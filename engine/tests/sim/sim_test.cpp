#include <doctest/doctest.h>

#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <set>
#include <span>
#include <sstream>
#include <string>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

#include "core/live_api.h"
#include "core/log_api.h"
#include "core/rng.h"
#include "core/sim_api.h"

using namespace rumor;

namespace {

// --- Hand-made world, population and vocabulary ---------------------------------

World test_world(Tick ticks) {
    World w;
    for (std::size_t i = 0; i < kPlaceCount; ++i) {
        w.places.push_back(Place{PlaceId::from_index(i), Point{static_cast<int>(i) * 10, 0}});
    }
    w.routes.resize(kPlaceCount * kPlaceCount);
    for (const Place& from : w.places) {
        for (const Place& to : w.places) {
            if (from.id == to.id) continue;
            w.routes[from.id.index() * kPlaceCount + to.id.index()] =
                Route{from.id, to.id, ticks, {from.at, to.at}};
        }
    }
    return w;
}

void always_at(World& w, Job job, PlaceId place) {
    w.timetable[static_cast<std::size_t>(job)].fill(place);
}

Population test_population(int count, Job job = Job::retired) {
    Population p;
    for (int i = 1; i <= count; ++i) {
        p.neighbors.push_back(Neighbor{NeighborId(static_cast<std::uint32_t>(i)),
                                       "N" + std::to_string(i), i % 2 == 1, job, Trait::sociable,
                                       PlaceId(13)});
    }
    return p;
}

Vocab test_vocab() {
    Vocab v;
    for (std::size_t i = 0; i < kPlaceCount; ++i) v.places[i] = "name-" + std::string(kPlaces[i].key);
    return v;
}

ScenarioParams village(int neighbors, Tick start, Tick end) {
    ScenarioParams p;
    p.name = "test";
    p.neighbors = neighbors;
    p.layout = Layout::village;
    p.start_tick = start;
    p.end_tick = end;
    p.start_weekday = 1;
    p.max_turns = 4;
    p.meet_ppm = kPpm;
    p.pair_cooldown = 10;
    p.rest_ticks = 2;
    p.stay_ticks = 30;
    return p;
}

Injection party(Tick tick, std::vector<NeighborId> to, PlaceId where, TimeSlot when) {
    Injection inj;
    inj.tick = tick;
    inj.what = "party";
    inj.slots[idx(Slot::who)] = 1;
    inj.slots[idx(Slot::where)] = static_cast<SlotValue>(where.v);
    inj.slots[idx(Slot::when)] = when;
    inj.slots[idx(Slot::amount)] = 50;
    inj.to = std::move(to);
    return inj;
}

// --- Test policies ----------------------------------------------------------------

using Answer = std::function<Decision(const DecisionRequest&)>;

Decision none() { return Decision{}; }

Decision say(Act act) {
    Decision d;
    d.action.type = ActionType::say;
    d.action.act = act;
    return d;
}

// What a neighbor can state without failing validation: sure values as they
// are, doubts as guesses.
Claim claim_of(const Belief& b) {
    Claim c;
    for (Slot s : kSlots) {
        const SlotBelief& slot = b.slots[idx(s)];
        if (slot.state == SlotState::sure || slot.state == SlotState::doubt) {
            c.slots[idx(s)] = slot.value;
            c.guess[idx(s)] = slot.state == SlotState::doubt;
        }
    }
    return c;
}

Decision tell(const DecisionRequest& q, int fact) {
    Decision d = say(Act::tell);
    d.action.fact = fact;
    d.action.claim = claim_of(q.facts[static_cast<std::size_t>(fact - 1)]);
    return d;
}

Decision go(const DecisionRequest& q) {
    Decision d;
    d.action.type = ActionType::go;
    d.action.fact = q.trigger_fact;
    d.action.claim = claim_of(q.facts[static_cast<std::size_t>(q.trigger_fact - 1)]);
    return d;
}

Decision greet_always(const DecisionRequest& q) {
    return q.kind == DecisionKind::turn ? say(Act::greet) : none();
}

Decision tell_always(const DecisionRequest& q) {
    if (q.kind == DecisionKind::plan) return go(q);
    return q.facts.empty() ? say(Act::greet) : tell(q, 1);
}

// Depends only on the request, through its seed.
Decision random_answer(const DecisionRequest& q) {
    Rng rng(q.seed);
    if (q.kind == DecisionKind::plan) return rng.chance_ppm(kPpm / 2) ? go(q) : none();
    switch (rng.below(5)) {
        case 0: return say(Act::greet);
        case 1: return say(Act::bye);
        case 2: return none();
        default: return q.facts.empty() ? say(Act::greet) : tell(q, 1);
    }
}

// Answers with `answer` and checks the batch rules on every call: one tick per
// call, ticks only go forward, plans before turns, and each seed derived from
// (run seed, tick, neighbor, kind).
class TestPolicy : public Policy {
  public:
    TestPolicy(std::uint64_t seed, Answer answer) : seed_(seed), answer_(std::move(answer)) {}

    std::string name() const override { return "test"; }

    std::vector<Decision> decide(std::span<const DecisionRequest> batch) override {
        REQUIRE_FALSE(batch.empty());
        const Tick tick = batch.front().tick;
        CHECK(tick > last_tick_);
        last_tick_ = tick;
        bool turns_started = false;
        std::vector<Decision> out;
        for (const DecisionRequest& q : batch) {
            CHECK(q.tick == tick);
            const Stream stream = q.kind == DecisionKind::turn ? Stream::turn : Stream::plan;
            CHECK(q.seed == derive_seed(seed_, q.tick, q.self, stream));
            if (q.kind == DecisionKind::turn) turns_started = true;
            CHECK_FALSE((turns_started && q.kind == DecisionKind::plan));
            out.push_back(answer_(q));
        }
        batches.emplace_back(batch.begin(), batch.end());
        return out;
    }

    void set_visible(std::span<const NeighborId> neighbors) override {
        visible.emplace_back(neighbors.begin(), neighbors.end());
    }

    std::vector<std::vector<DecisionRequest>> batches;
    std::vector<std::vector<NeighborId>> visible;  // every list received, in order

  private:
    std::uint64_t seed_;
    Answer answer_;
    Tick last_tick_ = -1;
};

struct Run {
    LogHeader header;
    std::vector<Event> events;
    std::vector<std::vector<DecisionRequest>> batches;
    std::vector<std::vector<NeighborId>> visible;

    template <class E>
    std::vector<E> all() const {
        std::vector<E> out;
        for (const Event& e : events) {
            if (const E* x = std::get_if<E>(&e)) out.push_back(*x);
        }
        return out;
    }
};

Run simulate(const ScenarioParams& params, const World& world, const Population& population,
             std::uint64_t seed, Answer answer, RunControl* control = nullptr) {
    TestPolicy policy(seed, std::move(answer));
    Run run;
    int headers = 0;
    RunSink sink;
    sink.header = [&](const LogHeader& h) {
        ++headers;
        run.header = h;
    };
    sink.event = [&](const Event& e) { run.events.push_back(e); };
    run_simulation(params, world, population, test_vocab(), policy, seed, sink, control);
    CHECK(headers == 1);
    run.batches = std::move(policy.batches);
    run.visible = std::move(policy.visible);
    return run;
}

// --- Live runs ------------------------------------------------------------------------

// Gives the orders written for each tick, and remembers every tick it was asked
// about and what it heard after each one.
class ScriptedControl : public RunControl {
  public:
    TickOrders before_tick(Tick t) override {
        asked.push_back(t);
        const auto it = script.find(t);
        if (it == script.end()) return {};
        return std::move(it->second);
    }
    void after_tick(Tick t, bool quiet) override { after.emplace_back(t, quiet); }

    std::map<Tick, TickOrders> script;
    std::vector<Tick> asked;
    std::vector<std::pair<Tick, bool>> after;  // (tick, quiet), in order
};

// Whether an event carries a fact (the first rule of a quiet tick).
bool carries_fact(const Event& e) {
    return std::visit(
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
}

LiveInjection to_neighbors(std::vector<NeighborId> to) {
    return LiveInjection{party(0, std::move(to), PlaceId(1), 30), std::nullopt};
}

LiveInjection to_place(PlaceId place) {
    return LiveInjection{party(0, {}, PlaceId(1), 30), place};
}

// The neighbors whose memory an injection wrote, in order of first change.
std::vector<NeighborId> injected(const Run& run, FactId fact, Tick tick) {
    std::vector<NeighborId> out;
    for (const MemoryEvent& m : run.all<MemoryEvent>()) {
        if (m.fact != fact || m.cause != MemoryCause::inject) continue;
        CHECK(m.tick == tick);
        if (out.empty() || out.back() != m.who) out.push_back(m.who);
    }
    return out;
}

// Twelve neighbors of three jobs that meet at the square and the bar and go
// home, with one fact in the village.
struct Busy {
    World world = test_world(4);
    Population population;
    ScenarioParams params = village(12, 480, 720);

    Busy() {
        for (int h = 0; h < 24; ++h) {
            const auto hour = static_cast<std::size_t>(h);
            world.timetable[static_cast<std::size_t>(Job::baker)][hour] = PlaceId(h % 2 == 0 ? 1 : 2);
            world.timetable[static_cast<std::size_t>(Job::farmer)][hour] = h % 3 == 0 ? PlaceId() : PlaceId(1);
        }
        always_at(world, Job::retired, PlaceId(2));
        population = test_population(12);
        for (std::size_t i = 0; i < 12; ++i) {
            population.neighbors[i].job = i % 3 == 0 ? Job::baker : i % 3 == 1 ? Job::farmer : Job::retired;
        }
        params.meet_ppm = 300'000;
        params.forget_ppm = 5'000;
        params.doubt_drop_ppm = 50'000;
        params.injections = {party(490, {NeighborId(1), NeighborId(5)}, PlaceId(1), 22)};
    }
};

}  // namespace

TEST_SUITE("sim") {

TEST_CASE("the header carries the scenario, the world and the people") {
    World world = test_world(3);
    always_at(world, Job::retired, PlaceId(1));
    const Population population = test_population(4);
    ScenarioParams params = village(4, 480, 490);
    params.forget_ppm = 7;
    const Run run = simulate(params, world, population, 9, greet_always);

    const LogHeader& h = run.header;
    CHECK(h.format == kLogFormat);
    CHECK(h.seed == 9);
    CHECK(h.scenario == "test");
    CHECK(h.policy == "test");
    CHECK_FALSE(h.model.has_value());
    CHECK(h.start_tick == 480);
    CHECK(h.start_weekday == 1);
    CHECK(h.tick_seconds == kTickSeconds);
    const std::vector<std::string> names = {"neighbors", "end_tick", "forget_ppm", "doubt_drop_ppm",
                                            "max_turns", "meet_ppm", "pair_cooldown", "rest_ticks",
                                            "stay_ticks", "hop_gap", "hop_retries"};
    REQUIRE(h.params.size() == names.size());
    for (std::size_t i = 0; i < names.size(); ++i) CHECK(h.params[i].first == names[i]);
    CHECK(h.params[0].second == 4);
    CHECK(h.params[1].second == 490);
    CHECK(h.params[2].second == 7);
    REQUIRE(h.places.size() == kPlaceCount);
    CHECK(h.places[0].key == "square");
    CHECK(h.places[0].name == "name-square");
    CHECK(h.places[12].kind == PlaceKind::home);
    CHECK(h.routes.size() == kPlaceCount * (kPlaceCount - 1) / 2);
    for (const Route& r : h.routes) CHECK(r.from < r.to);
    CHECK(h.neighbors == population.neighbors);
}

TEST_CASE("header.params carries trait_mix, last, only when it is not 0") {
    World world = test_world(3);
    always_at(world, Job::retired, PlaceId(1));
    ScenarioParams params = village(4, 480, 490);
    for (int mix : {-2, -1, 1, 2}) {
        params.trait_mix = mix;
        const Run run = simulate(params, world, test_population(4), 9, greet_always);
        REQUIRE(run.header.params.size() == 12);
        CHECK(run.header.params[10].first == "hop_retries");
        CHECK(run.header.params.back() == std::pair<std::string, std::int64_t>{"trait_mix", mix});
        // And it reads back from the log.
        std::istringstream in(write_header(run.header) + "\n" + write_event(run.events.back()) + "\n");
        CHECK(read_log(in).header == run.header);
    }
    params.trait_mix = 0;
    const Run plain = simulate(params, world, test_population(4), 9, greet_always);
    CHECK(plain.header.params.size() == 11);
    CHECK(write_header(plain.header).find("trait_mix") == std::string::npos);
}

TEST_CASE("a tick does not advance with decisions pending") {
    Busy busy;
    const Run run = simulate(busy.params, busy.world, busy.population, 3, tell_always);
    REQUIRE_FALSE(run.batches.empty());

    // Every conversation gets exactly one turn in every tick from its start to
    // its end: none is left behind for a later tick.
    std::map<std::uint32_t, Tick> started, ended;
    std::map<std::uint32_t, std::vector<Tick>> turns;
    for (const Event& e : run.events) {
        if (const auto* s = std::get_if<ConvStartEvent>(&e)) started[s->conv.v] = s->tick;
        if (const auto* t = std::get_if<TurnEvent>(&e)) turns[t->conv.v].push_back(t->tick);
        if (const auto* c = std::get_if<ConvEndEvent>(&e)) ended[c->conv.v] = c->tick;
    }
    REQUIRE_FALSE(started.empty());
    CHECK(ended.size() == started.size());
    for (const auto& [conv, start] : started) {
        const std::vector<Tick>& ticks = turns[conv];
        REQUIRE_FALSE(ticks.empty());
        for (std::size_t i = 0; i < ticks.size(); ++i) CHECK(ticks[i] == start + static_cast<Tick>(i));
        CHECK(ended[conv] == ticks.back());
    }

    // Every request of the run went out, and each one got its decision event.
    std::size_t requests = 0;
    for (const auto& batch : run.batches) requests += batch.size();
    CHECK(requests == run.all<TurnEvent>().size() + run.all<PlanEvent>().size());
}

TEST_CASE("the seed of a request depends on the run seed, the tick, the neighbor and the kind") {
    Busy busy;
    const Run run = simulate(busy.params, busy.world, busy.population, 11, random_answer);
    // TestPolicy already checked derive_seed(seed, tick, who, stream) for each
    // request, which does not depend on the position in the batch. Within one
    // batch, no two requests share a seed.
    bool plans = false;
    for (const auto& batch : run.batches) {
        std::set<std::uint64_t> seeds;
        for (const DecisionRequest& q : batch) {
            seeds.insert(q.seed);
            plans = plans || q.kind == DecisionKind::plan;
        }
        CHECK(seeds.size() == batch.size());
    }
    CHECK(plans);
}

TEST_CASE("same seed, same events; another seed, other events") {
    Busy busy;
    const Run a = simulate(busy.params, busy.world, busy.population, 5, random_answer);
    const Run b = simulate(busy.params, busy.world, busy.population, 5, random_answer);
    const Run c = simulate(busy.params, busy.world, busy.population, 6, random_answer);
    CHECK(a.header == b.header);
    CHECK(a.events == b.events);
    CHECK(a.events != c.events);
    CHECK_FALSE(a.all<TurnEvent>().empty());
    CHECK_FALSE(a.all<MoveEvent>().empty());
    CHECK_FALSE(a.all<MemoryEvent>().empty());
}

TEST_CASE("events come in tick order and the run ends with `end`") {
    Busy busy;
    const Run run = simulate(busy.params, busy.world, busy.population, 8, random_answer);
    REQUIRE_FALSE(run.events.empty());
    Tick last = busy.params.start_tick;
    for (const Event& e : run.events) {
        CHECK(event_tick(e) >= last);
        last = event_tick(e);
    }
    const auto* end = std::get_if<EndEvent>(&run.events.back());
    REQUIRE(end != nullptr);
    CHECK(end->tick == busy.params.end_tick);
    CHECK(end->turns == static_cast<int>(run.all<TurnEvent>().size()));
    CHECK(end->plans == static_cast<int>(run.all<PlanEvent>().size()));
    CHECK(end->decisions == end->turns + end->plans);
    CHECK(end->conversations == static_cast<int>(run.all<ConvStartEvent>().size()));
    CHECK(end->informed >= 2);
    // Turn and plan ids are one count from 1.
    std::vector<int> ids;
    for (const Event& e : run.events) {
        if (const auto* t = std::get_if<TurnEvent>(&e)) ids.push_back(t->id);
        if (const auto* p = std::get_if<PlanEvent>(&e)) ids.push_back(p->id);
    }
    for (std::size_t i = 0; i < ids.size(); ++i) CHECK(ids[i] == static_cast<int>(i) + 1);
}

TEST_CASE("a conversation ends at the turn limit, then the pair cools down") {
    World world = test_world(3);
    always_at(world, Job::retired, PlaceId(1));
    const Run run = simulate(village(2, 480, 520), world, test_population(2), 1, greet_always);

    const auto starts = run.all<ConvStartEvent>();
    const auto turns = run.all<TurnEvent>();
    const auto ends = run.all<ConvEndEvent>();
    REQUIRE(starts.size() >= 2);
    CHECK(starts[0].tick == 480);
    CHECK(starts[0].place == PlaceId(1));
    REQUIRE(turns.size() >= 4);
    for (int i = 0; i < 4; ++i) {
        const TurnEvent& t = turns[static_cast<std::size_t>(i)];
        CHECK(t.tick == 480 + i);
        CHECK(t.n == i + 1);
        CHECK(t.who == (i % 2 == 0 ? starts[0].a : starts[0].b));
        CHECK(t.to == (i % 2 == 0 ? starts[0].b : starts[0].a));
        CHECK(t.act == Act::greet);
    }
    REQUIRE_FALSE(ends.empty());
    CHECK(ends[0].tick == 483);
    CHECK(ends[0].reason == ConvEndReason::max_turns);
    // Rest ends at 485, the cooldown of the pair at 493.
    CHECK(starts[1].tick == 493);
    // No conversation starts that could not end before the end of the run.
    for (const auto& s : starts) CHECK(s.tick + 4 <= 520);
}

TEST_CASE("a plan leads to move and arrive with its slot") {
    World world = test_world(5);
    always_at(world, Job::retired, PlaceId(2));  // n001 lives at the bar
    always_at(world, Job::baker, PlaceId(1));    // n002 is already at the square
    Population population = test_population(2);
    population.neighbors[1].job = Job::baker;
    ScenarioParams params = village(2, 480, 700);
    params.meet_ppm = 0;
    params.injections = {party(480, {NeighborId(1), NeighborId(2)}, PlaceId(1), 20)};  // 10:00
    const Run run = simulate(params, world, population, 4, tell_always);

    const auto plans = run.all<PlanEvent>();
    REQUIRE(plans.size() == 2);
    for (const PlanEvent& p : plans) {
        CHECK(p.tick == 480);
        CHECK(p.action == ActionType::go);
        CHECK(p.fact == FactId(1));
    }
    REQUIRE(run.batches.size() == 1);
    const DecisionRequest& q = run.batches[0][0];
    CHECK(q.kind == DecisionKind::plan);
    CHECK(q.trigger_fact == 1);
    CHECK_FALSE(q.other.valid());

    const auto moves = run.all<MoveEvent>();
    REQUIRE(moves.size() == 2);
    CHECK(moves[0] == MoveEvent{595, NeighborId(1), PlaceId(2), PlaceId(1), 600, FactId(1)});
    // Held until 600 + stay_ticks, then the timetable takes n001 back.
    CHECK(moves[1] == MoveEvent{630, NeighborId(1), PlaceId(1), PlaceId(2), 635, FactId()});

    const auto arrivals = run.all<ArriveEvent>();
    REQUIRE(arrivals.size() == 2);
    // n002 was already there: no move, it arrives at the time of the plan.
    CHECK(arrivals[0] == ArriveEvent{600, NeighborId(1), PlaceId(1), FactId(1), 20});
    CHECK(arrivals[1] == ArriveEvent{600, NeighborId(2), PlaceId(1), FactId(1), 20});
}

TEST_CASE("nobody talks in a home quarter") {
    const World world = test_world(3);  // empty timetable: everybody at home
    ScenarioParams params = village(6, 480, 600);
    params.injections = {party(480, {NeighborId(1)}, PlaceId(1), 42)};
    const Run run = simulate(params, world, test_population(6), 2, tell_always);
    CHECK(run.all<ConvStartEvent>().empty());
    CHECK(run.all<TurnEvent>().empty());
    CHECK(run.all<MoveEvent>().empty());
}

TEST_CASE("telephone-20: a policy that always tells makes 19 hops") {
    const ScenarioParams params = load_scenario(RUMOR_DATA_DIR, "telephone-20", Lang::en);
    const Run run = simulate(params, test_world(5), test_population(20), 1, tell_always);

    const auto starts = run.all<ConvStartEvent>();
    REQUIRE(starts.size() == 19);
    for (std::size_t i = 0; i < starts.size(); ++i) {
        CHECK(starts[i].a == NeighborId(static_cast<std::uint32_t>(i + 1)));
        CHECK(starts[i].b == NeighborId(static_cast<std::uint32_t>(i + 2)));
        CHECK(starts[i].place == PlaceId(1));
    }
    CHECK(starts[0].tick == params.start_tick + params.hop_gap);
    CHECK(run.all<MoveEvent>().empty());
    CHECK(run.all<PlanEvent>().empty());
    const auto* end = std::get_if<EndEvent>(&run.events.back());
    REQUIRE(end != nullptr);
    CHECK(end->informed == 20);
}

TEST_CASE("telephone-20: a pair that keeps quiet the first time talks again") {
    const ScenarioParams params = load_scenario(RUMOR_DATA_DIR, "telephone-20", Lang::es);
    int turns_seen = 0;
    const Run run = simulate(params, test_world(5), test_population(20), 1,
                             [&](const DecisionRequest& q) {
                                 return ++turns_seen == 1 ? none() : tell_always(q);
                             });

    const auto starts = run.all<ConvStartEvent>();
    REQUIRE(starts.size() == 20);
    CHECK(starts[0].a == NeighborId(1));
    CHECK(starts[0].b == NeighborId(2));
    CHECK(starts[1].a == NeighborId(1));
    CHECK(starts[1].b == NeighborId(2));
    CHECK(starts[2].a == NeighborId(2));
    const auto ends = run.all<ConvEndEvent>();
    REQUIRE_FALSE(ends.empty());
    CHECK(ends[0].reason == ConvEndReason::none);
    CHECK(starts[1].tick == ends[0].tick + params.hop_gap);
}

TEST_CASE("telephone: the chain is cut when the retries run out") {
    ScenarioParams params = load_scenario(RUMOR_DATA_DIR, "telephone-20", Lang::es);
    const Run run = simulate(params, test_world(5), test_population(20), 1, [](const DecisionRequest&) {
        return none();
    });
    const auto starts = run.all<ConvStartEvent>();
    CHECK(starts.size() == static_cast<std::size_t>(params.hop_retries) + 1);
    for (const auto& s : starts) CHECK(s.b == NeighborId(2));
}

TEST_CASE("telephone: the run ends when the chain does, not at the limit") {
    const ScenarioParams params = load_scenario(RUMOR_DATA_DIR, "telephone-20", Lang::es);
    const Run run = simulate(params, test_world(5), test_population(20), 1, tell_always);
    const auto ends = run.all<ConvEndEvent>();
    REQUIRE(ends.size() == 19);
    const auto* end = std::get_if<EndEvent>(&run.events.back());
    REQUIRE(end != nullptr);
    CHECK(end->tick == ends.back().tick + 1);
    CHECK(end->tick < params.end_tick);
}

TEST_CASE("the last plan about a fact rules: deciding not to go cancels the visit") {
    World world = test_world(5);
    always_at(world, Job::retired, PlaceId(2));  // both live at the bar
    ScenarioParams params = village(2, 480, 700);
    // Only n002 hears it first hand: square, 10:00.
    params.injections = {party(480, {NeighborId(2)}, PlaceId(1), 20)};

    int plans_of_n1 = 0;
    const Run run = simulate(params, world, test_population(2), 3, [&](const DecisionRequest& q) {
        if (q.kind == DecisionKind::plan) {
            if (q.self == NeighborId(2)) return none();
            return ++plans_of_n1 == 1 ? go(q) : none();  // n001 says yes, then no
        }
        if (q.self != NeighborId(2)) return say(Act::greet);
        // n002 tells it as a guess in the first conversation and as certain in
        // the later ones, so n001's version changes from doubt to sure.
        Decision d = tell(q, 1);
        if (q.tick < 490) {
            for (Slot s : kSlots) d.action.claim->guess[idx(s)] = true;
        }
        return d;
    });

    std::vector<PlanEvent> plans;
    for (const PlanEvent& p : run.all<PlanEvent>()) {
        // A plan that ends in `none` still says which fact it was about.
        CHECK(p.fact == FactId(1));
        if (p.who == NeighborId(1)) plans.push_back(p);
    }
    REQUIRE(plans.size() == 2);
    CHECK(plans[0].action == ActionType::go);
    CHECK(plans[1].action == ActionType::none);
    CHECK(plans[1].tick >= 490);
    CHECK(plans[1].tick < 595);  // before it would have left
    // The visit was written down and then cancelled: nobody goes anywhere.
    CHECK(run.all<ArriveEvent>().empty());
    CHECK(run.all<MoveEvent>().empty());
}

TEST_CASE("live: a stop ends the run at that tick with a readable log") {
    Busy busy;
    ScriptedControl control;
    control.script[500].stop = true;
    const Run run = simulate(busy.params, busy.world, busy.population, 8, random_answer, &control);

    CHECK(control.asked.front() == busy.params.start_tick);
    CHECK(control.asked.back() == 500);
    CHECK(control.asked.size() == 21);
    REQUIRE_FALSE(run.events.empty());
    for (std::size_t i = 0; i + 1 < run.events.size(); ++i) CHECK(event_tick(run.events[i]) < 500);
    const auto* end = std::get_if<EndEvent>(&run.events.back());
    REQUIRE(end != nullptr);
    CHECK(end->tick == 500);
    CHECK(end->turns == static_cast<int>(run.all<TurnEvent>().size()));
    CHECK(end->informed >= 2);  // the injection of 490 went in

    std::ostringstream out;
    out << write_header(run.header) << '\n';
    for (const Event& e : run.events) out << write_event(e) << '\n';
    std::istringstream in(out.str());
    const Log log = read_log(in);
    CHECK(log.header == run.header);
    CHECK(log.events == run.events);
}

TEST_CASE("live: a fact for some neighbors enters at its tick, after those of the scenario") {
    Busy busy;
    ScriptedControl control;
    // Same tick as the scenario's: it comes second. An order to nobody is
    // dropped; the screen goes to the policy.
    control.script[490].injections = {to_neighbors({}), to_neighbors({NeighborId(3), NeighborId(7)})};
    control.script[490].visible = std::vector<NeighborId>{NeighborId(2), NeighborId(4)};
    control.script[600].injections = {to_neighbors({NeighborId(12)})};
    const Run run = simulate(busy.params, busy.world, busy.population, 3, tell_always, &control);

    const auto injects = run.all<InjectEvent>();
    REQUIRE(injects.size() == 3);
    CHECK(injects[0].tick == 490);
    CHECK(injects[0].fact == FactId(1));
    CHECK(injects[0].to == std::vector<NeighborId>{NeighborId(1), NeighborId(5)});
    CHECK(injects[1].tick == 490);
    CHECK(injects[1].fact == FactId(2));
    CHECK(injects[1].what == "party");
    CHECK(injects[1].to == std::vector<NeighborId>{NeighborId(3), NeighborId(7)});
    CHECK(injects[2] == InjectEvent{600, FactId(3), std::nullopt, "party", injects[1].slots,
                                    {NeighborId(12)}});
    CHECK(injected(run, FactId(2), 490) == std::vector<NeighborId>{NeighborId(3), NeighborId(7)});
    CHECK(injected(run, FactId(3), 600) == std::vector<NeighborId>{NeighborId(12)});

    // As in the scenario, each receiver gets a plan about it at once (later,
    // those who hear it get theirs).
    std::set<std::uint32_t> planned;
    for (const PlanEvent& p : run.all<PlanEvent>()) {
        if (p.fact == FactId(2) && p.tick == 490) planned.insert(p.who.v);
    }
    CHECK(planned == std::set<std::uint32_t>{3, 7});

    REQUIRE(run.visible.size() == 1);
    CHECK(run.visible[0] == std::vector<NeighborId>{NeighborId(2), NeighborId(4)});
}

TEST_CASE("live: a fact for a place goes to whoever is there, or waits for somebody") {
    World world = test_world(5);
    always_at(world, Job::retired, PlaceId(2));  // n001 and n002, at the bar all day
    // n003 and n004 farm the market from 9:00 and are at home before.
    for (int h = 9; h < 24; ++h) {
        world.timetable[static_cast<std::size_t>(Job::farmer)][static_cast<std::size_t>(h)] = PlaceId(3);
    }
    Population population = test_population(4);
    population.neighbors[2].job = Job::farmer;
    population.neighbors[3].job = Job::farmer;
    ScenarioParams params = village(4, 480, 700);
    params.meet_ppm = 0;

    ScriptedControl control;
    control.script[485].injections = {to_place(PlaceId(3)), to_place(PlaceId(2))};
    const Run run = simulate(params, world, population, 4, tell_always, &control);

    // The bar has people: at once, in identifier order.
    const auto injects = run.all<InjectEvent>();
    REQUIRE(injects.size() == 2);
    CHECK(injects[0].tick == 485);
    CHECK(injects[0].fact == FactId(1));
    CHECK(injects[0].to == std::vector<NeighborId>{NeighborId(1), NeighborId(2)});
    CHECK(injected(run, FactId(1), 485) == injects[0].to);

    // The market is empty until the first farmer arrives: the fact enters the
    // tick after that arrival (arrivals come after the injections in a tick),
    // to the farmers who are there by then.
    Tick first = params.end_tick;
    for (const MoveEvent& m : run.all<MoveEvent>()) {
        if (m.to == PlaceId(3)) first = std::min(first, m.arrive);
    }
    REQUIRE(first < params.end_tick);
    std::vector<NeighborId> there;
    for (const MoveEvent& m : run.all<MoveEvent>()) {
        if (m.to == PlaceId(3) && m.arrive <= first) there.push_back(m.who);
    }
    std::sort(there.begin(), there.end());
    CHECK(injects[1].tick == first + 1);
    CHECK(injects[1].fact == FactId(2));
    CHECK(injects[1].to == there);
    CHECK(injected(run, FactId(2), first + 1) == there);

    // The pace: never quiet while the fact for the market waits for somebody.
    for (const auto& [t, quiet] : control.after) {
        if (t >= 485 && t <= first) CHECK_FALSE(quiet);
    }
}

TEST_CASE("live: after_tick says when a tick is quiet, once per tick, after its events") {
    Busy busy;
    ScriptedControl control;
    const Run run = simulate(busy.params, busy.world, busy.population, 5, random_answer, &control);
    REQUIRE(control.after.size() == control.asked.size());
    std::set<Tick> with_fact;
    for (const Event& e : run.events) {
        if (carries_fact(e)) with_fact.insert(event_tick(e));
    }
    int quiet_ticks = 0;
    for (std::size_t i = 0; i < control.after.size(); ++i) {
        const auto [t, quiet] = control.after[i];
        CHECK(t == control.asked[i]);
        if (with_fact.count(t) > 0) CHECK_FALSE(quiet);
        // Before the fact of 490 nobody knows anything.
        if (t < 490) CHECK(quiet);
        quiet_ticks += quiet ? 1 : 0;
    }
    CHECK(quiet_ticks > 0);
    CHECK(quiet_ticks < static_cast<int>(control.after.size()));
}

TEST_CASE("live: a conversation of somebody who knows a fact is not quiet") {
    // Two neighbors at the square: n001 knows the fact and they greet each
    // other for four turns without a word about it.
    World world = test_world(3);
    always_at(world, Job::retired, PlaceId(1));
    ScenarioParams params = village(2, 480, 520);
    params.injections = {party(480, {NeighborId(1)}, PlaceId(1), 40)};
    ScriptedControl control;
    const Run run = simulate(params, world, test_population(2), 3, greet_always, &control);
    const auto starts = run.all<ConvStartEvent>();
    const auto ends = run.all<ConvEndEvent>();
    REQUIRE_FALSE(starts.empty());
    REQUIRE_FALSE(ends.empty());
    for (const auto& [t, quiet] : control.after) {
        if (t >= starts[0].tick && t < ends[0].tick) CHECK_FALSE(quiet);
    }
}

TEST_CASE("live: a control that orders nothing changes nothing") {
    Busy busy;
    const Run without = simulate(busy.params, busy.world, busy.population, 5, random_answer);
    ScriptedControl control;
    const Run with = simulate(busy.params, busy.world, busy.population, 5, random_answer, &control);
    const auto bytes = [](const Run& run) {
        std::string out = write_header(run.header) + '\n';
        for (const Event& e : run.events) out += write_event(e) + '\n';
        return out;
    };
    CHECK(bytes(with) == bytes(without));
    CHECK_FALSE(with.all<TurnEvent>().empty());
    CHECK(control.asked.size() == static_cast<std::size_t>(busy.params.end_tick - busy.params.start_tick));
    CHECK(with.visible.empty());
}

}  // TEST_SUITE
