// One engine at a time (launcher/instance.h) and the whole launcher in
// "Sin IA" (run_launcher): a second start that finds a live engine only opens
// the browser; an old instance.json is replaced; the game answers GET /state
// and ends with POST /quit, which removes instance.json. And with the AI
// possible but the model missing: the game opens at once, the model comes
// inside it, and POST /ai/activate serves again on the same port with a fake
// model (llama.cpp is never touched).
#include <doctest/doctest.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <future>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <cpp-httplib/httplib.h>
#include <nlohmann/json.hpp>

#include "core/build_info.h"
#include "core/sha256.h"
#include "launcher/instance.h"
#include "launcher/launcher.h"
#include "llm/fake_batch.h"

using namespace rumor;
using namespace rumor::launcher;
using namespace std::chrono_literals;
namespace fs = std::filesystem;
using Json = nlohmann::json;

namespace {

fs::path fresh_dir(const std::string& name) {
    static std::atomic<int> counter{0};
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path dir = fs::temp_directory_path() /
                         ("rumor-launcher-" + name + "-" + std::to_string(stamp) + "-" + std::to_string(counter++));
    fs::remove_all(dir);
    return dir;
}

// A server that answers GET /state with `body`, as a running engine would.
struct StateServer {
    httplib::Server server;
    std::thread thread;
    int port = 0;

    explicit StateServer(const std::string& body) {
        server.Get("/state", [body](const httplib::Request&, httplib::Response& res) {
            res.set_content(body, "application/json");
        });
        port = server.bind_to_any_port("127.0.0.1");
        REQUIRE(port > 0);
        thread = std::thread([this] { server.listen_after_bind(); });
        server.wait_until_ready();
    }
    ~StateServer() {
        server.stop();
        thread.join();
    }
};

// A port where nothing listens (it was free a moment ago).
int dead_port() {
    httplib::Server server;
    const int port = server.bind_to_any_port("127.0.0.1");
    server.stop();
    return port;
}

// The repo: viewer/ and data/ as next to the executable of a prebuilt.
fs::path repo_dir() { return fs::path(RUMOR_DATA_DIR).parent_path(); }

struct FakeHost {
    std::ostringstream out;
    std::mutex mutex;
    std::vector<std::string> opened;
    std::atomic<bool> probed{false};
    Probes probes;  // by default a binary without GPU backends: Sin IA, ggml untouched
    Host host;

    FakeHost() {
        host.base_dir = repo_dir();
        host.env = [](const std::string&) { return std::optional<std::string>(); };
        host.lang = UiLang::en;
        host.probe = [this] {
            probed = true;
            return probes;
        };
        host.open_browser = [this](const std::string& url) {
            const std::lock_guard lock(mutex);
            opened.push_back(url);
            return true;
        };
        host.download.curl = "/nonexistent/curl";
        host.out = &out;
    }
};

// What a computer that can run the AI reports (CUDA, a card, a new driver).
Probes ai_probes() {
    Probes p;
    p.backends = "cuda";
    p.cuda_library = true;
    p.cuda_init = true;
    p.cuda_devices = 1;
    p.cuda_driver = 12090;
    p.cuda_name = "Fake GPU";
    p.ggml_checked = true;
    p.gpu_name = "CUDA0";
    p.gpu_description = "Fake GPU";
    return p;
}

// Serves /model.gguf, nothing until `released`.
struct HeldModel {
    httplib::Server server;
    std::thread thread;
    int port = 0;
    std::string data;
    std::atomic<bool> released{false};

    explicit HeldModel(std::string body) : data(std::move(body)) {
        server.Get("/model.gguf", [this](const httplib::Request&, httplib::Response& res) {
            res.set_content_provider(data.size(), "application/octet-stream",
                                     [this](std::size_t offset, std::size_t length, httplib::DataSink& sink) {
                                         while (!released) std::this_thread::sleep_for(10ms);
                                         return sink.write(data.data() + offset, length);
                                     });
        });
        port = server.bind_to_any_port("127.0.0.1");
        REQUIRE(port > 0);
        thread = std::thread([this] { server.listen_after_bind(); });
        server.wait_until_ready();
    }
    ~HeldModel() {
        released = true;
        server.stop();
        thread.join();
    }
    std::string url() const { return "http://127.0.0.1:" + std::to_string(port) + "/model.gguf"; }
};

// Ends the launcher of a failed test (POST /quit where instance.json says),
// so that waiting for it does not hang.
struct QuitAtEnd {
    fs::path instance;
    ~QuitAtEnd() {
        if (const std::optional<Instance> running = read_instance(instance)) {
            httplib::Client client("127.0.0.1", running->port);
            client.set_connection_timeout(1s);
            client.Post("/quit");
        }
    }
};

// GET /state of the game at `port`, or nullopt while nothing answers there.
std::optional<Json> state_at(int port) {
    httplib::Client client("127.0.0.1", port);
    client.set_connection_timeout(1s);
    client.set_read_timeout(5s);
    const httplib::Result res = client.Get("/state");
    if (!res || res->status != 200) return std::nullopt;
    return Json::parse(res->body);
}

}  // namespace

TEST_SUITE("launcher") {
    TEST_CASE("instance.json is written and read back; anything else is no instance") {
        const fs::path dir = fresh_dir("instance");
        fs::create_directories(dir);
        write_instance(dir / "instance.json", Instance{8080, 4242, "1.0.0"});
        const std::optional<Instance> back = read_instance(dir / "instance.json");
        REQUIRE(back);
        CHECK(back->port == 8080);
        CHECK(back->pid == 4242);
        CHECK(back->version == "1.0.0");
        CHECK_FALSE(read_instance(dir / "missing.json"));
        std::ofstream(dir / "junk.json") << "{not json";
        CHECK_FALSE(read_instance(dir / "junk.json"));
        std::ofstream(dir / "port.json") << R"({"port":0})";
        CHECK_FALSE(read_instance(dir / "port.json"));
        fs::remove_all(dir);
    }

    TEST_CASE("an engine is alive when /state answers JSON with a version") {
        StateServer engine(R"({"state":"waiting","version":"1.0.0"})");
        CHECK(instance_alive(engine.port));
        StateServer other(R"({"hello":"world"})");
        CHECK_FALSE(instance_alive(other.port));
        StateServer html("<html></html>");
        CHECK_FALSE(instance_alive(html.port));
        CHECK_FALSE(instance_alive(dead_port(), 500ms));
    }

    TEST_CASE("the port: the preferred one when free, else any") {
        CHECK(choose_port(0) == 0);
        const int idle = dead_port();
        CHECK(choose_port(idle) == idle);
        // A listener that set SO_REUSEPORT (cpp-httplib does) still holds it.
        StateServer busy(R"({"version":"1"})");
        CHECK(choose_port(busy.port) == 0);
        CHECK(game_url(8080) == "http://127.0.0.1:8080/?play=1");
    }

    TEST_CASE("a second start with a live engine opens the browser there and ends") {
        StateServer engine(R"({"state":"waiting","version":"1.0.0"})");
        const fs::path data = fresh_dir("second");
        fs::create_directories(data);
        write_instance(data / "instance.json", Instance{engine.port, 1, "1.0.0"});
        FakeHost fake;
        Args args;
        args.data_dir = data.string();
        CHECK(run_launcher(args, fake.host) == 0);
        CHECK_FALSE(fake.probed);  // no detection, no second engine
        REQUIRE(fake.opened.size() == 1);
        CHECK(fake.opened[0] == game_url(engine.port));
        CHECK(fs::exists(data / "instance.json"));
        CHECK(fake.out.str().find("already open") != std::string::npos);

        // With --no-browser it only says where.
        FakeHost quiet;
        args.no_browser = true;
        CHECK(run_launcher(args, quiet.host) == 0);
        CHECK(quiet.opened.empty());
        CHECK(quiet.out.str().find(game_url(engine.port)) != std::string::npos);
        // Without options of its own nothing is said about them...
        CHECK(fake.out.str().find("do not apply") == std::string::npos);

        // ...with them, it says they do not apply to the open game.
        FakeHost with_url;
        args.model_url = "http://127.0.0.1:1/model.gguf";
        CHECK(run_launcher(args, with_url.host) == 0);
        CHECK(with_url.out.str().find("do not apply") != std::string::npos);
        fs::remove_all(data);
    }

    TEST_CASE("Sin IA from end to end: an old instance.json is replaced, /state, POST /quit") {
        const fs::path data = fresh_dir("e2e");
        fs::create_directories(data);
        const int old_port = dead_port();
        write_instance(data / "instance.json", Instance{old_port, 1, "0.9.0"});

        FakeHost fake;
        Args args;
        args.data_dir = data.string();
        args.no_browser = true;
        args.port = 0;
        auto done = std::async(std::launch::async, [&] { return run_launcher(args, fake.host); });

        // instance.json tells the new port once the server listens.
        std::optional<Instance> running;
        for (int i = 0; i < 600; ++i) {
            running = read_instance(data / "instance.json");
            if (running && running->port != old_port) break;
            REQUIRE(done.wait_for(50ms) == std::future_status::timeout);
        }
        REQUIRE(running);
        REQUIRE(running->port != old_port);
        CHECK(running->version == std::string(engine_version()));
        CHECK(instance_alive(running->port));

        httplib::Client client("127.0.0.1", running->port);
        const httplib::Result state = client.Get("/state");
        REQUIRE(state);
        CHECK(state->status == 200);
        const Json json = Json::parse(state->body);
        CHECK(json["version"] == std::string(engine_version()));
        CHECK(json["ai"]["available"] == false);
        CHECK(json["ai"]["reason"] == "no_gpu");
        // The viewer is served from next to the "executable".
        const httplib::Result page = client.Get("/");
        REQUIRE(page);
        CHECK(page->status == 200);

        const httplib::Result quit = client.Post("/quit");
        REQUIRE(quit);
        CHECK(quit->status == 200);
        REQUIRE(done.wait_for(30s) == std::future_status::ready);
        CHECK(done.get() == 0);
        CHECK_FALSE(fs::exists(data / "instance.json"));
        CHECK(fake.probed);
        CHECK(fake.opened.empty());
        const std::string out = fake.out.str();
        CHECK(out.find("There is no graphics card that can run the AI.") != std::string::npos);
        CHECK(out.find("Mode: Without AI") != std::string::npos);
        CHECK(out.find(game_url(running->port)) != std::string::npos);
        fs::remove_all(data);
    }

    TEST_CASE("AI possible, model missing: the game opens at once, downloads it and activates it on the same port") {
        // A prebuilt next to the "executable": viewer/ and data/ of the repo,
        // and a model.json of a small file.
        const fs::path base = fresh_dir("activate-base");
        fs::create_directories(base);
        std::error_code ec;
        fs::create_directory_symlink(repo_dir() / "viewer", base / "viewer", ec);
        if (!ec) fs::create_directory_symlink(repo_dir() / "data", base / "data", ec);
        if (ec) {
            MESSAGE("skipped: cannot make symbolic links here (" << ec.message() << ")");
            fs::remove_all(base);
            return;
        }
        const std::string model(64 * 1024, 'm');
        HeldModel origin(model);
        std::ofstream(base / "model.json") << Json{{"file", "model.gguf"},
                                                   {"size_bytes", model.size()},
                                                   {"sha256", sha256_hex(model)},
                                                   {"url", ""}}
                                                  .dump();
        const fs::path data = fresh_dir("activate-data");

        FakeHost fake;
        fake.probes = ai_probes();
        fake.host.base_dir = base;
        fake.host.download.curl = "curl";
        std::mutex loads_mutex;
        std::vector<std::string> loads;
        fake.host.load_model = [&](const llm::BatchOptions& options) -> std::unique_ptr<llm::Batch> {
            {
                const std::lock_guard lock(loads_mutex);
                loads.push_back(options.model_path);
            }
            return std::make_unique<llm::FakeBatch>([](const std::string&, const llm::Request&) {
                llm::Result r;
                r.json = R"({"action":"stay"})";
                return r;
            });
        };
        Args args;
        args.data_dir = data.string();
        args.model_url = origin.url();  // --model-url over the empty url of model.json
        args.port = 0;
        auto done = std::async(std::launch::async, [&] { return run_launcher(args, fake.host); });
        const QuitAtEnd quit_at_end{data / "instance.json"};

        // The game listens while the origin still holds the model back.
        std::optional<Instance> running;
        for (int i = 0; i < 600 && !running; ++i) {
            running = read_instance(data / "instance.json");
            if (!running) REQUIRE(done.wait_for(50ms) == std::future_status::timeout);
        }
        REQUIRE(running);
        const int port = running->port;
        std::optional<Json> state = state_at(port);
        REQUIRE(state);
        CHECK((*state)["ai"]["available"] == false);
        CHECK((*state)["ai"]["reason"] == "no_model");
        const Json download = (*state)["ai"]["download"];
        CHECK(download["state"] == "running");
        CHECK(download["total"] == model.size());
        CHECK(download["file"] == "model.gguf");
        CHECK(download["folder"] == fs::absolute(data / "models").string());
        {
            const std::lock_guard lock(fake.mutex);
            REQUIRE(fake.opened.size() == 1);
            CHECK(fake.opened[0] == game_url(port));
        }

        // Released: running, checking, ready.
        origin.released = true;
        for (int i = 0; i < 600; ++i) {
            state = state_at(port);
            REQUIRE(state);
            if ((*state)["ai"]["download"]["state"] == "ready") break;
            std::this_thread::sleep_for(50ms);
        }
        REQUIRE((*state)["ai"]["download"]["state"] == "ready");
        CHECK((*state)["ai"]["download"]["bytes"] == model.size());
        CHECK(fs::exists(data / "models" / "model.gguf"));

        // Activate: the same port, now with the model, and no new browser.
        httplib::Client client("127.0.0.1", port);
        const httplib::Result activate = client.Post("/ai/activate", "{}", "application/json");
        REQUIRE(activate);
        CHECK(activate->status == 200);
        // The new server has the model: no download, and the hardware check
        // runs (in a build without the card renderer it fails: model_error).
        bool with_model = false;
        for (int i = 0; i < 600 && !with_model; ++i) {
            REQUIRE(done.wait_for(50ms) == std::future_status::timeout);
            state = state_at(port);
            with_model = state && !(*state)["ai"].contains("download");
        }
        REQUIRE(with_model);
        CHECK((*state)["check"]["state"] != "skipped");
        CHECK((*state)["ai"]["reason"] != "no_model");
        {
            const std::lock_guard lock(loads_mutex);
            REQUIRE(loads.size() == 1);
            CHECK(fs::path(loads[0]) == fs::absolute(data / "models" / "model.gguf"));
        }
        running = read_instance(data / "instance.json");
        REQUIRE(running);
        CHECK(running->port == port);
        {
            const std::lock_guard lock(fake.mutex);
            CHECK(fake.opened.size() == 1);
        }

        const httplib::Result quit = client.Post("/quit");
        REQUIRE(quit);
        REQUIRE(done.wait_for(60s) == std::future_status::ready);
        CHECK(done.get() == 0);
        CHECK_FALSE(fs::exists(data / "instance.json"));
        const std::string out = fake.out.str();
        CHECK(out.find("Graphics card: Fake GPU (CUDA0)") != std::string::npos);
        CHECK(out.find("it downloads inside the game") != std::string::npos);
        CHECK(out.find("Mode: Without AI") != std::string::npos);
        CHECK(out.find("Loading the AI") != std::string::npos);
        CHECK(out.find("Mode: With AI") != std::string::npos);
        CHECK(out.find("The game goes on at " + game_url(port)) != std::string::npos);
        fs::remove_all(data);
        fs::remove_all(base);
    }

    TEST_CASE("AI possible, model missing and no url: the game opens Sin IA with the download unavailable") {
        const fs::path base = fresh_dir("unavailable-base");
        fs::create_directories(base);
        std::error_code ec;
        fs::create_directory_symlink(repo_dir() / "viewer", base / "viewer", ec);
        if (!ec) fs::create_directory_symlink(repo_dir() / "data", base / "data", ec);
        if (ec) {
            MESSAGE("skipped: cannot make symbolic links here (" << ec.message() << ")");
            fs::remove_all(base);
            return;
        }
        std::ofstream(base / "model.json") << R"({"file":"model.gguf","size_bytes":10,"sha256":"00","url":""})";
        const fs::path data = fresh_dir("unavailable-data");
        FakeHost fake;
        fake.probes = ai_probes();
        fake.host.base_dir = base;
        Args args;
        args.data_dir = data.string();
        args.no_browser = true;
        args.port = 0;
        auto done = std::async(std::launch::async, [&] { return run_launcher(args, fake.host); });
        const QuitAtEnd quit_at_end{data / "instance.json"};
        std::optional<Instance> running;
        for (int i = 0; i < 600 && !running; ++i) {
            running = read_instance(data / "instance.json");
            if (!running) REQUIRE(done.wait_for(50ms) == std::future_status::timeout);
        }
        REQUIRE(running);
        const std::optional<Json> state = state_at(running->port);
        REQUIRE(state);
        CHECK((*state)["ai"]["reason"] == "no_model");
        CHECK((*state)["ai"]["download"]["state"] == "unavailable");
        httplib::Client client("127.0.0.1", running->port);
        const httplib::Result again = client.Post("/ai/download", "{}", "application/json");
        REQUIRE(again);
        CHECK(again->status == 409);
        REQUIRE(client.Post("/quit"));
        REQUIRE(done.wait_for(30s) == std::future_status::ready);
        CHECK(done.get() == 0);
        CHECK(fake.out.str().find("The model is missing. To play with AI, put the file model.gguf in") !=
              std::string::npos);
        fs::remove_all(data);
        fs::remove_all(base);
    }
}
