#pragma once
// The simulation loop and the command line. Implemented in src/sim and
// src/cli.

#include <cstdint>
#include <functional>
#include <ostream>
#include <string>

#include "core/catalog.h"
#include "core/event.h"
#include "core/live_api.h"
#include "core/policy.h"
#include "core/population_api.h"
#include "core/run_modes.h"
#include "core/scenario.h"
#include "core/world_api.h"

namespace rumor {

namespace llm {
class Batch;
}

// Where a run sends its log: the header once, then every event in order. Live
// and recording are this same stream.
struct RunSink {
    std::function<void(const LogHeader&)> header;
    std::function<void(const Event&)> event;
};

// Reads data_dir/scenarios/<name>.json. Throws std::runtime_error.
ScenarioParams load_scenario(const std::string& data_dir, const std::string& name, Lang lang);

// Runs a scenario from start_tick to end_tick with the seven steps of the tick
// loop. Deterministic: same arguments and same policy answers, same events.
// `control`, if given, is asked before every tick (core/live_api.h): it can
// stop the run, inject facts and tell the policy who is on screen. Without it
// the run depends on nothing else.
void run_simulation(const ScenarioParams& params, const World& world, const Population& population,
                    const Vocab& vocab, Policy& policy, std::uint64_t seed, const RunSink& sink,
                    RunControl* control = nullptr);

struct RunOptions {
    std::string data_dir = "data";
    std::string scenario;
    Lang lang = Lang::es;
    std::uint64_t seed = 0;
    std::string policy = "baseline";  // "baseline" or "model"
    // Only with the model policy.
    TextMode text = TextMode::all;
    PromptMode prompt = PromptMode::full;
};

// `rumor run` without the file: loads world, population, vocabulary and
// scenario, runs, and writes the JSONL (one line per header and event, each
// ended by '\n') to `out`. The model policy decides with `batch`, which the
// caller loads once and may reuse for several runs; `trace`, if given, gets
// the card and the raw answer of every decision (policy/model.h). Throws
// std::runtime_error.
void run_to_stream(const RunOptions& options, std::ostream& out, llm::Batch* batch = nullptr,
                   std::ostream* trace = nullptr);

// The `rumor` command. Returns the exit code.
int cli_main(int argc, char** argv);

}  // namespace rumor
