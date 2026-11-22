// `rumor play` (phase 9, server/play_server.h) on an ephemeral port, with the
// baseline only: the states and their transitions, the origin check, the
// draft (preview, start, errors), the files of a game, GET /card, /games and
// /profile, `--once`, and that the card recorder changes no byte of the log.
#include <doctest/doctest.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <future>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <process.h>  // _getpid
#define getpid _getpid
#else
#include <unistd.h>
#endif

#include <cpp-httplib/httplib.h>
#include <nlohmann/json.hpp>

#include "core/game_api.h"
#include "core/log_api.h"
#include "core/sim_api.h"
#include "core/world_api.h"
#include "server/card_recorder.h"
#include "server/game_draft.h"
#include "server/game_files.h"
#include "server/live_run.h"
#include "server/play_server.h"

using namespace rumor;
using Json = nlohmann::json;
using namespace std::chrono_literals;
namespace fs = std::filesystem;

namespace {

const char* const kRumor =
    R"({"fact":{"what":"party","who":"n006","where":"square","when":"hoy 21:00","amount":50},)"
    R"("text":"esta noche hay fiesta en la plaza a las 9","to":{"place":"square"},"at":"start"})";

std::string draft_with(const std::string& rumors, const std::string& settings = R"({"town":7})") {
    return R"({"settings":)" + settings + R"(,"rumors":[)" + rumors +
           R"(],"challenge":null,"bets":{"attend":12,"half":null,"last":null},"race":null})";
}

// A fresh folder for the files of the games.
fs::path fresh_dir(const std::string& name) {
    static std::atomic<int> counter{0};
    const fs::path dir = fs::temp_directory_path() /
                         ("rumor-play-" + name + "-" + std::to_string(::getpid()) + "-" +
                          std::to_string(counter++));
    fs::remove_all(dir);
    return dir;
}

PlayOptions options_for(const fs::path& out, int speed = 0, PlayDownload download = {}) {
    PlayOptions o;
    o.download = std::move(download);
    o.live.port = 0;
    o.live.speed = speed;
    o.live.quiet_speed = 0;
    o.data_dir = RUMOR_DATA_DIR;
    o.out_dir = out.string();
    return o;
}

std::vector<std::string> lines_of(const std::string& text) {
    std::vector<std::string> lines;
    std::istringstream in(text);
    for (std::string line; std::getline(in, line);) lines.push_back(line);
    return lines;
}

std::string slurp(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream out;
    out << in.rdbuf();
    return out.str();
}

std::set<std::string> listing(const fs::path& dir) {
    std::set<std::string> out;
    for (const auto& entry : fs::recursive_directory_iterator(dir)) {
        out.insert(entry.path().string() + " " + std::to_string(entry.is_regular_file() ? fs::file_size(entry) : 0));
    }
    return out;
}

// A started play server and a client for it.
struct Play {
    fs::path out;
    PlayServer server;
    int port;
    httplib::Client client;

    explicit Play(const std::string& name, int speed = 0, PlayDownload download = {})
        : out(fresh_dir(name)),
          server(options_for(out, speed, std::move(download))),
          port(server.listen()),
          client("127.0.0.1", port) {
        client.set_read_timeout(30, 0);
    }
    ~Play() {
        server.shutdown();
        std::error_code ec;
        fs::remove_all(out, ec);
    }

    Json get(const std::string& path) {
        const httplib::Result res = client.Get(path);
        REQUIRE(res);
        REQUIRE(res->status == 200);
        return Json::parse(res->body);
    }
    httplib::Result post(const std::string& path, const std::string& body) {
        return client.Post(path, body, "application/json");
    }
    std::string run_id() { return get("/state")["run"].get<std::string>(); }

    // Polls GET /state until `state`, for up to a minute.
    void wait_state(const std::string& state) {
        for (int i = 0; i < 600; ++i) {
            if (get("/state")["state"] == state) return;
            std::this_thread::sleep_for(100ms);
        }
        FAIL("the server never reached " << state);
    }
};

Json body_of(const httplib::Result& res) {
    REQUIRE(res);
    return Json::parse(res->body);
}

// The log a draft gives without the server: the same world, the rumors as
// injections at their tick, the baseline without the card recorder.
std::string plain_log(const Json& draft) {
    const std::string data = RUMOR_DATA_DIR;
    const GameSettings settings = draft_settings(draft, false);
    GameWorld game = make_game_world(settings, data);
    const Vocab vocab = load_vocab(data, settings.lang);
    DraftRumors rumors = draft_rumors(draft, settings, game.scenario, game.population, vocab);
    REQUIRE(rumors.errors.empty());
    fit_end(game.scenario, rumors.last_needed, settings.until);
    struct AtTheirTick : RunControl {
        const std::vector<GameRumor>& rumors;
        explicit AtTheirTick(const std::vector<GameRumor>& r) : rumors(r) {}
        TickOrders before_tick(Tick t) override {
            TickOrders orders;
            for (const GameRumor& r : rumors) {
                if (r.at == t) orders.injections.push_back(r.injection);
            }
            return orders;
        }
    } control(rumors.rumors);
    std::ostringstream out;
    RunSink sink;
    sink.header = [&](const LogHeader& h) { out << write_header(h) << '\n'; };
    sink.event = [&](const Event& e) { out << write_event(e) << '\n'; };
    const std::unique_ptr<Policy> policy = make_baseline_policy();
    run_simulation(game.scenario, load_world(data), game.population, vocab, *policy, game.seed, sink,
                   &control);
    return out.str();
}

// The download of the model inside the game as the launcher drives it
// (launcher/download.h), with its state set by the test.
struct FakeDownload {
    std::mutex mutex;
    std::string state = "idle";
    int starts = 0;

    PlayDownload hook() {
        PlayDownload d;
        d.status = [this] {
            const std::lock_guard lock(mutex);
            return Json{{"state", state}, {"bytes", 5},       {"total", 10},
                        {"reason", nullptr}, {"folder", "/m"}, {"file", "m.gguf"}};
        };
        d.start = [this]() -> std::optional<std::string> {
            const std::lock_guard lock(mutex);
            if (state == "running") return std::nullopt;
            if (state != "idle" && state != "failed") return "the download is " + state;
            state = "running";
            ++starts;
            return std::nullopt;
        };
        d.activate = [this]() -> std::optional<std::string> {
            const std::lock_guard lock(mutex);
            if (state != "ready") return "not ready";
            state = "activating";
            return std::nullopt;
        };
        return d;
    }
    void set(const std::string& s) {
        const std::lock_guard lock(mutex);
        state = s;
    }
};

}  // namespace

TEST_SUITE("server") {

TEST_CASE("play: waiting, playing, ended and back to waiting") {
    Play play("states", 1);  // one tick per second: the game is seen playing
    Json state = play.get("/state");
    CHECK(state["state"] == "waiting");
    CHECK(state["game"].is_null());
    CHECK(state["ai"] == Json::parse(R"({"available":false,"reason":"no_model"})"));
    CHECK(state["check"] ==
          Json::parse(R"({"state":"skipped","decisions_per_s":null,"advice":null})"));
    CHECK(state["draft"]["settings"]["mode"] == "rules");
    CHECK(state["draft"]["rumors"] == Json::array());
    REQUIRE(state["challenges"].is_array());
    REQUIRE(!state["challenges"].empty());
    bool fill = false;
    for (std::size_t i = 0; i < state["challenges"].size(); ++i) {
        const Json& c = state["challenges"][i];
        fill = fill || c["id"] == "fill-the-square";
        if (i > 0) CHECK(state["challenges"][i - 1]["order"] <= c["order"]);  // by "order"
    }
    CHECK(fill);
    const std::string waiting_run = state["run"];
    CHECK(play.get("/control")["run"] == waiting_run);
    CHECK(play.get("/control")["extract"] == false);

    // Waiting: no game to stop, no /inject, no model for /extract.
    CHECK(play.post("/stop", "")->status == 409);
    CHECK(play.post("/inject", R"({"fact":{"what":"fiesta"},"to":{"place":"bar"}})")->status == 409);
    CHECK(play.post("/extract", R"({"text":"hay fiesta"})")->status == 501);
    CHECK(play.post("/viewport", R"({"neighbors":["n001"]})")->status == 204);

    // Start: a new run, playing.
    httplib::Result res = play.post("/start", draft_with(kRumor));
    REQUIRE(res);
    REQUIRE(res->status == 200);
    const std::string id = body_of(res)["game"]["id"];
    CHECK(valid_game_id(id));
    CHECK(id.find("-rules-t7") != std::string::npos);
    state = play.get("/state");
    CHECK(state["state"] == "playing");
    CHECK(state["game"]["id"] == id);
    CHECK(state["run"] != waiting_run);
    CHECK(state["draft"]["settings"]["town"] == 7);
    CHECK(play.post("/start", draft_with(kRumor))->status == 409);
    CHECK(play.post("/preview", draft_with(kRumor))->status == 409);
    CHECK(play.post("/extract", R"({"text":"hay fiesta"})")->status == 501);

    // Full speed, to the end.
    CHECK(play.post("/control", R"({"speed":"max"})")->status == 200);
    play.wait_state("ended");
    const std::string game_run = play.run_id();
    CHECK(play.post("/stop", "")->status == 409);
    CHECK(play.post("/start", draft_with(kRumor))->status == 409);

    // Its three files.
    const std::vector<std::string> log = lines_of(slurp(play.out / (id + ".jsonl")));
    REQUIRE(log.size() > 100);
    CHECK(Json::parse(log.front())["type"] == "header");
    CHECK(Json::parse(log.back())["type"] == "end");
    const Json game = Json::parse(slurp(play.out / (id + ".game.json")));
    CHECK(game["format"] == 1);
    CHECK(game["id"] == id);
    CHECK(game["game_version"] == 1);
    CHECK(game["started"].is_string());
    CHECK(game["ended"].is_string());
    CHECK(game["stopped"] == false);
    CHECK(game["end_tick"] == Json::parse(log.back())["tick"]);
    CHECK(game["settings"]["mode"] == "rules");
    CHECK(game["rumors"].size() == 1);
    CHECK(game["bets"]["attend"] == 12);
    CHECK(game["challenge"].is_null());
    CHECK(!lines_of(slurp(play.out / (id + ".cards.jsonl"))).empty());

    // Reset: waiting again, a new run, the draft kept; clear empties it.
    res = play.post("/reset", "");
    REQUIRE(res);
    CHECK(res->status == 200);
    state = play.get("/state");
    CHECK(state["state"] == "waiting");
    CHECK(state["run"] != game_run);
    CHECK(state["game"].is_null());
    CHECK(state["draft"]["rumors"].size() == 1);
    CHECK(play.post("/reset", R"({"clear":true})")->status == 200);
    CHECK(play.get("/state")["draft"]["rumors"] == Json::array());
    CHECK(play.post("/reset", R"({"clear":3})")->status == 400);
}

TEST_CASE("play: only its own page may use it") {
    Play play("origin");
    const std::string port = std::to_string(play.port);
    const auto status = [&](const char* method, const std::string& path, httplib::Headers headers) {
        const httplib::Result res = std::string(method) == "GET"
                                        ? play.client.Get(path, headers)
                                        : play.client.Post(path, headers, draft_with(kRumor),
                                                           "application/json");
        REQUIRE(res);
        return res->status;
    };
    CHECK(status("POST", "/start", {{"Origin", "http://example.org"}}) == 403);
    CHECK(status("GET", "/state", {{"Origin", "http://example.org"}}) == 403);
    CHECK(status("GET", "/state", {{"Origin", "http://127.0.0.1:1"}}) == 403);
    CHECK(status("GET", "/state", {{"Host", "example.org:" + port}}) == 403);
    CHECK(status("GET", "/state", {{"Host", "127.0.0.1"}}) == 403);
    CHECK(status("GET", "/events", {{"Host", "evil.test:" + port}}) == 403);
    CHECK(play.get("/state")["state"] == "waiting");  // nothing started

    CHECK(status("GET", "/state", {}) == 200);  // no Origin: curl
    CHECK(status("GET", "/state", {{"Origin", "http://127.0.0.1:" + port}}) == 200);
    CHECK(status("GET", "/state", {{"Origin", "http://localhost:" + port}}) == 200);
    CHECK(status("GET", "/state", {{"Host", "localhost:" + port}}) == 200);
}

TEST_CASE("play: /preview keeps the draft, writes nothing and changes the run with the village") {
    Play play("preview");
    const std::set<std::string> before = listing(play.out);
    const std::string run = play.run_id();

    // Only the mode and the distortion change: the same village.
    httplib::Result res =
        play.post("/preview", draft_with(kRumor, R"({"town":1,"distortion":"high","mode":"rules"})"));
    REQUIRE(res);
    REQUIRE(res->status == 200);
    Json answer = body_of(res);
    CHECK(answer["town_changed"] == false);
    CHECK(answer["header"]["type"] == "header");
    CHECK(answer["header"]["seed"] == 1);
    CHECK(play.run_id() == run);
    Json draft = play.get("/state")["draft"];
    CHECK(draft["settings"]["distortion"] == "high");
    CHECK(draft["rumors"].size() == 1);

    // Another town: another village and another run, whose stream starts
    // with its header.
    res = play.post("/preview", draft_with(kRumor, R"({"town":417})"));
    REQUIRE(res);
    answer = body_of(res);
    CHECK(answer["town_changed"] == true);
    CHECK(answer["header"]["seed"] == 417);
    CHECK(play.run_id() != run);
    CHECK(answer["header"]["neighbors"].size() == 25);
    res = play.post("/preview", draft_with("", R"({"type":"telephone"})"));
    REQUIRE(res);
    CHECK(body_of(res)["town_changed"] == true);
    CHECK(body_of(res)["header"]["neighbors"].size() == 20);

    CHECK(play.post("/preview", R"({"settings":{"neighbors":30}})")->status == 400);
    CHECK(play.post("/preview", R"({"settings":{},"rumors":3})")->status == 400);
    CHECK(play.post("/preview", "[]")->status == 400);
    CHECK(listing(play.out) == before);
}

TEST_CASE("play: the stream of a replaced run ends, after its header") {
    Play play("stream");
    auto stream = std::async(std::launch::async, [port = play.port] {
        httplib::Client client("127.0.0.1", port);
        client.set_read_timeout(20, 0);
        std::string text;
        client.Get("/events", [&](const char* data, std::size_t len) {
            text.append(data, len);
            return true;
        });
        return text;
    });
    std::this_thread::sleep_for(300ms);
    CHECK(stream.wait_for(0ms) == std::future_status::timeout);
    REQUIRE(play.post("/reset", "")->status == 200);
    REQUIRE(stream.wait_for(10s) == std::future_status::ready);
    const std::string text = stream.get();
    CHECK(text.rfind("id: 1\ndata: {\"type\":\"header\"", 0) == 0);
    CHECK(text.find("id: 2") == std::string::npos);
}

TEST_CASE("play: /start says what is wrong with the draft") {
    Play play("errors");
    const auto errors = [&](const std::string& draft) {
        const httplib::Result res = play.post("/start", draft);
        REQUIRE(res);
        CHECK(res->status == 400);
        return body_of(res)["errors"];
    };
    CHECK(errors(draft_with("")) ==
          Json::parse(R"([{"rumor":null,"field":"rumors","error":"empty"}])"));
    CHECK(errors(draft_with(std::string(kRumor) + "," + kRumor, R"({"type":"telephone"})")) ==
          Json::parse(R"([{"rumor":null,"field":"rumors","error":"too_many"}])"));
    CHECK(errors(draft_with(kRumor, R"({"mode":"ai"})")) ==
          Json::parse(R"([{"rumor":null,"field":"mode","error":"no_model"}])"));
    CHECK(errors(draft_with(kRumor, R"({"neighbors":7})"))[0]["field"] == "settings");

    const std::string unknown_who =
        R"({"fact":{"what":"party","who":"Nadie"},"to":{"place":"square"},"at":"start"})";
    CHECK(errors(draft_with(std::string(kRumor) + "," + unknown_who)) ==
          Json::parse(R"([{"rumor":1,"field":"who","error":"unknown"}])"));
    CHECK(errors(draft_with(R"({"fact":{"what":"party"},"to":{"place":"luna"}})"))[0]["field"] == "to");
    CHECK(errors(draft_with(R"({"fact":{"what":"party"},"to":{"place":"bar"},"at":"03:00"})")) ==
          Json::parse(R"([{"rumor":0,"field":"at","error":"out_of_range"}])"));
    CHECK(errors(draft_with(R"({"fact":{"what":"party"},"to":{"place":"bar"},"at":"9h"})"))[0]["error"] ==
          "invalid");
    CHECK(errors(draft_with(R"({"fact":{"what":"party","when":"ayer 10:00"},"to":{"place":"bar"}})"))[0]["field"] ==
          "fact");
    CHECK(play.get("/state")["state"] == "waiting");
    CHECK(fs::is_empty(play.out));
}

TEST_CASE("play: a rumor's hour, its receivers and the telephone row") {
    const std::string data = RUMOR_DATA_DIR;
    const Vocab vocab = load_vocab(data, Lang::es);

    // In the village: by identifier, key or name; at an hour of day 0; "when"
    // read against day 0, and "tomorrow" stretches the game.
    Json draft = Json::parse(draft_with(
        R"({"fact":{"what":"wedding","who":"n003","where":"p01","when":"mañana 10:30"},"to":{"neighbors":["n010","n010","n011"]},"at":"12:00"},)"
        R"({"fact":{"what":"party","where":"square","when":"today 21:00"},"to":{"place":"church"}})"));
    GameSettings settings = draft_settings(draft, false);
    GameWorld game = make_game_world(settings, data);
    DraftRumors rumors = draft_rumors(draft, settings, game.scenario, game.population, vocab);
    REQUIRE(rumors.errors.empty());
    REQUIRE(rumors.rumors.size() == 2);
    const GameRumor& a = rumors.rumors[0];
    CHECK(a.at == 12 * kTicksPerHour);
    CHECK(a.injection.fact.to == std::vector<NeighborId>{NeighborId(10), NeighborId(11)});
    CHECK(!a.injection.place);
    CHECK(a.injection.fact.slots[idx(Slot::who)] == 3);
    CHECK(a.injection.fact.slots[idx(Slot::where)] == 1);
    CHECK(a.injection.fact.slots[idx(Slot::when)] == kSlotsPerDay + 21);
    const GameRumor& b = rumors.rumors[1];
    CHECK(b.at == game.scenario.start_tick);
    REQUIRE(b.injection.place);
    CHECK(b.injection.fact.slots[idx(Slot::when)] == 42);
    CHECK(rumors.last_needed == tick_of(kSlotsPerDay + 21));
    const Tick end = game.scenario.end_tick;
    fit_end(game.scenario, rumors.last_needed, settings.until);
    CHECK(game.scenario.end_tick > tick_of(kSlotsPerDay + 21));
    CHECK(game.scenario.end_tick > end);

    // In the telephone game: to the first of the row, at the start.
    draft = Json::parse(draft_with(
        R"({"fact":{"what":"party","where":"square"},"to":{"place":"bar"},"at":"15:00"})",
        R"({"type":"telephone"})"));
    settings = draft_settings(draft, false);
    game = make_game_world(settings, data);
    rumors = draft_rumors(draft, settings, game.scenario, game.population, vocab);
    REQUIRE(rumors.errors.empty());
    REQUIRE(rumors.rumors.size() == 1);
    CHECK(rumors.rumors[0].at == game.scenario.start_tick);
    CHECK(rumors.rumors[0].injection.fact.to == std::vector<NeighborId>{NeighborId(1)});
    CHECK(!rumors.rumors[0].injection.place);
}

TEST_CASE("play: /stop ends the game with its end event") {
    Play play("stop", 5);
    httplib::Result res = play.post("/start", draft_with(kRumor));
    REQUIRE(res);
    REQUIRE(res->status == 200);
    const std::string id = body_of(res)["game"]["id"];
    std::this_thread::sleep_for(700ms);
    res = play.post("/stop", "");
    REQUIRE(res);
    CHECK(res->status == 200);
    CHECK(play.get("/state")["state"] == "ended");
    const std::vector<std::string> log = lines_of(slurp(play.out / (id + ".jsonl")));
    REQUIRE(log.size() >= 2);
    const Json end = Json::parse(log.back());
    CHECK(end["type"] == "end");
    const Json game = Json::parse(slurp(play.out / (id + ".game.json")));
    CHECK(game["stopped"] == true);
    CHECK(game["end_tick"] == end["tick"]);
    CHECK(end["tick"].get<int>() < 8 * kTicksPerHour);

    // A reset during a game stops it the same way.
    REQUIRE(play.post("/reset", "")->status == 200);
    res = play.post("/start", draft_with(kRumor));
    REQUIRE(res);
    const std::string second = body_of(res)["game"]["id"];
    CHECK(second != id);
    REQUIRE(play.post("/reset", "")->status == 200);
    CHECK(play.get("/state")["state"] == "waiting");
    CHECK(Json::parse(lines_of(slurp(play.out / (second + ".jsonl"))).back())["type"] == "end");
}

TEST_CASE("play: GET /games, the files of a game and GET /card") {
    Play play("games");
    CHECK(play.get("/games") == Json::parse(R"({"games":[]})"));
    std::vector<std::string> ids;
    for (const char* town : {R"({"town":3})", R"({"town":4})"}) {
        REQUIRE(play.post("/reset", "")->status == 200);
        httplib::Result res = play.post("/start", draft_with(kRumor, town));
        REQUIRE(res);
        REQUIRE(res->status == 200);
        ids.push_back(body_of(res)["game"]["id"]);
        play.wait_state("ended");
    }
    const Json games = play.get("/games")["games"];
    REQUIRE(games.size() == 2);
    CHECK(games[0]["id"] == ids[1]);  // newest first
    CHECK(games[1]["id"] == ids[0]);
    CHECK(games[0]["settings"]["town"] == 4);

    httplib::Result res = play.client.Get("/games/" + ids[0] + ".jsonl");
    REQUIRE(res);
    CHECK(res->status == 200);
    const std::string log_text = slurp(play.out / (ids[0] + ".jsonl"));
    CHECK(res->body == log_text);
    CHECK(play.get("/games/" + ids[0] + ".game.json")["id"] == ids[0]);
    for (const std::string& bad : std::vector<std::string>{"/games/nope.jsonl", "/games/" + ids[0] + ".cards.jsonl",
                                  "/games/..%2F" + ids[0] + ".jsonl", "/games/20260101-000000-rules-t9.jsonl"}) {
        CAPTURE(bad);
        res = play.client.Get(bad);
        REQUIRE(res);
        CHECK(res->status == 404);
    }

    // Every turn of the first game has its card, with the rule that gave its act.
    int checked = 0;
    for (const std::string& line : lines_of(log_text)) {
        const Json e = Json::parse(line);
        if (e["type"] != "turn" || checked >= 200) continue;
        const std::optional<Json> card =
            find_card((play.out / (ids[0] + ".cards.jsonl")).string(), e["tick"].get<Tick>(),
                      e["who"].get<std::string>(), std::string("turn"));
        REQUIRE(card);
        CHECK(card->at("card").is_null());
        const std::string rule = card->at("rule").at("rule");
        const std::string act = e["act"].is_null() ? "none" : e["act"].get<std::string>();
        if (rule == "greet_first" || rule == "greet_back") CHECK(act == "greet");
        else if (rule == "bye") CHECK(act == "bye");
        else CHECK(act == "tell");
        ++checked;
    }
    CHECK(checked > 10);

    // Over HTTP: by game, or the current one.
    Json turn;
    for (const std::string& line : lines_of(slurp(play.out / (ids[1] + ".jsonl")))) {
        turn = Json::parse(line);
        if (turn["type"] == "turn") break;
    }
    REQUIRE(turn["type"] == "turn");
    const std::string query =
        "tick=" + std::to_string(turn["tick"].get<int>()) + "&who=" + turn["who"].get<std::string>();
    Json card = play.get("/card?" + query);  // the current game: ids[1]
    CHECK(card["tick"] == turn["tick"]);
    CHECK(card["who"] == turn["who"]);
    CHECK(card["kind"] == "turn");
    CHECK(card["policy"] == "baseline");
    CHECK(card["card"].is_null());
    CHECK(card["rule"]["rule"].is_string());
    CHECK(card["rule"]["rolls"].is_array());
    CHECK(play.get("/card?game=" + ids[1] + "&" + query) == card);
    for (const std::string& bad : std::vector<std::string>{"/card?game=" + ids[1] + "&tick=1&who=n001",
                                  "/card?game=nope&" + query}) {
        res = play.client.Get(bad);
        REQUIRE(res);
        CHECK(res->status == 404);
    }
    res = play.client.Get("/card?game=" + ids[1] + "&tick=x&who=n001");
    REQUIRE(res);
    CHECK(res->status == 400);
}

TEST_CASE("play: the profile, whole and atomic") {
    Play play("profile");
    CHECK(play.get("/profile") == Json::parse(R"({"format":1})"));
    const std::string profile =
        R"({"format":1,"tutorial_seen":true,"stars":{"fill-the-square":{"ai":0,"rules":2}},"games":{}})";
    httplib::Result res = play.post("/profile", profile);
    REQUIRE(res);
    CHECK(res->status == 200);
    CHECK(play.get("/profile") == Json::parse(profile));
    CHECK(Json::parse(slurp(play.out / "profile.json")) == Json::parse(profile));

    for (const char* bad : {"[1,2]", "not json", "3"}) {
        res = play.post("/profile", bad);
        REQUIRE(res);
        CHECK(res->status == 400);
    }
    std::string big = R"({"format":1,"pad":")" + std::string(1 << 20, 'x') + R"("})";
    res = play.post("/profile", big);
    REQUIRE(res);
    CHECK(res->status == 400);
    CHECK(play.get("/profile") == Json::parse(profile));
    CHECK(!fs::exists(play.out / "profile.json.tmp"));
}

TEST_CASE("play: GET /timetable gives where each job is at each hour") {
    Play play("timetable");
    const Json timetable = play.get("/timetable");
    REQUIRE(timetable.contains("jobs"));
    CHECK(timetable["jobs"]["bartender"].size() == 24);
    CHECK(timetable["jobs"]["bartender"][12] == "bar");
}

TEST_CASE("live run: after a quiet tick the next one comes at quiet_speed") {
    const Vocab vocab = load_vocab(RUMOR_DATA_DIR, Lang::es);
    const Population population = make_population(RUMOR_DATA_DIR, 25, Layout::village, 1);
    const auto gap = [](LiveRun& run, bool quiet) {
        run.after_tick(600, quiet);
        const auto t0 = std::chrono::steady_clock::now();
        run.before_tick(601);
        return std::chrono::steady_clock::now() - t0;
    };
    LiveOptions options;
    options.speed = 2;  // 500 ms
    options.quiet_speed = 50;  // 20 ms
    LiveRun run(options, vocab, population, nullptr);
    run.before_tick(600);
    CHECK(gap(run, true) < 250ms);
    CHECK(gap(run, false) > 350ms);
    CHECK(gap(run, true) < 250ms);

    options.quiet_speed = 0;  // off, as in `rumor run --serve`
    LiveRun plain(options, vocab, population, nullptr);
    plain.before_tick(600);
    CHECK(gap(plain, true) > 350ms);
}

TEST_CASE("live run: a reading hold delays the next tick, only once") {
    const Vocab vocab = load_vocab(RUMOR_DATA_DIR, Lang::es);
    const Population population = make_population(RUMOR_DATA_DIR, 25, Layout::village, 1);
    LiveOptions options;
    options.speed = 100;  // 10 ms
    LiveRun run(options, vocab, population, nullptr);
    run.before_tick(600);
    run.hold(300);
    auto t0 = std::chrono::steady_clock::now();
    run.before_tick(601);
    CHECK(std::chrono::steady_clock::now() - t0 > 250ms);
    t0 = std::chrono::steady_clock::now();
    run.before_tick(602);
    CHECK(std::chrono::steady_clock::now() - t0 < 150ms);
}

TEST_CASE("play: POST /quit") {
    Play play("quit");
    auto quit = std::async(std::launch::async, [&] { play.server.wait_quit(); });
    CHECK(quit.wait_for(200ms) == std::future_status::timeout);
    httplib::Result res = play.post("/quit", "");
    REQUIRE(res);
    CHECK(res->status == 200);
    CHECK(quit.wait_for(5s) == std::future_status::ready);
}

TEST_CASE("play: without the download of the launcher there is no ai.download nor its routes") {
    Play play("no-download");
    CHECK_FALSE(play.get("/state")["ai"].contains("download"));
    CHECK(play.post("/ai/download", "{}")->status == 404);
    CHECK(play.post("/ai/activate", "{}")->status == 404);
    CHECK_FALSE(play.server.activate_requested());
}

TEST_CASE("play: the download of the model inside the game, and its activation") {
    FakeDownload fake;
    Play play("download", 1, fake.hook());  // one tick per second: a game is seen playing
    Json state = play.get("/state");
    CHECK(state["ai"]["available"] == false);
    CHECK(state["ai"]["reason"] == "no_model");
    CHECK(state["ai"]["download"] ==
          Json::parse(R"({"state":"idle","bytes":5,"total":10,"reason":null,"folder":"/m","file":"m.gguf"})"));

    // POST /ai/download: from idle it starts; running, nothing more.
    httplib::Result res = play.post("/ai/download", "{}");
    REQUIRE(res);
    CHECK(res->status == 200);
    CHECK(body_of(res)["download"]["state"] == "running");
    CHECK(play.post("/ai/download", "{}")->status == 200);
    CHECK(fake.starts == 1);
    CHECK(play.get("/state")["ai"]["download"]["state"] == "running");
    for (const char* s : {"unavailable", "checking", "ready", "activating"}) {
        fake.set(s);
        res = play.post("/ai/download", "{}");
        REQUIRE(res);
        CHECK(res->status == 409);
        CHECK(body_of(res)["error"].is_string());
    }
    fake.set("failed");
    CHECK(play.post("/ai/download", "{}")->status == 200);
    CHECK(fake.starts == 2);

    // Only this page may drive it.
    CHECK(play.client.Post("/ai/download", {{"Origin", "http://example.org"}}, "{}", "application/json")->status ==
          403);
    CHECK(play.client.Post("/ai/activate", {{"Origin", "http://example.org"}}, "{}", "application/json")->status ==
          403);

    // POST /ai/activate: only when ready, and not in a game.
    res = play.post("/ai/activate", "{}");
    REQUIRE(res);
    CHECK(res->status == 409);
    fake.set("ready");
    REQUIRE(play.post("/start", draft_with(kRumor))->status == 200);
    CHECK(play.post("/ai/activate", "{}")->status == 409);
    CHECK(play.get("/state")["ai"]["download"]["state"] == "ready");
    REQUIRE(play.post("/stop", "")->status == 200);

    auto quit = std::async(std::launch::async, [&] { play.server.wait_quit(); });
    CHECK(quit.wait_for(100ms) == std::future_status::timeout);
    CHECK_FALSE(play.server.activate_requested());
    res = play.post("/ai/activate", "{}");
    REQUIRE(res);
    CHECK(res->status == 200);
    CHECK(body_of(res) == Json::parse(R"({"activating":true})"));
    CHECK(quit.wait_for(5s) == std::future_status::ready);
    CHECK(play.server.activate_requested());
    CHECK(play.get("/state")["ai"]["download"]["state"] == "activating");
    CHECK(play.post("/start", draft_with(kRumor))->status == 503);  // the server is closing
}

TEST_CASE("play --once writes the three files and prints the id") {
    const fs::path out = fresh_dir("once");
    fs::create_directories(out);
    const fs::path draft = out / "draft.json";
    std::ofstream(draft) << draft_with(kRumor);
    const std::string data = RUMOR_DATA_DIR;
    std::vector<std::string> args = {"rumor", "play", "--once", draft.string(), "--data", data,
                                     "--out", out.string()};
    std::vector<char*> argv;
    for (std::string& a : args) argv.push_back(a.data());

    std::ostringstream printed;
    std::streambuf* old = std::cout.rdbuf(printed.rdbuf());
    const int code = play_command(static_cast<int>(argv.size()), argv.data());
    std::cout.rdbuf(old);
    CHECK(code == 0);
    const std::string id = printed.str().substr(0, printed.str().find('\n'));
    REQUIRE(valid_game_id(id));
    const std::string log = slurp(out / (id + ".jsonl"));
    CHECK(Json::parse(lines_of(log).back())["type"] == "end");
    CHECK(Json::parse(slurp(out / (id + ".game.json")))["ended"].is_string());
    CHECK(!lines_of(slurp(out / (id + ".cards.jsonl"))).empty());

    // The card recorder changed no byte: the same draft without the server
    // and without the recorder gives the same log.
    CHECK(log == plain_log(Json::parse(draft_with(kRumor))));

    // A draft that cannot be played: exit 1, nothing written.
    std::ofstream(draft) << draft_with("");
    const auto before = listing(out);
    CHECK(play_command(static_cast<int>(argv.size()), argv.data()) == 1);
    CHECK(listing(out) == before);
    fs::remove_all(out);
}

TEST_CASE("play: the card recorder changes no byte of the log, with several rumors") {
    const std::string draft = draft_with(
        std::string(kRumor) + "," +
            R"({"fact":{"what":"wedding","who":"n003","where":"church","when":"mañana 12:00"},"to":{"neighbors":["n010"]},"at":"12:00"})",
        R"({"town":11,"trait_mix":1,"distortion":"high"})");
    Play play("bytes");
    httplib::Result res = play.post("/start", draft);
    REQUIRE(res);
    REQUIRE(res->status == 200);
    const std::string id = body_of(res)["game"]["id"];
    play.server.wait_game();
    CHECK(slurp(play.out / (id + ".jsonl")) == plain_log(Json::parse(draft)));
}

}  // TEST_SUITE
