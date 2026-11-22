// The download of the model (launcher/download.h) with the curl of the
// system against a server in this process: a cut that resumes with Range, a
// bad sum, no curl, no url, no space, and the size check of later starts. And
// the same inside the game (ModelDownload): its states, a new start after a
// failure, activate, and that cancel kills curl.
#include <doctest/doctest.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <future>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <cpp-httplib/httplib.h>
#include <nlohmann/json.hpp>

#include "core/sha256.h"
#include "launcher/download.h"

using namespace rumor;
using namespace rumor::launcher;
namespace fs = std::filesystem;

namespace {

fs::path fresh_dir(const std::string& name) {
    static std::atomic<int> counter{0};
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path dir = fs::temp_directory_path() /
                         ("rumor-launcher-" + name + "-" + std::to_string(stamp) + "-" + std::to_string(counter++));
    fs::remove_all(dir);
    return dir;
}

std::string slurp(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream out;
    out << in.rdbuf();
    return out.str();
}

// Bytes that do not repeat in a simple way.
std::string model_bytes(std::size_t size) {
    std::string data(size, '\0');
    std::uint32_t x = 12345;
    for (char& c : data) {
        x = x * 1103515245u + 12345u;
        c = static_cast<char>(x >> 24);
    }
    return data;
}

// Serves /model.gguf. With `cut`, the first answer stops half way (the
// connection closes before Content-Length); the others honour Range. With
// `slow`, the answers come in pieces of 4 KB, each `slow` ms apart, and none
// while `hold` is set.
struct ModelServer {
    httplib::Server server;
    std::thread thread;
    int port = 0;
    std::string data;
    bool cut = false;
    int slow = 0;
    std::atomic<bool> hold{false};
    std::atomic<int> requests{0};
    std::mutex mutex;
    std::vector<std::string> ranges;  // the Range header of each request ("" when none)

    ModelServer(std::string body, bool cut_first, int slow_ms = 0)
        : data(std::move(body)), cut(cut_first), slow(slow_ms) {
        server.Get("/model.gguf", [this](const httplib::Request& req, httplib::Response& res) {
            const int n = requests++;
            {
                const std::lock_guard lock(mutex);
                ranges.push_back(req.get_header_value("Range"));
            }
            if (slow > 0) {
                res.set_content_provider(data.size(), "application/octet-stream",
                                         [this](std::size_t offset, std::size_t length, httplib::DataSink& sink) {
                                             while (hold) std::this_thread::sleep_for(std::chrono::milliseconds(10));
                                             std::this_thread::sleep_for(std::chrono::milliseconds(slow));
                                             const std::size_t piece = std::min<std::size_t>(length, 4096);
                                             return sink.write(data.data() + offset, piece);
                                         });
                return;
            }
            if (n == 0 && cut) {
                res.set_content_provider(data.size(), "application/octet-stream",
                                         [this](std::size_t offset, std::size_t, httplib::DataSink& sink) {
                                             const std::size_t half = data.size() / 2;
                                             if (offset < half) sink.write(data.data() + offset, half - offset);
                                             return false;  // the connection is dropped
                                         });
                return;
            }
            res.set_content(data, "application/octet-stream");
        });
        port = server.bind_to_any_port("127.0.0.1");
        REQUIRE(port > 0);
        thread = std::thread([this] { server.listen_after_bind(); });
        server.wait_until_ready();
    }
    ~ModelServer() {
        hold = false;
        server.stop();
        thread.join();
    }
    std::string url() const { return "http://127.0.0.1:" + std::to_string(port) + "/model.gguf"; }
};

DownloadOptions test_options() {
    DownloadOptions o;
    o.curl = "curl";
    o.retries = 0;  // the cut is seen by the launcher, not retried by curl
    o.retry_delay = 0;
    o.quiet = true;
    return o;
}

ModelInfo info_for(const std::string& data, const std::string& url) {
    ModelInfo info;
    info.file = "model.gguf";
    info.size_bytes = data.size();
    info.sha256 = sha256_hex(data);
    info.url = url;
    return info;
}

// Polls `ok` every 20 ms for up to 30 s.
bool eventually(const std::function<bool()>& ok) {
    for (int i = 0; i < 1500; ++i) {
        if (ok()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    return false;
}

std::string state_of(const ModelDownload& download) { return download.status()["state"].get<std::string>(); }

}  // namespace

TEST_SUITE("launcher") {
    TEST_CASE("a cut download resumes with Range next time, and the sum matches") {
        const std::string data = model_bytes(300'000);
        ModelServer server(data, true);
        const fs::path models = fresh_dir("resume") / "models";
        const ModelInfo info = info_for(data, server.url());
        int checks = 0;
        DownloadOptions options = test_options();
        options.on_check = [&] { ++checks; };

        // First start: cut half way; the .part keeps what arrived.
        CHECK(ensure_model(info, models, options) == "download_cut");
        const fs::path part = models / "model.gguf.part";
        REQUIRE(fs::exists(part));
        const auto had = fs::file_size(part);
        CHECK(had > 0);
        CHECK(had < data.size());
        CHECK_FALSE(fs::exists(models / "model.gguf"));
        CHECK(checks == 0);

        // Second start: curl asks for the rest.
        CHECK(ensure_model(info, models, options) == "");
        CHECK(checks == 1);
        CHECK(slurp(models / "model.gguf") == data);
        CHECK_FALSE(fs::exists(part));
        REQUIRE(server.requests == 2);
        CHECK(server.ranges[0].empty());
        CHECK(server.ranges[1] == "bytes=" + std::to_string(had) + "-");

        // Later starts only compare the size: no request, no sum.
        DownloadOptions no_curl = options;
        no_curl.curl = "/nonexistent/curl";
        CHECK(model_ready(models, info));
        CHECK(ensure_model(info, models, no_curl) == "");
        CHECK(server.requests == 2);
        CHECK(checks == 1);
        fs::remove_all(models.parent_path());
    }

    TEST_CASE("a model whose sum does not match is deleted: download_bad") {
        const std::string data = model_bytes(50'000);
        ModelServer server(data, false);
        const fs::path models = fresh_dir("bad") / "models";
        ModelInfo info = info_for(data, server.url());
        info.sha256 = std::string(64, '0');
        CHECK(ensure_model(info, models, test_options()) == "download_bad");
        CHECK_FALSE(fs::exists(models / "model.gguf.part"));
        CHECK_FALSE(fs::exists(models / "model.gguf"));
        fs::remove_all(models.parent_path());
    }

    TEST_CASE("a model of another size is downloaded again") {
        const std::string data = model_bytes(20'000);
        ModelServer server(data, false);
        const fs::path models = fresh_dir("size") / "models";
        fs::create_directories(models);
        std::ofstream(models / "model.gguf", std::ios::binary) << "short";
        const ModelInfo info = info_for(data, server.url());
        CHECK_FALSE(model_ready(models, info));
        CHECK(ensure_model(info, models, test_options()) == "");
        CHECK(slurp(models / "model.gguf") == data);
        fs::remove_all(models.parent_path());
    }

    TEST_CASE("no curl, no url, no space") {
        const fs::path models = fresh_dir("reasons") / "models";
        const std::string data = model_bytes(1000);
        ModelInfo info = info_for(data, "http://127.0.0.1:9/model.gguf");
        DownloadOptions options = test_options();
        options.curl = "/nonexistent/curl";
        CHECK(ensure_model(info, models, options) == "no_curl");

        info.url.clear();
        CHECK(ensure_model(info, models, options) == "no_model");

        info.url = "http://127.0.0.1:9/model.gguf";
        info.size_bytes = std::uint64_t{1} << 60;  // more than any disk
        CHECK(ensure_model(info, models, options) == "no_space");
        fs::remove_all(models.parent_path());
    }

    TEST_CASE("model.json and the sum of a file in pieces") {
        const fs::path dir = fresh_dir("json");
        fs::create_directories(dir);
        std::ofstream(dir / "model.json")
            << R"({"file":"m.gguf","size_bytes":5335287008,"sha256":"ab","url":"","license":"x"})";
        const ModelInfo info = read_model_info(dir / "model.json");
        CHECK(info.file == "m.gguf");
        CHECK(info.size_bytes == 5'335'287'008ull);
        CHECK(info.url.empty());
        std::ofstream(dir / "bad.json") << R"({"file":"../m.gguf","size_bytes":1,"sha256":"ab"})";
        CHECK_THROWS_AS(read_model_info(dir / "bad.json"), std::runtime_error);
        CHECK_THROWS_AS(read_model_info(dir / "missing.json"), std::runtime_error);

        const std::string data = model_bytes(3 * 1024 * 1024 + 17);  // several pieces
        std::ofstream(dir / "f.bin", std::ios::binary) << data;
        CHECK(file_sha256(dir / "f.bin") == sha256_hex(data));
        CHECK_FALSE(file_sha256(dir / "f.bin", [] { return true; }).has_value());
        CHECK_FALSE(file_sha256(dir / "missing.bin").has_value());
        fs::remove_all(dir);
    }

    TEST_CASE("in the game: without a url it is unavailable and cannot start") {
        const fs::path models = fresh_dir("unavailable") / "models";
        ModelInfo info = info_for(model_bytes(100), "");
        ModelDownload download(info, models, test_options());
        const nlohmann::json status = download.status();
        CHECK(status["state"] == "unavailable");
        CHECK(status["bytes"] == 0);
        CHECK(status["total"] == 100);
        CHECK(status["reason"].is_null());
        CHECK(status["file"] == "model.gguf");
        CHECK(fs::path(status["folder"].get<std::string>()).is_absolute());
        CHECK(status["folder"] == fs::absolute(models).string());
        CHECK(download.start().has_value());
        CHECK(download.activate().has_value());
        CHECK(state_of(download) == "unavailable");
        fs::remove_all(models.parent_path());
    }

    TEST_CASE("in the game: running, checking, ready, then activating") {
        const std::string data = model_bytes(40'000);  // ten pieces
        ModelServer server(data, false, 30);
        const fs::path models = fresh_dir("states") / "models";
        // The sum waits for the test, so that "checking" is seen.
        std::promise<void> checked;
        std::shared_future<void> go = checked.get_future().share();
        std::atomic<bool> in_check{false};
        DownloadOptions options = test_options();
        options.on_check = [&in_check, go] {
            in_check = true;
            go.wait_for(std::chrono::seconds(30));  // never forever, should the test fail
        };
        ModelDownload download(info_for(data, server.url()), models, options);
        CHECK(state_of(download) == "idle");
        CHECK(download.activate().has_value());

        CHECK_FALSE(download.start().has_value());
        CHECK(state_of(download) == "running");
        CHECK_FALSE(download.start().has_value());  // running: nothing more
        // The bytes are those of the .part as it grows.
        REQUIRE(eventually([&] {
            const nlohmann::json s = download.status();
            return s["state"] == "running" && s["bytes"].get<std::uint64_t>() > 0;
        }));
        CHECK(download.status()["bytes"].get<std::uint64_t>() < data.size());

        REQUIRE(eventually([&] { return in_check.load(); }));
        nlohmann::json status = download.status();
        CHECK(status["state"] == "checking");
        CHECK(status["bytes"] == data.size());
        CHECK(download.start().has_value());     // 409
        CHECK(download.activate().has_value());  // not ready yet
        checked.set_value();

        REQUIRE(eventually([&] { return state_of(download) == "ready"; }));
        status = download.status();
        CHECK(status["bytes"] == data.size());
        CHECK(status["reason"].is_null());
        CHECK(slurp(download.model_path()) == data);
        CHECK(download.model_path() == fs::absolute(models) / "model.gguf");
        CHECK(download.start().has_value());
        CHECK_FALSE(download.activate().has_value());
        CHECK(state_of(download) == "activating");
        CHECK(download.activate().has_value());
        CHECK(server.requests == 1);
        fs::remove_all(models.parent_path());
    }

    TEST_CASE("in the game: failed with its reason, and a new start resumes") {
        const std::string data = model_bytes(60'000);
        {
            ModelServer server(data, true);
            const fs::path models = fresh_dir("retry") / "models";
            ModelDownload download(info_for(data, server.url()), models, test_options());
            CHECK_FALSE(download.start().has_value());
            REQUIRE(eventually([&] { return state_of(download) == "failed"; }));
            CHECK(download.status()["reason"] == "download_cut");
            CHECK(download.status()["bytes"].get<std::uint64_t>() > 0);  // the .part stays
            CHECK(download.activate().has_value());
            CHECK_FALSE(download.start().has_value());
            REQUIRE(eventually([&] { return state_of(download) == "ready"; }));
            CHECK(download.status()["reason"].is_null());
            CHECK(slurp(download.model_path()) == data);
            REQUIRE(server.requests == 2);
            CHECK(server.ranges[1].rfind("bytes=", 0) == 0);
            fs::remove_all(models.parent_path());
        }
        {
            ModelServer server(data, false);
            const fs::path models = fresh_dir("bad-sum") / "models";
            ModelInfo info = info_for(data, server.url());
            info.sha256 = std::string(64, '0');
            ModelDownload download(info, models, test_options());
            CHECK_FALSE(download.start().has_value());
            REQUIRE(eventually([&] { return state_of(download) == "failed"; }));
            CHECK(download.status()["reason"] == "download_bad");
            CHECK(download.status()["bytes"] == 0);  // deleted
            CHECK_FALSE(download.start().has_value());  // again, from the start
            REQUIRE(eventually([&] { return server.requests == 2 && state_of(download) == "failed"; }));
            CHECK(server.ranges[1].empty());
            fs::remove_all(models.parent_path());
        }
        {
            const fs::path models = fresh_dir("no-space") / "models";
            ModelInfo info = info_for(data, "http://127.0.0.1:9/model.gguf");
            info.size_bytes = std::uint64_t{1} << 60;
            ModelDownload download(info, models, test_options());
            CHECK_FALSE(download.start().has_value());
            REQUIRE(eventually([&] { return state_of(download) == "failed"; }));
            CHECK(download.status()["reason"] == "no_space");
            fs::remove_all(models.parent_path());
        }
        {
            const fs::path models = fresh_dir("no-curl") / "models";
            DownloadOptions options = test_options();
            options.curl = "/nonexistent/curl";
            ModelDownload download(info_for(data, "http://127.0.0.1:9/model.gguf"), models, options);
            CHECK_FALSE(download.start().has_value());
            REQUIRE(eventually([&] { return state_of(download) == "failed"; }));
            CHECK(download.status()["reason"] == "no_curl");
            fs::remove_all(models.parent_path());
        }
    }

    TEST_CASE("in the game: cancel kills curl at once and keeps the .part") {
        const std::string data = model_bytes(4096 * 200);  // 200 pieces, 50 ms apart: 10 s
        ModelServer server(data, false, 50);
        const fs::path models = fresh_dir("cancel") / "models";
        ModelDownload download(info_for(data, server.url()), models, test_options());
        CHECK_FALSE(download.start().has_value());
        REQUIRE(eventually([&] { return download.status()["bytes"].get<std::uint64_t>() > 0; }));
        const auto t0 = std::chrono::steady_clock::now();
        download.cancel();
        CHECK(std::chrono::steady_clock::now() - t0 < std::chrono::seconds(2));
        const fs::path part = models / "model.gguf.part";
        REQUIRE(fs::exists(part));
        const auto had = fs::file_size(part);
        CHECK(had < data.size());
        // Nobody writes it any more.
        std::this_thread::sleep_for(std::chrono::milliseconds(300));
        CHECK(fs::file_size(part) == had);
        CHECK(download.start().has_value());  // closing: nothing starts
        fs::remove_all(models.parent_path());
    }
}
