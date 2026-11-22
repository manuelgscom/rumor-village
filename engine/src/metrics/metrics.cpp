// The results card of docs/medicion.md, computed from the header and the
// events of a log already read.
//
// Definitions. Everything is computed on identifiers.
//
// - The measured fact is the first one injected. Its original version is the
//   `slots` of that `inject`. Each neighbor's memory of it is rebuilt by
//   applying the `memory` events in order (each one brings the new state and
//   value); an `inject` also leaves its slots as sure in its `to` neighbors.
// - Knowing the fact: from the `inject` that names a neighbor in `to`, or from
//   being the `to` of a `turn` with act tell, not rejected, about the fact.
// - Decisions: `turn` + `plan`. Rejected: those whose reject is not none, over
//   the total.
// - Slots said: slots with a verdict other than omitted, in turns and plans not
//   rejected with a claim (any fact). Invented memories, contradictions and
//   hardened doubts: slots with that verdict, count and rate over slots said.
// - Version of a neighbor who knows the fact: wrong if it holds (sure or doubt)
//   some slot with a value other than the original (a slot without original
//   value counts as different); correct if it holds every slot of the original
//   with the original value; incomplete otherwise.
// - Reach: at the end, how many know the fact and how many in each version;
//   and a series every 30 ticks from start_tick up to the tick of `end`
//   (that tick included), each point after every event of its tick.
// - Attendance: from the `arrive` events of the fact, the first one of each
//   neighbor: right if place and slot match the original where and when;
//   other_time if only the place matches; other_place if the place does not.
//   Planned: neighbors whose last plan about the fact is a go, not rejected,
//   with where and when said and neither of them failed.
// - Hop: each turn with act tell, not rejected, about the fact, from A to B.
//   Deformation per hop, per slot: the hop counts for a slot only if A has
//   ever received a value for it (inject or told); what A received is the
//   value and state that the last hearing left in its memory. The slot changes
//   if it does not reach B (omitted or failed), if another value reaches B, or
//   if A received it as doubt and passes it unmarked. The cause, first match:
//     model          verdict contradiction or invented
//     hardened       verdict hardened_doubt
//     guess          verdict declared_guess with a value other than received
//     forgot         verdict omitted and A had it forgotten
//     omission       verdict omitted and A held it (sure or doubt)
//     doubt_dropped  verdict faithful, received as doubt, passed unmarked, and
//                    A had a memory event doubt_dropped since it received it
//   A declared guess of the received value is not a change.
// - Decision to tell: per conversation and participant P who knew the fact at
//   its start and had not told it to the other yet, one opportunity; told if P
//   makes a tell of the fact, not rejected, in that conversation. Total, by
//   relation (header relations; acquaintance without an edge) and by trait
//   of P.
// - Courtesy loops: conversations that end by max_turns, over all of them;
//   and repeats: tells of the fact, not rejected, from P to Q when P had
//   already told it to Q.
// - Rejected by reason: the count of each reject reason. A `go` that is not
//   rejected but ends without `where` or without `when` (not said, or failed)
//   is counted apart as go_incomplete: it is not written in the agenda.
// - Performance, from the `gen` of turns and plans and from the `perf`
//   events; null when the log has neither (the baseline). Times are wall
//   clock, so these figures change from run to run.
//     generation_ms       sum, over the ticks with decisions, of the time
//                         from the first start to the last end of that tick
//     decisions_per_s     decisions with `gen` over generation_ms
//     tokens_per_s        output tokens over generation_ms
//     decisions_per_tick  over the ticks with decisions: mean, p95 (nearest
//                         rank) and max; per_run_tick divides by every tick
//                         of the run instead
//     ms_per_tick         the time of each of those ticks: mean, p95, max
//     ms_per_decision     end minus start of each decision: mean, p95, max
//     batch               of the `perf` samples: count, mean and max size
//     vram_mb             the highest `perf` sample
// - Incoherent text: turns whose `text` contradicts their own claim (as
//   proposed), by src/card/textcheck. Only turns with text and a claim can be
//   checked: count and rate over those, and the slots contradicted. Null when
//   no turn has text (the baseline, or a run without text).

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/textcheck.h"
#include "core/metrics_api.h"

namespace rumor {
namespace {

using Json = nlohmann::ordered_json;

Json rate(int count, int total) {
    if (total == 0) return Json(nullptr);
    return static_cast<double>(count) / static_cast<double>(total);
}

enum class Cause : std::uint8_t { forgot, guess, doubt_dropped, model, hardened, omission };
constexpr std::array<const char*, 6> kCauseKeys = {"forgot", "guess",    "doubt_dropped",
                                                   "model",  "hardened", "omission"};

bool holds(SlotState s) { return s == SlotState::sure || s == SlotState::doubt; }

// One slot of one neighbor's memory of the measured fact.
struct SlotTrack {
    SlotState state = SlotState::unknown;
    std::optional<SlotValue> value;
    std::optional<SlotValue> received;  // value left by the last hearing
    SlotState received_state = SlotState::unknown;
    bool dropped = false;  // doubt dropped since the last hearing
};
using Track = PerSlot<SlotTrack>;

struct SlotDeformation {
    int hops = 0;
    int changed = 0;
    std::array<int, kCauseKeys.size()> by_cause{};
};

struct Tally {
    int opportunities = 0;
    int told = 0;
};

Json tally_json(const Tally& t) {
    Json j;
    j["opportunities"] = t.opportunities;
    j["told"] = t.told;
    j["rate"] = rate(t.told, t.opportunities);
    return j;
}

// Mean, p95 (nearest rank) and max of a list of numbers; null when empty.
Json spread(std::vector<std::int64_t> values) {
    if (values.empty()) return Json(nullptr);
    std::sort(values.begin(), values.end());
    std::int64_t sum = 0;
    for (const std::int64_t v : values) sum += v;
    const std::size_t rank = (values.size() * 95 + 99) / 100;  // ceil(0.95 n), at least 1
    Json j;
    j["mean"] = static_cast<double>(sum) / static_cast<double>(values.size());
    j["p95"] = values[rank - 1];
    j["max"] = values.back();
    return j;
}

enum class Version : std::uint8_t { correct, incomplete, wrong };

Version version_of(const Track& track, const PerSlot<std::optional<SlotValue>>& original) {
    bool complete = true;
    for (Slot s : kSlots) {
        const SlotTrack& t = track[idx(s)];
        const bool held = holds(t.state) && t.value.has_value();
        if (held && t.value != original[idx(s)]) return Version::wrong;
        if (original[idx(s)].has_value() && !held) complete = false;
    }
    return complete ? Version::correct : Version::incomplete;
}

struct Opportunity {
    NeighborId who;
    Relation relation = Relation::acquaintance;
    std::optional<Trait> trait;
    bool told = false;
};

struct Calculator {
    const LogHeader& header;
    std::map<std::pair<NeighborId, NeighborId>, Relation> relations;
    std::map<NeighborId, Trait> traits;

    int turns = 0;
    int plans = 0;
    int rejected = 0;
    std::array<int, enum_count<RejectReason>> rejected_by{};
    int go_incomplete = 0;
    int slots_said = 0;
    int invented = 0;
    int contradictions = 0;
    int hardened = 0;

    std::optional<InjectEvent> fact;  // the first inject
    std::map<NeighborId, Track> memory;
    std::set<NeighborId> informed;
    std::set<std::pair<NeighborId, NeighborId>> told_pairs;  // (teller, listener)

    int hops = 0;
    PerSlot<SlotDeformation> deformation{};

    std::vector<Opportunity> opportunities;
    std::map<ConvId, std::vector<std::size_t>> conv_opportunities;
    int conversations = 0;
    int max_turns = 0;
    int repeats = 0;

    std::map<NeighborId, ArriveEvent> arrivals;  // first one of each neighbor
    std::map<NeighborId, PlanEvent> last_plan;

    // Performance: the generation window of each tick and of each decision.
    struct TickGen {
        std::int64_t start = 0;
        std::int64_t end = 0;
        int decisions = 0;
    };
    std::map<Tick, TickGen> tick_gen;
    std::vector<std::int64_t> decision_ms;
    std::int64_t tokens_in = 0;
    std::int64_t tokens_out = 0;
    std::vector<PerfEvent> perf;

    // Incoherent text: the names come from the header, as the model read them.
    TextCheckContext text_context;
    int turns_with_text = 0;
    int text_with_claim = 0;
    int incoherent = 0;
    PerSlot<int> incoherent_by{};

    explicit Calculator(const LogHeader& h) : header(h) {
        text_context.lang = h.lang;
        for (const HeaderPlace& p : h.places) {
            if (!p.id.valid()) continue;
            if (text_context.places.size() <= p.id.index()) text_context.places.resize(p.id.index() + 1);
            text_context.places[p.id.index()] = p.name;
        }
        for (const Neighbor& n : h.neighbors) {
            if (!n.id.valid()) continue;
            if (text_context.neighbors.size() <= n.id.index()) {
                text_context.neighbors.resize(n.id.index() + 1);
            }
            text_context.neighbors[n.id.index()] = n.name;
        }
        for (const RelationEdge& e : h.relations) {
            relations[std::minmax(e.a, e.b)] = e.type;
        }
        for (const Neighbor& n : h.neighbors) traits[n.id] = n.trait;
    }

    bool is_fact(FactId f) const { return fact.has_value() && f.valid() && f == fact->fact; }

    Relation relation(NeighborId x, NeighborId y) const {
        const auto it = relations.find(std::minmax(x, y));
        return it == relations.end() ? Relation::acquaintance : it->second;
    }

    void count_decision(Tick tick, const Verdict& verdict, const std::optional<Generation>& gen) {
        if (verdict.reject != RejectReason::none) {
            ++rejected;
            ++rejected_by[static_cast<std::size_t>(verdict.reject)];
        }
        if (!gen) return;
        const auto [it, fresh] = tick_gen.try_emplace(tick, TickGen{gen->t_start_ms, gen->t_end_ms, 0});
        TickGen& g = it->second;
        if (!fresh) {
            g.start = std::min(g.start, gen->t_start_ms);
            g.end = std::max(g.end, gen->t_end_ms);
        }
        ++g.decisions;
        decision_ms.push_back(gen->t_end_ms - gen->t_start_ms);
        tokens_in += gen->tokens_in;
        tokens_out += gen->tokens_out;
    }

    void count_claim(const Verdict& verdict, const std::optional<Claim>& claim) {
        if (verdict.reject != RejectReason::none || !claim || !verdict.slots) return;
        for (SlotVerdict v : *verdict.slots) {
            if (v == SlotVerdict::omitted) continue;
            ++slots_said;
            if (v == SlotVerdict::invented) ++invented;
            if (v == SlotVerdict::contradiction) ++contradictions;
            if (v == SlotVerdict::hardened_doubt) ++hardened;
        }
    }

    void on(const InjectEvent& e) {
        if (!fact) fact = e;
        if (!is_fact(e.fact)) return;
        for (NeighborId n : e.to) {
            informed.insert(n);
            Track& track = memory[n];
            for (Slot s : kSlots) {
                const auto& value = e.slots[idx(s)];
                if (!value) continue;
                SlotTrack& t = track[idx(s)];
                t.state = SlotState::sure;
                t.value = value;
                t.received = value;
                t.received_state = SlotState::sure;
                t.dropped = false;
            }
        }
    }

    void on(const MemoryEvent& e) {
        if (!is_fact(e.fact)) return;
        SlotTrack& t = memory[e.who][idx(e.slot)];
        t.state = e.state;
        t.value = e.value;
        if ((e.cause == MemoryCause::told || e.cause == MemoryCause::inject) && holds(e.state) &&
            e.value) {
            t.received = e.value;
            t.received_state = e.state;
            t.dropped = false;
        }
        if (e.cause == MemoryCause::doubt_dropped) t.dropped = true;
    }

    void on(const ConvStartEvent& e) {
        ++conversations;
        if (!fact) return;
        for (const auto& [p, q] : {std::pair{e.a, e.b}, std::pair{e.b, e.a}}) {
            if (!informed.contains(p) || told_pairs.contains({p, q})) continue;
            Opportunity o;
            o.who = p;
            o.relation = relation(p, q);
            if (const auto it = traits.find(p); it != traits.end()) o.trait = it->second;
            conv_opportunities[e.conv].push_back(opportunities.size());
            opportunities.push_back(o);
        }
    }

    void on(const ConvEndEvent& e) {
        if (e.reason == ConvEndReason::max_turns) ++max_turns;
    }

    void on(const TurnEvent& e) {
        ++turns;
        count_decision(e.tick, e.verdict, e.gen);
        count_claim(e.verdict, e.claim);
        if (e.text) {
            ++turns_with_text;
            if (e.claim && e.verdict.reject == RejectReason::none) {
                ++text_with_claim;
                text_context.speaker = e.who;
                text_context.listener = e.to;
                const TextCheck check = check_text(text_context, *e.claim, e.tick, *e.text);
                if (check.any()) ++incoherent;
                for (Slot s : kSlots) {
                    if (check.contradicts[idx(s)]) ++incoherent_by[idx(s)];
                }
            }
        }
        const bool tell = e.verdict.reject == RejectReason::none && e.action == ActionType::say &&
                          e.act == Act::tell && is_fact(e.fact);
        if (!tell) return;

        ++hops;
        count_hop(e);
        if (!told_pairs.insert({e.who, e.to}).second) ++repeats;
        if (const auto it = conv_opportunities.find(e.conv); it != conv_opportunities.end()) {
            for (std::size_t i : it->second) {
                if (opportunities[i].who == e.who) opportunities[i].told = true;
            }
        }
        informed.insert(e.to);
    }

    void count_hop(const TurnEvent& e) {
        if (!e.claim || !e.verdict.slots) return;
        Track& speaker = memory[e.who];
        for (Slot s : kSlots) {
            const SlotTrack& a = speaker[idx(s)];
            if (!a.received) continue;
            SlotDeformation& d = deformation[idx(s)];
            ++d.hops;

            const SlotVerdict v = (*e.verdict.slots)[idx(s)];
            const auto& said = e.claim->slots[idx(s)];
            const bool marked = e.claim->guess[idx(s)];
            const bool reaches = v != SlotVerdict::omitted && !is_failure(v);
            const bool unmarked_doubt = a.received_state == SlotState::doubt && !marked;
            if (reaches && said == a.received && !unmarked_doubt) continue;
            ++d.changed;

            std::optional<Cause> cause;
            if (is_failure(v)) {
                cause = Cause::model;
            } else if (v == SlotVerdict::hardened_doubt) {
                cause = Cause::hardened;
            } else if (v == SlotVerdict::declared_guess && said != a.received) {
                cause = Cause::guess;
            } else if (v == SlotVerdict::omitted && a.state == SlotState::forgotten) {
                cause = Cause::forgot;
            } else if (v == SlotVerdict::omitted && holds(a.state)) {
                cause = Cause::omission;
            } else if (v == SlotVerdict::faithful && unmarked_doubt && a.dropped) {
                cause = Cause::doubt_dropped;
            }
            if (cause) ++d.by_cause[static_cast<std::size_t>(*cause)];
        }
    }

    void on(const PlanEvent& e) {
        ++plans;
        count_decision(e.tick, e.verdict, e.gen);
        if (e.action == ActionType::go && e.verdict.reject == RejectReason::none && !planned(e)) {
            ++go_incomplete;
        }
        count_claim(e.verdict, e.claim);
        if (is_fact(e.fact)) last_plan.insert_or_assign(e.who, e);
    }

    void on(const ArriveEvent& e) {
        if (is_fact(e.fact)) arrivals.try_emplace(e.who, e);
    }

    void on(const MoveEvent&) {}
    void on(const PerfEvent& e) { perf.push_back(e); }
    void on(const EndEvent&) {}

    // Neighbors who know the fact, and how many in each version.
    std::array<int, 3> versions() const {
        std::array<int, 3> count{};
        if (!fact) return count;
        for (NeighborId n : informed) {
            const auto it = memory.find(n);
            const Version v = version_of(it == memory.end() ? Track{} : it->second, fact->slots);
            ++count[static_cast<std::size_t>(v)];
        }
        return count;
    }

    bool planned(const PlanEvent& p) const {
        if (p.action != ActionType::go || p.verdict.reject != RejectReason::none) return false;
        if (!p.claim || !p.verdict.slots) return false;
        for (Slot s : {Slot::where, Slot::when}) {
            if (!p.claim->slots[idx(s)] || is_failure((*p.verdict.slots)[idx(s)])) return false;
        }
        return true;
    }
};

// The performance section; null when the log has no generation and no samples.
Json performance_json(const Calculator& calc, Tick run_ticks) {
    if (calc.tick_gen.empty() && calc.perf.empty()) return Json(nullptr);

    std::vector<std::int64_t> per_tick;
    std::vector<std::int64_t> tick_ms;
    std::int64_t generation_ms = 0;
    std::int64_t decisions = 0;
    for (const auto& [tick, g] : calc.tick_gen) {
        per_tick.push_back(g.decisions);
        tick_ms.push_back(g.end - g.start);
        generation_ms += g.end - g.start;
        decisions += g.decisions;
    }
    const auto per_second = [&](std::int64_t count) {
        if (generation_ms <= 0) return Json(nullptr);
        return Json(static_cast<double>(count) * 1000.0 / static_cast<double>(generation_ms));
    };

    Json p;
    p["decisions"] = decisions;
    p["tokens_in"] = calc.tokens_in;
    p["tokens_out"] = calc.tokens_out;
    p["generation_ms"] = generation_ms;
    p["decisions_per_s"] = per_second(decisions);
    p["tokens_per_s"] = per_second(calc.tokens_out);
    p["busy_ticks"] = per_tick.size();
    p["decisions_per_tick"] = spread(per_tick);
    p["decisions_per_run_tick"] =
        run_ticks > 0 ? Json(static_cast<double>(decisions) / static_cast<double>(run_ticks))
                      : Json(nullptr);
    p["ms_per_tick"] = spread(tick_ms);
    p["ms_per_decision"] = spread(calc.decision_ms);

    std::int64_t batch_sum = 0;
    int batch_max = 0;
    int vram = 0;
    for (const PerfEvent& e : calc.perf) {
        batch_sum += e.batch;
        batch_max = std::max(batch_max, e.batch);
        vram = std::max(vram, e.vram_mb);
    }
    Json& batch = p["batch"];
    batch["samples"] = calc.perf.size();
    batch["mean"] = calc.perf.empty() ? Json(nullptr)
                                      : Json(static_cast<double>(batch_sum) /
                                             static_cast<double>(calc.perf.size()));
    batch["max"] = batch_max;
    p["vram_mb"] = calc.perf.empty() ? Json(nullptr) : Json(vram);
    return p;
}

}  // namespace

nlohmann::ordered_json compute_metrics(const LogHeader& header, const std::vector<Event>& events) {
    Calculator calc(header);

    Tick end_tick = header.start_tick;
    bool has_end = false;
    for (const Event& e : events) {
        if (const auto* end = std::get_if<EndEvent>(&e)) {
            end_tick = end->tick;
            has_end = true;
        } else if (!has_end && event_tick(e) > end_tick) {
            end_tick = event_tick(e);
        }
    }

    std::vector<Tick> samples;
    for (Tick t = header.start_tick; t <= end_tick; t += kTicksPerSlot) samples.push_back(t);
    if (samples.empty() || samples.back() != end_tick) samples.push_back(end_tick);

    Json timeline = Json::array();
    std::size_t next = 0;
    const auto sample_until = [&](std::optional<Tick> before) {
        while (next < samples.size() && (!before || samples[next] < *before)) {
            const auto v = calc.versions();
            Json point;
            point["tick"] = samples[next];
            point["informed"] = calc.fact ? static_cast<int>(calc.informed.size()) : 0;
            point["correct"] = v[static_cast<std::size_t>(Version::correct)];
            timeline.push_back(std::move(point));
            ++next;
        }
    };
    for (const Event& e : events) {
        sample_until(event_tick(e));
        std::visit([&](const auto& ev) { calc.on(ev); }, e);
    }
    sample_until(std::nullopt);

    Json out;
    out["format"] = header.format;
    out["scenario"] = header.scenario;
    out["lang"] = std::string(key(header.lang));
    out["policy"] = header.policy;
    out["model"] = header.model ? Json(*header.model) : Json(nullptr);
    out["seed"] = header.seed;
    out["neighbors"] = header.neighbors.size();
    out["start_tick"] = header.start_tick;
    out["end_tick"] = end_tick;

    const int decisions = calc.turns + calc.plans;
    out["decisions"]["total"] = decisions;
    out["decisions"]["turns"] = calc.turns;
    out["decisions"]["plans"] = calc.plans;
    out["rejected"]["count"] = calc.rejected;
    out["rejected"]["total"] = decisions;
    out["rejected"]["rate"] = rate(calc.rejected, decisions);
    for (std::size_t i = 1; i < enum_count<RejectReason>; ++i) {
        out["rejected"]["by_reason"][std::string(EnumKeys<RejectReason>::keys[i])] =
            calc.rejected_by[i];
    }
    out["decisions"]["go_incomplete"] = calc.go_incomplete;

    out["slots_said"] = calc.slots_said;
    out["invented"]["count"] = calc.invented;
    out["invented"]["rate"] = rate(calc.invented, calc.slots_said);
    out["contradictions"]["count"] = calc.contradictions;
    out["contradictions"]["rate"] = rate(calc.contradictions, calc.slots_said);
    out["hardened_doubts"]["count"] = calc.hardened;
    out["hardened_doubts"]["rate"] = rate(calc.hardened, calc.slots_said);
    out["incoherent_text"] = nullptr;
    if (calc.turns_with_text > 0) {
        Json& text = out["incoherent_text"];
        text["turns_with_text"] = calc.turns_with_text;
        text["with_claim"] = calc.text_with_claim;
        text["count"] = calc.incoherent;
        text["rate"] = rate(calc.incoherent, calc.text_with_claim);
        for (Slot s : kSlots) {
            text["by_slot"][std::string(key(s))] = calc.incoherent_by[idx(s)];
        }
    }

    Json& deformation = out["deformation"];
    deformation["hops"] = calc.hops;
    for (Slot s : kSlots) {
        const SlotDeformation& d = calc.deformation[idx(s)];
        Json slot;
        slot["hops"] = d.hops;
        slot["changed"] = d.changed;
        slot["rate"] = rate(d.changed, d.hops);
        for (std::size_t c = 0; c < kCauseKeys.size(); ++c) {
            slot["by_cause"][kCauseKeys[c]] = d.by_cause[c];
        }
        deformation["by_slot"][std::string(key(s))] = std::move(slot);
    }

    const auto versions = calc.versions();
    Json& reach = out["reach"];
    reach["fact"] = calc.fact ? Json(calc.fact->fact.str()) : Json(nullptr);
    reach["informed"] = calc.fact ? static_cast<int>(calc.informed.size()) : 0;
    reach["correct"] = versions[static_cast<std::size_t>(Version::correct)];
    reach["incomplete"] = versions[static_cast<std::size_t>(Version::incomplete)];
    reach["wrong"] = versions[static_cast<std::size_t>(Version::wrong)];
    reach["timeline"] = std::move(timeline);

    int planned = 0;
    for (const auto& [who, plan] : calc.last_plan) {
        if (calc.planned(plan)) ++planned;
    }
    int right = 0, other_time = 0, other_place = 0;
    for (const auto& [who, a] : calc.arrivals) {
        const auto& where = calc.fact->slots[idx(Slot::where)];
        const auto& when = calc.fact->slots[idx(Slot::when)];
        const bool place_ok = where && static_cast<SlotValue>(a.place.v) == *where;
        if (!place_ok) {
            ++other_place;
        } else if (when && a.slot == *when) {
            ++right;
        } else {
            ++other_time;
        }
    }
    Json& attendance = out["attendance"];
    attendance["planned"] = planned;
    attendance["arrived"] = static_cast<int>(calc.arrivals.size());
    attendance["right"] = right;
    attendance["other_time"] = other_time;
    attendance["other_place"] = other_place;

    Tally total;
    std::array<Tally, kRelationCount> by_relation{};
    std::array<Tally, kTraitCount> by_trait{};
    for (const Opportunity& o : calc.opportunities) {
        for (Tally* t : {&total, &by_relation[static_cast<std::size_t>(o.relation)]}) {
            ++t->opportunities;
            if (o.told) ++t->told;
        }
        if (o.trait) {
            Tally& t = by_trait[static_cast<std::size_t>(*o.trait)];
            ++t.opportunities;
            if (o.told) ++t.told;
        }
    }
    Json& telling = out["telling"];
    telling["opportunities"] = total.opportunities;
    telling["told"] = total.told;
    telling["rate"] = rate(total.told, total.opportunities);
    telling["by_relation"] = Json::object();
    for (std::size_t i = 0; i < kRelationCount; ++i) {
        telling["by_relation"][std::string(EnumKeys<Relation>::keys[i])] =
            tally_json(by_relation[i]);
    }
    telling["by_trait"] = Json::object();
    for (std::size_t i = 0; i < kTraitCount; ++i) {
        telling["by_trait"][std::string(EnumKeys<Trait>::keys[i])] = tally_json(by_trait[i]);
    }

    Json& courtesy = out["courtesy"];
    courtesy["conversations"] = calc.conversations;
    courtesy["max_turns"] = calc.max_turns;
    courtesy["rate"] = rate(calc.max_turns, calc.conversations);
    courtesy["repeats"] = calc.repeats;

    out["performance"] = performance_json(calc, end_tick - header.start_tick);
    return out;
}

}  // namespace rumor
