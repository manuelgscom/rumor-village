// `rumor play` (phase 9): the game server (server/play_server.h), or with
// --once one game of a draft at full speed and without HTTP.
//
//  main thread               HTTP threads             stop thread
//  ─────────────────────     ─────────────────────    ──────────────────────
//  block_stop_signals()
//  load the model (once)
//  PlayServer, listen ──►    routes, games            waits for SIGINT/SIGTERM
//  wait_quit() ◄──────────── POST /quit ◄──────────── or asks the same quit
//  shutdown(): a game ends with its end event, the listener stops; exit 0
//  (or kPlayActivate after POST /ai/activate: the launcher serves again)

#include <atomic>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>

#include <nlohmann/json.hpp>

#include "cli/play.h"
#include "cli/serve.h"
#include "cli/stop_signal.h"
#include "cli/usage.h"
#include "core/enum_keys.h"
#include "core/game_api.h"
#include "core/run_modes.h"
#include "llm/batch.h"
#include "server/play_server.h"

namespace rumor {
namespace {

constexpr const char* kPlayUsage =
    "usage: rumor play [--port N] [--bind ADDR] [--viewer DIR] [--data DIR] [--out DIR]\n"
    "                  [--speed N|max] [--quiet-speed N]\n"
    "                  [--model GGUF [--prompt full|card] [--batch N] [--device NAME]\n"
    "                   [--text all|none|camera]] [--once DRAFT.json]\n";

int speed_value(std::string_view flag, const std::string& value) {
    if (value == "max") return 0;
    const std::uint64_t speed = parse_uint(flag, value);
    if (speed < 1 || speed > 1000) throw UsageError("bad " + std::string(flag.substr(2)) + " '" + value + "'");
    return static_cast<int>(speed);
}

}  // namespace

int play_command(int argc, char** argv) {
    PlayOptions options;
    options.live.port = 8080;
    options.live.viewer_dir = "viewer";
    options.live.speed = 2;
    // Quiet stretches play a little faster than x4 (8): fast, but still watchable.
    options.live.quiet_speed = 10;
    llm::BatchOptions batch_options;
    std::string once;
    bool model_only = false;
    try {
        for (int i = 2; i < argc; i += 2) {
            const std::string_view flag = argv[i];
            if (i + 1 >= argc) throw UsageError("missing value for " + std::string(flag));
            const std::string value = argv[i + 1];
            if (flag == "--port") {
                const std::uint64_t port = parse_uint(flag, value);
                if (port > 65535) throw UsageError("bad port '" + value + "'");
                options.live.port = static_cast<int>(port);
            } else if (flag == "--bind") {
                options.live.bind = value;
            } else if (flag == "--viewer") {
                options.live.viewer_dir = value;
            } else if (flag == "--data") {
                options.data_dir = value;
            } else if (flag == "--out") {
                options.out_dir = value;
            } else if (flag == "--speed") {
                options.live.speed = speed_value(flag, value);
            } else if (flag == "--quiet-speed") {
                if (value == "max") throw UsageError("bad quiet-speed 'max': give ticks per second");
                options.live.quiet_speed = speed_value(flag, value);
            } else if (flag == "--once") {
                once = value;
            } else if (flag == "--model") {
                batch_options.model_path = value;
            } else if (flag == "--text") {
                const auto mode = from_key<TextMode>(value);
                if (!mode) throw UsageError("unknown text mode '" + value + "'");
                options.text = *mode;
                model_only = true;
            } else if (flag == "--prompt") {
                const auto mode = from_key<PromptMode>(value);
                if (!mode) throw UsageError("unknown prompt mode '" + value + "'");
                options.prompt = *mode;
                model_only = true;
            } else if (flag == "--batch") {
                const std::uint64_t n = parse_uint(flag, value);
                if (n < 1 || n > 1024) throw UsageError("bad batch '" + value + "'");
                batch_options.n_parallel = static_cast<int>(n);
                model_only = true;
            } else if (flag == "--device") {
                batch_options.device = value;
                model_only = true;
            } else {
                throw UsageError("unknown option '" + std::string(flag) + "'");
            }
        }
        if (model_only && batch_options.model_path.empty()) {
            throw UsageError("--prompt, --batch, --device and --text need --model");
        }
    } catch (const UsageError& e) {
        std::cerr << "rumor: " << e.what() << '\n' << kPlayUsage;
        return 2;
    }

    // --once: one game of a draft, at full speed, without HTTP.
    if (!once.empty()) {
        std::ifstream in(once, std::ios::binary);
        if (!in) throw std::runtime_error("cannot open '" + once + "'");
        const nlohmann::json draft = nlohmann::json::parse(in, nullptr, false);
        if (draft.is_discarded()) throw std::runtime_error(once + ": not JSON");
        std::unique_ptr<llm::Batch> batch;
        if (!batch_options.model_path.empty()) batch = llm::make_llama_batch(batch_options);
        options.batch = batch.get();
        options.live.speed = 0;
        PlayServer server(options);
        const PlayServer::Answer answer = server.start(draft);
        if (answer.status != 200) {
            std::cerr << "rumor: the draft cannot be played: " << answer.body.dump() << '\n';
            return 1;
        }
        server.wait_game();
        std::cout << answer.body["game"]["id"].get<std::string>() << '\n';
        return 0;
    }

    return serve_play(options, batch_options);
}

int serve_play(PlayOptions options, const llm::BatchOptions& batch_options, const OnPlayListen& on_listen,
               const MakeBatch& make_batch) {
    // Before the model runtime or the server start any thread (stop_signal.h).
    block_stop_signals();
    std::unique_ptr<llm::Batch> batch;
    if (!batch_options.model_path.empty()) {
        batch = make_batch ? make_batch(batch_options) : llm::make_llama_batch(batch_options);
    }
    options.batch = batch.get();

    PlayServer server(options);
    server.start_check();  // before the first request: /start waits for it
    const int port = server.listen();
    const std::string& bind = options.live.bind;
    const std::string host = bind == "0.0.0.0" || bind == "::" ? "127.0.0.1" : bind;
    std::cerr << "rumor: play at http://" << host << ':' << port << "/?play=1" << std::endl;

    std::atomic<bool> asked{false};
    std::atomic<bool> stopped{false};  // by the stop, not by a route
    std::thread stopper([&] {
        wait_for_stop(asked);
        if (!asked) stopped = true;
        server.request_quit();
    });
    if (on_listen) on_listen(port);
    server.wait_quit();
    asked = true;
    stopper.join();
    server.shutdown();
    return server.activate_requested() && !stopped ? kPlayActivate : 0;
}

}  // namespace rumor
