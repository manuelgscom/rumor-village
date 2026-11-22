// The tick loop (docs/arquitectura.md, "El bucle de simulación"). One Sim per
// run; every step walks neighbors, places and conversations in identifier
// order, and all randomness is derived from (seed, tick, entity, stream).
//
// A live run adds a RunControl (core/live_api.h), asked before each tick. What
// it orders enters the loop at fixed points: injections in step 0 after those
// of the scenario, the screen before the decisions. Without one nothing
// changes, not even a byte of the log.

#include <algorithm>
#include <cstddef>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

#include "core/decision.h"
#include "core/memory_api.h"
#include "core/rng.h"
#include "core/sim_api.h"
#include "core/validate_api.h"

namespace rumor {
namespace {

// A trip in progress. `fact` is none for a timetable move.
struct Trip {
    PlaceId to;
    Tick arrive = 0;
    FactId fact;
    TimeSlot slot = 0;  // the `when` of the plan
};

// One planned visit: where and when, for one fact. Leaves once.
struct AgendaEntry {
    FactId fact;
    PlaceId place;
    TimeSlot slot = 0;
    bool done = false;
};

struct Resident {
    PlaceId place;              // where the neighbor is; meaningless while on a trip
    std::optional<Trip> trip;
    Memory memory;
    ConvId conv;                // none outside a conversation
    Tick rest_until = 0;        // may start a conversation from this tick
    Tick held_until = 0;        // a plan keeps the timetable away until this tick
    int offset = 0;             // minutes the timetable runs late for this neighbor
    std::vector<AgendaEntry> agenda;
};

struct Conversation {
    ConvId id;
    NeighborId a;  // spoke first
    NeighborId b;
    PlaceId place;
    NeighborId next;  // whose turn it is
    int turns = 0;
    std::vector<ConvEntry> entries;
};

// What a request of the batch is about, besides the request itself.
struct Pending {
    ConvId conv;  // turn
    FactId fact;  // plan
};

class Sim {
  public:
    Sim(const ScenarioParams& params, const World& world, const Population& population,
        const Vocab& vocab, Policy& policy, std::uint64_t seed, const RunSink& sink,
        RunControl* control)
        : p_(params), world_(world), people_(population), vocab_(vocab), policy_(policy),
          seed_(seed), sink_(sink), control_(control) {}

    void run() {
        check_inputs();
        sink_.header(header());
        setup();
        Tick stop = p_.end_tick;
        for (Tick t = p_.start_tick; t < p_.end_tick; ++t) {
            events_.clear();
            TickOrders orders;
            if (control_) {
                orders = control_->before_tick(t);
                if (orders.stop) {
                    stop = t;
                    break;
                }
                if (orders.visible) policy_.set_visible(*orders.visible);
            }
            inject(t, std::move(orders.injections));
            if (village()) move(t);
            forget(t);
            if (village()) meet_village(t);
            else meet_line(t);
            decide(t);
            for (const Event& e : events_) sink_.event(e);
            if (control_) control_->after_tick(t, quiet());
            // The telephone game is over when the chain reaches the last
            // neighbor or is cut: nothing else can happen.
            if (!village() && line_done_ && convs_.empty()) {
                stop = t + 1;
                break;
            }
        }
        EndEvent end;
        end.tick = stop;
        end.decisions = turns_ + plans_;
        end.turns = turns_;
        end.plans = plans_;
        end.rejected = rejected_;
        end.conversations = static_cast<int>(conv_count_);
        for (const Resident& r : residents_) end.informed += r.memory.facts.empty() ? 0 : 1;
        sink_.event(end);
    }

  private:
    const ScenarioParams& p_;
    const World& world_;
    const Population& people_;
    const Vocab& vocab_;
    Policy& policy_;
    std::uint64_t seed_;
    const RunSink& sink_;
    RunControl* control_;  // none in a recorded run

    std::vector<Resident> residents_;       // residents_[n.index()]
    std::vector<Conversation> convs_;       // active, by identifier
    std::uint32_t conv_count_ = 0;
    std::uint32_t fact_count_ = 0;
    std::map<std::pair<NeighborId, NeighborId>, Tick> last_talk_;  // end of the last conversation of a pair
    std::vector<std::pair<NeighborId, FactId>> plan_queue_;        // insertion order
    std::vector<Event> events_;                                    // of the current tick
    std::vector<LiveInjection> live_waiting_;                      // by place, nobody there yet
    int next_id_ = 0;
    int turns_ = 0;
    int plans_ = 0;
    int rejected_ = 0;

    // Line layout: the pair (line_i_, line_i_ + 1) talks next.
    std::uint32_t line_i_ = 1;
    int line_retries_ = 0;
    Tick line_next_ = 0;
    bool line_busy_ = false;
    bool line_done_ = false;

    // Built in place: moving a temporary Event trips a false maybe-uninitialized
    // warning of GCC 13 on std::variant.
    template <class E>
    void emit(E e) {
        events_.emplace_back(std::in_place_type<E>, std::move(e));
    }

    bool village() const { return p_.layout == Layout::village; }
    Resident& res(NeighborId n) { return residents_[n.index()]; }

    void check_inputs() const {
        if (people_.neighbors.size() != static_cast<std::size_t>(p_.neighbors)) {
            throw std::runtime_error("population has " + std::to_string(people_.neighbors.size()) +
                                     " neighbors, the scenario wants " + std::to_string(p_.neighbors));
        }
        if (world_.places.size() != kPlaceCount ||
            world_.routes.size() != kPlaceCount * kPlaceCount) {
            throw std::runtime_error("world does not cover the place catalog");
        }
    }

    LogHeader header() const {
        LogHeader h;
        h.seed = seed_;
        h.scenario = p_.name;
        h.lang = p_.lang;
        h.policy = policy_.name();
        h.model = policy_.model();
        h.params = {
            {"neighbors", p_.neighbors},       {"end_tick", p_.end_tick},
            {"forget_ppm", p_.forget_ppm},     {"doubt_drop_ppm", p_.doubt_drop_ppm},
            {"max_turns", p_.max_turns},       {"meet_ppm", p_.meet_ppm},
            {"pair_cooldown", p_.pair_cooldown}, {"rest_ticks", p_.rest_ticks},
            {"stay_ticks", p_.stay_ticks},     {"hop_gap", p_.hop_gap},
            {"hop_retries", p_.hop_retries},
        };
        // Only when it leans the draw: the logs of 0 stay as they were.
        if (p_.trait_mix != 0) h.params.emplace_back("trait_mix", p_.trait_mix);
        h.start_tick = p_.start_tick;
        h.start_weekday = p_.start_weekday;
        for (const Place& place : world_.places) {
            const PlaceInfo& info = place_info(place.id);
            h.places.push_back(HeaderPlace{place.id, std::string(info.key), vocab_.place(place.id),
                                           info.kind, place.at.x, place.at.y});
        }
        for (const Place& from : world_.places) {
            for (const Place& to : world_.places) {
                if (from.id < to.id) h.routes.push_back(world_.route(from.id, to.id));
            }
        }
        h.neighbors = people_.neighbors;
        h.relations = people_.relations;
        return h;
    }

    // Nothing worth watching in the tick just done (RunControl::after_tick): no
    // event carries a fact, no open conversation has somebody who knows one,
    // and no injection by place waits for somebody. Reads, never writes.
    bool quiet() const {
        if (!live_waiting_.empty()) return false;
        for (const Event& e : events_) {
            const bool fact = std::visit(
                [](const auto& x) {
                    using E = std::decay_t<decltype(x)>;
                    if constexpr (std::is_same_v<E, InjectEvent> || std::is_same_v<E, MemoryEvent>) {
                        return true;
                    } else if constexpr (std::is_same_v<E, TurnEvent> || std::is_same_v<E, PlanEvent> ||
                                         std::is_same_v<E, ArriveEvent> || std::is_same_v<E, MoveEvent>) {
                        return x.fact.valid();
                    } else {
                        return false;
                    }
                },
                e);
            if (fact) return false;
        }
        for (const Conversation& c : convs_) {
            if (!residents_[c.a.index()].memory.facts.empty() ||
                !residents_[c.b.index()].memory.facts.empty()) {
                return false;
            }
        }
        return true;
    }

    // --- Places and time -------------------------------------------------------

    Tick duration(PlaceId from, PlaceId to) const {
        return from == to ? 0 : world_.route(from, to).ticks;
    }

    // Where the timetable wants a neighbor at tick t: hour h rules from
    // h*60 + offset.
    PlaceId scheduled(NeighborId n, Tick t) const {
        const Neighbor& who = people_.at(n);
        const int minute = (minute_of_day(t) - res_offset(n) + kTicksPerDay) % kTicksPerDay;
        return world_.scheduled(who.job, minute / kTicksPerHour, who.home);
    }
    int res_offset(NeighborId n) const { return residents_[n.index()].offset; }

    void setup() {
        residents_.resize(people_.neighbors.size());
        for (std::size_t i = 0; i < residents_.size(); ++i) {
            const NeighborId n = NeighborId::from_index(i);
            Resident& r = residents_[i];
            Rng rng(derive_seed(seed_, 0, n, Stream::schedule));
            r.offset = rng.range(0, 19);
            r.place = village() ? scheduled(n, p_.start_tick) : PlaceId(1);
        }
        line_next_ = p_.start_tick + p_.hop_gap;
    }

    // --- Step 0: injections ------------------------------------------------------

    // Those of the scenario first, then those from outside in order of
    // arrival: the ones still waiting for somebody at their place, then the
    // new ones.
    void inject(Tick t, std::vector<LiveInjection> live) {
        for (const Injection& inj : p_.injections) {
            if (inj.tick == t) apply_injection(t, inj);
        }
        if (live_waiting_.empty() && live.empty()) return;
        std::vector<LiveInjection> queue = std::move(live_waiting_);
        live_waiting_.clear();
        for (LiveInjection& order : live) queue.push_back(std::move(order));
        for (LiveInjection& order : queue) {
            if (order.place) {
                order.fact.to = present_at(*order.place);
                if (order.fact.to.empty()) {
                    live_waiting_.push_back(std::move(order));
                    continue;
                }
            }
            // The server checks receivers before queueing: an order that still
            // names nobody, or somebody who does not exist, is dropped rather
            // than allowed to touch memory out of range.
            if (!known_receivers(order.fact.to)) continue;
            apply_injection(t, order.fact);
        }
    }

    // One fact, receivers already resolved, enters at tick t (inj.tick is not
    // read): the same for the scenario and for a live run.
    void apply_injection(Tick t, const Injection& inj) {
        const Fact fact{FactId(++fact_count_), inj.what, inj.slots};
        emit(InjectEvent{t, fact.id, inj.text, inj.what, inj.slots, inj.to});
        std::vector<MemoryEvent> changes;
        for (NeighborId n : inj.to) memory_inject(res(n).memory, n, fact, t, changes);
        for (MemoryEvent& m : changes) emit(std::move(m));
        if (village()) {
            for (NeighborId n : inj.to) queue_plan(n, fact.id);
        }
    }

    // Who is at a place right now and not on a trip, in identifier order.
    std::vector<NeighborId> present_at(PlaceId place) const {
        std::vector<NeighborId> out;
        for (std::size_t i = 0; i < residents_.size(); ++i) {
            const Resident& r = residents_[i];
            if (!r.trip && r.place == place) out.push_back(NeighborId::from_index(i));
        }
        return out;
    }

    bool known_receivers(const std::vector<NeighborId>& to) const {
        if (to.empty()) return false;
        for (NeighborId n : to) {
            if (!n.valid() || n.index() >= residents_.size()) return false;
        }
        return true;
    }

    void queue_plan(NeighborId n, FactId fact) {
        const auto item = std::make_pair(n, fact);
        if (std::find(plan_queue_.begin(), plan_queue_.end(), item) == plan_queue_.end()) {
            plan_queue_.push_back(item);
        }
    }

    // --- Step 1: moves -------------------------------------------------------------

    void arrive(Tick t, NeighborId n, PlaceId place, FactId fact, TimeSlot slot) {
        emit(ArriveEvent{t, n, place, fact, slot});
        res(n).held_until = std::max(t, tick_of(slot)) + p_.stay_ticks;
    }

    void move(Tick t) {
        // Arrivals.
        for (std::size_t i = 0; i < residents_.size(); ++i) {
            Resident& r = residents_[i];
            if (!r.trip || r.trip->arrive != t) continue;
            const Trip trip = *r.trip;
            r.trip.reset();
            r.place = trip.to;
            if (trip.fact) arrive(t, NeighborId::from_index(i), trip.to, trip.fact, trip.slot);
        }
        // Agenda: one entry at most leaves per neighbor and tick.
        for (std::size_t i = 0; i < residents_.size(); ++i) {
            Resident& r = residents_[i];
            if (r.trip || r.conv) continue;
            const NeighborId n = NeighborId::from_index(i);
            for (AgendaEntry& entry : r.agenda) {
                if (entry.done) continue;
                const Tick d = duration(r.place, entry.place);
                if (t < tick_of(entry.slot) - d) continue;
                entry.done = true;
                if (d == 0) {
                    // Already there: t >= tick_of(slot), so it arrives now.
                    arrive(t, n, entry.place, entry.fact, entry.slot);
                } else {
                    emit(MoveEvent{t, n, r.place, entry.place, t + d, entry.fact});
                    r.trip = Trip{entry.place, t + d, entry.fact, entry.slot};
                }
                break;
            }
        }
        // Timetable.
        for (std::size_t i = 0; i < residents_.size(); ++i) {
            Resident& r = residents_[i];
            if (r.trip || r.conv || t < r.held_until) continue;
            const NeighborId n = NeighborId::from_index(i);
            const PlaceId target = scheduled(n, t);
            if (target == r.place) continue;
            const Tick arrive_at = t + duration(r.place, target);
            emit(MoveEvent{t, n, r.place, target, arrive_at, FactId()});
            r.trip = Trip{target, arrive_at, FactId(), 0};
        }
    }

    // --- Step 2: forgetting ------------------------------------------------------

    void forget(Tick t) {
        std::vector<MemoryEvent> changes;
        for (std::size_t i = 0; i < residents_.size(); ++i) {
            Resident& r = residents_[i];
            if (r.memory.facts.empty()) continue;
            memory_forget(r.memory, NeighborId::from_index(i), p_.forget_ppm, p_.doubt_drop_ppm,
                          seed_, t, changes);
        }
        for (MemoryEvent& m : changes) emit(std::move(m));
    }

    // --- Step 3: encounters ------------------------------------------------------

    void open(Tick t, NeighborId a, NeighborId b, PlaceId place) {
        const ConvId id(++conv_count_);
        convs_.push_back(Conversation{id, a, b, place, a, 0, {}});
        res(a).conv = id;
        res(b).conv = id;
        emit(ConvStartEvent{t, id, a, b, place});
    }

    static std::pair<NeighborId, NeighborId> pair_key(NeighborId x, NeighborId y) {
        return x < y ? std::make_pair(x, y) : std::make_pair(y, x);
    }

    bool cooling(NeighborId a, NeighborId b, Tick t) const {
        const auto it = last_talk_.find(pair_key(a, b));
        return it != last_talk_.end() && t < it->second + p_.pair_cooldown;
    }

    void meet_village(Tick t) {
        if (t + p_.max_turns > p_.end_tick) return;  // every conversation ends inside the run
        for (const Place& place : world_.places) {
            if (!is_public(place.id)) continue;
            std::vector<NeighborId> free;
            for (std::size_t i = 0; i < residents_.size(); ++i) {
                const Resident& r = residents_[i];
                if (!r.trip && r.place == place.id && !r.conv && t >= r.rest_until) {
                    free.push_back(NeighborId::from_index(i));
                }
            }
            if (free.size() < 2) continue;
            Rng rng(derive_seed(seed_, t, place.id.v, Stream::encounter));
            rng.shuffle(free);
            for (std::size_t k = 0; k + 1 < free.size(); k += 2) {
                if (cooling(free[k], free[k + 1], t)) continue;
                if (rng.chance_ppm(p_.meet_ppm)) open(t, free[k], free[k + 1], place.id);
            }
        }
    }

    void meet_line(Tick t) {
        if (line_done_ || line_busy_ || t < line_next_ || t + p_.max_turns > p_.end_tick) return;
        if (line_i_ + 1 > people_.neighbors.size()) {
            line_done_ = true;
            return;
        }
        open(t, NeighborId(line_i_), NeighborId(line_i_ + 1), PlaceId(1));
        line_busy_ = true;
    }

    // After a conversation of the line: the fact passed when the second
    // neighbor knows every fact the first one knows.
    void line_after(Tick t, const Conversation& c) {
        line_busy_ = false;
        line_next_ = t + p_.hop_gap;
        const Memory& from = res(c.a).memory;
        const Memory& to = res(c.b).memory;
        bool passed = !from.facts.empty();
        for (const Belief& b : from.facts) passed = passed && to.find(b.fact) != nullptr;
        if (passed) {
            ++line_i_;
            line_retries_ = 0;
            if (line_i_ + 1 > people_.neighbors.size()) line_done_ = true;
        } else if (line_retries_ < p_.hop_retries) {
            ++line_retries_;
        } else {
            line_done_ = true;  // the chain is cut
        }
    }

    // --- Steps 4 to 6: decisions -------------------------------------------------

    Conversation* find_conv(ConvId id) {
        for (Conversation& c : convs_) {
            if (c.id == id) return &c;
        }
        return nullptr;
    }

    DecisionRequest request(Tick t, DecisionKind kind, NeighborId n, int trigger) {
        const Resident& r = res(n);
        const Neighbor& who = people_.at(n);
        DecisionRequest q;
        q.kind = kind;
        q.seed = derive_seed(seed_, t, n, kind == DecisionKind::turn ? Stream::turn : Stream::plan);
        q.tick = t;
        q.weekday = weekday_of(t, p_.start_weekday);
        q.self = n;
        q.job = who.job;
        q.trait = who.trait;
        q.place = r.trip ? r.trip->to : r.place;
        if (const Conversation* c = find_conv(r.conv)) {
            q.other = c->a == n ? c->b : c->a;
            q.relation = people_.relation(n, q.other);
            q.conversation = c->entries;
        }
        q.facts = r.memory.facts;
        q.trigger_fact = trigger;
        q.neighbor_count = static_cast<int>(people_.neighbors.size());
        return q;
    }

    static int fact_number(const Memory& memory, FactId fact) {
        for (std::size_t i = 0; i < memory.facts.size(); ++i) {
            if (memory.facts[i].fact == fact) return static_cast<int>(i) + 1;
        }
        return 0;
    }

    void decide(Tick t) {
        std::vector<DecisionRequest> batch;
        std::vector<Pending> pending;

        // Plans: one per neighbor and tick, in neighbor order; the rest waits.
        std::stable_sort(plan_queue_.begin(), plan_queue_.end(),
                         [](const auto& x, const auto& y) { return x.first < y.first; });
        std::vector<std::pair<NeighborId, FactId>> later;
        NeighborId last;
        for (const auto& [n, fact] : plan_queue_) {
            if (n == last) {
                later.push_back({n, fact});
                continue;
            }
            last = n;
            batch.push_back(request(t, DecisionKind::plan, n, fact_number(res(n).memory, fact)));
            pending.push_back(Pending{ConvId(), fact});
        }
        plan_queue_ = std::move(later);

        // Turns: one per active conversation, in conversation order.
        for (const Conversation& c : convs_) {
            batch.push_back(request(t, DecisionKind::turn, c.next, 0));
            pending.push_back(Pending{c.id, FactId()});
        }

        if (batch.empty()) return;
        const std::vector<Decision> answers = policy_.decide(batch);
        if (answers.size() != batch.size()) {
            throw std::runtime_error("policy returned " + std::to_string(answers.size()) +
                                     " decisions for " + std::to_string(batch.size()) + " requests");
        }
        for (std::size_t i = 0; i < batch.size(); ++i) {
            const int id = ++next_id_;
            if (batch[i].kind == DecisionKind::turn) {
                apply_turn(t, id, pending[i].conv, batch[i], answers[i]);
            } else {
                apply_plan(t, id, batch[i], answers[i]);
            }
        }
        // What the model runtime measured while deciding this tick.
        for (const PerfSample& s : policy_.take_perf()) {
            emit(PerfEvent{t, s.batch, s.tokens_per_s, s.decisions_per_s_milli, s.vram_mb});
        }
    }

    static bool rejected(const Validated& v) { return v.verdict.reject != RejectReason::none; }

    void apply_turn(Tick t, int id, ConvId conv_id, const DecisionRequest& q, const Decision& d) {
        Conversation& c = *find_conv(conv_id);
        const Validated v = validate(q, d);
        const Action& act = v.action;
        ++turns_;
        if (rejected(v)) ++rejected_;
        ++c.turns;

        TurnEvent e;
        e.tick = t;
        e.id = id;
        e.conv = c.id;
        e.n = c.turns;
        e.who = q.self;
        e.to = q.other;
        e.card = fingerprint(q);
        e.action = act.type;
        e.act = act.act;
        const Belief* belief = act.fact ? &q.facts[static_cast<std::size_t>(*act.fact - 1)] : nullptr;
        if (belief) e.fact = belief->fact;
        if (!rejected(v)) e.claim = d.action.claim;
        e.verdict = v.verdict;
        e.text = act.text;
        e.gen = d.gen;

        std::vector<MemoryEvent> changes;
        const bool tell = act.type == ActionType::say && act.act == Act::tell && belief && act.claim;
        if (tell) {
            Resident& listener = res(q.other);
            const Belief* before = listener.memory.find(belief->fact);
            const bool knew = before != nullptr;
            const SlotBelief where_before = knew ? before->slots[idx(Slot::where)] : SlotBelief{};
            const SlotBelief when_before = knew ? before->slots[idx(Slot::when)] : SlotBelief{};
            e.conflicts = memory_hear(listener.memory, q.other, q.self, belief->fact, belief->what,
                                      *act.claim, t, id, changes);
            memory_mark_told(res(q.self).memory, belief->fact, q.other);

            const Belief* after = listener.memory.find(belief->fact);
            if (village() && after) {
                const bool changed = !knew || !same(where_before, after->slots[idx(Slot::where)]) ||
                                     !same(when_before, after->slots[idx(Slot::when)]);
                if (changed && worth_a_plan(*after, t)) queue_plan(q.other, belief->fact);
            }
        }
        emit(std::move(e));
        for (MemoryEvent& m : changes) emit(std::move(m));

        if (act.type == ActionType::say) {
            c.entries.push_back(
                ConvEntry{q.self, *act.act, belief ? belief->fact : FactId(), tell ? act.claim : std::nullopt});
        }

        std::optional<ConvEndReason> end;
        if (act.type != ActionType::say) end = ConvEndReason::none;
        else if (act.act == Act::bye) end = ConvEndReason::bye;
        else if (c.turns >= p_.max_turns) end = ConvEndReason::max_turns;
        if (!end) {
            c.next = q.other;
            return;
        }

        emit(ConvEndEvent{t, c.id, *end});
        for (NeighborId n : {c.a, c.b}) {
            res(n).conv = ConvId();
            res(n).rest_until = t + p_.rest_ticks;
        }
        last_talk_[pair_key(c.a, c.b)] = t;
        const Conversation ended = c;
        convs_.erase(convs_.begin() + (&c - convs_.data()));
        if (!village()) line_after(t, ended);
    }

    static bool same(const SlotBelief& x, const SlotBelief& y) {
        return x.state == y.state && x.value == y.value;
    }

    // A fact deserves a plan when it has a place or a time, and that time (if
    // any) has not passed.
    static bool worth_a_plan(const Belief& b, Tick t) {
        const auto& where = b.slots[idx(Slot::where)].value;
        const auto& when = b.slots[idx(Slot::when)].value;
        if (!where && !when) return false;
        return !when || tick_of(*when) >= t;
    }

    void apply_plan(Tick t, int id, const DecisionRequest& q, const Decision& d) {
        const Validated v = validate(q, d);
        const Action& act = v.action;
        ++plans_;
        if (rejected(v)) ++rejected_;

        PlanEvent e;
        e.tick = t;
        e.id = id;
        e.who = q.self;
        e.card = fingerprint(q);
        e.action = act.type;
        // The fact the decision is about: the one of the `go`, or the one that
        // prompted the plan when the neighbor decides not to go.
        if (!rejected(v)) {
            const int number = act.fact ? *act.fact : q.trigger_fact;
            if (number >= 1 && static_cast<std::size_t>(number) <= q.facts.size()) {
                e.fact = q.facts[static_cast<std::size_t>(number - 1)].fact;
            }
            e.claim = d.action.claim;
        }
        e.verdict = v.verdict;
        e.gen = d.gen;

        // The last decision about a fact rules: it replaces a visit that has
        // not left yet. A `go` needs a place and a time to be written down.
        if (e.fact) {
            std::vector<AgendaEntry>& agenda = res(q.self).agenda;
            std::erase_if(agenda, [&](const AgendaEntry& a) { return !a.done && a.fact == e.fact; });
            if (act.type == ActionType::go && act.claim) {
                const auto& where = act.claim->slots[idx(Slot::where)];
                const auto& when = act.claim->slots[idx(Slot::when)];
                if (where && when) {
                    agenda.push_back(
                        AgendaEntry{e.fact, PlaceId(static_cast<std::uint32_t>(*where)), *when, false});
                }
            }
        }
        emit(std::move(e));
    }
};

}  // namespace

void run_simulation(const ScenarioParams& params, const World& world, const Population& population,
                    const Vocab& vocab, Policy& policy, std::uint64_t seed, const RunSink& sink,
                    RunControl* control) {
    Sim(params, world, population, vocab, policy, seed, sink, control).run();
}

}  // namespace rumor
