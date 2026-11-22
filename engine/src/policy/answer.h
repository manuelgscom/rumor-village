#pragma once
// Reading the JSON answer of a model as an action (contract, section 3). The
// model policy reads every answer of the model with it, and `rumor validate`
// reads with it the answers that other models wrote for a card. Implemented in
// src/policy/answer*.
//
// Reading only turns names into identifiers: which action fits a kind of
// decision, which fields it carries and which values are in range is for
// validation to say (core/validate_api.h).

#include <string_view>

#include "core/decision.h"
#include "core/policy.h"
#include "core/population_api.h"

namespace rumor {

// The answer `json_text` to `request` as a Decision: the action, or
// RejectReason::malformed (and an empty action) when it cannot be read as one.
// `gen` is left empty. Names are those of `vocab` and `population`; a `when`
// ("hoy 21:00") is relative to request.tick.
//
// Accepted: one JSON object (whitespace around and inside it, any key order;
// the grammar is not needed) with the keys of the action and nothing else:
//   action  "say", "go" or "none"; required
//   act     "greet", "tell", "ask" or "bye", or null
//   fact    an integer that fits in 32 bits (any sign), or null
//   claim   an object with any of who, where, when, amount and guess, or null;
//           a missing slot or a null one is an omission
//     who     the name of a neighbor of `population`
//     where   the name of any place of `vocab` (homes too; validation rejects
//             them)
//     when    "<today|tomorrow> HH:MM" with the day words of `vocab`, in steps
//             of 30 minutes
//     amount  an integer that fits in 32 bits (any sign)
//     guess   an array of slot keys in any order (repeats are harmless), or
//             null
//   text    a string, or null
// Malformed: anything else, such as text after the object, another type of
// value, an unknown key or name, or a when that is not a slot of today or
// tomorrow. When a key comes twice, the last one is read.
Decision read_answer(std::string_view json_text, const DecisionRequest& request,
                     const Vocab& vocab, const Population& population);

}  // namespace rumor
