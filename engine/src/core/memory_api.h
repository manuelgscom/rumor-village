#pragma once
// Memory rules (contract, section 2): injection, forgetting and what a
// listener does with what it is told. Implemented in src/memory.
//
// Every function appends one MemoryEvent per slot that changes, already with
// its cause, so the simulation only has to write them.

#include <cstdint>
#include <string_view>
#include <vector>

#include "core/action.h"
#include "core/event.h"
#include "core/fact.h"
#include "core/ids.h"
#include "core/time.h"

namespace rumor {

// A neighbor receives a fact first hand. Adds it to the memory with every slot
// the fact has as `sure`, without source; told_by is none. One event per slot
// with value, cause `inject`, turn 0. If the neighbor already knew the fact,
// the given slots are overwritten the same way.
void memory_inject(Memory& memory, NeighborId who, const Fact& fact, Tick tick,
                   std::vector<MemoryEvent>& out);

// One tick of forgetting for one neighbor. Facts in order and, in each, slots
// in order, with a single generator seeded with
// derive_seed(run_seed, tick, who, Stream::forget):
//   - a slot that is sure or doubt becomes forgotten with forget_ppm (its value
//     and source are erased): cause `forgot`;
//   - otherwise, a slot that is doubt becomes sure with doubt_drop_ppm (value
//     and source stay): cause `doubt_dropped`.
// With 0 nothing changes; with 1'000'000 everything is forgotten.
void memory_forget(Memory& memory, NeighborId who, std::uint32_t forget_ppm,
                   std::uint32_t doubt_drop_ppm, std::uint64_t run_seed, Tick tick,
                   std::vector<MemoryEvent>& out);

// The listener rule. `delivered` is the claim after validation: the slots that
// failed are already gone. For each slot with value:
//
//   listener had           told                   result
//   unknown or forgotten   value, not a guess     sure, source = teller
//   unknown or forgotten   value, a guess         doubt, source = teller
//   doubt                  value, not a guess     sure with the new value, source = teller
//   doubt                  value, a guess         no change
//   sure                   the same value         no change
//   sure                   another value          no change: a conflict
//
// If the listener did not know the fact, it is added first (told_by = teller,
// heard_at = tick), even when the claim has no value at all. Events have cause
// `told` and the given turn id. Returns the slots in conflict, in slot order.
std::vector<Slot> memory_hear(Memory& memory, NeighborId listener, NeighborId teller, FactId fact,
                              std::string_view what, const Claim& delivered, Tick tick,
                              int turn_id, std::vector<MemoryEvent>& out);

// Notes in the teller's memory that it has told `fact` to `listener` (told_to
// stays ascending and without repeats). Does nothing if the teller does not
// know the fact.
void memory_mark_told(Memory& memory, FactId fact, NeighborId listener);

}  // namespace rumor
