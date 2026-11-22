#pragma once
// One run served live: what a viewer sees of it and what it may change. The
// HTTP server that owns the port (LiveServer for `rumor run --serve`,
// PlayServer for `rumor play`) hands the requests of the run routes to the
// current LiveRun; a long-lived server swaps runs and closes the old one, so
// its streams end and the viewers reconnect to the new run.
//
//  simulation thread                    HTTP threads (through the server)
//  before_tick(t) ◄─ pace, pause, ──────  POST /control /viewport /inject
//                    orders, /extract     POST /extract (tasks run here)
//  publish(line) ─────────────────────►  GET /events (SSE), GET /control
//  after_tick(t, quiet): the next tick may come at quiet_speed
//
// Orders cross to the simulation only in before_tick, on its own thread.
// Every published line is kept in memory (a log weighs a few MB), so whoever
// connects late gets the whole run from line 1, byte for byte the same as the
// file.

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <memory>
#include <mutex>
#include <optional>
#include <ostream>
#include <string>
#include <vector>

#include "core/ids.h"
#include "core/live_api.h"
#include "core/population_api.h"
#include "core/sim_api.h"
#include "core/time.h"
#include "extract/extract.h"

namespace httplib {
struct Request;
struct Response;
}  // namespace httplib

namespace rumor {

struct LiveOptions {
    std::string bind = "127.0.0.1";  // only local by default
    int port = 0;                    // 0: any free port
    std::string viewer_dir;          // static files at "/"; empty: none
    int speed = 2;                   // ticks per second; 0: as fast as possible
    // Ticks per second after a quiet tick (RunControl::after_tick); 0: never
    // faster than `speed`. Only pacing: the log is the same.
    int quiet_speed = 0;
    bool paused = false;
    // How long POST /extract waits for the simulation thread before a 503.
    std::chrono::milliseconds extract_timeout{30000};
};

// Longest reading pause a viewer may ask for in one POST /control (hold_ms);
// the viewer's own cap is 4 s per tick (viewer/js/replay/constants.js).
inline constexpr int kMaxHoldMs = 10000;

class LiveRun : public RunControl {
  public:
    // `vocab` and `population` are those of the run and must outlive it.
    // `extractor` may be null: POST /extract answers 501. It is only ever
    // called on the simulation thread (a Batch is not thread safe). Only
    // speed, quiet_speed, paused and extract_timeout of `options` are used.
    LiveRun(const LiveOptions& options, const Vocab& vocab, const Population& population,
            Extractor* extractor);
    ~LiveRun() override;  // close()
    LiveRun(const LiveRun&) = delete;
    LiveRun& operator=(const LiveRun&) = delete;

    // GET /control "run": drawn when the run is made.
    const std::string& id() const { return id_; }

    // Simulation thread: one header or event line, without the final '\n'.
    // It becomes event n of /events, n being its line number in the file.
    void publish(std::string line);

    // Simulation thread, before tick t: waits for the pace and while paused,
    // runs the queued /extract tasks meanwhile, and hands over what arrived.
    TickOrders before_tick(Tick t) override;

    // Simulation thread, after tick t: whether the next tick may go at
    // quiet_speed.
    void after_tick(Tick t, bool quiet) override;

    // A reading pause: the next tick is not let through before `ms` from now
    // (POST /control {"hold_ms": N}, sent by the viewer while a bubble on
    // screen is read). Thread safe. Only pacing.
    void hold(int ms);

    // The run ended: /inject and /extract answer 409; streams stay open.
    void finish();

    // Thread safe: the next before_tick answers stop (the run ends with its
    // end event); streams stay open.
    void request_stop();

    // Thread safe and idempotent: request_stop(), and the streams of
    // /events end (a viewer reconnects and finds the next run).
    void close();

    // A copy of the published lines.
    std::vector<std::string> lines() const;

    // The routes of a run. GET /control also says `run`. The stream of
    // /events holds `keep` (the owner of the run) until it ends.
    void get_events(const httplib::Request& req, httplib::Response& res,
                    std::shared_ptr<const void> keep = {});
    void get_control(httplib::Response& res) const;
    void post_control(const httplib::Request& req, httplib::Response& res);
    void post_viewport(const httplib::Request& req, httplib::Response& res);
    void post_inject(const httplib::Request& req, httplib::Response& res);
    void post_extract(const httplib::Request& req, httplib::Response& res);

    // The state of GET /control: paused, speed, tick, ended, extract, run.
    std::string control_json() const;

  private:
    using Clock = std::chrono::steady_clock;

    // A fact accepted by /inject, waiting for the next tick: `when` is still
    // relative, it becomes a slot with the tick at which it enters.
    struct Order {
        Extracted fact;
        std::optional<std::string> text;
        std::optional<PlaceId> place;
        std::vector<NeighborId> to;
    };

    struct ExtractTask {
        std::string text;
        Extracted result;
        bool done = false;
        bool failed = false;  // the extractor threw
    };

    std::string control_json_locked() const;  // with mutex_ held

    // With the lock held; releases it while each extraction runs.
    void run_tasks(std::unique_lock<std::mutex>& lock);

    const Vocab& vocab_;
    const Population& population_;
    Extractor* extractor_;
    const std::string id_;
    const std::chrono::milliseconds extract_timeout_;

    mutable std::mutex mutex_;
    std::condition_variable wake_sim_;   // control changed, a task, stop
    std::condition_variable new_lines_;  // publish, finish, close
    std::condition_variable task_done_;  // an extraction finished, finish, stop
    std::vector<std::string> lines_;
    bool paused_;
    int speed_;        // 0: max
    int quiet_speed_;  // 0: off
    bool quiet_ = false;  // the last tick was quiet
    std::optional<Tick> tick_;  // the last one asked for
    bool ended_ = false;
    bool stopping_ = false;  // before_tick answers stop
    bool closed_ = false;    // streams end
    Clock::time_point released_ = Clock::time_point::min();  // the last tick let through
    Clock::time_point hold_until_ = Clock::time_point::min();  // reading pause (POST /control hold_ms)
    std::vector<Order> orders_;
    std::vector<NeighborId> visible_;
    bool visible_changed_ = false;
    std::deque<std::shared_ptr<ExtractTask>> tasks_;
};

// A sink that writes each line once: to `file` (if given, flushed per line,
// so the file is never behind the stream) and to the run.
RunSink publishing_sink(LiveRun& run, std::ostream* file);

}  // namespace rumor
