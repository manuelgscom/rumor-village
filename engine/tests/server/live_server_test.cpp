// The live server against an HTTP client of the same library, on an ephemeral
// port of 127.0.0.1: routes and codes, the SSE stream, the queue that
// before_tick hands over, pause and pace, and a whole party-25 run served live.
#include <doctest/doctest.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <future>
#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <process.h>  // _getpid
#define getpid _getpid
#else
#include <unistd.h>
#endif

#include <cpp-httplib/httplib.h>
#include <nlohmann/json.hpp>

#include "core/live_api.h"
#include "core/policy.h"
#include "core/population_api.h"
#include "core/sim_api.h"
#include "core/world_api.h"
#include "extract/extract.h"
#include "server/live_server.h"

using namespace rumor;
using Json = nlohmann::json;
using namespace std::chrono_literals;

namespace {

const Vocab& vocab_es() {
    static const Vocab v = load_vocab(RUMOR_DATA_DIR, Lang::es);
    return v;
}

const Population& people25() {
    static const Population p = make_population(RUMOR_DATA_DIR, 25, Layout::village, 1);
    return p;
}

LiveOptions max_speed() {
    LiveOptions o;
    o.speed = 0;
    return o;
}

// A started server and a client for it.
struct Live {
    LiveServer server;
    int port;
    httplib::Client client;

    explicit Live(const LiveOptions& options = max_speed(), Extractor* extractor = nullptr)
        : server(options, vocab_es(), people25(), extractor),
          port(server.start()),
          client("127.0.0.1", port) {
        client.set_read_timeout(10, 0);
    }

    httplib::Result post(const std::string& path, const std::string& body) {
        // As curl -d sends it: a form type, a JSON body.
        return client.Post(path, body, "application/x-www-form-urlencoded");
    }
};

struct SseEvent {
    std::string id;
    std::string data;
};

// Splits a stream into events, without the comments.
std::vector<SseEvent> parse_events(const std::string& stream) {
    std::vector<SseEvent> out;
    std::size_t pos = 0;
    for (;;) {
        const std::size_t end = stream.find("\n\n", pos);
        if (end == std::string::npos) break;
        const std::string block = stream.substr(pos, end - pos);
        pos = end + 2;
        if (block.rfind(':', 0) == 0) continue;  // a comment
        // Exactly "id: <n>\ndata: <line>"; anything else is kept whole, so
        // that the comparisons fail (this runs inside the client callback,
        // where a REQUIRE must not throw).
        const std::size_t nl = block.find('\n');
        if (nl == std::string::npos || block.rfind("id: ", 0) != 0 ||
            block.compare(nl + 1, 6, "data: ") != 0) {
            out.push_back({"?", block});
            continue;
        }
        out.push_back({block.substr(4, nl - 4), block.substr(nl + 7)});
    }
    return out;
}

// Reads /events until `done` says the stream so far is enough.
template <class Done>
std::string read_stream(int port, std::optional<std::string> last_id, Done done) {
    httplib::Client client("127.0.0.1", port);
    client.set_read_timeout(20, 0);
    httplib::Headers headers;
    if (last_id) headers.emplace("Last-Event-ID", *last_id);
    std::string stream;
    std::string content_type;
    client.Get(
        "/events", headers,
        [&](const httplib::Response& res) {
            content_type = res.get_header_value("Content-Type");
            CHECK(res.status == 200);
            CHECK(res.get_header_value("Cache-Control") == "no-cache");
            return true;
        },
        [&](const char* data, std::size_t len) {
            stream.append(data, len);
            return !done(stream);
        });
    CHECK(content_type.rfind("text/event-stream", 0) == 0);
    return stream;
}

std::string read_events(int port, std::size_t count, std::optional<std::string> last_id = {}) {
    return read_stream(port, std::move(last_id), [count](const std::string& s) {
        return parse_events(s).size() >= count;
    });
}

Json body_of(const httplib::Result& res) {
    REQUIRE(res);
    return Json::parse(res->body);
}

// An extractor that remembers the thread it ran on.
class FakeExtractor : public Extractor {
  public:
    Extracted extract(const std::string& text) override {
        thread = std::this_thread::get_id();
        seen = text;
        return validate_extracted(
            R"({"what":"fiesta","who":"Nadie","where":"plaza","when":"mañana 09:30","amount":null})",
            vocab_es(), people25());
    }
    std::thread::id thread;
    std::string seen;
};

const std::string kCriterion =
    R"({"fact":{"what":"fiesta","where":"plaza","when":"hoy 21:00"},"to":{"place":"bar"},"dryRun":true})";

}  // namespace

TEST_SUITE("server") {

TEST_CASE("GET and POST /control") {
    LiveOptions options;
    options.speed = 3;
    Live live(options);
    Json state = body_of(live.client.Get("/control"));
    REQUIRE(state.contains("run"));
    const Json run = state["run"];
    CHECK(run.is_string());
    CHECK(run.get<std::string>().size() == 16);
    state.erase("run");
    CHECK(state == Json::parse(
                       R"({"paused":false,"speed":3,"tick":null,"ended":false,"extract":false})"));
    // Another server, another run id; the same one in every answer of this one.
    {
        Live other(options);
        CHECK(body_of(other.client.Get("/control"))["run"] != run);
    }

    httplib::Result res = live.post("/control", R"({"action":"pause"})");
    REQUIRE(res);
    CHECK(res->status == 200);
    CHECK(body_of(res)["paused"] == true);

    res = live.client.Post("/control", R"({"speed":"max","action":"resume"})", "application/json");
    REQUIRE(res);
    CHECK(res->status == 200);
    state = body_of(res);
    CHECK(state["paused"] == false);
    CHECK(state["speed"] == "max");
    CHECK(body_of(live.post("/control", R"({"speed":7})"))["speed"] == 7);

    for (const char* bad : {"{", "[]", "{}", R"({"speed":0})", R"({"speed":-2})", R"({"speed":1.5})",
                            R"({"speed":"fast"})", R"({"action":"jump"})", R"({"other":1})"}) {
        CAPTURE(bad);
        res = live.post("/control", bad);
        REQUIRE(res);
        CHECK(res->status == 400);
        CHECK(body_of(res).contains("error"));
    }
    live.server.before_tick(480);
    live.server.finish();
    state = body_of(live.client.Get("/control"));
    CHECK(state["tick"] == 480);
    CHECK(state["ended"] == true);
    CHECK(state["run"] == run);
}

TEST_CASE("POST /inject with dryRun says what it understood and queues nothing") {
    Live live;
    httplib::Result res = live.post("/inject", kCriterion);
    REQUIRE(res);
    CHECK(res->status == 200);
    const Json answer = body_of(res);
    CHECK(answer["understood"] == "Entendido: fiesta · plaza · hoy 21:00");
    CHECK(answer["empty"] == Json::parse(R"(["who","amount"])"));
    CHECK_FALSE(answer.contains("queued"));
    CHECK(live.server.before_tick(480).injections.empty());
}

TEST_CASE("POST /inject queues for the next tick, once and in order") {
    Live live;
    const Neighbor& first = people25().neighbors[0];
    httplib::Result res = live.post(
        "/inject",
        R"({"fact":{"what":"Fiesta","where":"la plaza","when":"hoy 21:00","amount":50},"to":{"place":"bar"}})");
    REQUIRE(res);
    CHECK(res->status == 202);
    CHECK(body_of(res)["queued"] == true);
    res = live.post("/inject",
                    R"({"fact":{"what":"un perro suelto","who":")" + first.name +
                        R"(","when":"mañana 09:30"},"text":"Hay un perro suelto","to":{"neighbors":["n003",")" +
                        first.name + R"(","n003"]}})");
    REQUIRE(res);
    CHECK(res->status == 202);
    CHECK(body_of(res)["empty"] == Json::parse(R"(["where","amount"])"));
    res = live.post("/inject", R"({"fact":{"what":"multa"},"to":{"place":"barrio alto"}})");
    REQUIRE(res);
    CHECK(res->status == 202);

    const Tick t = kTicksPerDay + 600;  // day 1, 10:00: "today" is day 1
    const TickOrders orders = live.server.before_tick(t);
    REQUIRE(orders.injections.size() == 3);
    const LiveInjection& a = orders.injections[0];
    CHECK(a.fact.what == "party");  // a label of the vocabulary becomes its key
    CHECK_FALSE(a.fact.text);
    REQUIRE(a.place);
    CHECK(*a.place == PlaceId(2));
    CHECK(a.fact.slots[idx(Slot::where)] == std::optional<SlotValue>(1));
    CHECK(a.fact.slots[idx(Slot::when)] == std::optional<SlotValue>(kSlotsPerDay + 42));
    CHECK(a.fact.slots[idx(Slot::amount)] == std::optional<SlotValue>(50));
    CHECK_FALSE(a.fact.slots[idx(Slot::who)]);

    const LiveInjection& b = orders.injections[1];
    CHECK(b.fact.what == "un perro suelto");  // free text stays as it is
    CHECK(b.fact.text == std::optional<std::string>("Hay un perro suelto"));
    CHECK_FALSE(b.place);
    CHECK(b.fact.to == std::vector<NeighborId>{NeighborId(3), first.id});
    CHECK(b.fact.slots[idx(Slot::who)] == std::optional<SlotValue>(static_cast<SlotValue>(first.id.v)));
    CHECK(b.fact.slots[idx(Slot::when)] == std::optional<SlotValue>(2 * kSlotsPerDay + 19));

    const LiveInjection& c = orders.injections[2];
    CHECK(c.fact.what == "fine");
    REQUIRE(c.place);
    CHECK(*c.place == PlaceId(13));  // a quarter is a place too

    CHECK(live.server.before_tick(t + 1).injections.empty());
}

TEST_CASE("POST /inject rejects what does not exist or is not a fact") {
    Live live;
    const std::vector<std::string> bad = {
        "not json",
        R"({"to":{"place":"bar"}})",
        R"({"fact":{"what":"fiesta"}})",
        R"({"fact":{"what":"fiesta"},"to":{}})",
        R"({"fact":{"what":"fiesta"},"to":{"place":"luna"}})",
        R"({"fact":{"what":"fiesta"},"to":{"place":"p17"}})",
        R"({"fact":{"what":"fiesta"},"to":{"neighbors":[]}})",
        R"({"fact":{"what":"fiesta"},"to":{"neighbors":["n026"]}})",
        R"({"fact":{"what":"fiesta"},"to":{"neighbors":["Nadie"]}})",
        R"({"fact":{"what":"fiesta"},"to":{"place":"bar","neighbors":["n001"]}})",
        R"({"fact":{"what":"fiesta","where":"luna"},"to":{"place":"bar"}})",
        R"({"fact":{"what":"fiesta","where":"barrio alto"},"to":{"place":"bar"}})",
        R"({"fact":{"what":"fiesta","who":"Nadie"},"to":{"place":"bar"}})",
        R"({"fact":{"what":"fiesta","when":"ayer 21:00"},"to":{"place":"bar"}})",
        R"({"fact":{"what":"fiesta","amount":-1},"to":{"place":"bar"}})",
        R"({"fact":{"what":""},"to":{"place":"bar"}})",
        R"({"fact":{"what":"fiesta","color":"rojo"},"to":{"place":"bar"}})",
        R"({"fact":{"what":"fiesta"},"to":{"place":"bar"},"dryRun":"yes"})",
        R"({"fact":{"what":"fiesta"},"to":{"place":"bar"},"text":3})",
        R"({"fact":{"what":"fiesta"},"to":{"place":"bar"},"later":true})",
    };
    for (const std::string& body : bad) {
        CAPTURE(body);
        const httplib::Result res = live.post("/inject", body);
        REQUIRE(res);
        CHECK(res->status == 400);
        CHECK(body_of(res).contains("error"));
    }
    CHECK(live.server.before_tick(480).injections.empty());

    // By key and by identifier, the place is found too.
    for (const char* place : {"square", "p01", "Plaza"}) {
        CAPTURE(place);
        const httplib::Result res = live.post(
            "/inject", std::string(R"({"fact":{"what":"fiesta"},"to":{"place":")") + place + R"("}})");
        REQUIRE(res);
        CHECK(res->status == 202);
    }

    live.server.finish();
    httplib::Result res = live.post("/inject", R"({"fact":{"what":"fiesta"},"to":{"place":"bar"}})");
    REQUIRE(res);
    CHECK(res->status == 409);
    res = live.post("/inject", kCriterion);  // a dry run still answers
    REQUIRE(res);
    CHECK(res->status == 200);
}

TEST_CASE("POST /extract without an extractor is 501") {
    Live live;
    const httplib::Result res = live.post("/extract", R"({"text":"fiesta"})");
    REQUIRE(res);
    CHECK(res->status == 501);
}

TEST_CASE("POST /extract runs on the simulation thread") {
    FakeExtractor fake;
    LiveOptions options = max_speed();
    options.paused = true;  // before_tick waits and serves the task meanwhile
    Live live(options, &fake);
    CHECK(body_of(live.client.Get("/control"))["extract"] == true);

    std::atomic<bool> running{true};
    std::thread::id sim_thread;
    std::thread sim([&] {
        sim_thread = std::this_thread::get_id();
        const TickOrders orders = live.server.before_tick(480);
        CHECK(orders.stop);
        running = false;
    });
    httplib::Result res = live.post("/extract", R"({"text":"mañana fiesta en la plaza"})");
    REQUIRE(res);
    CHECK(res->status == 200);
    const Json answer = body_of(res);
    CHECK(answer["fact"] == Json::parse(
                                R"({"what":"fiesta","who":null,"where":"plaza","when":"mañana 09:30","amount":null})"));
    CHECK(answer["understood"] ==
          "Entendido: fiesta · Nadie (vecino desconocido) · plaza · mañana 09:30");
    CHECK(answer["empty"] == Json::parse(R"(["who","amount"])"));
    CHECK(answer["unknown"] == Json::parse(R"({"who":"Nadie"})"));
    CHECK(fake.seen == "mañana fiesta en la plaza");

    res = live.post("/extract", R"({"words":"x"})");
    REQUIRE(res);
    CHECK(res->status == 400);

    live.server.stop();
    sim.join();
    CHECK(fake.thread == sim_thread);
}

TEST_CASE("POST /extract: 503 when the simulation does not answer, 409 after the end") {
    FakeExtractor fake;
    LiveOptions options = max_speed();
    options.extract_timeout = 200ms;
    Live live(options, &fake);
    httplib::Result res = live.post("/extract", R"({"text":"fiesta"})");
    REQUIRE(res);
    CHECK(res->status == 503);
    live.server.before_tick(480);  // the withdrawn task is not run
    CHECK(fake.seen.empty());

    live.server.finish();
    res = live.post("/extract", R"({"text":"fiesta"})");
    REQUIRE(res);
    CHECK(res->status == 409);
}

TEST_CASE("pause holds before_tick until resume, and stop releases it") {
    LiveOptions options = max_speed();
    options.paused = true;
    Live live(options);

    std::atomic<bool> passed{false};
    std::thread sim([&] {
        CHECK_FALSE(live.server.before_tick(480).stop);
        passed = true;
    });
    std::this_thread::sleep_for(150ms);
    CHECK_FALSE(passed);
    REQUIRE(live.post("/control", R"({"action":"resume"})"));
    sim.join();
    CHECK(passed);

    REQUIRE(live.post("/control", R"({"action":"pause"})"));
    auto stopped = std::async(std::launch::async, [&] { return live.server.before_tick(481).stop; });
    CHECK(stopped.wait_for(100ms) == std::future_status::timeout);
    live.server.stop();
    CHECK(stopped.get());
    CHECK(live.server.before_tick(482).stop);
}

TEST_CASE("a change of speed wakes a waiting tick") {
    LiveOptions options;
    options.speed = 1;
    Live live(options);
    live.server.before_tick(480);
    const auto start = std::chrono::steady_clock::now();
    auto next = std::async(std::launch::async, [&] { return live.server.before_tick(481); });
    std::this_thread::sleep_for(100ms);
    REQUIRE(live.post("/control", R"({"speed":"max"})"));
    next.get();
    CHECK(std::chrono::steady_clock::now() - start < 800ms);
}

TEST_CASE("the pace is about `speed` ticks per second") {
    LiveOptions options;
    options.speed = 20;
    Live live(options);
    live.server.before_tick(480);
    const auto start = std::chrono::steady_clock::now();
    for (Tick t = 481; t <= 490; ++t) live.server.before_tick(t);
    const auto elapsed = std::chrono::steady_clock::now() - start;
    CHECK(elapsed >= 450ms);  // 10 ticks at 20 per second: 500 ms
    CHECK(elapsed < 2s);
}

TEST_CASE("POST /viewport reaches before_tick once, when it changes") {
    Live live;
    httplib::Result res = live.post("/viewport", R"({"neighbors":["n003","n001","n003"]})");
    REQUIRE(res);
    CHECK(res->status == 204);
    TickOrders orders = live.server.before_tick(480);
    REQUIRE(orders.visible);
    CHECK(*orders.visible == std::vector<NeighborId>{NeighborId(1), NeighborId(3)});
    CHECK_FALSE(live.server.before_tick(481).visible);

    REQUIRE(live.post("/viewport", R"({"neighbors":["n001","n003"]})"));  // the same
    CHECK_FALSE(live.server.before_tick(482).visible);
    REQUIRE(live.post("/viewport", R"({"neighbors":[]})"));
    orders = live.server.before_tick(483);
    REQUIRE(orders.visible);
    CHECK(orders.visible->empty());

    for (const char* bad : {R"({"neighbors":["n026"]})", R"({"neighbors":["x"]})",
                            R"({"neighbors":[1]})", R"({"who":[]})", "nope"}) {
        CAPTURE(bad);
        res = live.post("/viewport", bad);
        REQUIRE(res);
        CHECK(res->status == 400);
    }
    CHECK_FALSE(live.server.before_tick(484).visible);
}

TEST_CASE("static files of the viewer at /") {
    const std::filesystem::path dir =
        std::filesystem::temp_directory_path() / ("rumor-viewer-" + std::to_string(::getpid()));
    std::filesystem::create_directories(dir / "js");
    std::ofstream(dir / "index.html") << "<p>pueblo</p>";
    std::ofstream(dir / "js" / "app.js") << "let x = 1;";
    {
        LiveOptions options = max_speed();
        options.viewer_dir = dir.string();
        Live live(options);
        httplib::Result res = live.client.Get("/js/app.js");
        REQUIRE(res);
        CHECK(res->status == 200);
        CHECK(res->body == "let x = 1;");
        res = live.client.Get("/");
        REQUIRE(res);
        CHECK(res->status == 200);
        CHECK(res->body == "<p>pueblo</p>");
        // The routes still answer under the mount point.
        CHECK(body_of(live.client.Get("/control")).contains("paused"));
        res = live.client.Get("/missing.js");
        REQUIRE(res);
        CHECK(res->status == 404);
    }
    std::filesystem::remove_all(dir);

    LiveOptions options = max_speed();
    options.viewer_dir = (dir / "none").string();
    LiveServer server(options, vocab_es(), people25(), nullptr);
    CHECK_THROWS_AS(server.start(), std::runtime_error);
}

TEST_CASE("SSE: the published lines, in order, with their line number") {
    Live live;
    const std::vector<std::string> lines = {R"({"type":"header","x":"plaza río ñ"})",
                                            R"({"type":"a","tick":480})",
                                            R"({"type":"b","text":"\"hola\""})"};

    SUBCASE("a client that connects before any line") {
        auto early = std::async(std::launch::async, [&] { return read_events(live.port, 3); });
        std::this_thread::sleep_for(150ms);
        for (const std::string& line : lines) live.server.publish(line);
        const std::vector<SseEvent> events = parse_events(early.get());
        REQUIRE(events.size() == 3);
        for (std::size_t i = 0; i < 3; ++i) {
            CHECK(events[i].id == std::to_string(i + 1));
            CHECK(events[i].data == lines[i]);
        }
    }
    SUBCASE("a late client gets everything, then the new lines") {
        live.server.publish(lines[0]);
        live.server.publish(lines[1]);
        auto late = std::async(std::launch::async, [&] { return read_events(live.port, 3); });
        std::this_thread::sleep_for(150ms);
        live.server.publish(lines[2]);
        const std::string stream = late.get();
        CHECK(stream == "id: 1\ndata: " + lines[0] + "\n\nid: 2\ndata: " + lines[1] +
                            "\n\nid: 3\ndata: " + lines[2] + "\n\n");
    }
    SUBCASE("Last-Event-ID resumes after that line") {
        for (const std::string& line : lines) live.server.publish(line);
        const std::vector<SseEvent> events = parse_events(read_events(live.port, 1, "2"));
        REQUIRE(events.size() == 1);
        CHECK(events[0].id == "3");
        CHECK(events[0].data == lines[2]);
    }
    SUBCASE("streams close on stop") {
        live.server.publish(lines[0]);
        auto open = std::async(std::launch::async,
                               [&] { return read_stream(live.port, {}, [](const std::string&) { return false; }); });
        std::this_thread::sleep_for(150ms);
        live.server.stop();
        CHECK(open.wait_for(5s) == std::future_status::ready);
        CHECK(parse_events(open.get()).size() == 1);
    }
}

TEST_CASE("party-25 with the baseline, served live") {
    const std::string data = RUMOR_DATA_DIR;
    const ScenarioParams params = load_scenario(data, "party-25", Lang::es);
    const World world = load_world(data);
    const Population population = make_population(data, params.neighbors, params.layout, 1);
    const Vocab& vocab = vocab_es();
    std::unique_ptr<Policy> policy = make_baseline_policy();

    LiveServer server(max_speed(), vocab, population, nullptr);
    const int port = server.start();

    // A client from the first line to the end event.
    auto stream = std::async(std::launch::async, [port] {
        return read_stream(port, {}, [](const std::string& s) {
            return s.find(R"("type":"end")") != std::string::npos && s.ends_with("\n\n");
        });
    });
    std::this_thread::sleep_for(100ms);

    // At 12:00 a user injects a fact through HTTP, from the simulation thread
    // (as the viewer would from elsewhere); the server hands it over next.
    struct Injecting : RunControl {
        LiveServer& server;
        int port;
        Tick when;
        int status = 0;
        Injecting(LiveServer& s, int p, Tick w) : server(s), port(p), when(w) {}
        TickOrders before_tick(Tick t) override {
            if (t == when) {
                httplib::Client client("127.0.0.1", port);
                const httplib::Result res = client.Post(
                    "/inject",
                    R"({"fact":{"what":"boda","where":"iglesia","when":"mañana 12:00"},"to":{"neighbors":["n010"]}})",
                    "application/x-www-form-urlencoded");
                status = res ? res->status : -1;
            }
            return server.before_tick(t);
        }
    };
    Injecting control(server, port, 12 * kTicksPerHour);
    std::ostringstream file;
    run_simulation(params, world, population, vocab, *policy, 1, publishing_sink(server, &file),
                   &control);
    server.finish();
    CHECK(control.status == 202);

    const std::vector<SseEvent> events = parse_events(stream.get());
    std::vector<std::string> lines;
    {
        std::istringstream in(file.str());
        for (std::string line; std::getline(in, line);) lines.push_back(line);
    }
    REQUIRE(lines.size() > 100);
    REQUIRE(events.size() == lines.size());
    bool injected = false;
    for (std::size_t i = 0; i < lines.size(); ++i) {
        CHECK(events[i].id == std::to_string(i + 1));
        CHECK(events[i].data == lines[i]);
        const Json j = Json::parse(lines[i]);
        if (j["type"] == "inject" && j["what"] == "wedding") {
            CHECK(j["tick"] == 12 * kTicksPerHour);
            CHECK(j["to"] == Json::parse(R"(["n010"])"));
            injected = true;
        }
    }
    CHECK(injected);
    server.stop();
}

}  // TEST_SUITE
