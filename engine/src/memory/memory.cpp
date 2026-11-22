// Memory rules (contract, section 2). See core/memory_api.h.

#include <algorithm>
#include <string>
#include <utility>

#include "core/memory_api.h"
#include "core/rng.h"

namespace rumor {

namespace {

MemoryEvent make_event(Tick tick, NeighborId who, FactId fact, Slot slot, const SlotBelief& b,
                       MemoryCause cause, int turn) {
    MemoryEvent e;
    e.tick = tick;
    e.who = who;
    e.fact = fact;
    e.slot = slot;
    e.state = b.state;
    e.value = b.value;
    e.cause = cause;
    e.turn = turn;
    return e;
}

// The belief for `fact`, appended at the end of the memory if it is new.
Belief& find_or_add(Memory& memory, FactId fact, std::string_view what, NeighborId told_by,
                    Tick tick) {
    if (Belief* known = memory.find(fact)) return *known;
    Belief b;
    b.fact = fact;
    b.what = std::string(what);
    b.told_by = told_by;
    b.heard_at = tick;
    memory.facts.push_back(std::move(b));
    return memory.facts.back();
}

}  // namespace

void memory_inject(Memory& memory, NeighborId who, const Fact& fact, Tick tick,
                   std::vector<MemoryEvent>& out) {
    Belief& belief = find_or_add(memory, fact.id, fact.what, NeighborId{}, tick);
    for (Slot s : kSlots) {
        const auto& value = fact.slots[idx(s)];
        if (!value) continue;
        SlotBelief& b = belief.slots[idx(s)];
        b.state = SlotState::sure;
        b.value = value;
        b.source = NeighborId{};
        out.push_back(make_event(tick, who, fact.id, s, b, MemoryCause::inject, 0));
    }
}

void memory_forget(Memory& memory, NeighborId who, std::uint32_t forget_ppm,
                   std::uint32_t doubt_drop_ppm, std::uint64_t run_seed, Tick tick,
                   std::vector<MemoryEvent>& out) {
    Rng rng(derive_seed(run_seed, tick, who, Stream::forget));
    for (Belief& belief : memory.facts) {
        for (Slot s : kSlots) {
            SlotBelief& b = belief.slots[idx(s)];
            if (b.state != SlotState::sure && b.state != SlotState::doubt) continue;
            if (rng.chance_ppm(forget_ppm)) {
                b.state = SlotState::forgotten;
                b.value.reset();
                b.source = NeighborId{};
                out.push_back(make_event(tick, who, belief.fact, s, b, MemoryCause::forgot, 0));
            } else if (b.state == SlotState::doubt && rng.chance_ppm(doubt_drop_ppm)) {
                b.state = SlotState::sure;
                out.push_back(
                    make_event(tick, who, belief.fact, s, b, MemoryCause::doubt_dropped, 0));
            }
        }
    }
}

std::vector<Slot> memory_hear(Memory& memory, NeighborId listener, NeighborId teller, FactId fact,
                              std::string_view what, const Claim& delivered, Tick tick,
                              int turn_id, std::vector<MemoryEvent>& out) {
    std::vector<Slot> conflicts;
    Belief& belief = find_or_add(memory, fact, what, teller, tick);
    for (Slot s : kSlots) {
        const auto& value = delivered.slots[idx(s)];
        if (!value) continue;
        const bool guess = delivered.guess[idx(s)];
        SlotBelief& b = belief.slots[idx(s)];
        switch (b.state) {
            case SlotState::unknown:
            case SlotState::forgotten:
                b.state = guess ? SlotState::doubt : SlotState::sure;
                break;
            case SlotState::doubt:
                if (guess) continue;
                b.state = SlotState::sure;
                break;
            case SlotState::sure:
                if (b.value != value) conflicts.push_back(s);
                continue;
        }
        b.value = value;
        b.source = teller;
        out.push_back(make_event(tick, listener, fact, s, b, MemoryCause::told, turn_id));
    }
    return conflicts;
}

void memory_mark_told(Memory& memory, FactId fact, NeighborId listener) {
    Belief* belief = memory.find(fact);
    if (!belief) return;
    auto& to = belief->told_to;
    const auto it = std::lower_bound(to.begin(), to.end(), listener);
    if (it == to.end() || *it != listener) to.insert(it, listener);
}

}  // namespace rumor
