#pragma once
// The fact (what is told) and each neighbor's own version of it (contract,
// section 2).

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "core/enum_keys.h"
#include "core/ids.h"
#include "core/time.h"

namespace rumor {

// The four slots of a fact that can be deformed. `what` is not a slot: it is
// the identity of the rumor.
enum class Slot : std::uint8_t { who, where, when, amount };
RUMOR_ENUM_KEYS(Slot, "who", "where", "when", "amount");
inline constexpr std::size_t kSlotCount = enum_count<Slot>;
inline constexpr std::array<Slot, kSlotCount> kSlots = {Slot::who, Slot::where, Slot::when,
                                                        Slot::amount};
constexpr std::size_t idx(Slot s) { return static_cast<std::size_t>(s); }

// One element per slot, indexed with idx(slot).
template <class T>
using PerSlot = std::array<T, kSlotCount>;

// The value of a slot, whatever the slot:
//   who     value of a NeighborId
//   where   value of a PlaceId (a public place)
//   when    a TimeSlot
//   amount  the number itself, never negative
using SlotValue = std::int32_t;

// A fact as it was injected: the original version, the truth of the village.
struct Fact {
    FactId id;
    std::string what;
    PerSlot<std::optional<SlotValue>> slots;

    friend bool operator==(const Fact&, const Fact&) = default;
};

enum class SlotState : std::uint8_t {
    unknown,    // never told
    sure,       // heard as certain
    doubt,      // heard as somebody's guess
    forgotten,  // known once, forgotten since
};
RUMOR_ENUM_KEYS(SlotState, "unknown", "sure", "doubt", "forgotten");

// One slot in one neighbor's memory.
struct SlotBelief {
    SlotState state = SlotState::unknown;
    // Set exactly when the state is sure or doubt. Forgetting erases it: the
    // old value must not reach the policy.
    std::optional<SlotValue> value;
    // Who said the value: for a doubt, whose guess it is. None when the value
    // comes from an injection or there is no value.
    NeighborId source;

    friend bool operator==(const SlotBelief&, const SlotBelief&) = default;
};

// One neighbor's version of one fact.
struct Belief {
    FactId fact;
    std::string what;
    PerSlot<SlotBelief> slots;
    NeighborId told_by;               // who told it first; none if it was injected
    Tick heard_at = 0;                // when it was first heard
    std::vector<NeighborId> told_to;  // whom this neighbor has told it to: ascending, no repeats

    friend bool operator==(const Belief&, const Belief&) = default;
};

// Everything one neighbor knows, in the order it was learned. The position in
// `facts` plus one is the number of the fact in that neighbor's card.
struct Memory {
    std::vector<Belief> facts;

    const Belief* find(FactId fact) const {
        for (const Belief& b : facts) {
            if (b.fact == fact) return &b;
        }
        return nullptr;
    }
    Belief* find(FactId fact) {
        for (Belief& b : facts) {
            if (b.fact == fact) return &b;
        }
        return nullptr;
    }
};

}  // namespace rumor
