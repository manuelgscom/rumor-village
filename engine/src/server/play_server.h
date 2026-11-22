#pragma once
// The game server of `rumor play` (phase 9, docs/arquitectura.md "Modo
// juego"): one process, one port, the model loaded once, and a run at a time.
//
//  PlayServer (port, routes, origin check, model)
//    ├─ draft (settings, rumors, challenge, bets, race) ◄── POST /preview, GET /state
//    └─ current session: a village and its LiveRun (SSE lines, pause, pace, run id)
//         waiting: only the header of the village of the draft; no tick
//         playing: the simulation thread ─► <id>.jsonl + SSE; rumors enter at their tick
//         ended:   the finished log, still served
//
//   waiting ──POST /start──► playing ──end or POST /stop──► ended
//      ▲                                                     │
//      └──────────────── POST /reset (any state) ────────────┘
//
// A new session (start, reset, another village in /preview) gets a new run
// id, and the streams of the old one end, so the viewer reloads. The routes
// and their answers are the table of docs/arquitectura.md, "Formatos". Every
// route, the static viewer included, answers 403 unless Host is
// 127.0.0.1:<port> or localhost:<port> and Origin, when present, is
// http:// plus one of those.
//
// Only the launcher of phase 10 sets PlayOptions::download (the model comes
// inside the game): then GET /state has ai.download, POST /ai/download starts
// it again and POST /ai/activate ends the server so that the launcher serves
// again with the model (activate_requested()). Without it those routes are 404.

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

#include "core/game_api.h"
#include "core/run_modes.h"
#include "core/world_api.h"
#include "llm/batch.h"
#include "server/live_run.h"

namespace httplib {
class Server;
struct Request;
struct Response;
}  // namespace httplib

namespace rumor {

// The download of the model inside the game, from the launcher
// (launcher/download.h, ModelDownload), so that this server does not depend on
// it. All three set, or none.
struct PlayDownload {
    // The "download" object of GET /state ai.download.
    std::function<nlohmann::json()> status;
    // POST /ai/download and POST /ai/activate: nullopt when done, else why
    // not (409).
    std::function<std::optional<std::string>()> start;
    std::function<std::optional<std::string>()> activate;

    explicit operator bool() const { return status && start && activate; }
};

struct PlayOptions {
    // bind, port, viewer_dir, speed and quiet_speed of every run (the rest of
    // LiveOptions is not used).
    LiveOptions live;
    std::string data_dir = "data";
    std::string out_dir = "runs/play";
    // The model, loaded once by the caller; null: only "rules" games.
    llm::Batch* batch = nullptr;
    TextMode text = TextMode::camera;
    PromptMode prompt = PromptMode::full;
    // Why there is no model, as /state says it (ai.reason): the launcher of
    // phase 10 sets the cause it found ("no_gpu", "no_nvidia", ...).
    std::string no_ai_reason = "no_model";
    // The download of the model inside the game (launcher only); empty: none.
    PlayDownload download;
};

// Thresholds of the hardware check (recalibrated in phase 10). At x1 the pace
// of the game hides the model: a tick lasts 0.5 s and the decisions of a tick
// take less on a card that measures enough. What the model adds was replayed
// tick by tick from the recorded phase 9 games (docs/fases/capturas/fase-10/
// ritmo.py, which reproduces their measured 376 s and 139 s):
//   check 8 -> a 100-neighbor game +23 %, a 25-neighbor one +10 %
//   check 3 -> a 100-neighbor game +175 %, a 25-neighbor one +93 %
// Below kAdviceNeighbors25Dps the model makes a 100-neighbor game over a
// quarter longer: the advice is "neighbors25" (it never blocks). Below
// kAdviceRulesDps a 25-neighbor game takes about twice as long: the advice is
// "rules". (Phase 9 had 13 for the first one, taking the length of a
// 100-neighbor game, which is the pace's, for the GPU's.)
inline constexpr double kAdviceRulesDps = 3.0;
inline constexpr double kAdviceNeighbors25Dps = 8.0;
inline constexpr int kCheckSeconds = 8;                 // the check lasts about this...
inline constexpr int kCheckDecisions = 64;              // ...or this many decisions
// Before measuring, a warm-up that is not counted (a backend's one-time setup,
// such as the shaders of Vulkan): up to this many decisions or seconds.
inline constexpr int kCheckWarmupDecisions = 16;
inline constexpr int kCheckWarmupSeconds = 60;

class PlayServer {
  public:
    // Loads the world and both vocabularies, makes the out folder and the
    // waiting village of the default settings. Throws std::runtime_error.
    explicit PlayServer(const PlayOptions& options);
    ~PlayServer();  // shutdown()
    PlayServer(const PlayServer&) = delete;
    PlayServer& operator=(const PlayServer&) = delete;

    // Binds and serves in the background. Returns the port. Throws
    // std::runtime_error.
    int listen();

    // With a model, the hardware check runs in the background (GET /state
    // "check"); without one it is "skipped".
    void start_check();

    // POST /start without HTTP (`--once`): {status, body} as the route answers.
    struct Answer {
        int status = 200;
        nlohmann::json body;
    };
    Answer start(const nlohmann::json& draft);

    // Blocks until the game of the current session (if any) has ended.
    void wait_game();

    // Blocks until POST /quit or request_quit().
    void wait_quit();
    void request_quit();

    // True once POST /ai/activate was accepted: the quit is to serve again
    // with the model.
    bool activate_requested() const;

    // Ends a running game with its end event, stops the check and the
    // listener. Idempotent.
    void shutdown();

    // The state as GET /state answers it.
    nlohmann::json state_json() const;

    struct Session;

  private:
    enum class State { waiting, playing, ended };

    std::shared_ptr<Session> current() const;
    std::shared_ptr<Session> make_waiting(const GameSettings& settings) const;
    const Vocab& vocab(Lang lang) const;
    // Makes `next` the current session (state `state`) and closes the old one.
    void swap_in(std::shared_ptr<Session> next, State state);
    // With ops_mutex_ held: stops a running game and joins its thread.
    void end_game_locked();
    void run_game(const std::shared_ptr<Session>& session);
    void run_check();

    // Routes.
    void routes();
    bool allowed(const httplib::Request& req) const;
    void post_preview(const httplib::Request& req, httplib::Response& res);
    void post_start(const httplib::Request& req, httplib::Response& res);
    void post_stop(httplib::Response& res);
    void post_reset(const httplib::Request& req, httplib::Response& res);
    void post_extract(const httplib::Request& req, httplib::Response& res);
    void get_card(const httplib::Request& req, httplib::Response& res) const;
    void get_game_file(const httplib::Request& req, httplib::Response& res,
                       const std::string& suffix, const std::string& type) const;
    void get_profile(httplib::Response& res) const;
    void get_timetable(httplib::Response& res) const;
    void post_profile(const httplib::Request& req, httplib::Response& res);
    void get_control(httplib::Response& res) const;
    void post_ai_download(httplib::Response& res);
    void post_ai_activate(httplib::Response& res);

    const PlayOptions options_;
    const World world_;
    const Vocab vocab_es_;
    const Vocab vocab_en_;

    std::unique_ptr<httplib::Server> http_;
    std::thread listener_;
    std::atomic<int> port_{0};

    // Serializes what changes the session: start, stop, reset, preview,
    // shutdown. Never taken by the game thread.
    std::mutex ops_mutex_;
    std::thread game_thread_;
    bool shut_ = false;

    // The model: the hardware check, a game Con IA and /extract.
    mutable std::mutex model_mutex_;
    std::thread check_thread_;
    std::atomic<bool> quitting_{false};

    std::mutex profile_mutex_;  // POST /profile, one at a time

    // What the routes read.
    mutable std::mutex mutex_;
    std::condition_variable quit_cv_;
    bool quit_ = false;
    bool activate_ = false;  // POST /ai/activate accepted
    State state_ = State::waiting;
    std::shared_ptr<Session> current_;
    nlohmann::json draft_;
    std::string check_state_;  // "running", "done", "skipped"
    std::optional<double> check_dps_;
    std::optional<std::string> check_advice_;
    std::optional<std::string> ai_reason_;  // why "ai" is not available
};

}  // namespace rumor
