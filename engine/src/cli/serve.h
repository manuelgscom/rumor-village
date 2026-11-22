#pragma once
// `rumor run --serve`: a run served live (server/live_server.h) while it is
// written to its file, and the loading it shares with `rumor run` (cli.cpp).
//
//  main thread              simulation           stop thread
//  ─────────────────────    ──────────────────   ─────────────────────────
//  block_stop_signals()
//  load, start server ───►  run_simulation       waits for SIGINT/SIGTERM
//                           (line -> file + SSE)   or a stop asked by code
//                           finish()                 │
//  join ◄─────────────────────────────────────────── server.stop()
//
// A stop during the run ends it at the next tick with its `end` event, so the
// log is always whole. After the run the server keeps serving until the stop.

#include <functional>
#include <memory>
#include <ostream>

#include "card/render.h"
#include "cli/stop_signal.h"  // block_stop_signals()
#include "core/policy.h"
#include "core/sim_api.h"

namespace rumor {

struct LiveOptions;

// Everything a run needs, loaded once (implemented in cli.cpp). The policy and
// the renderer point into the other members: it is neither copied nor moved.
// Throws std::runtime_error, as run_to_stream.
struct LoadedRun {
    LoadedRun(const RunOptions& options, llm::Batch* batch, std::ostream* trace);
    LoadedRun(const LoadedRun&) = delete;
    LoadedRun& operator=(const LoadedRun&) = delete;

    const bool with_model;
    const ScenarioParams params;
    const World world;
    const Population population;
    const Vocab vocab;
    std::unique_ptr<Renderer> renderer;  // only with the model policy
    std::unique_ptr<Policy> policy;
};

// Called on the simulation thread once the server listens, with its port and
// a thread-safe way to ask for the same stop as SIGINT or SIGTERM.
using OnListen = std::function<void(int port, std::function<void()> stop)>;

// As run_to_stream, served live with `live`: says on stderr where, runs with
// every line written to `out` (flushed one by one) and published, then serves
// until the stop. With a model, POST /extract uses `batch`; without, it
// answers 501. Throws std::runtime_error.
void serve_to_stream(const RunOptions& options, const LiveOptions& live, std::ostream& out,
                     llm::Batch* batch = nullptr, std::ostream* trace = nullptr,
                     const OnListen& on_listen = {});

}  // namespace rumor
