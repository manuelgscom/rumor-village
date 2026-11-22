#pragma once
// The action a policy proposes (contract, section 3). The JSON keys are
// `action`, `act`, `fact`, `claim` {`who`, `where`, `when`, `amount`, `guess`}
// and `text`, in that order; inside the engine the claim already carries
// identifiers and slots, not names.

#include <cstdint>
#include <optional>
#include <string>

#include "core/enum_keys.h"
#include "core/fact.h"

namespace rumor {

enum class DecisionKind : std::uint8_t {
    turn,  // it is the neighbor's turn to speak: say or none
    plan,  // the neighbor has just learned, or seen change, a fact: go or none
};
RUMOR_ENUM_KEYS(DecisionKind, "turn", "plan");

enum class ActionType : std::uint8_t { none, say, go };
RUMOR_ENUM_KEYS(ActionType, "none", "say", "go");

enum class Act : std::uint8_t { greet, tell, ask, bye };
RUMOR_ENUM_KEYS(Act, "greet", "tell", "ask", "bye");

// What a neighbor states about a fact. A slot without value is an omission. A
// value marked in `guess` is a declared guess ("I think it was at ten").
struct Claim {
    PerSlot<std::optional<SlotValue>> slots;
    PerSlot<bool> guess = {};

    friend bool operator==(const Claim&, const Claim&) = default;
};

struct Action {
    ActionType type = ActionType::none;
    std::optional<Act> act;           // only with say
    std::optional<int> fact;          // number of the fact in the request, from 1; with tell, ask and go
    std::optional<Claim> claim;       // with tell and go
    std::optional<std::string> text;  // only with say, and optional; the baseline writes none

    friend bool operator==(const Action&, const Action&) = default;
};

// Start and end of the generation of one decision, in milliseconds since the
// start of the run, and its tokens. Only a model produces it.
struct Generation {
    std::int64_t t_start_ms = 0;
    std::int64_t t_end_ms = 0;
    int tokens_in = 0;
    int tokens_out = 0;

    friend bool operator==(const Generation&, const Generation&) = default;
};

}  // namespace rumor
