#pragma once
// The hook of a live run: what reaches a running simulation from outside (the
// live server, src/server) and when. The tick loop asks once per tick, on its
// own thread, so the simulation never shares state with another thread: the
// server keeps its own queue and hands it over here. Without a control the run
// is the same, byte for byte, as a recorded one.

#include <optional>
#include <vector>

#include "core/ids.h"
#include "core/scenario.h"
#include "core/time.h"

namespace rumor {

// A fact that enters a running village. It is applied with the same code as
// the injections of the scenario: `inject` event, memory changes and, in the
// village, a plan for each receiver.
struct LiveInjection {
    Injection fact;                // fact.tick is ignored: it enters at the tick it is applied
    std::optional<PlaceId> place;  // when set: whoever is at this place (fact.to is ignored)
};

// What the outside wants before one tick.
struct TickOrders {
    bool stop = false;  // end the run now
    // In order of arrival, applied after those of the scenario. One by place
    // goes to the neighbors at that place and not on a trip, in identifier
    // order; while nobody is there it waits inside the simulation and is tried
    // again every tick. One by neighbors with an empty `to` is dropped.
    std::vector<LiveInjection> injections;
    std::optional<std::vector<NeighborId>> visible;  // neighbors on screen, when it changed
};

// Called by the tick loop, on the simulation thread, before each tick. May
// block (pacing, pause).
class RunControl {
  public:
    virtual ~RunControl() = default;
    virtual TickOrders before_tick(Tick t) = 0;

    // Called by the tick loop after the events of tick t went to the sink
    // (phase 9, the pace of a game). `quiet` is true when nothing worth
    // watching happened: no event of the tick carries a fact, no open
    // conversation has a neighbor who knows a fact, and no injection by place
    // is waiting for somebody to arrive. A live server may then let the next
    // tick through sooner. Only pacing: it never changes the run.
    virtual void after_tick(Tick /*t*/, bool /*quiet*/) {}
};

}  // namespace rumor
