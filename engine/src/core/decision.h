#pragma once
// The situation of one decision, as data. It is everything a policy may use:
// the baseline reads it directly and, from phase 2, the card of the model is
// written from it. No policy sees the state of the village.

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "core/action.h"
#include "core/catalog.h"
#include "core/fact.h"
#include "core/ids.h"
#include "core/time.h"

namespace rumor {

// One earlier turn of the conversation, from the data and not from the text:
// "Luis greeted you", "Luis told you [1]: square, 21:00".
struct ConvEntry {
    NeighborId speaker;
    Act act = Act::greet;
    FactId fact;                 // with tell and ask
    std::optional<Claim> claim;  // with tell: as it was delivered, without the slots that failed validation

    friend bool operator==(const ConvEntry&, const ConvEntry&) = default;
};

struct DecisionRequest {
    DecisionKind kind = DecisionKind::turn;
    // Derived from (run seed, tick, neighbor, kind), never from the position in
    // the batch. It is the only randomness a policy may use.
    std::uint64_t seed = 0;

    Tick tick = 0;
    int weekday = 0;  // 0 = Monday

    NeighborId self;  // who decides
    Job job = Job::retired;
    Trait trait = Trait::sociable;
    PlaceId place;  // where the neighbor is; the destination while on the way

    NeighborId other;  // who is in front; none in a plan outside a conversation
    Relation relation = Relation::acquaintance;  // with `other`

    // What the neighbor knows, numbered from 1 in this order: a copy of the
    // neighbor's memory. Action::fact refers to these numbers.
    std::vector<Belief> facts;

    // Earlier turns of this conversation, oldest first.
    std::vector<ConvEntry> conversation;

    // Plan: number (from 1) of the fact that prompted the decision. 0 in a turn.
    int trigger_fact = 0;

    // Size of the closed list of neighbors: n001..n<count>. A `who` outside it
    // is outside the vocabulary.
    int neighbor_count = 0;

    friend bool operator==(const DecisionRequest&, const DecisionRequest&) = default;
};

// Stable text form of a request, without the seed. Two requests with the same
// text are the same situation and produce the same card in any language.
std::string canonical(const DecisionRequest& request);

// SHA-256 of canonical(): the fingerprint of the card that the log stores in
// every `turn` and `plan` (contract, section 6).
std::string fingerprint(const DecisionRequest& request);

}  // namespace rumor
