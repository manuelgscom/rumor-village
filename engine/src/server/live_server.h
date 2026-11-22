#pragma once
// The live server (phase 3): the engine serves a running village over HTTP on
// 127.0.0.1, with the HTTP library that llama.cpp vendors (cpp-httplib).
//
//  simulation thread                          HTTP threads
//  ┌────────────────────────────┐             ┌──────────────────────────────┐
//  │ for tick:                  │   orders    │ POST /control /viewport      │
//  │   before_tick(t) ◄─────────┼─────────────┤      /inject  /extract       │
//  │     (pacing, pause, the    │ (mutex, cv) │                              │
//  │      /extract tasks)       │             │ GET /events (SSE)            │
//  │   line -> file + publish ──┼─────────────► GET /control                 │
//  └────────────────────────────┘             │ GET /...  static viewer/     │
//                                             └──────────────────────────────┘
//
// The server owns the port and one run (server/live_run.h), which holds what
// the routes see and change. Orders cross to the simulation only in
// before_tick, on its own thread: nothing here touches the simulation, the
// policy or the extractor from an HTTP thread. The routes are described in
// docs/fases/fase-3.md; bodies are read as JSON whatever their Content-Type
// (curl -d sends a form type). GET /control also says `run`: an id drawn when
// the server is made, so that a viewer that reconnects can tell another run
// behind the same port (the SSE ids are line numbers and go on from
// Last-Event-ID whatever the run).

#include <memory>
#include <mutex>
#include <ostream>
#include <string>
#include <thread>

#include "core/live_api.h"
#include "core/population_api.h"
#include "core/sim_api.h"
#include "core/time.h"
#include "extract/extract.h"
#include "server/live_run.h"

namespace httplib {
class Server;
}  // namespace httplib

namespace rumor {

class LiveServer : public RunControl {
  public:
    // `vocab` and `population` are those of the run and must outlive the
    // server. `extractor` may be null: POST /extract answers 501. It is only
    // ever called on the simulation thread (a Batch is not thread safe).
    LiveServer(const LiveOptions& options, const Vocab& vocab, const Population& population,
               Extractor* extractor);
    ~LiveServer() override;  // stop()
    LiveServer(const LiveServer&) = delete;
    LiveServer& operator=(const LiveServer&) = delete;

    // Binds and serves in the background. Returns the port. Throws
    // std::runtime_error when the address cannot be bound or viewer_dir is not
    // a folder.
    int start();

    // Simulation thread: one header or event line, without the final '\n'.
    // It becomes event n of /events, n being its line number in the file.
    void publish(std::string line) { run_.publish(std::move(line)); }

    // Simulation thread, before tick t: waits for the pace and while paused,
    // runs the queued /extract tasks meanwhile, and hands over what arrived.
    TickOrders before_tick(Tick t) override { return run_.before_tick(t); }
    void after_tick(Tick t, bool quiet) override { run_.after_tick(t, quiet); }

    // The run ended: /inject and /extract answer 409; streams stay open and
    // the server keeps serving what it has.
    void finish() { run_.finish(); }

    // Thread safe and idempotent: before_tick answers stop, streams close and
    // the listener ends. Not from a signal handler.
    void stop();

    LiveRun& run() { return run_; }

  private:
    const LiveOptions options_;
    LiveRun run_;
    std::unique_ptr<httplib::Server> http_;
    std::thread listener_;
    std::once_flag stop_once_;
};

// A sink that writes each line once: to `file` (if given, flushed per line,
// so the file is never behind the stream) and to the server.
inline RunSink publishing_sink(LiveServer& server, std::ostream* file) {
    return publishing_sink(server.run(), file);
}

}  // namespace rumor
