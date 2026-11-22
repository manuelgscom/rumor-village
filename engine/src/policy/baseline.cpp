// The baseline policy: rules and dice, no model. It answers from the request
// and its seed only, so the same request always gets the same action.
// explain_baseline (core/game_api.h) runs the very same code with a recorder
// of the draws: the explanation can never differ from the decision.

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

#include "core/catalog.h"
#include "core/game_api.h"
#include "core/policy.h"
#include "core/rng.h"
#include "core/time.h"

namespace rumor {
namespace {

// --- Tunable probabilities, in parts per million ------------------------------

// Chance of telling a fact, by relation with the listener...
constexpr std::array<std::uint32_t, kRelationCount> kTellByRelation = {
    900'000,  // family
    800'000,  // friend
    600'000,  // coworker
    400'000,  // acquaintance
    100'000,  // rival
};

// ...multiplied by a factor of the trait of the teller, capped at 100 %.
constexpr std::array<std::uint32_t, kTraitCount> kTellTraitFactor = {
    1'300'000,  // gossip
    1'150'000,  // sociable
    700'000,    // prudent
    500'000,    // discreet
    600'000,    // shy
    1'100'000,  // exaggerator
};

// Chance of guessing a forgotten slot (marked in guess) instead of omitting it.
constexpr std::uint32_t kGuessForgotten = 500'000;

// Chance of going to a planned fact, by trait.
constexpr std::array<std::uint32_t, kTraitCount> kGoByTrait = {
    950'000,  // gossip
    900'000,  // sociable
    850'000,  // prudent
    800'000,  // discreet
    800'000,  // shy
    900'000,  // exaggerator
};

// A guessed amount is uniform in 0..kGuessAmountMax.
constexpr SlotValue kGuessAmountMax = 10;

// ------------------------------------------------------------------------------

// Where the draws and the rule of one decision go when it is explained; null
// when it is only decided.
using Why = RuleExplanation*;

// rng.chance_ppm(ppm), recording the draw: the same call to the generator.
bool roll(Rng& rng, std::uint32_t ppm, const char* name, Why why) {
    const std::uint32_t r = rng.below(kPpm);
    const bool hit = r < ppm;
    if (why) why->rolls.push_back({name, ppm, r, hit});
    return hit;
}

// rng.pick(items), recording the draw: chance and roll on the scale of a
// million (the i-th of n is i * 1e6 / n).
int pick(Rng& rng, const std::vector<int>& items, Why why) {
    const auto n = static_cast<std::uint32_t>(items.size());
    const std::uint32_t i = rng.below(n);
    if (why) {
        why->rolls.push_back({"pick_fact", kPpm / n,
                              static_cast<std::uint32_t>(std::uint64_t{i} * kPpm / n), true});
    }
    return items[i];
}

void rule(Why why, const char* name) {
    if (why) why->rule = name;
}

template <class E, std::size_t N>
constexpr std::uint32_t lookup(const std::array<std::uint32_t, N>& table, E value) {
    return table[static_cast<std::size_t>(value)];
}

std::uint32_t tell_ppm(Relation relation, Trait trait) {
    const std::uint64_t p = static_cast<std::uint64_t>(lookup(kTellByRelation, relation)) *
                            lookup(kTellTraitFactor, trait) / kPpm;
    return static_cast<std::uint32_t>(std::min<std::uint64_t>(p, kPpm));
}

std::vector<SlotValue> public_places() {
    std::vector<SlotValue> out;
    for (std::size_t i = 0; i < kPlaceCount; ++i) {
        const PlaceId p = PlaceId::from_index(i);
        if (is_public(p)) out.push_back(static_cast<SlotValue>(p.v));
    }
    return out;
}

// The vocabulary that validation accepts for each slot.
bool in_vocabulary(Slot slot, SlotValue v, const DecisionRequest& request) {
    switch (slot) {
        case Slot::who: return v >= 1 && v <= request.neighbor_count;
        case Slot::where: return v >= 1 && is_public(PlaceId(static_cast<std::uint32_t>(v)));
        case Slot::when:
        case Slot::amount: return v >= 0;
    }
    return false;
}

// The neighbor's own value of a slot: sure or doubt, with a value inside the
// vocabulary. A value outside it would get the whole action rejected, so it is
// treated as missing.
std::optional<SlotValue> held_value(const Belief& belief, Slot slot,
                                    const DecisionRequest& request) {
    const SlotBelief& s = belief.slots[idx(slot)];
    if (s.state != SlotState::sure && s.state != SlotState::doubt) return std::nullopt;
    if (!s.value || !in_vocabulary(slot, *s.value, request)) return std::nullopt;
    return s.value;
}

// A random value inside the vocabulary of the slot; empty if there is none.
std::optional<SlotValue> guess_value(Slot slot, const DecisionRequest& request, Rng& rng) {
    switch (slot) {
        case Slot::who:
            if (request.neighbor_count < 1) return std::nullopt;
            return rng.range(1, request.neighbor_count);
        case Slot::where: return rng.pick(public_places());
        case Slot::when: {
            // A slot later today, after the current one.
            const TimeSlot first = slot_of(request.tick) + 1;
            const TimeSlot last = (day_of(request.tick) + 1) * kSlotsPerDay - 1;
            if (first > last) return std::nullopt;
            return rng.range(first, last);
        }
        case Slot::amount: return rng.range(0, kGuessAmountMax);
    }
    return std::nullopt;
}

// What the neighbor says when telling a fact: sure as it is, doubt as a guess,
// forgotten guessed or omitted, unknown omitted.
Claim tell_claim(const Belief& belief, const DecisionRequest& request, Rng& rng, Why why) {
    Claim claim;
    for (Slot slot : kSlots) {
        const SlotState state = belief.slots[idx(slot)].state;
        if (state == SlotState::sure || state == SlotState::doubt) {
            claim.slots[idx(slot)] = held_value(belief, slot, request);
            claim.guess[idx(slot)] = state == SlotState::doubt && claim.slots[idx(slot)];
        } else if (state == SlotState::forgotten &&
                   roll(rng, kGuessForgotten, "guess_forgotten", why)) {
            claim.slots[idx(slot)] = guess_value(slot, request, rng);
            claim.guess[idx(slot)] = claim.slots[idx(slot)].has_value();
        }
    }
    return claim;
}

// The neighbor's version of a fact for a plan: what it holds, nothing guessed.
Claim plan_claim(const Belief& belief, const DecisionRequest& request) {
    Claim claim;
    for (Slot slot : kSlots) {
        claim.slots[idx(slot)] = held_value(belief, slot, request);
        claim.guess[idx(slot)] =
            claim.slots[idx(slot)] && belief.slots[idx(slot)].state == SlotState::doubt;
    }
    return claim;
}

Action say(Act act) {
    Action a;
    a.type = ActionType::say;
    a.act = act;
    return a;
}

Action tell(int number, const DecisionRequest& request, Rng& rng, Why why) {
    Action a = say(Act::tell);
    a.fact = number;
    a.claim = tell_claim(request.facts[static_cast<std::size_t>(number - 1)], request, rng, why);
    return a;
}

// Number (from 1) of a fact in the request; 0 if the neighbor does not know it.
int number_of(const DecisionRequest& request, FactId fact) {
    for (std::size_t i = 0; i < request.facts.size(); ++i) {
        if (request.facts[i].fact == fact) return static_cast<int>(i) + 1;
    }
    return 0;
}

bool said(const DecisionRequest& request, NeighborId speaker, Act act) {
    return std::any_of(request.conversation.begin(), request.conversation.end(),
                       [&](const ConvEntry& e) { return e.speaker == speaker && e.act == act; });
}

// A fact the neighbor may tell to whoever is in front: not told to them before,
// not heard from them, and not told by them in this conversation.
bool is_candidate(const Belief& belief, const DecisionRequest& request) {
    const NeighborId other = request.other;
    if (!other.valid()) return false;
    if (std::find(belief.told_to.begin(), belief.told_to.end(), other) != belief.told_to.end()) {
        return false;
    }
    if (belief.told_by == other) return false;
    return std::none_of(request.conversation.begin(), request.conversation.end(),
                        [&](const ConvEntry& e) {
                            return e.speaker == other && e.act == Act::tell &&
                                   e.fact == belief.fact;
                        });
}

Action decide_turn(const DecisionRequest& request, Rng& rng, Why why) {
    // 1. Whoever opens the conversation greets.
    if (request.conversation.empty()) {
        rule(why, "greet_first");
        return say(Act::greet);
    }

    // 2. Answer a question about a known fact.
    const ConvEntry& last = request.conversation.back();
    if (last.speaker == request.other && last.act == Act::ask) {
        const int number = number_of(request, last.fact);
        if (number > 0) {
            rule(why, "answer_question");
            return tell(number, request, rng, why);
        }
    }

    // 3. One chance per conversation to tell one fact: right after being
    //    greeted, or after the other's first answer for whoever opened. Both
    //    neighbors get their chance before anybody says bye.
    const auto mine = std::count_if(request.conversation.begin(), request.conversation.end(),
                                    [&](const ConvEntry& e) { return e.speaker == request.self; });
    const bool opened = request.conversation.front().speaker == request.self;
    if (mine == (opened ? 1 : 0) && !said(request, request.self, Act::tell)) {
        std::vector<int> candidates;
        for (std::size_t i = 0; i < request.facts.size(); ++i) {
            if (is_candidate(request.facts[i], request)) candidates.push_back(static_cast<int>(i) + 1);
        }
        if (!candidates.empty()) {
            const int number = pick(rng, candidates, why);
            if (roll(rng, tell_ppm(request.relation, request.trait), "tell", why)) {
                rule(why, "tell_chance");
                return tell(number, request, rng, why);
            }
        }
    }

    // 4. Otherwise greet back, or leave if that is already done.
    rule(why, mine == 0 ? "greet_back" : "bye");
    return mine == 0 ? say(Act::greet) : say(Act::bye);
}

Action decide_plan(const DecisionRequest& request, Rng& rng, Why why) {
    rule(why, "plan_no_time");  // until the dice of going are thrown
    const int number = request.trigger_fact;
    if (number < 1 || static_cast<std::size_t>(number) > request.facts.size()) return {};
    const Belief& belief = request.facts[static_cast<std::size_t>(number - 1)];

    const std::optional<SlotValue> where = held_value(belief, Slot::where, request);
    const std::optional<SlotValue> when = held_value(belief, Slot::when, request);
    // when > slot_of(tick) is tick_of(when) > tick, without the multiplication.
    if (!where || !when || *when <= slot_of(request.tick)) return {};
    rule(why, "plan_go");
    if (!roll(rng, lookup(kGoByTrait, request.trait), "go", why)) return {};

    Action a;
    a.type = ActionType::go;
    a.fact = number;
    a.claim = plan_claim(belief, request);
    return a;
}

Decision decide_one(const DecisionRequest& request, Why why = nullptr) {
    Rng rng(request.seed);
    Decision d;
    d.action = request.kind == DecisionKind::plan ? decide_plan(request, rng, why)
                                                  : decide_turn(request, rng, why);
    return d;
}

class BaselinePolicy final : public Policy {
  public:
    std::string name() const override { return "baseline"; }

    std::vector<Decision> decide(std::span<const DecisionRequest> batch) override {
        std::vector<Decision> out;
        out.reserve(batch.size());
        for (const DecisionRequest& request : batch) out.push_back(decide_one(request));
        return out;
    }
};

}  // namespace

std::unique_ptr<Policy> make_baseline_policy() { return std::make_unique<BaselinePolicy>(); }

RuleExplanation explain_baseline(const DecisionRequest& request) {
    RuleExplanation why;
    decide_one(request, &why);
    return why;
}

}  // namespace rumor
