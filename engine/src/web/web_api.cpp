// The engine of the web version (phase 10, package F; README.md here): the
// game Sin IA behind one call, JSON text in and text out, for the Web Worker
// of viewer/js/web/. Single-threaded: no pthreads, no httplib, no model.
//
//   rw_call(method, input JSON) -> text (valid until the next call)
//
// It reuses what `rumor play` runs (server/play_server.cpp): the draft
// (server/game_draft), the world of the game (sim/game.cpp), the baseline
// wrapped by the card recorder (server/card_recorder) and the game id
// (server/game_files). The data of the game is embedded at /data (MEMFS).

#include <emscripten/emscripten.h>

#include <algorithm>
#include <chrono>
#include <exception>
#include <filesystem>
#include <fstream>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/build_info.h"
#include "core/game_api.h"
#include "core/log_api.h"
#include "core/policy.h"
#include "core/sim_api.h"
#include "core/world_api.h"
#include "server/card_recorder.h"
#include "server/game_draft.h"
#include "server/game_files.h"

namespace rumor::web {
namespace {

namespace fs = std::filesystem;
using Json = nlohmann::json;
using Ordered = nlohmann::ordered_json;

constexpr const char* kData = "/data";

// Loaded once: the world and both vocabularies, as PlayServer does.
struct Engine {
    World world = load_world(kData);
    Vocab es = load_vocab(kData, Lang::es);
    Vocab en = load_vocab(kData, Lang::en);
    const Vocab& vocab(Lang lang) const { return lang == Lang::en ? en : es; }
};

const Engine& engine() {
    static const Engine e;
    return e;
}

// An answer that the fake server turns into an HTTP reply as it is.
struct Failure {
    int status;
    Json body;
};

Json draft_error(const char* field, const std::string& message) {
    return draft_errors_json({{std::nullopt, field, message}});
}

// --- The header of a waiting village (as play_server.cpp header_line) --------

class FirstTickStop final : public RunControl {
  public:
    TickOrders before_tick(Tick) override {
        TickOrders orders;
        orders.stop = true;
        return orders;
    }
};

class HeaderOnlyPolicy final : public Policy {
  public:
    std::string name() const override { return "baseline"; }
    std::optional<std::string> model() const override { return std::nullopt; }
    std::vector<Decision> decide(std::span<const DecisionRequest> batch) override {
        return std::vector<Decision>(batch.size());
    }
};

std::string header_of(const GameSettings& settings) {
    const GameWorld game = make_game_world(settings, kData);
    HeaderOnlyPolicy policy;
    std::string line;
    RunSink sink;
    sink.header = [&line](const LogHeader& header) { line = write_header(header); };
    sink.event = [](const Event&) {};
    FirstTickStop stop;
    run_simulation(game.scenario, engine().world, game.population, engine().vocab(settings.lang),
                   policy, game.seed, sink, &stop);
    return line;
}

// --- The game ------------------------------------------------------------------

// The control of a game computed at once: each rumor of the player at its
// tick (as GameControl of play_server.cpp), a stop before `stop_at` (POST
// /stop), and what the page needs to pace it as LiveRun would: per tick, the
// tick, whether it was quiet and how many log lines there were after it.
class WebControl final : public RunControl {
  public:
    WebControl(const std::vector<GameRumor>& rumors, std::optional<Tick> stop_at,
               const std::size_t& lines)
        : rumors_(rumors), stop_at_(stop_at), lines_(lines) {}

    TickOrders before_tick(Tick t) override {
        TickOrders orders;
        if (stop_at_ && t >= *stop_at_) {
            orders.stop = true;
            return orders;
        }
        for (const GameRumor& rumor : rumors_) {
            if (rumor.at == t) orders.injections.push_back(rumor.injection);
        }
        return orders;
    }
    void after_tick(Tick t, bool quiet) override {
        ticks_.push_back(Json::array({t, quiet ? 1 : 0, lines_}));
    }
    Json ticks() const { return ticks_; }

  private:
    const std::vector<GameRumor>& rumors_;
    std::optional<Tick> stop_at_;
    const std::size_t& lines_;
    Json ticks_ = Json::array();
};

// A free id for a game started at `now_ms` (new_game_id, with the games kept
// by the page as the taken files): {"id", "started"}.
Json game_id(std::int64_t now_ms, std::uint64_t town, const Json& taken) {
    const fs::path dir = "/tmp/rw-games";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);
    for (const Json& id : taken) {
        if (id.is_string() && valid_game_id(id.get<std::string>())) {
            std::ofstream(dir / (id.get<std::string>() + ".game.json"));
        }
    }
    const WallClock::time_point now{std::chrono::milliseconds(now_ms)};
    const std::string id = new_game_id(dir, now, false, town);
    fs::remove_all(dir, ec);
    return {{"id", id}, {"started", iso_utc(now)}};
}

// in: {"draft", "stop_at": tick|null} and either {"id", "started"} (a game
// played again) or {"now_ms", "taken": [ids]} (a new game: its id is made
// here, as PlayServer::start does once the draft is valid)
// out: line 1 {"game": <id>.game.json, "ticks": [[t, quiet, lines]...],
//      "log_lines": N, "cards_lines": M, "compute_ms"}, then the N log lines
//      and the M card lines.
std::string play(const Json& in) {
    const Json& draft = in.at("draft");
    // The order of the checks of PlayServer::start.
    GameSettings settings;
    try {
        settings = draft_settings(draft, false);
    } catch (const std::invalid_argument& e) {
        throw Failure{400, draft_error("settings", e.what())};
    }
    if (settings.ai) throw Failure{400, draft_error("mode", "no_model")};
    GameWorld world = make_game_world(settings, kData);
    const Vocab& vocab = engine().vocab(settings.lang);
    DraftRumors rumors = draft_rumors(draft, settings, world.scenario, world.population, vocab);
    if (!rumors.errors.empty()) throw Failure{400, draft_errors_json(rumors.errors)};
    Json normalized;
    try {
        normalized = normalized_draft(draft, false);
    } catch (const std::invalid_argument& e) {
        throw Failure{400, draft_error("settings", e.what())};
    }
    fit_end(world.scenario, rumors.last_needed, settings.until);

    const Json named = in.contains("id")
                           ? Json{{"id", in.at("id")}, {"started", in.at("started")}}
                           : game_id(in.at("now_ms").get<std::int64_t>(), settings.town,
                                     in.value("taken", Json::array()));
    Ordered game;
    game["format"] = kGameFormat;
    game["id"] = named.at("id").get<std::string>();
    game["game_version"] = kGameVersion;
    game["started"] = named.at("started").get<std::string>();
    game["ended"] = nullptr;
    game["settings"] = Ordered::parse(normalized["settings"].dump());
    game["rumors"] = Ordered::parse(normalized["rumors"].dump());
    game["challenge"] = Ordered::parse(normalized["challenge"].dump());
    game["bets"] = Ordered::parse(normalized["bets"].dump());
    game["race"] = Ordered::parse(normalized["race"].dump());
    game["stopped"] = false;
    game["end_tick"] = nullptr;

    std::optional<Tick> stop_at;
    if (in.contains("stop_at") && !in["stop_at"].is_null()) stop_at = in["stop_at"].get<Tick>();

    const auto begun = std::chrono::steady_clock::now();
    std::string log;
    std::size_t lines = 0;
    std::optional<Tick> end_tick;
    RunSink sink;
    sink.header = [&](const LogHeader& header) {
        log += write_header(header);
        log += '\n';
        ++lines;
    };
    sink.event = [&](const Event& event) {
        if (const auto* end = std::get_if<EndEvent>(&event)) end_tick = end->tick;
        log += write_event(event);
        log += '\n';
        ++lines;
    };
    WebControl control(rumors.rumors, stop_at, lines);
    const std::unique_ptr<Policy> baseline = make_baseline_policy();
    std::ostringstream cards;
    CardRecorder recorder(*baseline, cards, nullptr);
    run_simulation(world.scenario, engine().world, world.population, vocab, recorder, world.seed,
                   sink, &control);
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - begun).count();

    const std::string card_text = cards.str();
    Json meta;
    meta["ok"] = true;
    meta["game"] =Json::parse(game.dump());  // reparsed in JS: the order is kept there
    meta["game_text"] = game.dump(2) + "\n";  // <id>.game.json as play_server writes it
    meta["ticks"] = control.ticks();
    meta["log_lines"] = lines;
    meta["cards_lines"] = static_cast<std::size_t>(std::count(card_text.begin(), card_text.end(), '\n'));
    meta["end_tick"] = end_tick ? Json(*end_tick) : Json(nullptr);
    meta["compute_ms"] = ms;
    return meta.dump() + "\n" + log + card_text;
}

// in: {"draft", "village": draft|null}. The checks and the answer of POST
// /preview: {"status", "body"} plus the normalized draft, whether the village
// changed (same_village, or the mode) and the header of the village now shown.
Json preview(const Json& in) {
    const Json& draft = in.at("draft");
    GameSettings settings;
    Json normalized;
    try {
        settings = draft_settings(draft, false);
        normalized = normalized_draft(draft, false);
    } catch (const std::invalid_argument& e) {
        throw Failure{400, draft_error("settings", e.what())};
    }
    const Json& village = in.contains("village") ? in["village"] : Json();
    bool changed = true;
    if (!village.is_null()) {
        const GameSettings shown = draft_settings(village, false);
        changed = !same_village(settings, shown) || settings.ai != shown.ai;
    }
    const std::string header = header_of(changed ? settings : draft_settings(village, false));
    Json out;
    out["status"] = 200;
    out["body"] = {{"header", Json::parse(header)}, {"town_changed", changed}};
    out["draft"] = normalized;
    out["changed"] = changed;
    out["header"] = header;
    return out;
}

// in: {"draft"}: the header line of its village (a waiting session).
Json header(const Json& in) {
    return {{"header", header_of(draft_settings(in.at("draft"), false))}};
}

// data_dir/challenges/*.json sorted by "order", then "id" (as play_server.cpp
// read_challenges).
Json challenges() {
    std::vector<Json> found;
    std::error_code ec;
    for (fs::directory_iterator it(fs::path(kData) / "challenges", ec), end; !ec && it != end;
         it.increment(ec)) {
        if (it->path().extension() != ".json") continue;
        const std::optional<std::string> text = read_file(it->path());
        Json j = text ? Json::parse(*text, nullptr, false) : Json(Json::value_t::discarded);
        if (j.is_discarded() || !j.is_object()) continue;
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

// What does not change during a visit: {"version", "challenges", "timetable",
// "default_draft"}.
Json info() {
    engine();  // loads the data, so a broken build fails here
    const std::optional<std::string> timetable =
        read_file(fs::path(kData) / "world" / "timetable.json");
    Json out;
    out["version"] = std::string(engine_version());
    out["challenges"] = challenges();
    out["timetable"] = timetable ? Json::parse(*timetable, nullptr, false) : Json(nullptr);
    if (out["timetable"].is_discarded()) out["timetable"] = nullptr;
    out["default_draft"] = default_draft(false);
    return out;
}

}  // namespace
}  // namespace rumor::web

namespace {
std::string g_out;  // the last answer; the caller copies it at once
}

// Every answer is text. JSON methods answer {"ok": true, ...} or
// {"ok": false, "status", "body"}; "play" answers that same failure object
// alone on its first line when it fails.
extern "C" EMSCRIPTEN_KEEPALIVE const char* rw_call(const char* method_c, const char* input_c) {
    using rumor::web::Failure;
    using Json = nlohmann::json;
    const std::string method = method_c ? method_c : "";
    try {
        const Json in = Json::parse(input_c ? input_c : "{}");
        if (method == "play") {
            g_out = rumor::web::play(in);
            return g_out.c_str();
        }
        Json out;
        if (method == "info") out = rumor::web::info();
        else if (method == "preview") out = rumor::web::preview(in);
        else if (method == "header") out = rumor::web::header(in);
        else throw Failure{500, Json{{"error", "unknown method '" + method + "'"}}};
        out["ok"] = true;
        g_out = out.dump();
    } catch (const Failure& f) {
        g_out = Json{{"ok", false}, {"status", f.status}, {"body", f.body}}.dump();
    } catch (const std::exception& e) {
        g_out = Json{{"ok", false}, {"status", 500}, {"body", {{"error", e.what()}}}}.dump();
    }
    return g_out.c_str();
}
