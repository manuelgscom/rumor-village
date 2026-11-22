#pragma once
// The event log (contract, section 6): one header and one event per line, in
// tick order. These structures are the log format 1; src/log writes and reads
// them and nothing else decides a key name.
//
// The key order of each line is the order of the fields below, after "type"
// (and "tick" in events). Identifiers are written as text ("n017"), slot values
// by their slot (who "n017", where "p03", when and amount as integers), enums
// by their key, and an absent value as null. Only integers, strings and null.

#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include "core/action.h"
#include "core/catalog.h"
#include "core/enum_keys.h"
#include "core/fact.h"
#include "core/ids.h"
#include "core/population_api.h"
#include "core/time.h"
#include "core/verdict.h"
#include "core/world_api.h"

namespace rumor {

inline constexpr int kLogFormat = 1;

// --- Header: {"type":"header", ...} ---------------------------------------------

// {"id","key","name","kind","x","y"}. `name` is in the language of the run.
struct HeaderPlace {
    PlaceId id;
    std::string key;
    std::string name;
    PlaceKind kind = PlaceKind::public_place;
    int x = 0;
    int y = 0;

    friend bool operator==(const HeaderPlace&, const HeaderPlace&) = default;
};

struct LogHeader {
    int format = kLogFormat;
    std::uint64_t seed = 0;
    std::string scenario;
    Lang lang = Lang::es;
    std::string policy;                // "baseline"
    std::optional<std::string> model;  // null with the baseline
    // "params": the numbers of the scenario, as an object in this order.
    std::vector<std::pair<std::string, std::int64_t>> params;
    int tick_seconds = kTickSeconds;
    Tick start_tick = 0;
    int start_weekday = 0;
    std::vector<HeaderPlace> places;
    // "routes": {"from","to","ticks","path":[[x,y],...]}, one per pair with from < to.
    std::vector<Route> routes;
    // "neighbors": {"id","name","gender" ("f" or "m"),"job","trait","home"}.
    std::vector<Neighbor> neighbors;
    // "relations": {"a","b","type"}.
    std::vector<RelationEdge> relations;

    friend bool operator==(const LogHeader&, const LogHeader&) = default;
};

// --- Events: {"type":"<name>","tick":N, ...} --------------------------------------

// "move": a neighbor leaves towards a place. The route is the one of the header
// between `from` and `to`. `fact` is null when the timetable moves the
// neighbor, and the fact of the plan otherwise.
struct MoveEvent {
    Tick tick = 0;
    NeighborId who;
    PlaceId from;
    PlaceId to;
    Tick arrive = 0;
    FactId fact;

    friend bool operator==(const MoveEvent&, const MoveEvent&) = default;
};

// "inject": a new fact enters. `text` is the original sentence, if any.
// {"fact","text","what","slots":{"who","where","when","amount"},"to":[...]}
struct InjectEvent {
    Tick tick = 0;
    FactId fact;
    std::optional<std::string> text;
    std::string what;
    PerSlot<std::optional<SlotValue>> slots;
    std::vector<NeighborId> to;

    friend bool operator==(const InjectEvent&, const InjectEvent&) = default;
};

// "conv_start": two neighbors start talking.
struct ConvStartEvent {
    Tick tick = 0;
    ConvId conv;
    NeighborId a;  // speaks first
    NeighborId b;
    PlaceId place;

    friend bool operator==(const ConvStartEvent&, const ConvStartEvent&) = default;
};

// "turn": one decision of kind turn.
// {"id","conv","n","who","to","card","action","act","fact","claim","reject",
//  "verdict","conflicts","text","gen"}
//   claim     {"who","where","when","amount","guess":[slots]} as proposed, or null
//   reject    null or the reason; when rejected, action is "none" and act, fact,
//             claim and verdict are null
//   verdict   {"who","where","when","amount"} or null when there is no claim
//   conflicts slots in which the listener kept its own sure value
//   gen       null, or {"t0","t1","in","out"}: milliseconds and tokens
struct TurnEvent {
    Tick tick = 0;
    int id = 0;  // of the decision: turns and plans share one count, from 1
    ConvId conv;
    int n = 0;  // number of the turn in its conversation, from 1
    NeighborId who;
    NeighborId to;
    std::string card;  // fingerprint of the decision request
    ActionType action = ActionType::none;
    std::optional<Act> act;
    FactId fact;  // identifier, not the number in the card
    std::optional<Claim> claim;
    Verdict verdict;
    std::vector<Slot> conflicts;
    std::optional<std::string> text;
    std::optional<Generation> gen;

    friend bool operator==(const TurnEvent&, const TurnEvent&) = default;
};

enum class ConvEndReason : std::uint8_t { none, bye, max_turns };
RUMOR_ENUM_KEYS(ConvEndReason, "none", "bye", "max_turns");

// "conv_end"
struct ConvEndEvent {
    Tick tick = 0;
    ConvId conv;
    ConvEndReason reason = ConvEndReason::none;

    friend bool operator==(const ConvEndEvent&, const ConvEndEvent&) = default;
};

enum class MemoryCause : std::uint8_t { told, forgot, doubt_dropped, inject };
RUMOR_ENUM_KEYS(MemoryCause, "told", "forgot", "doubt_dropped", "inject");

// "memory": one slot of one neighbor's memory changes. `value` is null when
// the new state has none. `turn` is the id of the turn that caused it, null
// (0 here) when no turn did.
struct MemoryEvent {
    Tick tick = 0;
    NeighborId who;
    FactId fact;
    Slot slot = Slot::who;
    SlotState state = SlotState::unknown;
    std::optional<SlotValue> value;
    MemoryCause cause = MemoryCause::told;
    int turn = 0;

    friend bool operator==(const MemoryEvent&, const MemoryEvent&) = default;
};

// "plan": one decision of kind plan.
// {"id","who","card","action","fact","claim","reject","verdict","gen"}, as in "turn".
// `fact` is the fact the plan is about, also when the neighbor decides not to
// go (action "none"); it is null only when the decision was rejected. The last
// plan of a neighbor about a fact rules: it replaces a visit that has not left.
struct PlanEvent {
    Tick tick = 0;
    int id = 0;
    NeighborId who;
    std::string card;
    ActionType action = ActionType::none;
    FactId fact;
    std::optional<Claim> claim;
    Verdict verdict;
    std::optional<Generation> gen;

    friend bool operator==(const PlanEvent&, const PlanEvent&) = default;
};

// "arrive": a neighbor arrives at the place of a plan. `slot` is the `when` of
// that plan: with `place` it tells whether the neighbor went to the right place
// at the right time.
struct ArriveEvent {
    Tick tick = 0;
    NeighborId who;
    PlaceId place;
    FactId fact;
    TimeSlot slot = 0;

    friend bool operator==(const ArriveEvent&, const ArriveEvent&) = default;
};

// "perf": a performance sample. Only a model produces it; the baseline never
// does, so its log stays identical byte for byte.
// {"batch","tokens_per_s","decisions_per_s_milli","vram_mb"}
struct PerfEvent {
    Tick tick = 0;
    int batch = 0;
    int tokens_per_s = 0;
    int decisions_per_s_milli = 0;  // decisions per second, times 1000
    int vram_mb = 0;

    friend bool operator==(const PerfEvent&, const PerfEvent&) = default;
};

// "end": the run is over. The last line of a complete log.
// {"decisions","turns","plans","rejected","conversations","informed"}
struct EndEvent {
    Tick tick = 0;
    int decisions = 0;      // turns + plans
    int turns = 0;
    int plans = 0;
    int rejected = 0;       // decisions replaced by none
    int conversations = 0;
    int informed = 0;       // neighbors who know at least one fact

    friend bool operator==(const EndEvent&, const EndEvent&) = default;
};

using Event = std::variant<MoveEvent, InjectEvent, ConvStartEvent, TurnEvent, ConvEndEvent,
                           MemoryEvent, PlanEvent, ArriveEvent, PerfEvent, EndEvent>;

inline Tick event_tick(const Event& event) {
    return std::visit([](const auto& e) { return e.tick; }, event);
}

// A neighbor knows a fact from the moment an `inject` names it in `to`, or a
// `turn` with act tell that was not rejected is addressed to it. The metrics
// and the viewer use this definition.

}  // namespace rumor
