#include <doctest/doctest.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "core/catalog.h"
#include "core/game_api.h"
#include "core/policy.h"
#include "core/rng.h"
#include "core/time.h"
#include "core/verdict.h"

using namespace rumor;

namespace {

constexpr int kNeighbors = 100;
constexpr std::size_t kTurnCap = 8;  // the cap of the scenario

// --- A checker written from validate_api.h and verdict.h -----------------------

struct Check {
    RejectReason reject = RejectReason::none;
    PerSlot<SlotVerdict> slots{};
};

bool claim_in_vocabulary(const Claim& c, const DecisionRequest& r) {
    for (Slot s : kSlots) {
        const auto& v = c.slots[idx(s)];
        if (!v) continue;
        switch (s) {
            case Slot::who:
                if (*v < 1 || *v > r.neighbor_count) return false;
                break;
            case Slot::where:
                if (*v < 1 || !is_public(PlaceId(static_cast<std::uint32_t>(*v)))) return false;
                break;
            case Slot::when:
            case Slot::amount:
                if (*v < 0) return false;
                break;
        }
    }
    return true;
}

SlotVerdict slot_verdict(const SlotBelief& m, const std::optional<SlotValue>& said, bool guess) {
    if (!said) return SlotVerdict::omitted;
    switch (m.state) {
        case SlotState::sure:
            return *said == m.value ? SlotVerdict::faithful : SlotVerdict::contradiction;
        case SlotState::doubt:
            if (*said == m.value) return guess ? SlotVerdict::faithful : SlotVerdict::hardened_doubt;
            return guess ? SlotVerdict::declared_guess : SlotVerdict::invented;
        case SlotState::forgotten:
        case SlotState::unknown:
            return guess ? SlotVerdict::declared_guess : SlotVerdict::invented;
    }
    return SlotVerdict::invented;
}

Check check(const DecisionRequest& r, const Decision& d) {
    Check out;
    const Action& a = d.action;
    if (d.reject != RejectReason::none) {
        out.reject = d.reject;
        return out;
    }
    const bool allowed = r.kind == DecisionKind::turn
                             ? (a.type == ActionType::say || a.type == ActionType::none)
                             : (a.type == ActionType::go || a.type == ActionType::none);
    if (!allowed) {
        out.reject = RejectReason::action_not_allowed;
        return out;
    }
    bool fields = true;
    switch (a.type) {
        case ActionType::none: fields = !a.act && !a.fact && !a.claim && !a.text; break;
        case ActionType::go: fields = !a.act && !a.text && a.fact && a.claim; break;
        case ActionType::say:
            if (!a.act) {
                fields = false;
            } else if (*a.act == Act::greet || *a.act == Act::bye) {
                fields = !a.fact && !a.claim;
            } else if (*a.act == Act::ask) {
                fields = a.fact && !a.claim;
            } else {
                fields = a.fact && a.claim;
            }
            break;
    }
    if (!fields || (a.claim && !claim_in_vocabulary(*a.claim, r))) {
        out.reject = RejectReason::bad_fields;
        return out;
    }
    if (a.fact && (*a.fact < 1 || static_cast<std::size_t>(*a.fact) > r.facts.size())) {
        out.reject = RejectReason::unknown_fact;
        return out;
    }
    if (a.claim) {
        const Belief& b = r.facts[static_cast<std::size_t>(*a.fact - 1)];
        for (Slot s : kSlots) {
            out.slots[idx(s)] =
                slot_verdict(b.slots[idx(s)], a.claim->slots[idx(s)], a.claim->guess[idx(s)]);
        }
    }
    return out;
}

// Everything the baseline must hold for every decision.
void require_sound(const DecisionRequest& r, const Decision& d) {
    REQUIRE(d.reject == RejectReason::none);
    REQUIRE(!d.gen);
    REQUIRE(!d.action.text);
    const Check c = check(r, d);
    REQUIRE(c.reject == RejectReason::none);
    for (Slot s : kSlots) REQUIRE(!is_failure(c.slots[idx(s)]));
}

// --- Builders --------------------------------------------------------------------

Belief belief(std::uint32_t fact) {
    Belief b;
    b.fact = FactId(fact);
    b.what = "party";
    return b;
}

void set(Belief& b, Slot s, SlotState state, std::optional<SlotValue> value = std::nullopt) {
    b.slots[idx(s)].state = state;
    b.slots[idx(s)].value = value;
}

ConvEntry entry(NeighborId speaker, Act act, std::uint32_t fact = 0) {
    ConvEntry e;
    e.speaker = speaker;
    e.act = act;
    e.fact = FactId(fact);
    return e;
}

DecisionRequest base_turn() {
    DecisionRequest r;
    r.kind = DecisionKind::turn;
    r.tick = 600;  // day 0, 10:00
    r.self = NeighborId(1);
    r.other = NeighborId(2);
    r.place = PlaceId(1);
    r.neighbor_count = kNeighbors;
    return r;
}

// A random request: both kinds, memories with the four states, conversations at
// any point, and some values that do not fit (told_to, told_by, past hours).
DecisionRequest random_request(std::uint64_t seed) {
    Rng g(seed * 7919 + 13);
    DecisionRequest r;
    r.kind = g.below(2) ? DecisionKind::plan : DecisionKind::turn;
    r.seed = g.next();
    r.tick = g.range(0, 3 * kTicksPerDay - 1);
    r.weekday = g.range(0, 6);
    r.self = NeighborId(static_cast<std::uint32_t>(g.range(1, kNeighbors)));
    r.other = NeighborId(static_cast<std::uint32_t>(g.range(1, kNeighbors)));
    if (r.kind == DecisionKind::plan && g.below(2)) r.other = NeighborId();
    r.job = static_cast<Job>(g.below(kJobCount));
    r.trait = static_cast<Trait>(g.below(kTraitCount));
    r.relation = static_cast<Relation>(g.below(kRelationCount));
    r.place = PlaceId(static_cast<std::uint32_t>(g.range(1, static_cast<int>(kPlaceCount))));
    r.neighbor_count = kNeighbors;

    const int nfacts = g.range(0, 4);
    for (int i = 0; i < nfacts; ++i) {
        Belief b = belief(static_cast<std::uint32_t>(i + 1));
        for (Slot s : kSlots) {
            const auto state = static_cast<SlotState>(g.below(4));
            std::optional<SlotValue> value;
            if (state == SlotState::sure || state == SlotState::doubt) {
                switch (s) {
                    case Slot::who: value = g.range(1, kNeighbors); break;
                    case Slot::where: value = g.range(1, static_cast<int>(kPublicPlaceCount)); break;
                    case Slot::when: value = slot_of(r.tick) + g.range(-6, 60); break;
                    case Slot::amount: value = g.range(0, 5000); break;
                }
                if (*value < 0) value = 0;
            }
            set(b, s, state, value);
        }
        const std::uint32_t pick = g.below(3);
        b.told_by = pick == 0 ? NeighborId() : pick == 1 ? r.other : NeighborId(50);
        if (g.below(3) == 0) b.told_to.push_back(r.other);
        r.facts.push_back(b);
    }

    if (r.kind == DecisionKind::turn) {
        const int len = g.range(0, 6);
        for (int i = 0; i < len; ++i) {
            // Alternating speakers, the last one being the other.
            const NeighborId who = (len - i) % 2 == 1 ? r.other : r.self;
            const auto act = static_cast<Act>(g.below(4));
            ConvEntry e = entry(who, act);
            if (act == Act::tell || act == Act::ask) {
                e.fact = FactId(static_cast<std::uint32_t>(g.range(1, 5)));
            }
            if (act == Act::tell) e.claim = Claim{};
            r.conversation.push_back(e);
        }
    } else {
        r.trigger_fact = g.range(0, nfacts + 1);
    }
    return r;
}

Action say_action(Act act) {
    Action a;
    a.type = ActionType::say;
    a.act = act;
    return a;
}

Decision decide1(Policy& p, const DecisionRequest& r) {
    const std::vector<Decision> out = p.decide(std::span<const DecisionRequest>(&r, 1));
    REQUIRE(out.size() == 1);
    return out[0];
}

}  // namespace

TEST_SUITE("policy") {

TEST_CASE("the baseline is named baseline") {
    CHECK(make_baseline_policy()->name() == "baseline");
}

TEST_CASE("same request, same action: alone, in batches, in any order") {
    auto policy = make_baseline_policy();
    std::vector<DecisionRequest> requests;
    for (std::uint64_t s = 0; s < 400; ++s) requests.push_back(random_request(s));

    std::vector<Decision> alone;
    for (const auto& r : requests) alone.push_back(decide1(*policy, r));

    const std::vector<Decision> batch = policy->decide(requests);
    REQUIRE(batch.size() == requests.size());
    for (std::size_t i = 0; i < requests.size(); ++i) CHECK(batch[i].action == alone[i].action);

    // Shuffled, with duplicates and other requests mixed in.
    for (std::uint64_t round = 0; round < 5; ++round) {
        Rng g(round + 99);
        std::vector<std::size_t> order;
        for (std::size_t i = 0; i < requests.size(); ++i) {
            order.push_back(i);
            if (g.below(4) == 0) order.push_back(i);
        }
        g.shuffle(order);
        std::vector<DecisionRequest> mixed;
        std::vector<std::optional<std::size_t>> origin;
        for (std::size_t i : order) {
            if (g.below(3) == 0) {
                mixed.push_back(random_request(10'000 + g.below(1000)));
                origin.push_back(std::nullopt);
            }
            mixed.push_back(requests[i]);
            origin.push_back(i);
        }
        const std::vector<Decision> out = policy->decide(mixed);
        REQUIRE(out.size() == mixed.size());
        for (std::size_t k = 0; k < mixed.size(); ++k) {
            if (origin[k]) CHECK(out[k].action == alone[*origin[k]].action);
        }
    }

    // A fresh policy answers the same: there is no state between calls.
    auto other = make_baseline_policy();
    const std::vector<Decision> again = other->decide(requests);
    for (std::size_t i = 0; i < requests.size(); ++i) CHECK(again[i].action == alone[i].action);
}

TEST_CASE("never a rejected action nor a failed slot") {
    auto policy = make_baseline_policy();
    std::vector<DecisionRequest> requests;
    for (std::uint64_t s = 0; s < 20'000; ++s) requests.push_back(random_request(s));
    const std::vector<Decision> out = policy->decide(requests);
    REQUIRE(out.size() == requests.size());

    std::map<int, int> seen;  // what came out, to make sure the run covers it all
    int guesses = 0;
    for (std::size_t i = 0; i < requests.size(); ++i) {
        require_sound(requests[i], out[i]);
        const Action& a = out[i].action;
        seen[a.type == ActionType::say ? 10 + static_cast<int>(*a.act) : static_cast<int>(a.type)]++;
        const Check c = check(requests[i], out[i]);
        for (Slot s : kSlots) guesses += c.slots[idx(s)] == SlotVerdict::declared_guess;
    }
    CHECK(seen[static_cast<int>(ActionType::none)] > 0);
    CHECK(seen[static_cast<int>(ActionType::go)] > 0);
    CHECK(seen[10 + static_cast<int>(Act::greet)] > 0);
    CHECK(seen[10 + static_cast<int>(Act::tell)] > 0);
    CHECK(seen[10 + static_cast<int>(Act::bye)] > 0);
    CHECK(seen[10 + static_cast<int>(Act::ask)] == 0);
    CHECK(guesses > 0);
}

TEST_CASE("conversations between two neighbors end in a few turns") {
    auto policy = make_baseline_policy();
    std::map<std::size_t, int> lengths;
    for (std::uint64_t run = 0; run < 2'000; ++run) {
        Rng g(run + 5);
        const NeighborId a(3), b(4);
        std::vector<Belief> mem[2];
        for (int side = 0; side < 2; ++side) {
            const int n = g.range(0, 3);
            for (int i = 0; i < n; ++i) {
                Belief x = belief(static_cast<std::uint32_t>(i + 1 + side));
                for (Slot s : kSlots) {
                    const auto state = static_cast<SlotState>(g.below(4));
                    const bool valued = state == SlotState::sure || state == SlotState::doubt;
                    set(x, s, state,
                        valued ? std::optional<SlotValue>(s == Slot::where ? 2 : 40) : std::nullopt);
                }
                mem[side].push_back(x);
            }
        }
        const auto relation = static_cast<Relation>(g.below(kRelationCount));
        const auto trait = static_cast<Trait>(g.below(kTraitCount));

        std::vector<ConvEntry> conv;
        Tick tick = 600;
        bool ended = false;
        while (!ended && conv.size() < kTurnCap) {
            const int side = static_cast<int>(conv.size() % 2);
            DecisionRequest r = base_turn();
            r.tick = tick;
            r.self = side == 0 ? a : b;
            r.other = side == 0 ? b : a;
            r.relation = relation;
            r.trait = trait;
            r.facts = mem[side];
            r.conversation = conv;
            r.seed = derive_seed(run, tick, r.self, Stream::turn);
            const Decision d = decide1(*policy, r);
            require_sound(r, d);
            if (d.action.type == ActionType::none || d.action.act == Act::bye) {
                ended = true;
            } else {
                ConvEntry e = entry(r.self, *d.action.act);
                if (d.action.fact) e.fact = r.facts[static_cast<std::size_t>(*d.action.fact - 1)].fact;
                e.claim = d.action.claim;
                conv.push_back(e);
            }
            ++tick;
        }
        REQUIRE(ended);
        CHECK(conv.size() + 1 < kTurnCap);
        lengths[conv.size() + 1]++;
    }
    // Both short conversations (nothing to tell) and longer ones happen.
    CHECK(lengths[3] > 0);
    CHECK(lengths.rbegin()->first >= 4);
}

TEST_CASE("turn rules") {
    auto policy = make_baseline_policy();
    const NeighborId me(1), you(2);

    SUBCASE("whoever opens greets; the other greets back when it has nothing to tell") {
        DecisionRequest r = base_turn();
        r.facts.push_back(belief(1));
        CHECK(decide1(*policy, r).action.act == Act::greet);  // opens: always a greeting
        r.facts.clear();
        r.conversation.push_back(entry(you, Act::greet));
        CHECK(decide1(*policy, r).action.act == Act::greet);
        r.conversation.push_back(entry(me, Act::greet));
        r.conversation.push_back(entry(you, Act::bye));
        CHECK(decide1(*policy, r).action.act == Act::bye);
    }

    SUBCASE("each neighbor has one chance to tell, before anybody leaves") {
        for (std::uint64_t s = 0; s < 200; ++s) {
            DecisionRequest r = base_turn();
            r.seed = s;
            r.relation = Relation::family;
            r.trait = Trait::gossip;  // always tells when it can
            r.facts = {belief(1)};
            // Greeted: tells right away.
            r.conversation = {entry(you, Act::greet)};
            CHECK(decide1(*policy, r).action.act == Act::tell);
            // Opened and got an answer: tells now.
            r.conversation = {entry(me, Act::greet), entry(you, Act::greet)};
            CHECK(decide1(*policy, r).action.act == Act::tell);
            // The chance has passed: leaves.
            r.conversation = {entry(you, Act::greet), entry(me, Act::greet), entry(you, Act::greet)};
            CHECK(decide1(*policy, r).action.act == Act::bye);
        }
    }

    SUBCASE("answers a question about a known fact") {
        for (std::uint64_t s = 0; s < 200; ++s) {
            DecisionRequest r = base_turn();
            r.seed = s;
            r.relation = Relation::rival;
            r.trait = Trait::discreet;
            r.facts.push_back(belief(7));
            r.facts.push_back(belief(9));
            set(r.facts[1], Slot::where, SlotState::sure, 3);
            r.facts[1].told_to.push_back(you);  // asked anyway
            r.conversation = {entry(you, Act::greet), entry(me, Act::greet), entry(you, Act::ask, 9)};
            const Decision d = decide1(*policy, r);
            require_sound(r, d);
            CHECK(d.action.act == Act::tell);
            CHECK(d.action.fact == 2);
            CHECK(d.action.claim->slots[idx(Slot::where)] == 3);
        }
    }

    SUBCASE("a question about an unknown fact is not answered with it") {
        for (std::uint64_t s = 0; s < 200; ++s) {
            DecisionRequest r = base_turn();
            r.seed = s;
            r.facts.push_back(belief(7));
            r.facts[0].told_to.push_back(you);
            r.conversation = {entry(you, Act::greet), entry(me, Act::greet), entry(you, Act::ask, 3)};
            CHECK(decide1(*policy, r).action.act == Act::bye);
        }
    }

    SUBCASE("tells at most once, then leaves") {
        for (std::uint64_t s = 0; s < 200; ++s) {
            DecisionRequest r = base_turn();
            r.seed = s;
            r.relation = Relation::family;
            r.trait = Trait::gossip;
            r.facts = {belief(1), belief(2)};
            r.conversation = {entry(you, Act::greet), entry(me, Act::greet), entry(you, Act::greet),
                              entry(me, Act::tell, 1), entry(you, Act::greet)};
            CHECK(decide1(*policy, r).action.act == Act::bye);
        }
    }

    SUBCASE("does not tell what the listener already has") {
        for (std::uint64_t s = 0; s < 200; ++s) {
            DecisionRequest r = base_turn();
            r.seed = s;
            r.relation = Relation::family;
            r.trait = Trait::gossip;  // always tells when it can
            r.facts = {belief(1), belief(2), belief(3)};
            r.facts[0].told_to = {NeighborId(1), you};
            r.facts[1].told_by = you;
            r.conversation = {entry(me, Act::greet), entry(you, Act::tell, 3)};
            CHECK(decide1(*policy, r).action.act == Act::bye);
            // Without the last filter, fact 3 is told every time.
            r.conversation.back() = entry(you, Act::greet);
            const Decision d = decide1(*policy, r);
            CHECK(d.action.act == Act::tell);
            CHECK(d.action.fact == 3);
        }
    }

    SUBCASE("slots: sure as it is, doubt as a guess, unknown omitted, forgotten guessed or omitted") {
        int guessed = 0, omitted = 0;
        for (std::uint64_t s = 0; s < 1'000; ++s) {
            DecisionRequest r = base_turn();
            r.seed = s;
            r.relation = Relation::family;
            r.trait = Trait::gossip;
            Belief b = belief(1);
            set(b, Slot::who, SlotState::sure, 17);
            set(b, Slot::where, SlotState::doubt, 4);
            set(b, Slot::when, SlotState::unknown);
            set(b, Slot::amount, SlotState::forgotten);
            r.facts = {b};
            r.conversation = {entry(you, Act::greet)};
            const Decision d = decide1(*policy, r);
            require_sound(r, d);
            REQUIRE(d.action.act == Act::tell);
            const Claim& c = *d.action.claim;
            CHECK(c.slots[idx(Slot::who)] == 17);
            CHECK(!c.guess[idx(Slot::who)]);
            CHECK(c.slots[idx(Slot::where)] == 4);
            CHECK(c.guess[idx(Slot::where)]);
            CHECK(!c.slots[idx(Slot::when)]);
            if (c.slots[idx(Slot::amount)]) {
                ++guessed;
                CHECK(c.guess[idx(Slot::amount)]);
                CHECK(*c.slots[idx(Slot::amount)] >= 0);
            } else {
                ++omitted;
            }
        }
        CHECK(guessed > 300);
        CHECK(omitted > 300);
    }

    SUBCASE("a forgotten hour is guessed later today, or omitted when today is over") {
        for (std::uint64_t s = 0; s < 500; ++s) {
            DecisionRequest r = base_turn();
            r.seed = s;
            r.relation = Relation::family;
            r.trait = Trait::gossip;
            r.tick = s % 2 ? kTicksPerDay + 18 * kTicksPerHour + 10 : 2 * kTicksPerDay - 20;
            Belief b = belief(1);
            for (Slot sl : kSlots) set(b, sl, SlotState::forgotten);
            r.facts = {b};
            r.conversation = {entry(you, Act::greet)};
            const Decision d = decide1(*policy, r);
            require_sound(r, d);
            const auto when = d.action.claim->slots[idx(Slot::when)];
            if (s % 2 == 0) {
                CHECK(!when);
            } else if (when) {
                CHECK(*when > slot_of(r.tick));
                CHECK(*when < 2 * kSlotsPerDay);
            }
        }
    }
}

TEST_CASE("family hears more than the rival, the gossip tells more than the discreet") {
    auto policy = make_baseline_policy();
    const NeighborId me(1), you(2);
    auto tells = [&](Relation relation, Trait trait) {
        int n = 0;
        for (std::uint64_t s = 0; s < 2'000; ++s) {
            DecisionRequest r = base_turn();
            r.seed = mix64(s + 1);
            r.relation = relation;
            r.trait = trait;
            r.facts = {belief(1)};
            r.conversation = {entry(you, Act::greet)};
            n += decide1(*policy, r).action.act == Act::tell;
        }
        return n;
    };
    CHECK(tells(Relation::family, Trait::sociable) > tells(Relation::rival, Trait::sociable) + 1'000);
    CHECK(tells(Relation::acquaintance, Trait::gossip) >
          tells(Relation::acquaintance, Trait::discreet) + 400);
    CHECK(tells(Relation::family, Trait::gossip) == 2'000);  // capped at 100 %
}

TEST_CASE("plan") {
    auto policy = make_baseline_policy();
    auto plan_request = [](std::uint64_t seed) {
        DecisionRequest r;
        r.kind = DecisionKind::plan;
        r.seed = seed;
        r.tick = 600;  // slot 20
        r.self = NeighborId(5);
        r.trait = Trait::shy;
        r.neighbor_count = kNeighbors;
        r.facts = {belief(1), belief(2)};
        Belief& b = r.facts[1];
        set(b, Slot::who, SlotState::sure, 9);
        set(b, Slot::where, SlotState::sure, 3);
        set(b, Slot::when, SlotState::doubt, 42);
        set(b, Slot::amount, SlotState::forgotten);
        r.trigger_fact = 2;
        return r;
    };

    SUBCASE("a complete future version goes with that claim") {
        Claim expected;
        expected.slots[idx(Slot::who)] = 9;
        expected.slots[idx(Slot::where)] = 3;
        expected.slots[idx(Slot::when)] = 42;
        expected.guess[idx(Slot::when)] = true;
        int go = 0;
        for (std::uint64_t s = 0; s < 1'000; ++s) {
            const DecisionRequest r = plan_request(mix64(s));
            const Decision d = decide1(*policy, r);
            require_sound(r, d);
            if (d.action.type == ActionType::go) {
                ++go;
                CHECK(d.action.fact == 2);
                CHECK(d.action.claim == expected);
            } else {
                CHECK(d.action == Action{});
            }
        }
        CHECK(go > 700);
    }

    SUBCASE("incomplete, past or invalid gives none") {
        for (std::uint64_t s = 0; s < 300; ++s) {
            DecisionRequest r = plan_request(mix64(s));
            r.facts[1].slots[idx(Slot::where)] = SlotBelief{SlotState::forgotten, std::nullopt, {}};
            CHECK(decide1(*policy, r).action == Action{});

            r = plan_request(mix64(s));
            r.facts[1].slots[idx(Slot::when)] = SlotBelief{SlotState::unknown, std::nullopt, {}};
            CHECK(decide1(*policy, r).action == Action{});

            r = plan_request(mix64(s));
            r.tick = tick_of(42);  // the hour has come
            CHECK(decide1(*policy, r).action == Action{});

            r = plan_request(mix64(s));
            r.tick = tick_of(50);
            CHECK(decide1(*policy, r).action == Action{});

            for (int bad : {0, -1, 3}) {
                r = plan_request(mix64(s));
                r.trigger_fact = bad;
                CHECK(decide1(*policy, r).action == Action{});
            }
        }
    }
}

// --- explain_baseline (phase 9): "¿Qué pensó?" without the model -------------------

TEST_CASE("the explanation of the baseline matches every decision and changes none") {
    auto policy = make_baseline_policy();
    std::vector<DecisionRequest> requests;
    for (std::uint64_t s = 0; s < 20'000; ++s) requests.push_back(random_request(s));
    const std::vector<Decision> before = policy->decide(requests);

    std::map<std::string, int> rules;
    for (std::size_t i = 0; i < requests.size(); ++i) {
        const DecisionRequest& r = requests[i];
        const Action& a = before[i].action;
        CAPTURE(i);
        const RuleExplanation why = explain_baseline(r);
        CHECK(explain_baseline(r).rule == why.rule);  // the same every time
        rules[why.rule]++;

        // Every draw is consistent with itself.
        const RuleRoll* tell_roll = nullptr;
        const RuleRoll* go_roll = nullptr;
        std::vector<const RuleRoll*> guesses;
        for (const RuleRoll& roll : why.rolls) {
            CHECK(roll.roll_ppm < kPpm);
            if (roll.name == "pick_fact") {
                CHECK(roll.hit);
                CHECK(roll.chance_ppm > 0);
                CHECK(roll.chance_ppm <= kPpm);
                continue;
            }
            CHECK(roll.hit == (roll.roll_ppm < roll.chance_ppm));
            if (roll.name == "tell") tell_roll = &roll;
            else if (roll.name == "go") go_roll = &roll;
            else if (roll.name == "guess_forgotten") guesses.push_back(&roll);
            else FAIL("unknown roll " << roll.name);
        }

        // The rule says which action came out.
        if (why.rule == "greet_first" || why.rule == "greet_back") {
            CHECK(a == say_action(Act::greet));
        } else if (why.rule == "bye") {
            CHECK(a == say_action(Act::bye));
        } else if (why.rule == "answer_question" || why.rule == "tell_chance") {
            REQUIRE(a.type == ActionType::say);
            CHECK(a.act == Act::tell);
        } else if (why.rule == "plan_go") {
            REQUIRE(go_roll != nullptr);
            CHECK(a.type == (go_roll->hit ? ActionType::go : ActionType::none));
        } else if (why.rule == "plan_no_time") {
            CHECK(a == Action{});
            CHECK(why.rolls.empty());
        } else {
            FAIL("unknown rule " << why.rule);
        }
        CHECK((r.kind == DecisionKind::plan) ==
              (why.rule == "plan_go" || why.rule == "plan_no_time"));

        // The dice of telling: a hit is a tell, a miss is not.
        if (why.rule == "tell_chance") {
            REQUIRE(tell_roll != nullptr);
            CHECK(tell_roll->hit);
            REQUIRE(why.rolls.size() >= 2);
            CHECK(why.rolls[0].name == "pick_fact");
        } else if (tell_roll) {
            CHECK(!tell_roll->hit);
            CHECK(a.act != Act::tell);
        }

        // One guess roll per forgotten slot of the fact told, in slot order; a
        // miss leaves the slot out.
        if (a.type == ActionType::say && a.act == Act::tell) {
            const Belief& told = r.facts[static_cast<std::size_t>(*a.fact - 1)];
            std::size_t g = 0;
            for (Slot s : kSlots) {
                if (told.slots[idx(s)].state != SlotState::forgotten) continue;
                REQUIRE(g < guesses.size());
                if (!guesses[g]->hit) CHECK(!a.claim->slots[idx(s)].has_value());
                else CHECK(a.claim->guess[idx(s)] == a.claim->slots[idx(s)].has_value());
                ++g;
            }
            CHECK(g == guesses.size());
        } else {
            CHECK(guesses.empty());
        }
    }
    // The sample covers every rule.
    for (const char* name : {"greet_first", "answer_question", "tell_chance", "greet_back", "bye",
                             "plan_go", "plan_no_time"}) {
        CAPTURE(name);
        CHECK(rules[name] > 0);
    }

    // Explaining changed nothing: the same decisions, from this policy and a new one.
    const std::vector<Decision> after = policy->decide(requests);
    const std::vector<Decision> fresh = make_baseline_policy()->decide(requests);
    for (std::size_t i = 0; i < requests.size(); ++i) {
        CHECK(after[i].action == before[i].action);
        CHECK(fresh[i].action == before[i].action);
    }
}

}  // TEST_SUITE
