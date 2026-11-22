#pragma once
// The launcher (phase 10, docs/fases/fase-10.md): what `rumor-village` does
// without a command. It is `rumor play` plus the detection, the download of
// the model inside the game and one engine at a time.
//
//  instance.json answers? ── yes ──► open the browser, exit 0
//        │ no (missing or old: removed)
//  detection (detect.h) ── not usable ──► message ──────────────────────┐
//        │ usable                                                       │
//  model in <data>/models? ── no ──► ModelDownload (download.h): starts │
//        │ yes                       in the background when there is a  │
//        │                           url; else "unavailable"            │
//        ▼                                                              ▼
//  serve_play (cli/play.h) on 127.0.0.1, Con IA ◄────────────────── or Sin IA
//  on_listen: instance.json, browser          until «Salir» (POST /quit) or Ctrl-C
//        ▲                                                              │
//        └── POST /ai/activate (download ready): served again with the ─┘
//            model, on the same port, without opening the browser again
//
// It looks for viewer/, data/ and model.json next to the executable, and
// keeps the model, the games and the progress in the data folder.

#include <filesystem>
#include <functional>
#include <iosfwd>
#include <string>

#include "cli/play.h"
#include "launcher/detect.h"
#include "launcher/download.h"

namespace rumor {

// `rumor-village` with no arguments or only options ("--..."), from
// cli_main. Returns the exit code.
int launcher_main(int argc, char** argv);

}  // namespace rumor

namespace rumor::launcher {

// The game port when it is free (else any).
inline constexpr int kDefaultPort = 8080;

struct Args {
    std::string data_dir;   // --data-dir; empty: data_dir_for()
    bool no_browser = false;
    std::string model_url;  // --model-url; empty: the url of model.json
    int port = kDefaultPort;  // --port; 0: any free port
};

// Parses the options (argv[1..]). Throws UsageError (cli/usage.h).
Args parse_args(int argc, char** argv);

// Which system's folders data_dir_for() follows (a parameter, so that both
// are tested anywhere).
enum class System { posix, windows };

#ifdef _WIN32
inline constexpr System kSystem = System::windows;
#else
inline constexpr System kSystem = System::posix;
#endif

// The data folder of the player: --data-dir, else RUMOR_DATA_DIR, else
// $XDG_DATA_HOME/rumor-village or ~/.local/share/rumor-village (Linux) or
// %LOCALAPPDATA%\RumorVillage (Windows). Throws std::runtime_error when none
// can be found.
std::filesystem::path data_dir_for(const std::string& option, const EnvFn& env, System system = kSystem);

// What the launcher takes from the computer; the tests give their own.
struct Host {
    std::filesystem::path base_dir;  // viewer/, data/ and model.json (the folder of the executable)
    EnvFn env;
    UiLang lang = UiLang::en;
    std::function<Probes()> probe;
    std::function<bool(const std::string& url)> open_browser;
    DownloadOptions download;
    MakeBatch load_model;  // empty: llama.cpp (the tests give a fake model)
    std::ostream* out = nullptr;  // the console
};

// The real computer: the folder of the executable, its environment, language,
// probes, browser and curl.
Host system_host();

// Runs the launcher (the drawing above). Returns the exit code. Throws
// std::runtime_error.
int run_launcher(const Args& args, const Host& host);

}  // namespace rumor::launcher
