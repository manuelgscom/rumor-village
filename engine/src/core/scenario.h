#pragma once
// Parameters of a scenario (data/scenarios/<name>.json). Probabilities are
// integers in parts per million; times are ticks.

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "core/catalog.h"
#include "core/enum_keys.h"
#include "core/fact.h"
#include "core/ids.h"
#include "core/time.h"

namespace rumor {

enum class Layout : std::uint8_t {
    village,  // neighbors follow their timetable and meet where they coincide
    // Telephone game: neighbor i only ever talks to neighbor i + 1. Nobody
    // moves, there are no plan decisions, and the run ends when the chain
    // reaches the last neighbor or is cut.
    line,
};
RUMOR_ENUM_KEYS(Layout, "village", "line");

// A fact that enters the village.
struct Injection {
    Tick tick = 0;
    std::string what;                         // a key of kWhatKeys, or free text
    std::optional<std::string> text;          // the original sentence, when a user wrote one
    PerSlot<std::optional<SlotValue>> slots;  // the original version
    std::vector<NeighborId> to;               // who receives it
};

struct ScenarioParams {
    std::string name;  // "party-100"
    Lang lang = Lang::es;
    int neighbors = 0;
    Layout layout = Layout::village;

    Tick start_tick = 0;    // first tick of the run
    Tick end_tick = 0;      // the run stops before this tick
    int start_weekday = 0;  // of day 0; 0 = Monday

    std::vector<Injection> injections;

    // Forgetting, per slot and per tick (contract, section 2).
    std::uint32_t forget_ppm = 0;      // sure or doubt -> forgotten
    std::uint32_t doubt_drop_ppm = 0;  // doubt -> sure

    int max_turns = 0;  // a conversation ends when it reaches this many turns

    // Village layout.
    std::uint32_t meet_ppm = 0;  // chance per tick that a free pair at the same public place starts talking
    Tick pair_cooldown = 0;      // ticks before the same two neighbors talk again
    Tick rest_ticks = 0;         // ticks a neighbor waits after a conversation before the next one
    Tick stay_ticks = 0;         // ticks a neighbor stays at the place of a plan

    // Line layout.
    Tick hop_gap = 0;     // ticks between the forced encounters of the line
    int hop_retries = 0;  // extra encounters of a pair while the fact has not passed

    // Character of the village (phase 9, contract section 7): leans the trait
    // draw of the generated neighbors, -2 very discreet .. +2 very gossipy.
    // 0 is the uniform draw of before; header.params only carries it when it
    // is not 0, so the logs of 0 stay identical byte for byte.
    int trait_mix = 0;
};

}  // namespace rumor
