#include "core/decision.h"

#include "core/sha256.h"

namespace rumor {
namespace {

template <class IdType>
std::string id_text(IdType id) {
    return id.valid() ? id.str() : std::string("-");
}

// "<state>" or "<state>:<value>:<source>".
std::string belief_text(const SlotBelief& slot) {
    std::string out(key(slot.state));
    if (slot.value) {
        out += ':';
        out += std::to_string(*slot.value);
        out += ':';
        out += id_text(slot.source);
    }
    return out;
}

// "-" for an omission, the value otherwise, with "?" after a declared guess.
std::string claim_text(const Claim& claim, Slot slot) {
    const auto& value = claim.slots[idx(slot)];
    if (!value) return "-";
    std::string out = std::to_string(*value);
    if (claim.guess[idx(slot)]) out += '?';
    return out;
}

}  // namespace

std::string canonical(const DecisionRequest& request) {
    std::string out;
    out += "kind=";
    out += key(request.kind);
    out += " tick=" + std::to_string(request.tick);
    out += " weekday=" + std::to_string(request.weekday);
    out += " self=" + id_text(request.self);
    out += " job=";
    out += key(request.job);
    out += " trait=";
    out += key(request.trait);
    out += " place=" + id_text(request.place);
    out += " other=" + id_text(request.other);
    out += " relation=";
    out += key(request.relation);
    out += " trigger=" + std::to_string(request.trigger_fact);
    out += " neighbors=" + std::to_string(request.neighbor_count);
    out += '\n';

    for (const Belief& belief : request.facts) {
        out += "fact " + id_text(belief.fact);
        for (Slot slot : kSlots) {
            out += ' ';
            out += key(slot);
            out += '=';
            out += belief_text(belief.slots[idx(slot)]);
        }
        out += " told_by=" + id_text(belief.told_by);
        out += " heard_at=" + std::to_string(belief.heard_at);
        out += " told_to=";
        for (std::size_t i = 0; i < belief.told_to.size(); ++i) {
            if (i > 0) out += ',';
            out += id_text(belief.told_to[i]);
        }
        // Free text goes last, with its length, so it cannot imitate a field.
        out += " what=" + std::to_string(belief.what.size()) + ':' + belief.what;
        out += '\n';
    }

    for (const ConvEntry& entry : request.conversation) {
        out += "conv " + id_text(entry.speaker) + ' ';
        out += key(entry.act);
        out += ' ' + id_text(entry.fact);
        if (entry.claim) {
            for (Slot slot : kSlots) {
                out += ' ';
                out += key(slot);
                out += '=';
                out += claim_text(*entry.claim, slot);
            }
        }
        out += '\n';
    }
    return out;
}

std::string fingerprint(const DecisionRequest& request) { return sha256_hex(canonical(request)); }

}  // namespace rumor
