#pragma once
// What validation says about a proposed action (contract, section 3).

#include <cstdint>
#include <optional>

#include "core/enum_keys.h"
#include "core/fact.h"

namespace rumor {

// Verdict of one slot of a claim against the neighbor's memory.
//
//   memory                 says                         verdict
//   sure X                 X (marked in guess or not)   faithful
//   sure X                 another value                contradiction    (failure)
//   doubt X                X marked in guess            faithful
//   doubt X                X not marked                 hardened_doubt   (counted apart)
//   doubt X                another value, marked        declared_guess
//   doubt X                another value, not marked    invented         (failure)
//   forgotten or unknown   a value marked in guess      declared_guess
//   forgotten or unknown   a value not marked           invented         (failure)
//   any                    no value                     omitted
//
// A mark in `guess` on a slot without value is ignored.
enum class SlotVerdict : std::uint8_t {
    faithful, contradiction, hardened_doubt, declared_guess, invented, omitted,
};
RUMOR_ENUM_KEYS(SlotVerdict, "faithful", "contradiction", "hardened_doubt", "declared_guess",
                "invented", "omitted");

// A failed slot does not reach the listener or the agenda.
constexpr bool is_failure(SlotVerdict v) {
    return v == SlotVerdict::contradiction || v == SlotVerdict::invented;
}

// Why a whole action is rejected and replaced by `none`.
enum class RejectReason : std::uint8_t {
    none,                // not rejected
    action_not_allowed,  // say in a plan, go in a turn
    bad_fields,          // fields that do not match the action, or a value outside the vocabulary
    unknown_fact,        // fact number that is not in the request
    malformed,           // the policy could not read the model output as an action
    truncated,           // the model output was cut by the token limit
};
RUMOR_ENUM_KEYS(RejectReason, "none", "action_not_allowed", "bad_fields", "unknown_fact",
                "malformed", "truncated");

struct Verdict {
    RejectReason reject = RejectReason::none;
    // Present when the action is not rejected and carries a claim (tell, go).
    std::optional<PerSlot<SlotVerdict>> slots;

    friend bool operator==(const Verdict&, const Verdict&) = default;
};

}  // namespace rumor
