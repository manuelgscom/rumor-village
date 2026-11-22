// The launcher (launcher.h).

#include "launcher/launcher.h"

#include <chrono>
#include <exception>
#include <iostream>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string_view>
#include <system_error>
#include <thread>
#include <vector>

#include "cli/play.h"
#include "cli/stop_signal.h"
#include "cli/usage.h"
#include "core/build_info.h"
#include "core/run_modes.h"
#include "launcher/instance.h"
#include "launcher/os.h"
#include "launcher/probe.h"
#include "launcher/terminal.h"
#include "llm/batch.h"
#include "server/play_server.h"

namespace rumor {
namespace launcher {

namespace fs = std::filesystem;

namespace {

constexpr const char* kUsage =
    "usage: rumor-village [--data-dir <dir>] [--no-browser] [--model-url <url>] [--port <N>]\n"
    "       rumor-village --version\n"
    "       rumor-village <command> ...   (the commands of `rumor`)\n"
    "Opens the game in the browser (docs/guia-jugador.md). The data folder (model,\n"
    "games, progress) is --data-dir, else RUMOR_DATA_DIR, else\n"
    "$XDG_DATA_HOME/rumor-village or ~/.local/share/rumor-village (Linux) or\n"
    "%LOCALAPPDATA%\\RumorVillage (Windows). --port: the port to try first (8080).\n";

// The pace of `rumor play` (cli/play.cpp).
constexpr int kSpeed = 2;
constexpr int kQuietSpeed = 10;

void say(std::ostream& out, const std::string& line) { out << line << std::endl; }

void remove_quietly(const fs::path& path) {
    std::error_code ec;
    fs::remove(path, ec);
}

// Removes instance.json when the launcher ends, once it has written it.
struct InstanceFile {
    fs::path path;
    bool written = false;
    ~InstanceFile() {
        if (written) remove_quietly(path);
    }
};

// True when a new game server may listen on `port` of 127.0.0.1, waiting up
// to a few seconds for the one that just closed it. Its closed connections
// (TIME_WAIT) make a plain bind fail for a minute, but not the bind of
// cpp-httplib (SO_REUSEPORT): it is enough that nothing listens there.
bool wait_port_usable(int port) {
    for (int i = 0; i < 50; ++i) {
        if (os::port_free(port) || !port_listening(port)) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    return false;
}

}  // namespace

Args parse_args(int argc, char** argv) {
    Args args;
    for (int i = 1; i < argc; ++i) {
        const std::string_view flag = argv[i];
        if (flag == "--no-browser") {
            args.no_browser = true;
            continue;
        }
        if (flag != "--data-dir" && flag != "--model-url" && flag != "--port") {
            throw UsageError("unknown option '" + std::string(flag) + "'");
        }
        if (i + 1 >= argc) throw UsageError("missing value for " + std::string(flag));
        const std::string value = argv[++i];
        if (flag == "--data-dir") {
            if (value.empty()) throw UsageError("empty --data-dir");
            args.data_dir = value;
        } else if (flag == "--model-url") {
            args.model_url = value;
        } else {
            const std::uint64_t port = parse_uint(flag, value);
            if (port > 65535) throw UsageError("bad port '" + value + "'");
            args.port = static_cast<int>(port);
        }
    }
    return args;
}

fs::path data_dir_for(const std::string& option, const EnvFn& env, System system) {
    if (!option.empty()) return fs::absolute(fs::path(option));
    const auto get = [&env](const std::string& name) {
        const std::optional<std::string> value = env(name);
        return value ? *value : std::string();
    };
    if (const std::string dir = get("RUMOR_DATA_DIR"); !dir.empty()) return fs::path(dir);
    if (system == System::windows) {
        if (const std::string local = get("LOCALAPPDATA"); !local.empty()) return fs::path(local) / "RumorVillage";
        throw std::runtime_error("no data folder: LOCALAPPDATA is not set (give --data-dir)");
    }
    // XDG: a relative value is invalid and ignored.
    if (const std::string xdg = get("XDG_DATA_HOME"); !xdg.empty() && xdg.front() == '/') {
        return fs::path(xdg) / "rumor-village";
    }
    if (const std::string home = get("HOME"); !home.empty()) {
        return fs::path(home) / ".local" / "share" / "rumor-village";
    }
    throw std::runtime_error("no data folder: HOME is not set (give --data-dir)");
}

Host system_host() {
    Host host;
    host.base_dir = os::exe_dir();
    host.env = [](const std::string& name) { return os::env(name); };
    host.lang = os::system_lang();
    host.probe = gather_probes;
    host.open_browser = os::open_browser;
    host.download.curl = os::curl_program();
    host.out = &std::cout;
    return host;
}

int run_launcher(const Args& args, const Host& host) {
    std::ostream& out = host.out ? *host.out : std::cout;
    const UiLang lang = host.lang;
    const bool es = lang == UiLang::es;
    say(out, "Rumor Village " + std::string(engine_version()));

    const fs::path viewer = host.base_dir / "viewer";
    const fs::path game_data = host.base_dir / "data";
    for (const fs::path& dir : {viewer, game_data}) {
        std::error_code ec;
        if (!fs::is_directory(dir, ec)) {
            throw std::runtime_error("'" + dir.string() + "' is missing: unpack the whole archive again");
        }
    }
    const fs::path data = data_dir_for(args.data_dir, host.env);
    fs::create_directories(data);
    say(out, (es ? "Carpeta de datos: " : "Data folder: ") + data.string());

    // One engine at a time.
    InstanceFile instance{data / "instance.json"};
    if (const std::optional<Instance> running = read_instance(instance.path)) {
        if (instance_alive(running->port)) {
            const std::string url = game_url(running->port);
            say(out, (es ? "Rumor Village ya está abierto en " : "Rumor Village is already open at ") + url);
            // The open game keeps its own options: say so instead of
            // ignoring them in silence (--data-dir chose this game already).
            if (!args.model_url.empty() || args.port != kDefaultPort) {
                say(out, es ? "Las opciones de esta orden no se aplican: el juego ya estaba abierto. Para "
                              "usarlas, ciérralo («Cerrar el juego» en el menú) y vuelve a lanzarlo."
                            : "The options of this command do not apply: the game was already open. To use "
                              "them, close it («Close the game» in the menu) and launch it again.");
            }
            if (!args.no_browser && host.open_browser) host.open_browser(url);
            return 0;
        }
    }
    remove_quietly(instance.path);  // missing, or old: nothing answers there

    // Detection, then the model. A missing model is not waited for: the game
    // opens Sin IA and the model comes inside it (ModelDownload, download.h).
    const Detection detection = detect(host.probe ? host.probe() : Probes{}, lang);
    for (const std::string& line : detection.console) say(out, line);
    std::string reason = detection.reason;
    std::string model_path;
    const fs::path models = data / "models";
    std::unique_ptr<ModelDownload> download;
    if (detection.ai_ok) {
        std::optional<ModelInfo> info;
        try {
            info = read_model_info(host.base_dir / "model.json");
        } catch (const std::exception& e) {
            say(out, std::string("rumor-village: ") + e.what());
            reason = "no_model";
        }
        if (info) {
            if (!args.model_url.empty()) info->url = args.model_url;
            if (model_ready(models, *info)) {
                model_path = (models / info->file).string();
            } else {
                reason = "no_model";
                DownloadOptions options = host.download;
                options.quiet = true;  // the game shows the progress; curl only says its errors
                download = std::make_unique<ModelDownload>(*info, models, options);
                if (info->url.empty()) {
                    MessageArgs message;
                    message.folder = fs::absolute(models).string();
                    message.file = info->file;
                    say(out, reason_message(reason, lang, message));
                } else {
                    say(out, (es ? "Falta el modelo de la IA (" : "The AI model (") + gigabytes(info->size_bytes, lang) +
                                 (es ? " GB): se descarga dentro del juego mientras juegas Sin IA, y desde el "
                                       "juego se activa."
                                     : " GB) is missing: it downloads inside the game while you play Without "
                                       "AI, and the game turns it on."));
                    download->start();
                }
            }
        }
    }
    if (!reason.empty() && !download) {
        MessageArgs message;
        message.folder = fs::absolute(models).string();
        say(out, reason_message(reason, lang, message));
    }
    say(out, mode_line(reason.empty(), lang));

    PlayOptions options;
    options.live.bind = "127.0.0.1";
    options.live.port = choose_port(args.port);
    options.live.viewer_dir = viewer.string();
    options.live.speed = kSpeed;
    options.live.quiet_speed = kQuietSpeed;
    options.data_dir = game_data.string();
    options.out_dir = data.string();
    options.prompt = PromptMode::card;
    options.text = TextMode::camera;
    options.no_ai_reason = reason.empty() ? "no_model" : reason;
    if (ModelDownload* const d = download.get()) {
        options.download.status = [d] { return d->status(); };
        options.download.start = [d] { return d->start(); };
        options.download.activate = [d] { return d->activate(); };
    }
    llm::BatchOptions batch;
    batch.model_path = model_path;

    bool listening = false;
    bool again = false;  // serving again after POST /ai/activate
    int served = 0;      // the port of the game
    // Must not throw: serve_play calls it with its stop thread running.
    const OnPlayListen on_listen = [&](int port) {
        listening = true;
        try {
            write_instance(instance.path, Instance{port, os::process_id(), std::string(engine_version())});
            instance.written = true;
        } catch (const std::exception& e) {
            say(out, std::string("rumor-village: ") + e.what());
        }
        const std::string url = game_url(port);
        if (again) {
            // The open page finds the new server on its own, on the same port.
            if (port == served) {
                say(out, (es ? "El juego sigue en " : "The game goes on at ") + url);
            } else {
                say(out, (es ? "El puerto ha cambiado: abre " : "The port has changed: open ") + url +
                             (es ? " en el navegador (la página abierta no lo encontrará)."
                                 : " in the browser (the open page will not find it)."));
            }
            served = port;
            return;
        }
        served = port;
        say(out, (es ? "El juego está en " : "The game is at ") + url);
        if (args.no_browser || !host.open_browser || !host.open_browser(url)) {
            say(out, es ? "Ábrelo en tu navegador." : "Open it in your browser.");
        }
        say(out, es ? "Para terminar, pulsa «Cerrar el juego» en el menú o Ctrl+C aquí."
                    : "To finish, press «Close the game» in the menu or Ctrl+C here.");
    };
    bool loaded = false;  // the model of this serve loaded
    const MakeBatch load = [&](const llm::BatchOptions& o) {
        std::unique_ptr<llm::Batch> model = host.load_model ? host.load_model(o) : llm::make_llama_batch(o);
        loaded = true;
        return model;
    };
    const auto serve = [&] {
        listening = false;
        loaded = false;
        try {
            return serve_play(options, batch, on_listen, load);
        } catch (const std::exception& e) {
            if (batch.model_path.empty() || listening) throw;
            if (loaded) {
                // The model loaded but the port was taken: any other one.
                if (options.live.port == 0) throw;
                options.live.port = 0;
                return serve_play(options, batch, on_listen, load);
            }
            // The model did not load: the same game, Sin IA.
            say(out, reason_message("model_error", lang) + " (" + e.what() + ")");
            say(out, mode_line(false, lang));
            options.no_ai_reason = "model_error";
            batch.model_path.clear();
            return serve_play(options, batch, on_listen, load);
        }
    };
    for (;;) {
        const int code = serve();
        if (code != kPlayActivate || !download) return code;  // the download, if any, ends with it
        // POST /ai/activate: the model is in place and checked. The same game
        // again, with it, on the same port; the open page reloads.
        batch.model_path = download->model_path().string();
        options.download = {};
        download.reset();
        options.live.port = wait_port_usable(served) ? served : 0;
        again = true;
        say(out, es ? "Cargando la IA…" : "Loading the AI…");
        say(out, mode_line(true, lang));
    }
}

}  // namespace launcher

namespace {

#ifndef _WIN32
// Linux, opened without a terminal (a double click): opens itself again in
// one (terminal.h). True when a terminal started.
bool reopen_in_terminal(int argc, char** argv) {
    const launcher::EnvFn env = [](const std::string& name) { return launcher::os::env(name); };
    if (!launcher::wants_terminal(env, launcher::os::stderr_is_terminal())) return false;
    std::string self;
    try {
        self = launcher::os::self_exe().string();
    } catch (const std::exception&) {
        return false;
    }
    const std::vector<std::string> command =
        launcher::relaunch_command(env, self, std::vector<std::string>(argv + 1, argv + argc));
    for (const std::vector<std::string>& line : launcher::terminal_commands(command, launcher::os::on_path)) {
        if (launcher::os::start_in_terminal(line)) return true;
    }
    return false;
}
#endif

int launch(int argc, char** argv) {
    for (int i = 1; i < argc; ++i) {
        if (std::string_view(argv[i]) == "--help") {
            std::cout << launcher::kUsage;
            return 0;
        }
    }
#ifndef _WIN32
    if (reopen_in_terminal(argc, argv)) return 0;
#endif
    launcher::Args args;
    try {
        args = launcher::parse_args(argc, argv);
    } catch (const UsageError& e) {
        std::cerr << "rumor-village: " << e.what() << '\n' << launcher::kUsage;
        return 2;
    }
    launcher::os::console_utf8();
#ifndef _WIN32
    // Before the probes: the CUDA driver starts threads, and they must not take
    // SIGINT and SIGTERM, which the game server waits for (stop_signal.h). On
    // Windows Ctrl-C ends the launcher until the game server installs its
    // handler.
    block_stop_signals();
#endif
    try {
        return launcher::run_launcher(args, launcher::system_host());
    } catch (const std::exception& e) {
        std::cerr << "rumor-village: " << e.what() << std::endl;
        return 1;
    }
}

}  // namespace

int launcher_main(int argc, char** argv) {
    const int code = launch(argc, argv);
    // An error stays on screen; 130 is the player's own Ctrl-C.
    if (code != 0 && code != 130) launcher::os::wait_if_own_console(launcher::os::system_lang());
    return code;
}

}  // namespace rumor
