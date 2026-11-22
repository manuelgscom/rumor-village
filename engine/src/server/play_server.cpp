// The game server of `rumor play` (play_server.h): the states, the routes of
// the game, the game thread and the hardware check.

#include "server/play_server.h"

#include <algorithm>
#include <chrono>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <utility>
#include <variant>
#include <vector>

#include <cpp-httplib/httplib.h>

#include "card/render.h"
#include "core/build_info.h"
#include "core/log_api.h"
#include "core/sim_api.h"
#include "extract/extract.h"
#include "policy/model.h"
#include "server/card_recorder.h"
#include "server/game_draft.h"
#include "server/game_files.h"
#include "server/http_util.h"

namespace rumor {

namespace fs = std::filesystem;
using Json = nlohmann::json;
using Ordered = nlohmann::ordered_json;
using http::error;
using http::reply;

// One run of the server: a village, its LiveRun and, in a game, what the game
// writes. Members that point into others come after them.
struct PlayServer::Session {
    GameSettings settings;
    GameWorld world;
    const Vocab* vocab = nullptr;
    std::string header;  // waiting: the header line of the village
    std::unique_ptr<LiveRun> run;
    std::unique_ptr<Extractor> extractor;  // waiting with a model; only under model_mutex_

    // A game (empty id in waiting). Set before the game thread starts.
    std::string id;
    std::string started;
    Ordered game;  // <id>.game.json
    std::vector<GameRumor> rumors;
    std::ofstream log;
    std::ofstream cards;
    std::unique_ptr<Renderer> renderer;  // model only
    std::unique_ptr<Policy> policy;
    std::unique_ptr<CardRecorder> recorder;
    std::atomic<bool> stopped{false};
    std::optional<Tick> end_tick;  // game thread
};

namespace {

// Stops before the first tick: the header of a village without running it.
class FirstTickStop final : public RunControl {
  public:
    TickOrders before_tick(Tick) override {
        TickOrders orders;
        orders.stop = true;
        return orders;
    }
};

// The waiting village says in its header who will decide (header.policy and
// header.model), so the viewer labels the mode before the game starts. It never
// decides anything: the run stops before the first tick.
class HeaderOnlyPolicy final : public Policy {
  public:
    explicit HeaderOnlyPolicy(std::optional<std::string> model) : model_(std::move(model)) {}
    std::string name() const override { return model_ ? "model" : "baseline"; }
    std::optional<std::string> model() const override { return model_; }
    std::vector<Decision> decide(std::span<const DecisionRequest> batch) override {
        return std::vector<Decision>(batch.size());
    }

  private:
    std::optional<std::string> model_;
};

std::string header_line(const GameWorld& game, const World& world, const Vocab& vocab,
                        std::optional<std::string> model) {
    std::unique_ptr<Policy> policy = std::make_unique<HeaderOnlyPolicy>(std::move(model));
    std::string line;
    RunSink sink;
    sink.header = [&line](const LogHeader& header) { line = write_header(header); };
    sink.event = [](const Event&) {};
    FirstTickStop stop;
    run_simulation(game.scenario, world, game.population, vocab, *policy, game.seed, sink, &stop);
    return line;
}

// The control of a game: the pace, pause and stop of its LiveRun, and each
// rumor of the player at its tick.
class GameControl final : public RunControl {
  public:
    GameControl(LiveRun& run, const std::vector<GameRumor>& rumors) : run_(run), rumors_(rumors) {}

    TickOrders before_tick(Tick t) override {
        TickOrders orders = run_.before_tick(t);
        if (orders.stop) return orders;
        for (const GameRumor& rumor : rumors_) {
            if (rumor.at == t) orders.injections.push_back(rumor.injection);
        }
        return orders;
    }
    void after_tick(Tick t, bool quiet) override { run_.after_tick(t, quiet); }

  private:
    LiveRun& run_;
    const std::vector<GameRumor>& rumors_;
};

const char* state_key(int state) {
    switch (state) {
        case 0: return "waiting";
        case 1: return "playing";
        default: return "ended";
    }
}

Json draft_error(const char* field, const std::string& message) {
    return draft_errors_json({{std::nullopt, field, message}});
}

// data_dir/challenges/*.json, sorted by "order"; unreadable files are skipped.
Json read_challenges(const std::string& data_dir) {
    std::vector<Json> found;
    std::error_code ec;
    for (fs::directory_iterator it(fs::path(data_dir) / "challenges", ec), end; !ec && it != end;
         it.increment(ec)) {
        if (it->path().extension() != ".json") continue;
        const std::optional<std::string> text = read_file(it->path());
        Json j = text ? Json::parse(*text, nullptr, false) : Json(Json::value_t::discarded);
        if (j.is_discarded() || !j.is_object()) {
            std::cerr << "rumor play: warning: skipping " << it->path().string()
                      << ": not a JSON object\n";
            continue;
        }
        found.push_back(std::move(j));
    }
    const auto order = [](const Json& j) {
        const auto it = j.find("order");
        return it != j.end() && it->is_number() ? it->get<double>() : 1e18;
    };
    std::stable_sort(found.begin(), found.end(), [&](const Json& a, const Json& b) {
        if (order(a) != order(b)) return order(a) < order(b);
        return a.value("id", std::string()) < b.value("id", std::string());
    });
    Json out = Json::array();
    for (Json& j : found) out.push_back(std::move(j));
    return out;
}

}  // namespace

// --- Life of the server ------------------------------------------------------

PlayServer::PlayServer(const PlayOptions& options)
    : options_(options),
      world_(load_world(options.data_dir)),
      vocab_es_(load_vocab(options.data_dir, Lang::es)),
      vocab_en_(load_vocab(options.data_dir, Lang::en)),
      http_(std::make_unique<httplib::Server>()) {
    fs::create_directories(options_.out_dir);
    check_state_ = "skipped";
    if (!options_.batch) ai_reason_ = options_.no_ai_reason;
    draft_ = default_draft(options_.batch != nullptr);
    current_ = make_waiting(draft_settings(draft_, options_.batch != nullptr));
}

PlayServer::~PlayServer() { shutdown(); }

const Vocab& PlayServer::vocab(Lang lang) const { return lang == Lang::en ? vocab_en_ : vocab_es_; }

std::shared_ptr<PlayServer::Session> PlayServer::current() const {
    const std::lock_guard lock(mutex_);
    return current_;
}

std::shared_ptr<PlayServer::Session> PlayServer::make_waiting(const GameSettings& settings) const {
    auto s = std::make_shared<Session>();
    s->settings = settings;
    s->world = make_game_world(settings, options_.data_dir);
    s->vocab = &vocab(settings.lang);
    std::optional<std::string> model;
    if (settings.ai && options_.batch) model = options_.batch->info().file;
    s->header = header_line(s->world, world_, *s->vocab, std::move(model));
    s->run = std::make_unique<LiveRun>(options_.live, *s->vocab, s->world.population, nullptr);
    s->run->publish(s->header);
    return s;
}

void PlayServer::swap_in(std::shared_ptr<Session> next, State state) {
    std::shared_ptr<Session> old;
    {
        const std::lock_guard lock(mutex_);
        old = std::move(current_);
        current_ = std::move(next);
        state_ = state;
    }
    if (old) old->run->close();  // its streams end: the viewer reloads
}

void PlayServer::end_game_locked() {
    std::shared_ptr<Session> playing;
    {
        const std::lock_guard lock(mutex_);
        if (state_ == State::playing) playing = current_;
    }
    if (playing) {
        playing->stopped = true;
        playing->run->request_stop();
    }
    if (game_thread_.joinable()) game_thread_.join();
}

void PlayServer::wait_game() {
    const std::lock_guard ops(ops_mutex_);
    if (game_thread_.joinable()) game_thread_.join();
}

void PlayServer::request_quit() {
    {
        const std::lock_guard lock(mutex_);
        quit_ = true;
    }
    quitting_ = true;
    quit_cv_.notify_all();
}

bool PlayServer::activate_requested() const {
    const std::lock_guard lock(mutex_);
    return activate_;
}

void PlayServer::wait_quit() {
    std::unique_lock lock(mutex_);
    quit_cv_.wait(lock, [this] { return quit_; });
}

void PlayServer::shutdown() {
    {
        const std::lock_guard ops(ops_mutex_);
        if (shut_) return;
        shut_ = true;
        quitting_ = true;
        end_game_locked();
        if (check_thread_.joinable()) check_thread_.join();
    }
    // Streams end before the listener stops, or it would wait for them.
    if (const std::shared_ptr<Session> s = current()) s->run->close();
    http_->stop();
    if (listener_.joinable()) listener_.join();
}

// --- The game ------------------------------------------------------------------

PlayServer::Answer PlayServer::start(const Json& draft) {
    const std::lock_guard ops(ops_mutex_);
    if (shut_) return {503, Json{{"error", "the server is closing"}}};
    {
        const std::lock_guard lock(mutex_);
        if (activate_) return {503, Json{{"error", "the server is closing"}}};
        if (state_ != State::waiting) return {409, Json{{"error", "not waiting: reset first"}}};
        if (check_state_ == "running") {
            return {409, Json{{"error", "the hardware check has not finished"}}};
        }
    }
    const bool ai_default = options_.batch != nullptr;
    GameSettings settings;
    try {
        settings = draft_settings(draft, ai_default);
    } catch (const std::invalid_argument& e) {
        return {400, draft_error("settings", e.what())};
    }
    bool ai_available = false;
    {
        const std::lock_guard lock(mutex_);
        ai_available = options_.batch && !ai_reason_;
    }
    if (settings.ai && !ai_available) return {400, draft_error("mode", "no_model")};

    auto s = std::make_shared<Session>();
    s->settings = settings;
    s->world = make_game_world(settings, options_.data_dir);
    s->vocab = &vocab(settings.lang);
    DraftRumors rumors =
        draft_rumors(draft, settings, s->world.scenario, s->world.population, *s->vocab);
    if (!rumors.errors.empty()) return {400, draft_errors_json(rumors.errors)};
    const Json normalized = normalized_draft(draft, ai_default);
    s->rumors = std::move(rumors.rumors);
    fit_end(s->world.scenario, rumors.last_needed, settings.until);

    // The policy of the mode, and the recorder of «¿Qué pensó?» around it.
    if (settings.ai) {
        const std::lock_guard model(model_mutex_);
        s->renderer = make_renderer(options_.data_dir, *s->vocab, s->world.population);
        ModelPolicyOptions model_options;
        model_options.text = options_.text;
        model_options.prompt = options_.prompt;
        s->policy = make_model_policy(*options_.batch, *s->renderer, *s->vocab, s->world.population,
                                      model_options);
    } else {
        s->policy = make_baseline_policy();
    }

    // The files.
    const fs::path out(options_.out_dir);
    fs::create_directories(out);
    const WallClock::time_point now = WallClock::now();
    s->id = new_game_id(out, now, settings.ai, settings.town);
    s->started = iso_utc(now);
    s->log.open(out / (s->id + ".jsonl"), std::ios::binary);
    s->cards.open(out / (s->id + ".cards.jsonl"), std::ios::binary);
    if (!s->log || !s->cards) throw std::runtime_error("cannot write in '" + out.string() + "'");
    s->recorder = std::make_unique<CardRecorder>(*s->policy, s->cards, s->renderer.get());
    s->game["format"] = kGameFormat;
    s->game["id"] = s->id;
    s->game["game_version"] = kGameVersion;
    s->game["started"] = s->started;
    s->game["ended"] = nullptr;
    s->game["settings"] = Ordered::parse(normalized["settings"].dump());
    s->game["rumors"] = Ordered::parse(normalized["rumors"].dump());
    s->game["challenge"] = Ordered::parse(normalized["challenge"].dump());
    s->game["bets"] = Ordered::parse(normalized["bets"].dump());
    s->game["race"] = Ordered::parse(normalized["race"].dump());
    s->game["stopped"] = false;
    s->game["end_tick"] = nullptr;
    write_atomic(out / (s->id + ".game.json"), s->game.dump(2) + "\n");

    s->run = std::make_unique<LiveRun>(options_.live, *s->vocab, s->world.population, nullptr);
    if (game_thread_.joinable()) game_thread_.join();
    {
        const std::lock_guard lock(mutex_);
        draft_ = normalized;
    }
    swap_in(s, State::playing);
    game_thread_ = std::thread([this, s] { run_game(s); });
    return {200, Json{{"game", {{"id", s->id}}}}};
}

void PlayServer::run_game(const std::shared_ptr<Session>& s) {
    {
        std::unique_lock model(model_mutex_, std::defer_lock);
        if (s->settings.ai) model.lock();
        GameControl control(*s->run, s->rumors);
        Session* raw = s.get();
        const auto emit = [raw](std::string line) {
            raw->log << line << '\n';
            raw->log.flush();
            raw->run->publish(std::move(line));
        };
        RunSink sink;
        sink.header = [emit](const LogHeader& header) { emit(write_header(header)); };
        sink.event = [emit, raw](const Event& event) {
            if (const auto* end = std::get_if<EndEvent>(&event)) raw->end_tick = end->tick;
            emit(write_event(event));
        };
        try {
            run_simulation(s->world.scenario, world_, s->world.population, *s->vocab, *s->recorder,
                           s->world.seed, sink, &control);
        } catch (const std::exception& e) {
            std::cerr << "rumor play: game " << s->id << ": " << e.what() << '\n';
        }
    }
    s->run->finish();
    s->log.close();
    s->cards.close();
    if (!s->log || !s->cards) std::cerr << "rumor play: game " << s->id << ": cannot write its files\n";
    s->game["ended"] = iso_utc(WallClock::now());
    s->game["stopped"] = s->stopped.load();
    s->game["end_tick"] = s->end_tick ? Ordered(*s->end_tick) : Ordered(nullptr);
    try {
        write_atomic(fs::path(options_.out_dir) / (s->id + ".game.json"), s->game.dump(2) + "\n");
    } catch (const std::exception& e) {
        std::cerr << "rumor play: " << e.what() << '\n';
    }
    const std::lock_guard lock(mutex_);
    if (current_ == s && state_ == State::playing) state_ = State::ended;
}

// --- Hardware check -------------------------------------------------------------

void PlayServer::start_check() {
    const std::lock_guard ops(ops_mutex_);
    if (!options_.batch || check_thread_.joinable()) return;
    {
        const std::lock_guard lock(mutex_);
        check_state_ = "running";
    }
    check_thread_ = std::thread([this] { run_check(); });
}

void PlayServer::run_check() {
    std::optional<double> dps;
    std::optional<std::string> failure;
    try {
        const std::lock_guard model(model_mutex_);
        GameSettings settings;  // party-25, town 1
        settings.ai = true;
        const GameWorld game = make_game_world(settings, options_.data_dir);
        const Vocab& v = vocab(settings.lang);
        const std::unique_ptr<Renderer> renderer =
            make_renderer(options_.data_dir, v, game.population);
        ModelPolicyOptions model_options;
        model_options.text = options_.text;
        model_options.prompt = options_.prompt;
        const std::unique_ptr<Policy> policy =
            make_model_policy(*options_.batch, *renderer, v, game.population, model_options);

        // Decisions per second from the perf samples: each one is `batch`
        // decisions at its rate.
        double decisions = 0, seconds = 0;
        RunSink sink;
        sink.header = [](const LogHeader&) {};
        sink.event = [&](const Event& event) {
            const auto* perf = std::get_if<PerfEvent>(&event);
            if (!perf || perf->batch <= 0 || perf->decisions_per_s_milli <= 0) return;
            decisions += perf->batch;
            seconds += perf->batch * 1000.0 / perf->decisions_per_s_milli;
        };
        struct Until final : RunControl {
            const std::atomic<bool>& quitting;
            const double& decisions;
            const double most;
            std::chrono::steady_clock::time_point end;
            Until(const std::atomic<bool>& q, const double& d, double most_decisions, int most_seconds)
                : quitting(q), decisions(d), most(most_decisions),
                  end(std::chrono::steady_clock::now() + std::chrono::seconds(most_seconds)) {}
            TickOrders before_tick(Tick) override {
                TickOrders orders;
                orders.stop = quitting || decisions >= most || std::chrono::steady_clock::now() >= end;
                return orders;
            }
        };
        // Warm-up first, not counted: the first decisions of a backend pay for
        // its one-time setup (Vulkan compiles its shaders on first use: 0.75
        // decisions/s measured cold against 6.35 warm on the RTX 5070 Ti,
        // phase 10), which would make the advice say "rules" for no reason.
        {
            Until warm(quitting_, decisions, kCheckWarmupDecisions, kCheckWarmupSeconds);
            run_simulation(game.scenario, world_, game.population, v, *policy, game.seed, sink, &warm);
        }
        decisions = 0;
        seconds = 0;
        Until until(quitting_, decisions, kCheckDecisions, kCheckSeconds);
        run_simulation(game.scenario, world_, game.population, v, *policy, game.seed, sink, &until);
        if (seconds > 0) dps = decisions / seconds;
    } catch (const std::exception& e) {
        std::cerr << "rumor play: hardware check: " << e.what() << '\n';
        failure = "model_error";
    }
    const std::lock_guard lock(mutex_);
    check_state_ = "done";
    check_dps_ = dps;
    if (failure) {
        ai_reason_ = failure;
        check_advice_ = "rules";
    } else if (dps && *dps < kAdviceRulesDps) {
        check_advice_ = "rules";
    } else if (dps && *dps < kAdviceNeighbors25Dps) {
        check_advice_ = "neighbors25";
    }
    if (failure) {
        // A model that fails cannot play: the next games are "rules".
        draft_["settings"]["mode"] = "rules";
    }
}

// --- State ----------------------------------------------------------------------

Json PlayServer::state_json() const {
    Json j;
    // Before mutex_: the download has its own.
    const Json download = options_.download ? options_.download.status() : Json();
    {
        const std::lock_guard lock(mutex_);
        j["state"] = state_key(static_cast<int>(state_));
        j["version"] = std::string(engine_version());
        j["run"] = current_->run->id();
        j["ai"] = {{"available", options_.batch != nullptr && !ai_reason_},
                   {"reason", ai_reason_ ? Json(*ai_reason_) : Json(nullptr)}};
        if (options_.download) j["ai"]["download"] = download;
        j["check"] = {{"state", check_state_},
                      {"decisions_per_s", check_dps_ ? Json(*check_dps_) : Json(nullptr)},
                      {"advice", check_advice_ ? Json(*check_advice_) : Json(nullptr)}};
        j["draft"] = draft_;
        j["game"] = current_->id.empty()
                        ? Json(nullptr)
                        : Json{{"id", current_->id}, {"started", current_->started}};
    }
    j["challenges"] = read_challenges(options_.data_dir);
    return j;
}

// --- HTTP -------------------------------------------------------------------------

int PlayServer::listen() {
    routes();
    const int port = http::listen_in_background(*http_, options_.live.bind, options_.live.port,
                                                options_.live.viewer_dir, listener_, "play server");
    port_ = port;
    return port;
}

bool PlayServer::allowed(const httplib::Request& req) const {
    const std::string port = std::to_string(port_.load());
    const std::string host = req.get_header_value("Host");
    if (host != "127.0.0.1:" + port && host != "localhost:" + port) return false;
    if (!req.has_header("Origin")) return true;  // curl
    const std::string origin = req.get_header_value("Origin");
    return origin == "http://127.0.0.1:" + port || origin == "http://localhost:" + port;
}

void PlayServer::routes() {
    using Req = const httplib::Request&;
    using Res = httplib::Response&;
    http_->set_pre_routing_handler([this](Req req, Res res) {
        if (allowed(req)) return httplib::Server::HandlerResponse::Unhandled;
        error(res, 403, "only the page of this server may use it");
        return httplib::Server::HandlerResponse::Handled;
    });
    http_->set_exception_handler([](Req, Res res, std::exception_ptr ep) {
        std::string message = "internal error";
        try {
            if (ep) std::rethrow_exception(ep);
        } catch (const std::exception& e) {
            message = e.what();
        } catch (...) {
        }
        error(res, 500, message);
    });

    // The run routes of phase 3, on the current session.
    http_->Get("/events", [this](Req req, Res res) {
        const std::shared_ptr<Session> s = current();
        s->run->get_events(req, res, s);
    });
    http_->Get("/control", [this](Req, Res res) { get_control(res); });
    http_->Post("/control", [this](Req req, Res res) { current()->run->post_control(req, res); });
    http_->Post("/viewport", [this](Req req, Res res) { current()->run->post_viewport(req, res); });
    http_->Post("/inject", [](Req, Res res) {
        error(res, 409, "a game takes its rumors from the draft (POST /start), not from /inject");
    });
    http_->Post("/extract", [this](Req req, Res res) { post_extract(req, res); });

    // The game.
    http_->Get("/state", [this](Req, Res res) { reply(res, 200, state_json()); });
    http_->Post("/preview", [this](Req req, Res res) { post_preview(req, res); });
    http_->Post("/start", [this](Req req, Res res) { post_start(req, res); });
    http_->Post("/stop", [this](Req, Res res) { post_stop(res); });
    http_->Post("/reset", [this](Req req, Res res) { post_reset(req, res); });
    http_->Post("/quit", [this](Req, Res res) {
        reply(res, 200, Json{{"quit", true}});
        request_quit();
    });
    http_->Post("/ai/download", [this](Req, Res res) { post_ai_download(res); });
    http_->Post("/ai/activate", [this](Req, Res res) { post_ai_activate(res); });
    http_->Get("/card", [this](Req req, Res res) { get_card(req, res); });
    http_->Get("/games", [this](Req, Res res) {
        reply(res, 200, Json{{"games", list_games(options_.out_dir)}});
    });
    http_->Get(R"(/games/([^/]+)\.game\.json)", [this](Req req, Res res) {
        get_game_file(req, res, ".game.json", "application/json");
    });
    http_->Get(R"(/games/([^/]+)\.jsonl)", [this](Req req, Res res) {
        get_game_file(req, res, ".jsonl", "application/x-ndjson");
    });
    http_->Get("/profile", [this](Req, Res res) { get_profile(res); });
    http_->Get("/timetable", [this](Req, Res res) { get_timetable(res); });
    http_->Post("/profile", [this](Req req, Res res) { post_profile(req, res); });
}

void PlayServer::get_control(httplib::Response& res) const {
    std::shared_ptr<Session> s;
    bool extract = false;
    {
        const std::lock_guard lock(mutex_);
        s = current_;
        extract = options_.batch && !ai_reason_ && state_ == State::waiting;
    }
    Json j = Json::parse(s->run->control_json());
    j["extract"] = extract;
    reply(res, 200, j);
}

void PlayServer::post_ai_download(httplib::Response& res) {
    if (!options_.download) return error(res, 404, "the model is not downloaded from the game here");
    if (const std::optional<std::string> why = options_.download.start()) return error(res, 409, *why);
    reply(res, 200, Json{{"download", options_.download.status()}});
}

void PlayServer::post_ai_activate(httplib::Response& res) {
    if (!options_.download) return error(res, 404, "the model is not downloaded from the game here");
    {
        const std::lock_guard ops(ops_mutex_);  // no game starts meanwhile
        if (shut_) return error(res, 503, "the server is closing");
        {
            const std::lock_guard lock(mutex_);
            if (state_ == State::playing) return error(res, 409, "a game is being played: stop it first");
        }
        if (const std::optional<std::string> why = options_.download.activate()) {
            return error(res, 409, *why);
        }
        const std::lock_guard lock(mutex_);
        activate_ = true;
    }
    reply(res, 200, Json{{"activating", true}});
    request_quit();
}

void PlayServer::post_preview(const httplib::Request& req, httplib::Response& res) {
    const std::optional<Json> draft = http::object_body(req);
    if (!draft) return error(res, 400, "the body is a draft: a JSON object");
    const bool ai_default = options_.batch != nullptr;
    GameSettings settings;
    Json normalized;
    try {
        settings = draft_settings(*draft, ai_default);
        normalized = normalized_draft(*draft, ai_default);
    } catch (const std::invalid_argument& e) {
        return reply(res, 400, draft_error("settings", e.what()));
    }

    const std::lock_guard ops(ops_mutex_);
    if (shut_) return error(res, 503, "the server is closing");
    std::shared_ptr<Session> s;
    {
        const std::lock_guard lock(mutex_);
        if (state_ != State::waiting) return error(res, 409, "not waiting: reset first");
        s = current_;
    }
    // The mode changes header.policy and header.model too, so the viewer
    // reloads to label it.
    const bool changed = !same_village(settings, s->settings) || settings.ai != s->settings.ai;
    if (changed) {
        s = make_waiting(settings);
        swap_in(s, State::waiting);
    }
    {
        const std::lock_guard lock(mutex_);
        draft_ = normalized;
    }
    reply(res, 200, Json{{"header", Json::parse(s->header)}, {"town_changed", changed}});
}

void PlayServer::post_start(const httplib::Request& req, httplib::Response& res) {
    Json draft;
    if (req.body.find_first_not_of(" \t\r\n") == std::string::npos) {
        const std::lock_guard lock(mutex_);
        draft = draft_;  // the draft kept by /preview
    } else {
        const std::optional<Json> body = http::object_body(req);
        if (!body) return error(res, 400, "the body is a draft: a JSON object");
        draft = *body;
    }
    const Answer answer = start(draft);
    reply(res, answer.status, answer.body);
}

void PlayServer::post_stop(httplib::Response& res) {
    const std::lock_guard ops(ops_mutex_);
    std::string id;
    {
        const std::lock_guard lock(mutex_);
        if (state_ != State::playing) return error(res, 409, "no game is being played");
        id = current_->id;
    }
    end_game_locked();
    reply(res, 200, Json{{"state", "ended"}, {"game", {{"id", id}}}});
}

void PlayServer::post_reset(const httplib::Request& req, httplib::Response& res) {
    bool clear = false;
    if (req.body.find_first_not_of(" \t\r\n") != std::string::npos) {
        const std::optional<Json> body = http::object_body(req);
        if (!body) return error(res, 400, "the body is {\"clear\": true|false} or nothing");
        for (const auto& [key, value] : body->items()) {
            if (key != "clear" || !value.is_boolean()) {
                return error(res, 400, "the body is {\"clear\": true|false} or nothing");
            }
            clear = value.get<bool>();
        }
    }
    const std::lock_guard ops(ops_mutex_);
    if (shut_) return error(res, 503, "the server is closing");
    end_game_locked();
    const bool ai_default = options_.batch != nullptr;
    Json draft;
    {
        const std::lock_guard lock(mutex_);
        if (clear) draft_ = default_draft(ai_default && !ai_reason_);
        draft = draft_;
    }
    const std::shared_ptr<Session> s = make_waiting(draft_settings(draft, ai_default));
    swap_in(s, State::waiting);
    reply(res, 200, Json{{"state", "waiting"}, {"run", s->run->id()}});
}

void PlayServer::post_extract(const httplib::Request& req, httplib::Response& res) {
    {
        const std::lock_guard lock(mutex_);
        if (!options_.batch || ai_reason_) return error(res, 501, "there is no model: play Sin IA");
    }
    const std::optional<Json> body = http::object_body(req);
    if (!body || body->size() != 1 || !body->contains("text") || !(*body)["text"].is_string()) {
        return error(res, 400, "the body is {\"text\":\"...\"}");
    }
    const std::lock_guard model(model_mutex_);
    std::shared_ptr<Session> s;
    {
        const std::lock_guard lock(mutex_);
        if (state_ != State::waiting) return error(res, 409, "only while waiting");
        s = current_;
    }
    if (!s->extractor) {
        s->extractor = make_extractor(*options_.batch, options_.data_dir, *s->vocab,
                                      s->world.population, options_.prompt);
    }
    Extracted fact;
    try {
        fact = s->extractor->extract((*body)["text"].get<std::string>());
    } catch (const std::exception&) {
        return error(res, 500, "the extraction failed");
    }
    reply(res, 200, http::extract_answer(fact, *s->vocab, s->world.population));
}

void PlayServer::get_card(const httplib::Request& req, httplib::Response& res) const {
    std::string id = req.get_param_value("game");
    if (id.empty()) id = current()->id;
    if (id.empty() || !valid_game_id(id)) return error(res, 404, "no such game");
    const std::string tick_text = req.get_param_value("tick");
    const std::string who = req.get_param_value("who");
    Tick tick = 0;
    if (tick_text.empty() || tick_text.size() > 9 ||
        tick_text.find_first_not_of("0123456789") != std::string::npos || who.empty()) {
        return error(res, 400, "GET /card?game=<id>&tick=<t>&who=<id>[&kind=turn|plan]");
    }
    tick = static_cast<Tick>(std::stol(tick_text));
    std::optional<std::string> kind;
    if (req.has_param("kind")) kind = req.get_param_value("kind");
    const std::optional<Json> line =
        find_card((fs::path(options_.out_dir) / (id + ".cards.jsonl")).string(), tick, who, kind);
    if (!line) return error(res, 404, "no such decision");
    Ordered out;
    out["tick"] = (*line)["tick"];
    out["who"] = (*line)["who"];
    out["kind"] = (*line)["kind"];
    const Json card = line->value("card", Json());
    const Json rule = line->value("rule", Json());
    out["policy"] = card.is_null() && !rule.is_null() ? "baseline" : "model";
    out["card"] = Ordered::parse(card.dump());
    out["rule"] = Ordered::parse(rule.dump());
    res.status = 200;
    res.set_content(out.dump(), "application/json");
}

void PlayServer::get_game_file(const httplib::Request& req, httplib::Response& res,
                               const std::string& suffix, const std::string& type) const {
    const std::string id = req.matches.size() > 1 ? req.matches[1].str() : std::string();
    if (!valid_game_id(id)) return error(res, 404, "no such game");
    const std::optional<std::string> text = read_file(fs::path(options_.out_dir) / (id + suffix));
    if (!text) return error(res, 404, "no such game");
    res.status = 200;
    res.set_content(*text, type);
}

void PlayServer::get_profile(httplib::Response& res) const {
    const std::optional<std::string> text = read_file(fs::path(options_.out_dir) / "profile.json");
    Json profile = text ? Json::parse(*text, nullptr, false) : Json(Json::value_t::discarded);
    if (profile.is_discarded() || !profile.is_object()) profile = Json{{"format", 1}};
    reply(res, 200, profile);
}

// GET /timetable: data/world/timetable.json as the engine loaded it (where each
// job is at each hour). Read-only API of the server, not of the contract: the
// viewer shows it in the neighbor cards (phase 9-5).
void PlayServer::get_timetable(httplib::Response& res) const {
    const std::optional<std::string> text = read_file(fs::path(options_.data_dir) / "world" / "timetable.json");
    const Json timetable = text ? Json::parse(*text, nullptr, false) : Json(Json::value_t::discarded);
    if (timetable.is_discarded() || !timetable.is_object()) return error(res, 500, "the timetable cannot be read");
    reply(res, 200, timetable);
}

void PlayServer::post_profile(const httplib::Request& req, httplib::Response& res) {
    if (req.body.size() > kProfileMaxBytes) return error(res, 400, "the profile is over 1 MB");
    const std::optional<Json> profile = http::object_body(req);
    if (!profile) return error(res, 400, "the profile is a JSON object");
    const std::lock_guard lock(profile_mutex_);
    write_atomic(fs::path(options_.out_dir) / "profile.json", profile->dump() + "\n");
    reply(res, 200, *profile);
}

}  // namespace rumor
