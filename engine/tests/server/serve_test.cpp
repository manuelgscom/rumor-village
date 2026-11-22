// `rumor run --serve` (cli/serve.h) on an ephemeral port: the file it writes is
// the stream it serves, it keeps serving after the run until the stop, and a
// stop during the run ends it with its end event. Routes, pace and queue are
// covered by live_server_test.cpp.
#include <doctest/doctest.h>

#include <functional>
#include <future>
#include <sstream>
#include <string>
#include <vector>

#include <cpp-httplib/httplib.h>
#include <nlohmann/json.hpp>

#include "cli/serve.h"
#include "server/live_server.h"

using namespace rumor;
using Json = nlohmann::json;

namespace {

RunOptions party25() {
    RunOptions o;
    o.data_dir = RUMOR_DATA_DIR;
    o.scenario = "party-25";
    o.lang = Lang::es;
    o.seed = 1;
    return o;
}

std::vector<std::string> lines_of(const std::string& text) {
    std::vector<std::string> lines;
    std::istringstream in(text);
    for (std::string line; std::getline(in, line);) lines.push_back(line);
    return lines;
}

}  // namespace

TEST_SUITE("server") {

TEST_CASE("run --serve: the file is the stream, served until the stop") {
    LiveOptions live;
    live.speed = 0;
    std::future<std::string> client;
    std::future<int> after_run;
    std::ostringstream file;
    serve_to_stream(party25(), live, file, nullptr, nullptr,
                    [&](int port, std::function<void()> stop) {
        client = std::async(std::launch::async, [port, stop] {
            // /events until the end event, as the viewer reads it.
            std::string stream;
            httplib::Client http("127.0.0.1", port);
            http.set_read_timeout(20, 0);
            http.Get("/events", [&](const char* data, std::size_t len) {
                stream.append(data, len);
                return !(stream.find(R"("type":"end")") != std::string::npos &&
                         stream.ends_with("\n\n"));
            });
            stop();
            return stream;
        });
    });
    const std::vector<std::string> lines = lines_of(file.str());
    REQUIRE(lines.size() > 100);
    CHECK(Json::parse(lines.back())["type"] == "end");

    // "id: <n>\ndata: <line>\n\n" for each line of the file, and nothing else.
    std::string expected;
    for (std::size_t i = 0; i < lines.size(); ++i) {
        expected += "id: " + std::to_string(i + 1) + "\ndata: " + lines[i] + "\n\n";
    }
    CHECK(client.get() == expected);
}

TEST_CASE("run --serve: a stop during the run ends it with its end event") {
    LiveOptions live;
    live.speed = 0;
    live.paused = true;  // the run waits before its first tick
    std::ostringstream file;
    serve_to_stream(party25(), live, file, nullptr, nullptr,
                    [](int, std::function<void()> stop) { stop(); });
    const std::vector<std::string> lines = lines_of(file.str());
    REQUIRE(lines.size() >= 2);
    CHECK(Json::parse(lines.front())["type"] == "header");
    const Json end = Json::parse(lines.back());
    CHECK(end["type"] == "end");
    // Stopped before its first tick: nothing happened in the village.
    const ScenarioParams params = load_scenario(RUMOR_DATA_DIR, "party-25", Lang::es);
    CHECK(end["tick"] == params.start_tick);
}

TEST_CASE("run --serve: a bad viewer folder fails before the run") {
    LiveOptions live;
    live.viewer_dir = "/nonexistent-viewer";
    std::ostringstream file;
    CHECK_THROWS_AS(serve_to_stream(party25(), live, file), std::runtime_error);
    CHECK(file.str().empty());
}

}  // TEST_SUITE
