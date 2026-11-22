// Validation of a proposed action (contract, section 3). See core/validate_api.h
// for the order of the checks and core/verdict.h for the table of slot verdicts.

#include "core/validate_api.h"

#include <cstddef>
#include <cstdint>
#include <optional>

#include "core/catalog.h"
#include "core/ids.h"

namespace rumor {
namespace {

bool allowed(DecisionKind kind, ActionType type) {
    if (type == ActionType::none) return true;
    if (kind == DecisionKind::turn) return type == ActionType::say;
    return type == ActionType::go;
}

// Which fields the action must and must not carry.
bool fields_match(const Action& a) {
    const bool act = a.act.has_value();
    const bool fact = a.fact.has_value();
    const bool claim = a.claim.has_value();
    const bool text = a.text.has_value();
    switch (a.type) {
        case ActionType::none:
            return !act && !fact && !claim && !text;
        case ActionType::go:
            return !act && !text && fact && claim;
        case ActionType::say:
            if (!act) return false;
            switch (*a.act) {
                case Act::greet:
                case Act::bye:
                    return !fact && !claim;
                case Act::ask:
                    return fact && !claim;
                case Act::tell:
                    return fact && claim;
            }
            return false;
    }
    return false;
}

bool in_vocabulary(Slot slot, SlotValue v, int neighbor_count) {
    switch (slot) {
        case Slot::who:
            return v >= 1 && v <= neighbor_count;
        case Slot::where:
            return v >= 1 && is_public(PlaceId(static_cast<std::uint32_t>(v)));
        case Slot::when:
        case Slot::amount:
            return v >= 0;
    }
    return false;
}

bool claim_in_vocabulary(const Claim& claim, int neighbor_count) {
    for (Slot s : kSlots) {
        const auto& v = claim.slots[idx(s)];
        if (v && !in_vocabulary(s, *v, neighbor_count)) return false;
    }
    return true;
}

RejectReason check(const DecisionRequest& request, const Decision& decision) {
    if (decision.reject != RejectReason::none) return decision.reject;
    const Action& a = decision.action;
    if (!allowed(request.kind, a.type)) return RejectReason::action_not_allowed;
    if (!fields_match(a)) return RejectReason::bad_fields;
    if (a.claim && !claim_in_vocabulary(*a.claim, request.neighbor_count)) {
        return RejectReason::bad_fields;
    }
    if (a.fact && (*a.fact < 1 || static_cast<std::size_t>(*a.fact) > request.facts.size())) {
        return RejectReason::unknown_fact;
    }
    return RejectReason::none;
}

// One row of the table in core/verdict.h. A sure or doubt slot without value
// (which memory never holds) is read as unknown.
SlotVerdict slot_verdict(const SlotBelief& memory, const std::optional<SlotValue>& said,
                         bool guess) {
    if (!said) return SlotVerdict::omitted;
    SlotState state = memory.state;
    if ((state == SlotState::sure || state == SlotState::doubt) && !memory.value) {
        state = SlotState::unknown;
    }
    const bool same = memory.value == said;
    switch (state) {
        case SlotState::sure:
            return same ? SlotVerdict::faithful : SlotVerdict::contradiction;
        case SlotState::doubt:
            if (same) return guess ? SlotVerdict::faithful : SlotVerdict::hardened_doubt;
            return guess ? SlotVerdict::declared_guess : SlotVerdict::invented;
        case SlotState::unknown:
        case SlotState::forgotten:
            return guess ? SlotVerdict::declared_guess : SlotVerdict::invented;
    }
    return SlotVerdict::invented;
}

}  // namespace

Validated validate(const DecisionRequest& request, const Decision& decision) {
    Validated out;
    out.verdict.reject = check(request, decision);
    if (out.verdict.reject != RejectReason::none) return out;

    out.action = decision.action;
    if (!out.action.claim) return out;

    Claim& claim = *out.action.claim;
    const Belief& belief = request.facts[static_cast<std::size_t>(*out.action.fact) - 1];
    PerSlot<SlotVerdict> slots{};
    for (Slot s : kSlots) {
        const std::size_t i = idx(s);
        slots[i] = slot_verdict(belief.slots[i], claim.slots[i], claim.guess[i]);
        if (is_failure(slots[i])) claim.slots[i].reset();
        if (!claim.slots[i]) claim.guess[i] = false;
    }
    out.verdict.slots = slots;
    return out;
}

}  // namespace rumor
