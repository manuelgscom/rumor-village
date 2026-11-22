#include <doctest/doctest.h>

#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/metrics_api.h"

using namespace rumor;
using Json = nlohmann::ordered_json;

namespace {

using V = SlotVerdict;
using Opt = std::optional<SlotValue>;
using Slots = PerSlot<Opt>;
using Marks = PerSlot<bool>;
using Verdicts = PerSlot<SlotVerdict>;

constexpr Opt kNone = std::nullopt;
constexpr Marks kNoMarks = {false, false, false, false};

// Original fact: who n003, where p01, when 42, amount 50.
constexpr Slots kOriginal = {3, 1, 42, 50};

LogHeader make_header() {
    LogHeader h;
    h.seed = 7;
    h.scenario = "test-6";
    h.policy = "baseline";
    h.start_tick = 480;
    const Trait traits[] = {Trait::gossip,   Trait::sociable, Trait::prudent,
                            Trait::discreet, Trait::shy,      Trait::exaggerator};
    for (std::uint32_t i = 1; i <= 6; ++i) {
        Neighbor n;
        n.id = NeighborId(i);
        n.name = "N" + std::to_string(i);
        n.trait = traits[i - 1];
        n.home = PlaceId(13);
        h.neighbors.push_back(n);
    }
    h.relations = {{NeighborId(1), NeighborId(2), Relation::family},
                   {NeighborId(2), NeighborId(3), Relation::friend_},
                   {NeighborId(3), NeighborId(4), Relation::coworker},
                   {NeighborId(4), NeighborId(5), Relation::rival}};
    return h;
}

Event inject(Tick t, std::vector<NeighborId> to) {
    InjectEvent e;
    e.tick = t;
    e.fact = FactId(1);
    e.what = "party";
    e.slots = kOriginal;
    e.to = std::move(to);
    return e;
}

Event mem(Tick t, std::uint32_t who, Slot slot, SlotState state, Opt value, MemoryCause cause,
          int turn = 0) {
    MemoryEvent e;
    e.tick = t;
    e.who = NeighborId(who);
    e.fact = FactId(1);
    e.slot = slot;
    e.state = state;
    e.value = value;
    e.cause = cause;
    e.turn = turn;
    return e;
}

Event conv_start(Tick t, std::uint32_t conv, std::uint32_t a, std::uint32_t b) {
    return ConvStartEvent{t, ConvId(conv), NeighborId(a), NeighborId(b), PlaceId(2)};
}

Event conv_end(Tick t, std::uint32_t conv, ConvEndReason reason) {
    return ConvEndEvent{t, ConvId(conv), reason};
}

TurnEvent turn_base(Tick t, int id, std::uint32_t conv, int n, std::uint32_t who,
                    std::uint32_t to) {
    TurnEvent e;
    e.tick = t;
    e.id = id;
    e.conv = ConvId(conv);
    e.n = n;
    e.who = NeighborId(who);
    e.to = NeighborId(to);
    e.card = "card";
    return e;
}

Event tell(Tick t, int id, std::uint32_t conv, int n, std::uint32_t who, std::uint32_t to,
           Slots slots, Marks guess, Verdicts verdicts) {
    TurnEvent e = turn_base(t, id, conv, n, who, to);
    e.action = ActionType::say;
    e.act = Act::tell;
    e.fact = FactId(1);
    e.claim = Claim{slots, guess};
    e.verdict = Verdict{RejectReason::none, verdicts};
    return e;
}

Event say(Tick t, int id, std::uint32_t conv, int n, std::uint32_t who, std::uint32_t to,
          Act act) {
    TurnEvent e = turn_base(t, id, conv, n, who, to);
    e.action = ActionType::say;
    e.act = act;
    return e;
}

Event rejected_turn(Tick t, int id, std::uint32_t conv, int n, std::uint32_t who,
                    std::uint32_t to) {
    TurnEvent e = turn_base(t, id, conv, n, who, to);
    e.verdict.reject = RejectReason::malformed;
    return e;
}

Event go(Tick t, int id, std::uint32_t who, Slots slots, Marks guess, Verdicts verdicts) {
    PlanEvent e;
    e.tick = t;
    e.id = id;
    e.who = NeighborId(who);
    e.card = "card";
    e.action = ActionType::go;
    e.fact = FactId(1);
    e.claim = Claim{slots, guess};
    e.verdict = Verdict{RejectReason::none, verdicts};
    return e;
}

Event rejected_plan(Tick t, int id, std::uint32_t who) {
    PlanEvent e;
    e.tick = t;
    e.id = id;
    e.who = NeighborId(who);
    e.card = "card";
    e.verdict.reject = RejectReason::bad_fields;
    return e;
}

Event arrive(Tick t, std::uint32_t who, std::uint32_t place, TimeSlot slot) {
    return ArriveEvent{t, NeighborId(who), PlaceId(place), FactId(1), slot};
}

Event end(Tick t) {
    EndEvent e;
    e.tick = t;
    return e;
}

using S = Slot;
using St = SlotState;
using C = MemoryCause;

// A chain n001 -> n002 -> n003 -> n004 -> n005, then a repeat n001 -> n002.
// The comments give, per hop, what each counted slot does.
std::vector<Event> chain_log() {
    return {
        MoveEvent{500, NeighborId(1), PlaceId(13), PlaceId(2), 506, FactId()},
        inject(600, {NeighborId(1)}),
        mem(600, 1, S::who, St::sure, 3, C::inject),
        mem(600, 1, S::where, St::sure, 1, C::inject),
        mem(600, 1, S::when, St::sure, 42, C::inject),
        mem(600, 1, S::amount, St::sure, 50, C::inject),
        go(600, 1, 1, {kNone, 1, 42, kNone}, kNoMarks,
           {V::omitted, V::faithful, V::faithful, V::omitted}),

        // Hop 1, n001 -> n002. who: kept. where: omission. when: model.
        // amount: passed as a guess of a sure value, not a change.
        conv_start(610, 1, 1, 2),
        tell(611, 2, 1, 1, 1, 2, {3, kNone, 44, 50}, {false, false, false, true},
             {V::faithful, V::omitted, V::contradiction, V::faithful}),
        mem(611, 2, S::who, St::sure, 3, C::told, 2),
        mem(611, 2, S::amount, St::doubt, 50, C::told, 2),
        say(612, 3, 1, 2, 2, 1, Act::bye),
        conv_end(612, 1, ConvEndReason::bye),
        go(613, 4, 2, {kNone, 1, 42, kNone}, kNoMarks,
           {V::omitted, V::invented, V::invented, V::omitted}),
        mem(640, 2, S::who, St::forgotten, kNone, C::forgot),

        // Hop 2, n002 -> n003. who: guess (forgotten, guessed 4). where: not
        // counted (never received). amount: hardened.
        conv_start(650, 2, 2, 3),
        tell(651, 5, 2, 1, 2, 3, {4, 2, kNone, 50}, {true, true, false, false},
             {V::declared_guess, V::declared_guess, V::omitted, V::hardened_doubt}),
        mem(651, 3, S::who, St::doubt, 4, C::told, 5),
        mem(651, 3, S::where, St::doubt, 2, C::told, 5),
        mem(651, 3, S::amount, St::sure, 50, C::told, 5),
        conv_end(652, 2, ConvEndReason::bye),
        go(653, 6, 3, {kNone, 2, 42, kNone}, {false, true, true, false},
           {V::omitted, V::faithful, V::declared_guess, V::omitted}),
        mem(700, 3, S::who, St::sure, 4, C::doubt_dropped),
        mem(710, 3, S::amount, St::forgotten, kNone, C::forgot),

        // Hop 3, n003 -> n004. who: doubt_dropped. where: kept as a guess.
        // amount: forgot.
        conv_start(720, 3, 3, 4),
        tell(721, 7, 3, 1, 3, 4, {4, 2, kNone, kNone}, {false, true, false, false},
             {V::faithful, V::faithful, V::omitted, V::omitted}),
        mem(721, 4, S::who, St::sure, 4, C::told, 7),
        mem(721, 4, S::where, St::doubt, 2, C::told, 7),
        conv_end(722, 3, ConvEndReason::bye),
        go(723, 8, 4, {kNone, 2, 40, kNone}, {false, true, true, false},
           {V::omitted, V::faithful, V::declared_guess, V::omitted}),
        mem(750, 4, S::where, St::forgotten, kNone, C::forgot),

        // Hop 4, n004 -> n005. who: kept. where: a declared guess that hits
        // the received value, not a change.
        conv_start(760, 4, 4, 5),
        tell(761, 9, 4, 1, 4, 5, {4, 2, kNone, kNone}, {false, true, false, false},
             {V::faithful, V::declared_guess, V::omitted, V::omitted}),
        mem(761, 5, S::who, St::sure, 4, C::told, 9),
        mem(761, 5, S::where, St::doubt, 2, C::told, 9),
        conv_end(762, 4, ConvEndReason::bye),
        // The last plan of n004 has no when: not planned.
        go(763, 10, 4, {kNone, 2, kNone, kNone}, {false, true, false, false},
           {V::omitted, V::declared_guess, V::omitted, V::omitted}),
        go(764, 11, 5, {kNone, 1, 44, kNone}, {false, true, true, false},
           {V::omitted, V::declared_guess, V::declared_guess, V::omitted}),
        rejected_plan(765, 12, 6),

        // Hop 5, n001 -> n002 again: a repeat. when: omission. Ends by the
        // turn limit; n002 had an opportunity and its turn is rejected.
        conv_start(800, 5, 1, 2),
        tell(801, 13, 5, 1, 1, 2, {3, 1, kNone, 50}, kNoMarks,
             {V::faithful, V::faithful, V::omitted, V::faithful}),
        mem(801, 2, S::who, St::sure, 3, C::told, 13),
        mem(801, 2, S::where, St::sure, 1, C::told, 13),
        mem(801, 2, S::amount, St::sure, 50, C::told, 13),
        rejected_turn(802, 14, 5, 2, 2, 1),
        say(803, 15, 5, 3, 1, 2, Act::greet),
        conv_end(803, 5, ConvEndReason::max_turns),

        // n005 meets n006 (no edge: acquaintances) and does not tell.
        conv_start(900, 6, 5, 6),
        say(901, 16, 6, 1, 5, 6, Act::bye),
        conv_end(901, 6, ConvEndReason::bye),

        arrive(1260, 1, 1, 42),  // right
        arrive(1260, 3, 2, 42),  // other place
        arrive(1320, 5, 1, 44),  // other time
        arrive(1340, 5, 1, 42),  // second arrival of n005: ignored
        end(1450),
    };
}

void check_tally(const Json& j, int opportunities, int told) {
    CHECK(j["opportunities"] == opportunities);
    CHECK(j["told"] == told);
    if (opportunities == 0) {
        CHECK(j["rate"].is_null());
    } else {
        CHECK(j["rate"].get<double>() == doctest::Approx(double(told) / opportunities));
    }
}

void check_slot(const Json& j, int hops, int changed, std::vector<std::pair<std::string, int>> causes) {
    CHECK(j["hops"] == hops);
    CHECK(j["changed"] == changed);
    CHECK(j["rate"].get<double>() == doctest::Approx(double(changed) / hops));
    int listed = 0;
    for (const auto& [cause, count] : causes) {
        CAPTURE(cause);
        CHECK(j["by_cause"][cause] == count);
        listed += count;
    }
    int sum = 0;
    for (const auto& [cause, count] : j["by_cause"].items()) sum += count.get<int>();
    CHECK(sum == listed);
}

std::vector<std::string> keys_of(const Json& j) {
    std::vector<std::string> keys;
    for (const auto& [k, v] : j.items()) keys.push_back(k);
    return keys;
}

}  // namespace

TEST_SUITE("metrics") {

TEST_CASE("metrics: header fields and key order") {
    const Json m = compute_metrics(make_header(), chain_log());
    CHECK(keys_of(m) == std::vector<std::string>{
                            "format", "scenario", "lang", "policy", "model", "seed", "neighbors",
                            "start_tick", "end_tick", "decisions", "rejected", "slots_said",
                            "invented", "contradictions", "hardened_doubts", "incoherent_text",
                            "deformation", "reach", "attendance", "telling", "courtesy",
                            "performance"});
    CHECK(m["format"] == 1);
    CHECK(m["scenario"] == "test-6");
    CHECK(m["lang"] == "es");
    CHECK(m["policy"] == "baseline");
    CHECK(m["model"].is_null());
    CHECK(m["seed"] == 7);
    CHECK(m["neighbors"] == 6);
    CHECK(m["start_tick"] == 480);
    CHECK(m["end_tick"] == 1450);
    CHECK(m["incoherent_text"].is_null());
    CHECK(m["performance"].is_null());
    CHECK(keys_of(m["deformation"]["by_slot"]) ==
          std::vector<std::string>{"who", "where", "when", "amount"});
    CHECK(keys_of(m["deformation"]["by_slot"]["who"]["by_cause"]) ==
          std::vector<std::string>{"forgot", "guess", "doubt_dropped", "model", "hardened",
                                   "omission"});
    CHECK(keys_of(m["telling"]["by_relation"]) ==
          std::vector<std::string>{"family", "friend", "coworker", "acquaintance", "rival"});
    CHECK(keys_of(m["telling"]["by_trait"]) ==
          std::vector<std::string>{"gossip", "sociable", "prudent", "discreet", "shy",
                                   "exaggerator"});
}

TEST_CASE("metrics: decisions, rejections and slot verdicts") {
    const Json m = compute_metrics(make_header(), chain_log());
    CHECK(m["decisions"]["total"] == 16);
    CHECK(m["decisions"]["turns"] == 9);
    CHECK(m["decisions"]["plans"] == 7);
    CHECK(m["rejected"]["count"] == 2);
    CHECK(m["rejected"]["total"] == 16);
    CHECK(m["rejected"]["rate"].get<double>() == doctest::Approx(2.0 / 16));
    // 2+3+2+3+2+2+2+2+1+2+3 slots said, in id order of the claims.
    CHECK(m["slots_said"] == 24);
    CHECK(m["invented"]["count"] == 2);
    CHECK(m["invented"]["rate"].get<double>() == doctest::Approx(2.0 / 24));
    CHECK(m["contradictions"]["count"] == 1);
    CHECK(m["contradictions"]["rate"].get<double>() == doctest::Approx(1.0 / 24));
    CHECK(m["hardened_doubts"]["count"] == 1);
    CHECK(m["hardened_doubts"]["rate"].get<double>() == doctest::Approx(1.0 / 24));
}

TEST_CASE("metrics: deformation per hop, slot and cause") {
    const Json m = compute_metrics(make_header(), chain_log());
    const Json& d = m["deformation"];
    CHECK(d["hops"] == 5);
    // who: hops 1-5; changed in hop 2 (guess) and hop 3 (doubt dropped).
    check_slot(d["by_slot"]["who"], 5, 2, {{"guess", 1}, {"doubt_dropped", 1}});
    // where: hops 1, 3, 4, 5; changed in hop 1 (omission).
    check_slot(d["by_slot"]["where"], 4, 1, {{"omission", 1}});
    // when: hops 1 and 5; contradiction, then omission.
    check_slot(d["by_slot"]["when"], 2, 2, {{"model", 1}, {"omission", 1}});
    // amount: hops 1, 2, 3, 5; hardened in hop 2, forgot in hop 3.
    check_slot(d["by_slot"]["amount"], 4, 2, {{"hardened", 1}, {"forgot", 1}});
}

TEST_CASE("metrics: reach at the end and over time") {
    const Json m = compute_metrics(make_header(), chain_log());
    const Json& r = m["reach"];
    CHECK(r["fact"] == "f1");
    CHECK(r["informed"] == 5);
    CHECK(r["correct"] == 1);     // n001
    CHECK(r["incomplete"] == 1);  // n002: no when
    CHECK(r["wrong"] == 3);       // n003, n004, n005: who n004
    const Json& tl = r["timeline"];
    REQUIRE(tl.size() == 34);  // 480, 510, ..., 1440, and 1450
    const auto point = [&](std::size_t i, int tick, int informed, int correct) {
        CAPTURE(i);
        CHECK(tl[i]["tick"] == tick);
        CHECK(tl[i]["informed"] == informed);
        CHECK(tl[i]["correct"] == correct);
    };
    point(0, 480, 0, 0);
    point(3, 570, 0, 0);
    point(4, 600, 1, 1);
    point(5, 630, 2, 1);
    point(6, 660, 3, 1);
    point(8, 720, 3, 1);
    point(9, 750, 4, 1);
    point(10, 780, 5, 1);
    point(32, 1440, 5, 1);
    point(33, 1450, 5, 1);
    CHECK(keys_of(tl[0]) == std::vector<std::string>{"tick", "informed", "correct"});
}

TEST_CASE("metrics: attendance") {
    const Json m = compute_metrics(make_header(), chain_log());
    const Json& a = m["attendance"];
    CHECK(a["planned"] == 3);  // n001, n003, n005
    CHECK(a["arrived"] == 3);
    CHECK(a["right"] == 1);
    CHECK(a["other_time"] == 1);
    CHECK(a["other_place"] == 1);
}

TEST_CASE("metrics: decision to tell and courtesy loops") {
    const Json m = compute_metrics(make_header(), chain_log());
    const Json& t = m["telling"];
    check_tally(t, 6, 4);
    check_tally(t["by_relation"]["family"], 2, 1);
    check_tally(t["by_relation"]["friend"], 1, 1);
    check_tally(t["by_relation"]["coworker"], 1, 1);
    check_tally(t["by_relation"]["acquaintance"], 1, 0);
    check_tally(t["by_relation"]["rival"], 1, 1);
    check_tally(t["by_trait"]["gossip"], 1, 1);
    check_tally(t["by_trait"]["sociable"], 2, 1);
    check_tally(t["by_trait"]["prudent"], 1, 1);
    check_tally(t["by_trait"]["discreet"], 1, 1);
    check_tally(t["by_trait"]["shy"], 1, 0);
    check_tally(t["by_trait"]["exaggerator"], 0, 0);

    const Json& c = m["courtesy"];
    CHECK(c["conversations"] == 6);
    CHECK(c["max_turns"] == 1);
    CHECK(c["rate"].get<double>() == doctest::Approx(1.0 / 6));
    CHECK(c["repeats"] == 1);
}

TEST_CASE("metrics: an empty log") {
    const Json m = compute_metrics(make_header(), {});
    CHECK(m["end_tick"] == 480);
    CHECK(m["decisions"]["total"] == 0);
    CHECK(m["rejected"]["rate"].is_null());
    CHECK(m["slots_said"] == 0);
    CHECK(m["invented"]["rate"].is_null());
    CHECK(m["deformation"]["hops"] == 0);
    CHECK(m["deformation"]["by_slot"]["when"]["rate"].is_null());
    CHECK(m["reach"]["fact"].is_null());
    CHECK(m["reach"]["informed"] == 0);
    REQUIRE(m["reach"]["timeline"].size() == 1);
    CHECK(m["reach"]["timeline"][0]["tick"] == 480);
    CHECK(m["attendance"]["arrived"] == 0);
    CHECK(m["telling"]["opportunities"] == 0);
    CHECK(m["telling"]["rate"].is_null());
    CHECK(m["telling"]["by_relation"]["family"]["rate"].is_null());
    CHECK(m["courtesy"]["rate"].is_null());
}

TEST_CASE("metrics: a log without inject") {
    const std::vector<Event> events = {
        conv_start(500, 1, 1, 2),
        say(501, 1, 1, 1, 1, 2, Act::greet),
        rejected_turn(502, 2, 1, 2, 2, 1),
        conv_end(502, 1, ConvEndReason::none),
        end(540),
    };
    const Json m = compute_metrics(make_header(), events);
    CHECK(m["decisions"]["total"] == 2);
    CHECK(m["rejected"]["count"] == 1);
    CHECK(m["reach"]["fact"].is_null());
    CHECK(m["reach"]["informed"] == 0);
    CHECK(m["reach"]["timeline"].size() == 3);  // 480, 510, 540
    CHECK(m["telling"]["opportunities"] == 0);
    CHECK(m["courtesy"]["conversations"] == 1);
    CHECK(m["courtesy"]["max_turns"] == 0);
}

}  // TEST_SUITE
