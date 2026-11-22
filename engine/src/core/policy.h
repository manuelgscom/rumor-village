#pragma once
// Who decides. The baseline (rules, no model) and, from phase 2, the model
// implement the same interface, so the simulation does not know which one it
// is talking to.

#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

#include "core/action.h"
#include "core/decision.h"
#include "core/ids.h"
#include "core/verdict.h"

namespace rumor {

// The answer to one request.
struct Decision {
    Action action;
    // Set by a policy that could not produce an action at all (malformed or
    // truncated model output). Validation then rejects with this reason.
    RejectReason reject = RejectReason::none;
    // Only a model fills it; the baseline leaves it empty.
    std::optional<Generation> gen;
};

// One performance sample of the model runtime: one batch of sequences
// generated together. The simulation logs it as a `perf` event, so it holds
// integers only.
struct PerfSample {
    int batch = 0;                  // sequences generated together
    int tokens_per_s = 0;           // output tokens of the batch per second
    int decisions_per_s_milli = 0;  // decisions per second, times 1000
    int vram_mb = 0;                // GPU memory of the process

    friend bool operator==(const PerfSample&, const PerfSample&) = default;
};

class Policy {
  public:
    virtual ~Policy() = default;

    // Goes to the log header: "baseline", "model".
    virtual std::string name() const = 0;

    // Goes to the log header: the file name of the model. Empty without one.
    virtual std::optional<std::string> model() const { return std::nullopt; }

    // One decision per request, in the same order. A policy keeps no state
    // between calls: the answer to a request depends only on the request, so it
    // is the same whatever else is in the batch and in whatever order.
    virtual std::vector<Decision> decide(std::span<const DecisionRequest> batch) = 0;

    // The performance samples since the last call. The simulation asks after
    // the decisions of each tick and logs them; the baseline has none, so its
    // log stays identical byte for byte.
    virtual std::vector<PerfSample> take_perf() { return {}; }

    // The neighbors on screen in a live run, whenever the camera changes; the
    // simulation calls it between ticks, on its own thread. It may only decide
    // whether a bubble is written, never the action (TextMode::camera). The
    // baseline writes no text, so it ignores it.
    virtual void set_visible(std::span<const NeighborId>) {}
};

// The baseline without a model. Implemented in src/policy.
std::unique_ptr<Policy> make_baseline_policy();

}  // namespace rumor
