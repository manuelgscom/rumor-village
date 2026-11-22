#include <doctest/doctest.h>

#include <cstdint>
#include <optional>
#include <utility>
#include <vector>

#include "core/memory_api.h"
#include "core/rng.h"

using namespace rumor;

namespace {

const NeighborId kListener{7};
const NeighborId kTeller{12};
const FactId kFact{1};
constexpr Tick kTick = 600;
constexpr int kTurn = 42;

Claim claim_one(Slot s, SlotValue v, bool guess) {
    Claim c;
    c.slots[idx(s)] = v;
    c.guess[idx(s)] = guess;
    return c;
}

// A memory that already knows kFact, with one slot in the given state.
Memory memory_with(Slot s, SlotState state, std::optional<SlotValue> value, NeighborId source) {
    Memory m;
    Belief b;
    b.fact = kFact;
    b.what = "party";
    b.told_by = NeighborId{3};
    b.heard_at = 100;
    b.slots[idx(s)] = SlotBelief{state, value, source};
    m.facts.push_back(b);
    return m;
}

// A memory with `facts` facts whose four slots are sure (even slots) or doubt.
Memory full_memory(int facts) {
    Memory m;
    for (int f = 1; f <= facts; ++f) {
        Belief b;
        b.fact = FactId(static_cast<std::uint32_t>(f));
        b.what = "fact";
        for (Slot s : kSlots) {
            const bool doubt = idx(s) % 2 == 1;
            b.slots[idx(s)] = SlotBelief{doubt ? SlotState::doubt : SlotState::sure,
                                         static_cast<SlotValue>(f * 10 + static_cast<int>(idx(s))),
                                         doubt ? kTeller : NeighborId{}};
        }
        m.facts.push_back(b);
    }
    return m;
}

void check_told_event(const MemoryEvent& e, Slot s, SlotState state, SlotValue v) {
    CHECK(e.tick == kTick);
    CHECK(e.who == kListener);
    CHECK(e.fact == kFact);
    CHECK(e.slot == s);
    CHECK(e.state == state);
    CHECK(e.value == v);
    CHECK(e.cause == MemoryCause::told);
    CHECK(e.turn == kTurn);
}

}  // namespace

TEST_SUITE("memory") {

TEST_CASE("hear: unknown or forgotten + plain value becomes sure") {
    for (SlotState before : {SlotState::unknown, SlotState::forgotten}) {
        Memory m = memory_with(Slot::where, before, std::nullopt, NeighborId{});
        std::vector<MemoryEvent> out;
        auto conflicts = memory_hear(m, kListener, kTeller, kFact, "party",
                                     claim_one(Slot::where, 3, false), kTick, kTurn, out);
        CHECK(conflicts.empty());
        const SlotBelief& b = m.facts[0].slots[idx(Slot::where)];
        CHECK(b == SlotBelief{SlotState::sure, 3, kTeller});
        REQUIRE(out.size() == 1);
        check_told_event(out[0], Slot::where, SlotState::sure, 3);
    }
}

TEST_CASE("hear: unknown or forgotten + guess becomes doubt") {
    for (SlotState before : {SlotState::unknown, SlotState::forgotten}) {
        Memory m = memory_with(Slot::when, before, std::nullopt, NeighborId{});
        std::vector<MemoryEvent> out;
        auto conflicts = memory_hear(m, kListener, kTeller, kFact, "party",
                                     claim_one(Slot::when, 44, true), kTick, kTurn, out);
        CHECK(conflicts.empty());
        CHECK(m.facts[0].slots[idx(Slot::when)] == SlotBelief{SlotState::doubt, 44, kTeller});
        REQUIRE(out.size() == 1);
        check_told_event(out[0], Slot::when, SlotState::doubt, 44);
    }
}

TEST_CASE("hear: doubt + plain value becomes sure with the new value") {
    Memory m = memory_with(Slot::amount, SlotState::doubt, 5, NeighborId{3});
    std::vector<MemoryEvent> out;
    auto conflicts = memory_hear(m, kListener, kTeller, kFact, "party",
                                 claim_one(Slot::amount, 9, false), kTick, kTurn, out);
    CHECK(conflicts.empty());
    CHECK(m.facts[0].slots[idx(Slot::amount)] == SlotBelief{SlotState::sure, 9, kTeller});
    REQUIRE(out.size() == 1);
    check_told_event(out[0], Slot::amount, SlotState::sure, 9);
}

TEST_CASE("hear: doubt + guess does not change") {
    Memory m = memory_with(Slot::amount, SlotState::doubt, 5, NeighborId{3});
    const Memory before = m;
    std::vector<MemoryEvent> out;
    auto conflicts = memory_hear(m, kListener, kTeller, kFact, "party",
                                 claim_one(Slot::amount, 9, true), kTick, kTurn, out);
    CHECK(conflicts.empty());
    CHECK(m.facts == before.facts);
    CHECK(out.empty());
}

TEST_CASE("hear: sure + the same value does not change") {
    for (bool guess : {false, true}) {
        Memory m = memory_with(Slot::who, SlotState::sure, 20, NeighborId{});
        const Memory before = m;
        std::vector<MemoryEvent> out;
        auto conflicts = memory_hear(m, kListener, kTeller, kFact, "party",
                                     claim_one(Slot::who, 20, guess), kTick, kTurn, out);
        CHECK(conflicts.empty());
        CHECK(m.facts == before.facts);
        CHECK(out.empty());
    }
}

TEST_CASE("hear: sure + another value keeps its own and reports a conflict") {
    for (bool guess : {false, true}) {
        Memory m = memory_with(Slot::who, SlotState::sure, 20, NeighborId{});
        m.facts[0].slots[idx(Slot::amount)] = SlotBelief{SlotState::sure, 1, NeighborId{}};
        const Memory before = m;
        Claim c;
        c.slots[idx(Slot::who)] = 21;
        c.slots[idx(Slot::amount)] = 2;
        c.guess[idx(Slot::who)] = guess;
        std::vector<MemoryEvent> out;
        auto conflicts = memory_hear(m, kListener, kTeller, kFact, "party", c, kTick, kTurn, out);
        CHECK(conflicts == std::vector<Slot>{Slot::who, Slot::amount});
        CHECK(m.facts == before.facts);
        CHECK(out.empty());
    }
}

TEST_CASE("hear: a new fact is added at the end, events in slot order") {
    Memory m = memory_with(Slot::who, SlotState::sure, 20, NeighborId{});
    Claim c;
    c.slots[idx(Slot::amount)] = 4;
    c.slots[idx(Slot::who)] = 8;
    c.slots[idx(Slot::when)] = 40;
    c.guess[idx(Slot::when)] = true;
    std::vector<MemoryEvent> out;
    const FactId other{2};
    auto conflicts = memory_hear(m, kListener, kTeller, other, "prize", c, kTick, kTurn, out);
    CHECK(conflicts.empty());
    REQUIRE(m.facts.size() == 2);
    const Belief& b = m.facts[1];
    CHECK(b.fact == other);
    CHECK(b.what == "prize");
    CHECK(b.told_by == kTeller);
    CHECK(b.heard_at == kTick);
    CHECK(b.told_to.empty());
    CHECK(b.slots[idx(Slot::who)] == SlotBelief{SlotState::sure, 8, kTeller});
    CHECK(b.slots[idx(Slot::where)] == SlotBelief{});
    CHECK(b.slots[idx(Slot::when)] == SlotBelief{SlotState::doubt, 40, kTeller});
    CHECK(b.slots[idx(Slot::amount)] == SlotBelief{SlotState::sure, 4, kTeller});
    REQUIRE(out.size() == 3);
    CHECK(out[0].slot == Slot::who);
    CHECK(out[1].slot == Slot::when);
    CHECK(out[2].slot == Slot::amount);
    for (const MemoryEvent& e : out) CHECK(e.fact == other);
}

TEST_CASE("hear: a claim without values still adds the fact") {
    Memory m;
    std::vector<MemoryEvent> out;
    auto conflicts = memory_hear(m, kListener, kTeller, kFact, "party", Claim{}, kTick, kTurn, out);
    CHECK(conflicts.empty());
    CHECK(out.empty());
    REQUIRE(m.facts.size() == 1);
    CHECK(m.facts[0].fact == kFact);
    CHECK(m.facts[0].what == "party");
    CHECK(m.facts[0].told_by == kTeller);
    CHECK(m.facts[0].heard_at == kTick);
    for (Slot s : kSlots) CHECK(m.facts[0].slots[idx(s)] == SlotBelief{});
}

TEST_CASE("hear: a second hearing does not change told_by or heard_at") {
    Memory m;
    std::vector<MemoryEvent> out;
    memory_hear(m, kListener, kTeller, kFact, "party", claim_one(Slot::who, 5, true), kTick, kTurn,
                out);
    memory_hear(m, kListener, NeighborId{30}, kFact, "party", claim_one(Slot::who, 6, false),
                kTick + 10, kTurn + 1, out);
    REQUIRE(m.facts.size() == 1);
    CHECK(m.facts[0].told_by == kTeller);
    CHECK(m.facts[0].heard_at == kTick);
    CHECK(m.facts[0].slots[idx(Slot::who)] == SlotBelief{SlotState::sure, 6, NeighborId{30}});
    REQUIRE(out.size() == 2);
    CHECK(out[1].turn == kTurn + 1);
    CHECK(out[1].tick == kTick + 10);
}

TEST_CASE("forget: probability 0 changes nothing") {
    Memory m = full_memory(5);
    const Memory before = m;
    std::vector<MemoryEvent> out;
    for (Tick t = 0; t < 50; ++t) memory_forget(m, kListener, 0, 0, 1234, t, out);
    CHECK(m.facts == before.facts);
    CHECK(out.empty());
}

TEST_CASE("forget: probability 1'000'000 forgets everything and erases values") {
    Memory m = full_memory(3);
    m.facts[0].slots[idx(Slot::where)] = SlotBelief{};  // unknown stays unknown
    std::vector<MemoryEvent> out;
    memory_forget(m, kListener, kPpm, kPpm, 99, kTick, out);
    CHECK(out.size() == 11);
    CHECK(m.facts[0].slots[idx(Slot::where)] == SlotBelief{});
    for (const Belief& b : m.facts) {
        for (Slot s : kSlots) {
            if (b.fact == FactId{1} && s == Slot::where) continue;
            CHECK(b.slots[idx(s)] == SlotBelief{SlotState::forgotten, std::nullopt, NeighborId{}});
        }
    }
    std::size_t i = 0;
    for (const Belief& b : m.facts) {
        for (Slot s : kSlots) {
            if (b.fact == FactId{1} && s == Slot::where) continue;
            REQUIRE(i < out.size());
            const MemoryEvent& e = out[i++];
            CHECK(e.tick == kTick);
            CHECK(e.who == kListener);
            CHECK(e.fact == b.fact);
            CHECK(e.slot == s);
            CHECK(e.state == SlotState::forgotten);
            CHECK(e.value == std::nullopt);
            CHECK(e.cause == MemoryCause::forgot);
            CHECK(e.turn == 0);
        }
    }
    // Forgotten slots consume no draws and do not change again.
    const Memory after = m;
    out.clear();
    memory_forget(m, kListener, kPpm, kPpm, 99, kTick + 1, out);
    CHECK(m.facts == after.facts);
    CHECK(out.empty());
}

TEST_CASE("forget: doubt drop 1'000'000 with forget 0 turns every doubt into sure") {
    Memory m = full_memory(3);
    const Memory before = m;
    std::vector<MemoryEvent> out;
    memory_forget(m, kListener, 0, kPpm, 7, kTick, out);
    REQUIRE(out.size() == 6);
    std::size_t i = 0;
    for (std::size_t f = 0; f < m.facts.size(); ++f) {
        for (Slot s : kSlots) {
            const SlotBelief& old = before.facts[f].slots[idx(s)];
            const SlotBelief& now = m.facts[f].slots[idx(s)];
            CHECK(now.state == SlotState::sure);
            CHECK(now.value == old.value);
            CHECK(now.source == old.source);
            if (old.state == SlotState::doubt) {
                const MemoryEvent& e = out[i++];
                CHECK(e.fact == m.facts[f].fact);
                CHECK(e.slot == s);
                CHECK(e.state == SlotState::sure);
                CHECK(e.value == old.value);
                CHECK(e.cause == MemoryCause::doubt_dropped);
                CHECK(e.turn == 0);
            }
        }
    }
}

TEST_CASE("forget: same seed gives the same result; another tick or neighbor another") {
    const Memory start = full_memory(8);
    auto run = [&](NeighborId who, Tick tick) {
        Memory m = start;
        std::vector<MemoryEvent> out;
        memory_forget(m, who, 500'000, 500'000, 2024, tick, out);
        return std::make_pair(m.facts, out);
    };
    const auto a = run(kListener, kTick);
    const auto b = run(kListener, kTick);
    CHECK(a == b);
    CHECK(run(kListener, kTick + 1).first != a.first);
    CHECK(run(NeighborId{8}, kTick).first != a.first);
}

TEST_CASE("forget: an intermediate probability is roughly respected") {
    // 2000 calls x 4 sure slots = 8000 draws at 25%: expected 2000 forgotten.
    int forgotten = 0;
    for (Tick t = 0; t < 2000; ++t) {
        Memory m;
        Belief b;
        b.fact = kFact;
        for (Slot s : kSlots) b.slots[idx(s)] = SlotBelief{SlotState::sure, 1, NeighborId{}};
        m.facts.push_back(b);
        std::vector<MemoryEvent> out;
        memory_forget(m, kListener, 250'000, 0, 31337, t, out);
        forgotten += static_cast<int>(out.size());
    }
    CHECK(forgotten > 1800);
    CHECK(forgotten < 2200);
}

TEST_CASE("mark_told keeps order and does not repeat") {
    Memory m = memory_with(Slot::who, SlotState::sure, 1, NeighborId{});
    for (std::uint32_t v : {9u, 3u, 9u, 15u, 1u, 3u}) memory_mark_told(m, kFact, NeighborId{v});
    CHECK(m.facts[0].told_to ==
          std::vector<NeighborId>{NeighborId{1}, NeighborId{3}, NeighborId{9}, NeighborId{15}});
    // An unknown fact does nothing.
    const Memory before = m;
    memory_mark_told(m, FactId{5}, NeighborId{2});
    CHECK(m.facts == before.facts);
}

TEST_CASE("inject: a new fact") {
    Memory m;
    Fact f;
    f.id = kFact;
    f.what = "party";
    f.slots[idx(Slot::where)] = 4;
    f.slots[idx(Slot::when)] = 42;
    std::vector<MemoryEvent> out;
    memory_inject(m, kListener, f, kTick, out);
    REQUIRE(m.facts.size() == 1);
    const Belief& b = m.facts[0];
    CHECK(b.fact == kFact);
    CHECK(b.what == "party");
    CHECK(b.told_by == NeighborId{});
    CHECK(b.heard_at == kTick);
    CHECK(b.slots[idx(Slot::who)] == SlotBelief{});
    CHECK(b.slots[idx(Slot::where)] == SlotBelief{SlotState::sure, 4, NeighborId{}});
    CHECK(b.slots[idx(Slot::when)] == SlotBelief{SlotState::sure, 42, NeighborId{}});
    CHECK(b.slots[idx(Slot::amount)] == SlotBelief{});
    REQUIRE(out.size() == 2);
    CHECK(out[0] == MemoryEvent{kTick, kListener, kFact, Slot::where, SlotState::sure, 4,
                                MemoryCause::inject, 0});
    CHECK(out[1] == MemoryEvent{kTick, kListener, kFact, Slot::when, SlotState::sure, 42,
                                MemoryCause::inject, 0});
}

TEST_CASE("inject: a fact already known overwrites the given slots") {
    Memory m = memory_with(Slot::where, SlotState::doubt, 9, kTeller);
    m.facts[0].slots[idx(Slot::amount)] = SlotBelief{SlotState::forgotten, std::nullopt, {}};
    m.facts[0].slots[idx(Slot::who)] = SlotBelief{SlotState::sure, 30, kTeller};
    Fact f;
    f.id = kFact;
    f.what = "party";
    f.slots[idx(Slot::where)] = 4;
    f.slots[idx(Slot::amount)] = 100;
    std::vector<MemoryEvent> out;
    memory_inject(m, kListener, f, kTick, out);
    REQUIRE(m.facts.size() == 1);
    const Belief& b = m.facts[0];
    CHECK(b.told_by == NeighborId{3});  // first teller kept
    CHECK(b.heard_at == 100);
    CHECK(b.slots[idx(Slot::who)] == SlotBelief{SlotState::sure, 30, kTeller});  // not given
    CHECK(b.slots[idx(Slot::where)] == SlotBelief{SlotState::sure, 4, NeighborId{}});
    CHECK(b.slots[idx(Slot::amount)] == SlotBelief{SlotState::sure, 100, NeighborId{}});
    REQUIRE(out.size() == 2);
    CHECK(out[0].slot == Slot::where);
    CHECK(out[1].slot == Slot::amount);
    for (const MemoryEvent& e : out) CHECK(e.cause == MemoryCause::inject);
}

}  // TEST_SUITE
