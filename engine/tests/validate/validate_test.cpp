// Tests of rumor::validate: the table of core/verdict.h, every reject reason
// and its order, and the sanitized action.

#include <doctest/doctest.h>

#include <optional>
#include <string>
#include <utility>

#include "core/validate_api.h"

namespace rumor {
namespace {

constexpr SlotValue kWho = 5;      // n005
constexpr SlotValue kWhere = 1;    // p01, square
constexpr SlotValue kWhen = 42;    // day 0, 21:00
constexpr SlotValue kAmount = 100;

SlotBelief belief_slot(SlotState state, std::optional<SlotValue> value = std::nullopt) {
    SlotBelief b;
    b.state = state;
    b.value = value;
    return b;
}

// Memory of fact [1]: every slot sure with the values above.
Belief sure_belief() {
    Belief b;
    b.fact = FactId(1);
    b.what = "party";
    b.slots = {belief_slot(SlotState::sure, kWho), belief_slot(SlotState::sure, kWhere),
               belief_slot(SlotState::sure, kWhen), belief_slot(SlotState::sure, kAmount)};
    return b;
}

DecisionRequest request(DecisionKind kind) {
    DecisionRequest r;
    r.kind = kind;
    r.self = NeighborId(1);
    r.place = PlaceId(2);
    r.other = kind == DecisionKind::turn ? NeighborId(2) : NeighborId();
    r.facts = {sure_belief()};
    r.trigger_fact = kind == DecisionKind::plan ? 1 : 0;
    r.neighbor_count = 100;
    return r;
}

Claim full_claim() {
    Claim c;
    c.slots = {kWho, kWhere, kWhen, kAmount};
    return c;
}

Action say(Act act, std::optional<int> fact = std::nullopt,
           std::optional<Claim> claim = std::nullopt,
           std::optional<std::string> text = std::nullopt) {
    Action a;
    a.type = ActionType::say;
    a.act = act;
    a.fact = fact;
    a.claim = claim;
    a.text = text;
    return a;
}

Action go(std::optional<int> fact, std::optional<Claim> claim) {
    Action a;
    a.type = ActionType::go;
    a.fact = fact;
    a.claim = claim;
    return a;
}

Decision decision(Action a, RejectReason reject = RejectReason::none) {
    Decision d;
    d.action = std::move(a);
    d.reject = reject;
    return d;
}

void check_rejected(const Validated& v, RejectReason reason) {
    CHECK(v.verdict.reject == reason);
    CHECK(v.action == Action{});
    CHECK_FALSE(v.verdict.slots.has_value());
}

void check_rejected(const DecisionRequest& r, const Action& a, RejectReason reason) {
    check_rejected(validate(r, decision(a)), reason);
}

// Validates a tell whose only said slot is `amount`, against a memory whose
// `amount` slot is `memory`. Returns the result for inspection.
Validated tell_amount(SlotBelief memory, std::optional<SlotValue> said, bool guess) {
    DecisionRequest r = request(DecisionKind::turn);
    r.facts[0].slots[idx(Slot::amount)] = memory;
    Claim c;
    c.slots[idx(Slot::amount)] = said;
    c.guess[idx(Slot::amount)] = guess;
    return validate(r, decision(say(Act::tell, 1, c)));
}

SlotVerdict amount_verdict(const Validated& v) {
    REQUIRE(v.verdict.slots.has_value());
    return (*v.verdict.slots)[idx(Slot::amount)];
}

const Claim& delivered(const Validated& v) {
    REQUIRE(v.action.claim.has_value());
    return *v.action.claim;
}

std::optional<SlotValue> delivered_amount(const Validated& v) {
    return delivered(v).slots[idx(Slot::amount)];
}

bool delivered_guess(const Validated& v) { return delivered(v).guess[idx(Slot::amount)]; }

}  // namespace

TEST_SUITE("validate") {
    // --- Table of core/verdict.h ------------------------------------------------

    TEST_CASE("sure X, says X unmarked: faithful") {
        const Validated v = tell_amount(belief_slot(SlotState::sure, kAmount), kAmount, false);
        CHECK(v.verdict.reject == RejectReason::none);
        CHECK(amount_verdict(v) == SlotVerdict::faithful);
        CHECK(delivered_amount(v) == kAmount);
        CHECK_FALSE(delivered_guess(v));
    }

    TEST_CASE("sure X, says X marked: faithful, the mark is kept") {
        const Validated v = tell_amount(belief_slot(SlotState::sure, kAmount), kAmount, true);
        CHECK(amount_verdict(v) == SlotVerdict::faithful);
        CHECK(delivered_amount(v) == kAmount);
        CHECK(delivered_guess(v));
    }

    TEST_CASE("sure X, says another value: contradiction, marked or not") {
        for (bool guess : {false, true}) {
            CAPTURE(guess);
            const Validated v = tell_amount(belief_slot(SlotState::sure, kAmount), 200, guess);
            CHECK(v.verdict.reject == RejectReason::none);
            CHECK(amount_verdict(v) == SlotVerdict::contradiction);
            CHECK_FALSE(delivered_amount(v).has_value());
            CHECK_FALSE(delivered_guess(v));
        }
    }

    TEST_CASE("doubt X, says X marked: faithful") {
        const Validated v = tell_amount(belief_slot(SlotState::doubt, kAmount), kAmount, true);
        CHECK(amount_verdict(v) == SlotVerdict::faithful);
        CHECK(delivered_amount(v) == kAmount);
        CHECK(delivered_guess(v));
    }

    TEST_CASE("doubt X, says X unmarked: hardened_doubt, delivered as said") {
        const Validated v = tell_amount(belief_slot(SlotState::doubt, kAmount), kAmount, false);
        CHECK(amount_verdict(v) == SlotVerdict::hardened_doubt);
        CHECK_FALSE(is_failure(amount_verdict(v)));
        CHECK(delivered_amount(v) == kAmount);
        CHECK_FALSE(delivered_guess(v));
    }

    TEST_CASE("doubt X, says another value marked: declared_guess") {
        const Validated v = tell_amount(belief_slot(SlotState::doubt, kAmount), 200, true);
        CHECK(amount_verdict(v) == SlotVerdict::declared_guess);
        CHECK(delivered_amount(v) == 200);
        CHECK(delivered_guess(v));
    }

    TEST_CASE("doubt X, says another value unmarked: invented") {
        const Validated v = tell_amount(belief_slot(SlotState::doubt, kAmount), 200, false);
        CHECK(amount_verdict(v) == SlotVerdict::invented);
        CHECK_FALSE(delivered_amount(v).has_value());
        CHECK_FALSE(delivered_guess(v));
    }

    TEST_CASE("forgotten or unknown, says a value marked: declared_guess") {
        for (SlotState state : {SlotState::forgotten, SlotState::unknown}) {
            CAPTURE(static_cast<int>(state));
            const Validated v = tell_amount(belief_slot(state), 200, true);
            CHECK(amount_verdict(v) == SlotVerdict::declared_guess);
            CHECK(delivered_amount(v) == 200);
            CHECK(delivered_guess(v));
        }
    }

    TEST_CASE("forgotten or unknown, says a value unmarked: invented") {
        for (SlotState state : {SlotState::forgotten, SlotState::unknown}) {
            CAPTURE(static_cast<int>(state));
            const Validated v = tell_amount(belief_slot(state), 200, false);
            CHECK(amount_verdict(v) == SlotVerdict::invented);
            CHECK_FALSE(delivered_amount(v).has_value());
            CHECK_FALSE(delivered_guess(v));
        }
    }

    TEST_CASE("any memory, says no value: omitted") {
        for (const SlotBelief& memory :
             {belief_slot(SlotState::sure, kAmount), belief_slot(SlotState::doubt, kAmount),
              belief_slot(SlotState::forgotten), belief_slot(SlotState::unknown)}) {
            CAPTURE(static_cast<int>(memory.state));
            const Validated v = tell_amount(memory, std::nullopt, false);
            CHECK(v.verdict.reject == RejectReason::none);
            CHECK(amount_verdict(v) == SlotVerdict::omitted);
            CHECK_FALSE(delivered_amount(v).has_value());
        }
    }

    TEST_CASE("a guess mark on a slot without value is ignored and cleared") {
        for (const SlotBelief& memory :
             {belief_slot(SlotState::sure, kAmount), belief_slot(SlotState::doubt, kAmount),
              belief_slot(SlotState::forgotten), belief_slot(SlotState::unknown)}) {
            CAPTURE(static_cast<int>(memory.state));
            const Validated v = tell_amount(memory, std::nullopt, true);
            CHECK(v.verdict.reject == RejectReason::none);
            CHECK(amount_verdict(v) == SlotVerdict::omitted);
            CHECK_FALSE(delivered_amount(v).has_value());
            CHECK_FALSE(delivered_guess(v));
        }
    }

    // --- Reject reasons ------------------------------------------------------------

    TEST_CASE("action_not_allowed: say in a plan") {
        check_rejected(request(DecisionKind::plan), say(Act::greet),
                       RejectReason::action_not_allowed);
    }

    TEST_CASE("action_not_allowed: go in a turn") {
        check_rejected(request(DecisionKind::turn), go(1, full_claim()),
                       RejectReason::action_not_allowed);
    }

    TEST_CASE("bad_fields: none carries no act, fact, claim or text") {
        const DecisionRequest r = request(DecisionKind::turn);
        Action a;
        a.act = Act::greet;
        check_rejected(r, a, RejectReason::bad_fields);
        a = Action{};
        a.fact = 1;
        check_rejected(r, a, RejectReason::bad_fields);
        a = Action{};
        a.claim = full_claim();
        check_rejected(r, a, RejectReason::bad_fields);
        a = Action{};
        a.text = "bye";
        check_rejected(r, a, RejectReason::bad_fields);
    }

    TEST_CASE("bad_fields: say requires act") {
        Action a;
        a.type = ActionType::say;
        a.text = "hello";
        check_rejected(request(DecisionKind::turn), a, RejectReason::bad_fields);
    }

    TEST_CASE("bad_fields: go carries no act and no text") {
        const DecisionRequest r = request(DecisionKind::plan);
        Action a = go(1, full_claim());
        a.act = Act::tell;
        check_rejected(r, a, RejectReason::bad_fields);
        a = go(1, full_claim());
        a.text = "I will go";
        check_rejected(r, a, RejectReason::bad_fields);
    }

    TEST_CASE("bad_fields: greet and bye carry no fact and no claim") {
        const DecisionRequest r = request(DecisionKind::turn);
        for (Act act : {Act::greet, Act::bye}) {
            CAPTURE(static_cast<int>(act));
            check_rejected(r, say(act, 1), RejectReason::bad_fields);
            check_rejected(r, say(act, std::nullopt, full_claim()), RejectReason::bad_fields);
        }
    }

    TEST_CASE("bad_fields: ask needs a fact and carries no claim") {
        const DecisionRequest r = request(DecisionKind::turn);
        check_rejected(r, say(Act::ask), RejectReason::bad_fields);
        check_rejected(r, say(Act::ask, 1, full_claim()), RejectReason::bad_fields);
    }

    TEST_CASE("bad_fields: tell needs a fact and a claim") {
        const DecisionRequest r = request(DecisionKind::turn);
        check_rejected(r, say(Act::tell, std::nullopt, full_claim()), RejectReason::bad_fields);
        check_rejected(r, say(Act::tell, 1), RejectReason::bad_fields);
    }

    TEST_CASE("bad_fields: go needs a fact and a claim") {
        const DecisionRequest r = request(DecisionKind::plan);
        check_rejected(r, go(std::nullopt, full_claim()), RejectReason::bad_fields);
        check_rejected(r, go(1, std::nullopt), RejectReason::bad_fields);
    }

    TEST_CASE("bad_fields: who outside 1..neighbor_count") {
        const DecisionRequest r = request(DecisionKind::turn);
        for (SlotValue who : {-1, 0, 101}) {
            CAPTURE(who);
            Claim c = full_claim();
            c.slots[idx(Slot::who)] = who;
            check_rejected(r, say(Act::tell, 1, c), RejectReason::bad_fields);
        }
        Claim last = full_claim();
        last.slots[idx(Slot::who)] = 100;
        CHECK(validate(r, decision(say(Act::tell, 1, last))).verdict.reject ==
              RejectReason::none);
    }

    TEST_CASE("bad_fields: where not a public place") {
        const DecisionRequest r = request(DecisionKind::plan);
        // 0 is none, 13 is a home quarter, 17 is past the catalog.
        for (SlotValue where : {-1, 0, 13, 16, 17}) {
            CAPTURE(where);
            Claim c = full_claim();
            c.slots[idx(Slot::where)] = where;
            check_rejected(r, go(1, c), RejectReason::bad_fields);
        }
        Claim last = full_claim();
        last.slots[idx(Slot::where)] = 12;
        CHECK(validate(r, decision(go(1, last))).verdict.reject == RejectReason::none);
    }

    TEST_CASE("bad_fields: negative when or amount") {
        const DecisionRequest r = request(DecisionKind::turn);
        for (Slot s : {Slot::when, Slot::amount}) {
            CAPTURE(static_cast<int>(s));
            Claim c = full_claim();
            c.slots[idx(s)] = -1;
            check_rejected(r, say(Act::tell, 1, c), RejectReason::bad_fields);
            c.slots[idx(s)] = 0;
            CHECK(validate(r, decision(say(Act::tell, 1, c))).verdict.reject ==
                  RejectReason::none);
        }
    }

    TEST_CASE("unknown_fact: 0 and past the list") {
        const DecisionRequest r = request(DecisionKind::turn);
        for (int fact : {-1, 0, 2}) {
            CAPTURE(fact);
            check_rejected(r, say(Act::tell, fact, full_claim()), RejectReason::unknown_fact);
            check_rejected(r, say(Act::ask, fact), RejectReason::unknown_fact);
            check_rejected(request(DecisionKind::plan), go(fact, full_claim()),
                           RejectReason::unknown_fact);
        }
    }

    TEST_CASE("unknown_fact: a request without facts") {
        DecisionRequest r = request(DecisionKind::turn);
        r.facts.clear();
        check_rejected(r, say(Act::ask, 1), RejectReason::unknown_fact);
    }

    TEST_CASE("malformed and truncated come from Decision::reject") {
        const DecisionRequest r = request(DecisionKind::turn);
        for (RejectReason reason : {RejectReason::malformed, RejectReason::truncated}) {
            CAPTURE(static_cast<int>(reason));
            // Even a valid action is discarded.
            check_rejected(validate(r, decision(say(Act::tell, 1, full_claim()), reason)),
                           reason);
            check_rejected(validate(r, decision(Action{}, reason)), reason);
        }
    }

    // --- Order of the checks ----------------------------------------------------------

    TEST_CASE("order: Decision::reject before action_not_allowed") {
        // go in a turn, with a fact that does not exist and bad fields.
        Action a = go(9, std::nullopt);
        a.text = "x";
        check_rejected(validate(request(DecisionKind::turn), decision(a, RejectReason::truncated)),
                       RejectReason::truncated);
    }

    TEST_CASE("order: action_not_allowed before bad_fields and unknown_fact") {
        // say in a plan, without act and with an unknown fact.
        Action a;
        a.type = ActionType::say;
        a.fact = 9;
        check_rejected(request(DecisionKind::plan), a, RejectReason::action_not_allowed);
    }

    TEST_CASE("order: bad_fields before unknown_fact") {
        const DecisionRequest r = request(DecisionKind::turn);
        // Fields that do not match the action.
        check_rejected(r, say(Act::greet, 9), RejectReason::bad_fields);
        // A value outside the vocabulary.
        Claim c = full_claim();
        c.slots[idx(Slot::where)] = 14;
        check_rejected(r, say(Act::tell, 9, c), RejectReason::bad_fields);
    }

    // --- Sanitized action -------------------------------------------------------------

    TEST_CASE("the claim loses its failed slots and keeps the rest") {
        DecisionRequest r = request(DecisionKind::turn);
        Belief& b = r.facts[0];
        b.slots[idx(Slot::who)] = belief_slot(SlotState::sure, kWho);
        b.slots[idx(Slot::where)] = belief_slot(SlotState::doubt, kWhere);
        b.slots[idx(Slot::when)] = belief_slot(SlotState::forgotten);
        b.slots[idx(Slot::amount)] = belief_slot(SlotState::unknown);

        Claim c;
        c.slots = {SlotValue{7}, SlotValue{kWhere}, SlotValue{44}, std::nullopt};
        c.guess = {true, false, true, true};
        const Action proposed = say(Act::tell, 1, c, std::string("text as it was"));
        const Validated v = validate(r, decision(proposed));

        CHECK(v.verdict.reject == RejectReason::none);
        REQUIRE(v.verdict.slots.has_value());
        const PerSlot<SlotVerdict> expected = {SlotVerdict::contradiction,
                                               SlotVerdict::hardened_doubt,
                                               SlotVerdict::declared_guess, SlotVerdict::omitted};
        CHECK(*v.verdict.slots == expected);

        Action want = proposed;
        want.claim->slots = {std::nullopt, SlotValue{kWhere}, SlotValue{44}, std::nullopt};
        want.claim->guess = {false, false, true, false};
        CHECK(v.action == want);
    }

    TEST_CASE("a go left without where or when is not rejected") {
        DecisionRequest r = request(DecisionKind::plan);
        r.facts[0].slots[idx(Slot::when)] = belief_slot(SlotState::forgotten);

        // where contradicts the memory, when is invented.
        Claim c = full_claim();
        c.slots[idx(Slot::where)] = 3;
        c.slots[idx(Slot::when)] = 50;
        const Validated v = validate(r, decision(go(1, c)));
        CHECK(v.verdict.reject == RejectReason::none);
        REQUIRE(v.verdict.slots.has_value());
        CHECK((*v.verdict.slots)[idx(Slot::where)] == SlotVerdict::contradiction);
        CHECK((*v.verdict.slots)[idx(Slot::when)] == SlotVerdict::invented);
        CHECK(v.action.type == ActionType::go);
        CHECK(v.action.fact == 1);
        CHECK_FALSE(delivered(v).slots[idx(Slot::where)].has_value());
        CHECK_FALSE(delivered(v).slots[idx(Slot::when)].has_value());
        CHECK(delivered(v).slots[idx(Slot::who)] == kWho);

        // A go that omits where and when from the start.
        Claim omitted;
        omitted.slots[idx(Slot::who)] = kWho;
        const Validated w = validate(r, decision(go(1, omitted)));
        CHECK(w.verdict.reject == RejectReason::none);
        CHECK(w.action == go(1, omitted));
    }

    // --- Valid actions come back intact -------------------------------------------

    TEST_CASE("a valid tell comes back intact, text included") {
        const Action a = say(Act::tell, 1, full_claim(), std::string("party at the square"));
        const Validated v = validate(request(DecisionKind::turn), decision(a));
        CHECK(v.action == a);
        CHECK(v.verdict.reject == RejectReason::none);
        REQUIRE(v.verdict.slots.has_value());
        for (Slot s : kSlots) CHECK((*v.verdict.slots)[idx(s)] == SlotVerdict::faithful);
    }

    TEST_CASE("a valid go comes back intact") {
        const Action a = go(1, full_claim());
        const Validated v = validate(request(DecisionKind::plan), decision(a));
        CHECK(v.action == a);
        CHECK(v.verdict.reject == RejectReason::none);
        REQUIRE(v.verdict.slots.has_value());
        for (Slot s : kSlots) CHECK((*v.verdict.slots)[idx(s)] == SlotVerdict::faithful);
    }

    TEST_CASE("actions without claim come back intact with no slot verdicts") {
        const DecisionRequest turn = request(DecisionKind::turn);
        for (const Action& a :
             {say(Act::greet), say(Act::greet, std::nullopt, std::nullopt, std::string("hi")),
              say(Act::bye), say(Act::ask, 1, std::nullopt, std::string("did you hear?")),
              Action{}}) {
            const Validated v = validate(turn, decision(a));
            CHECK(v.action == a);
            CHECK(v.verdict == Verdict{});
        }
        const Validated none_in_plan = validate(request(DecisionKind::plan), decision(Action{}));
        CHECK(none_in_plan.action == Action{});
        CHECK(none_in_plan.verdict == Verdict{});
    }
}

}  // namespace rumor
