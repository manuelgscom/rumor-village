#pragma once
// Validation of a proposed action against the memory of the neighbor (contract,
// section 3). The model proposes and the engine decides: nothing is applied
// without going through here. Implemented in src/card/validate*.

#include "core/action.h"
#include "core/decision.h"
#include "core/policy.h"
#include "core/verdict.h"

namespace rumor {

struct Validated {
    // What the engine applies. `none` (and nothing else) if the action was
    // rejected. Otherwise the proposed action with the failed slots removed
    // from the claim, together with their guess marks, and with the guess marks
    // of slots without value cleared.
    Action action;
    Verdict verdict;
};

// Checks, in this order; the first that fails rejects the action:
//   1. decision.reject is set                      -> that reason
//   2. action not allowed for the kind             -> action_not_allowed
//        turn: say, none        plan: go, none
//   3. fields that do not match the action         -> bad_fields
//        none        no act, fact, claim or text
//        say         act required; go and none carry no act and no text
//        greet, bye  no fact, no claim
//        ask         fact, no claim
//        tell        fact and claim
//        go          fact and claim
//      or a claim value outside the vocabulary:
//        who    not in 1..request.neighbor_count
//        where  not a public place of the catalog
//        when   negative
//        amount negative
//   4. fact number not in 1..request.facts.size()  -> unknown_fact
//
// If nothing fails, each slot of the claim gets its verdict from the table in
// core/verdict.h, against request.facts[fact - 1].
//
// A `go` whose claim ends without `where` or without `when` is not rejected:
// the verdict stands and the simulation does not write it in the agenda.
Validated validate(const DecisionRequest& request, const Decision& decision);

}  // namespace rumor
