// The launcher (phase 10): from made-up probes to the reason and the console
// message of each row of the table of docs/fases/fase-10.md ("C. Lanzador"),
// the language, the data folder and the options.
#include <doctest/doctest.h>

#include <algorithm>
#include <map>
#include <string>
#include <vector>

#include "cli/usage.h"
#include "launcher/detect.h"
#include "launcher/launcher.h"

using namespace rumor;
using namespace rumor::launcher;
namespace fs = std::filesystem;

namespace {

EnvFn env_of(std::map<std::string, std::string> vars) {
    return [vars](const std::string& name) -> std::optional<std::string> {
        const auto it = vars.find(name);
        if (it == vars.end()) return std::nullopt;
        return it->second;
    };
}

// A CUDA build on a computer with a working NVIDIA card and driver.
Probes cuda_ok() {
    Probes p;
    p.backends = "cuda";
    p.cuda_library = true;
    p.cuda_init = true;
    p.cuda_devices = 1;
    p.cuda_driver = 12090;
    p.cuda_name = "NVIDIA GeForce RTX 5070 Ti";
    p.ggml_checked = true;
    p.gpu_name = "CUDA0";
    p.gpu_description = "NVIDIA GeForce RTX 5070 Ti";
    return p;
}

// A Vulkan build with the loader and a GPU.
Probes vulkan_ok() {
    Probes p;
    p.backends = "vulkan";
    p.vulkan_loader = true;
    p.ggml_checked = true;
    p.gpu_name = "Vulkan0";
    p.gpu_description = "AMD Radeon RX 7600";
    return p;
}

bool has_line(const Detection& d, const std::string& text) {
    return std::any_of(d.console.begin(), d.console.end(),
                       [&](const std::string& line) { return line.find(text) != std::string::npos; });
}

}  // namespace

TEST_SUITE("launcher") {
    TEST_CASE("a CUDA build with a recent NVIDIA driver plays Con IA on CUDA0") {
        const Detection d = detect(cuda_ok(), UiLang::es);
        CHECK(d.ai_ok);
        CHECK(d.reason.empty());
        CHECK(d.backend == "cuda");
        CHECK(d.device == "CUDA0");
        CHECK(has_line(d, "Precompilado: CUDA"));
        CHECK(has_line(d, "NVIDIA: NVIDIA GeForce RTX 5070 Ti, controlador para CUDA 12.9"));
        CHECK(has_line(d, "Tarjeta gráfica: NVIDIA GeForce RTX 5070 Ti (CUDA0)"));
        CHECK(mode_line(true, UiLang::es) == "Modo: Con IA");
        CHECK(mode_line(false, UiLang::en) == "Mode: Without AI");
    }

    TEST_CASE("a Vulkan build with its loader and a GPU plays Con IA") {
        const Detection d = detect(vulkan_ok(), UiLang::en);
        CHECK(d.ai_ok);
        CHECK(d.backend == "vulkan");
        CHECK(d.device == "Vulkan0");
        CHECK(has_line(d, "Build: Vulkan"));
        CHECK(has_line(d, "Vulkan: found"));
        CHECK(has_line(d, "Graphics card: AMD Radeon RX 7600 (Vulkan0)"));
    }

    TEST_CASE("row: no usable GPU -> no_gpu") {
        Probes p = vulkan_ok();
        p.gpu_name.clear();  // the loader is there, ggml finds no GPU
        p.gpu_description.clear();
        Detection d = detect(p, UiLang::es);
        CHECK_FALSE(d.ai_ok);
        CHECK(d.reason == "no_gpu");
        CHECK(has_line(d, "Tarjeta gráfica: ninguna"));
        CHECK(reason_message(d.reason, UiLang::es) ==
              "No hay una tarjeta gráfica que pueda mover la IA. Juegas en modo Sin IA.");
        CHECK(reason_message(d.reason, UiLang::en) ==
              "There is no graphics card that can run the AI. You play in Without AI mode.");

        // A binary without GPU backends never touches ggml.
        Probes none;
        CHECK(driver_verdict(none).backend.empty());
        d = detect(none, UiLang::en);
        CHECK(d.reason == "no_gpu");
        CHECK(has_line(d, "Build: none (no GPU)"));
    }

    TEST_CASE("row: a CUDA build without NVIDIA -> no_nvidia, and ggml is not touched") {
        Probes p;
        p.backends = "cuda";  // no driver library at all
        CHECK(driver_verdict(p).backend.empty());
        Detection d = detect(p, UiLang::es);
        CHECK(d.reason == "no_nvidia");
        CHECK(has_line(d, "NVIDIA: no se encuentra el controlador"));
        CHECK(reason_message(d.reason, UiLang::es) ==
              "Este precompilado es para tarjetas NVIDIA y tu equipo no tiene una. Para jugar con IA, "
              "descarga el de Vulkan.");
        CHECK(reason_message(d.reason, UiLang::en) ==
              "This build is for NVIDIA cards and your computer has none. To play with AI, download the "
              "Vulkan one.");

        // The library is there but sees no card (cuInit fails or no device).
        p.cuda_library = true;
        p.cuda_driver = 12090;
        CHECK(detect(p, UiLang::en).reason == "no_nvidia");
        p.cuda_init = true;
        CHECK(detect(p, UiLang::en).reason == "no_nvidia");
        CHECK(has_line(detect(p, UiLang::en), "the driver sees no card"));
    }

    TEST_CASE("row: an old NVIDIA driver -> old_driver; CUDA 12.0 is the minimum") {
        Probes p = cuda_ok();
        p.cuda_driver = 11080;
        CHECK(driver_verdict(p).backend.empty());
        const Detection d = detect(p, UiLang::es);
        CHECK(d.reason == "old_driver");
        CHECK(has_line(d, "controlador para CUDA 11.8 (hace falta 12.0)"));
        CHECK(reason_message(d.reason, UiLang::es) ==
              "Tu controlador de NVIDIA es anterior al que hace falta. Actualiza el controlador o usa el "
              "precompilado de Vulkan.");
        CHECK(reason_message(d.reason, UiLang::en) ==
              "Your NVIDIA driver is older than the one needed. Update the driver or use the Vulkan build.");

        p.cuda_driver = kMinCudaDriver;
        CHECK(detect(p, UiLang::es).ai_ok);
        p.cuda_driver = kMinCudaDriver - 10;  // 11.9
        CHECK(detect(p, UiLang::es).reason == "old_driver");
    }

    TEST_CASE("row: no Vulkan -> no_vulkan, and ggml is not touched") {
        Probes p;
        p.backends = "vulkan";
        CHECK(driver_verdict(p).backend.empty());
        const Detection d = detect(p, UiLang::es);
        CHECK(d.reason == "no_vulkan");
        CHECK(has_line(d, "Vulkan: no se encuentra"));
        CHECK(reason_message(d.reason, UiLang::es) ==
              "No se encuentra Vulkan. Actualiza el controlador de tu tarjeta gráfica.");
        CHECK(reason_message(d.reason, UiLang::en) ==
              "Vulkan was not found. Update the driver of your graphics card.");
    }

    TEST_CASE("the build of the repo (CUDA and Vulkan) falls back to Vulkan without NVIDIA") {
        Probes p = vulkan_ok();
        p.backends = "cuda vulkan";
        CHECK(driver_verdict(p).backend == "vulkan");
        CHECK(detect(p, UiLang::es).ai_ok);
        p.vulkan_loader = false;
        CHECK(detect(p, UiLang::es).reason == "no_gpu");
        p = cuda_ok();
        p.backends = "cuda vulkan";
        p.cuda_driver = 11080;
        CHECK(detect(p, UiLang::es).reason == "old_driver");
    }

    TEST_CASE("rows of the download: no_space, download_cut, download_bad") {
        MessageArgs args;
        args.folder = "/home/ana/.local/share/rumor-village/models";
        args.bytes = 5'335'287'008;
        CHECK(reason_message("no_space", UiLang::es, args) ==
              "Hacen falta 5,34 GB libres en /home/ana/.local/share/rumor-village/models.");
        CHECK(reason_message("no_space", UiLang::en, args) ==
              "5.34 GB of free space are needed in /home/ana/.local/share/rumor-village/models.");
        CHECK(reason_message("download_cut", UiLang::es) == "La descarga se reanudará la próxima vez.");
        CHECK(reason_message("download_cut", UiLang::en) == "The download will resume next time.");
        CHECK(reason_message("download_bad", UiLang::es) ==
              "El modelo descargado está dañado. Se volverá a descargar.");
        CHECK(reason_message("download_bad", UiLang::en) ==
              "The downloaded model is damaged. It will be downloaded again.");

        // Beyond the table: no curl, no model published, a model that fails.
        args.url = "https://example.org/m.gguf";
        args.file = "m.gguf";
        const std::string no_curl = reason_message("no_curl", UiLang::es, args);
        CHECK(no_curl.find("curl") != std::string::npos);
        CHECK(no_curl.find(args.url) != std::string::npos);
        CHECK(no_curl.find(args.folder) != std::string::npos);
        const std::string no_model = reason_message("no_model", UiLang::en, args);
        CHECK(no_model.find("m.gguf") != std::string::npos);
        CHECK(no_model.find(args.folder) != std::string::npos);
        CHECK_FALSE(reason_message("model_error", UiLang::es).empty());
    }

    TEST_CASE("gigabytes are rounded to hundredths, with the decimal mark of the language") {
        CHECK(gigabytes(5'335'287'008, UiLang::es) == "5,34");
        CHECK(gigabytes(5'335'287'008, UiLang::en) == "5.34");
        CHECK(gigabytes(1'005'000'000, UiLang::en) == "1.01");
        CHECK(gigabytes(0, UiLang::es) == "0,00");
    }

    TEST_CASE("the console speaks Spanish when the locale does") {
        CHECK(lang_from_env(env_of({})) == UiLang::en);
        CHECK(lang_from_env(env_of({{"LANG", "es_ES.UTF-8"}})) == UiLang::es);
        CHECK(lang_from_env(env_of({{"LANG", "en_US.UTF-8"}})) == UiLang::en);
        CHECK(lang_from_env(env_of({{"LANG", "C.UTF-8"}})) == UiLang::en);
        // LC_ALL, then LC_MESSAGES, then LANG; an empty one does not count.
        CHECK(lang_from_env(env_of({{"LC_ALL", "en_GB.UTF-8"}, {"LANG", "es_ES.UTF-8"}})) == UiLang::en);
        CHECK(lang_from_env(env_of({{"LC_MESSAGES", "es_MX.UTF-8"}, {"LANG", "en_US"}})) == UiLang::es);
        CHECK(lang_from_env(env_of({{"LC_ALL", ""}, {"LANG", "es_AR"}})) == UiLang::es);
    }

    TEST_CASE("the data folder: option, then RUMOR_DATA_DIR, then XDG or the home") {
        const EnvFn env = env_of({{"RUMOR_DATA_DIR", "/srv/rv"},
                                  {"XDG_DATA_HOME", "/home/ana/.data"},
                                  {"HOME", "/home/ana"},
                                  {"LOCALAPPDATA", "C:\\Users\\Ana\\AppData\\Local"}});
        // fs::absolute: on Windows "/tmp/mine" is relative to the drive (C:/tmp/mine).
        CHECK(data_dir_for("/tmp/mine", env, System::posix) == fs::absolute("/tmp/mine"));
        CHECK(data_dir_for("rel", env, System::posix) == fs::absolute("rel"));
        CHECK(data_dir_for("", env, System::posix) == fs::path("/srv/rv"));
        CHECK(data_dir_for("", env, System::windows) == fs::path("/srv/rv"));
        CHECK(data_dir_for("", env_of({{"XDG_DATA_HOME", "/home/ana/.data"}, {"HOME", "/home/ana"}}),
                           System::posix) == fs::path("/home/ana/.data/rumor-village"));
        // A relative XDG_DATA_HOME is invalid: the default.
        CHECK(data_dir_for("", env_of({{"XDG_DATA_HOME", "data"}, {"HOME", "/home/ana"}}), System::posix) ==
              fs::path("/home/ana/.local/share/rumor-village"));
        CHECK(data_dir_for("", env_of({{"HOME", "/home/ana"}}), System::posix) ==
              fs::path("/home/ana/.local/share/rumor-village"));
        CHECK(data_dir_for("", env_of({{"LOCALAPPDATA", "C:\\Users\\Ana\\AppData\\Local"}}), System::windows) ==
              fs::path("C:\\Users\\Ana\\AppData\\Local") / "RumorVillage");
        CHECK_THROWS_AS(data_dir_for("", env_of({}), System::posix), std::runtime_error);
        CHECK_THROWS_AS(data_dir_for("", env_of({{"HOME", "/home/ana"}}), System::windows), std::runtime_error);
    }

    TEST_CASE("the options of the launcher") {
        const auto parse = [](std::vector<std::string> args) {
            args.insert(args.begin(), "rumor-village");
            std::vector<char*> argv;
            for (std::string& arg : args) argv.push_back(arg.data());
            return parse_args(static_cast<int>(argv.size()), argv.data());
        };
        Args a = parse({});
        CHECK(a.data_dir.empty());
        CHECK_FALSE(a.no_browser);
        CHECK(a.port == kDefaultPort);
        a = parse({"--no-browser", "--data-dir", "/d", "--model-url", "http://h/m", "--port", "9000"});
        CHECK(a.no_browser);
        CHECK(a.data_dir == "/d");
        CHECK(a.model_url == "http://h/m");
        CHECK(a.port == 9000);
        CHECK_THROWS_AS(parse({"--port", "70000"}), UsageError);
        CHECK_THROWS_AS(parse({"--data-dir"}), UsageError);
        CHECK_THROWS_AS(parse({"--gpu"}), UsageError);
    }
}
