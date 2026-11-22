#pragma once
// From what the launcher found on this computer (the probes, probe.h) to
// whether the game can run Con IA, why not, and what the console says
// (docs/fases/fase-10.md, "C. Lanzador"). Pure: the tests feed it made-up
// probes.
//
//  backends of the binary ──► driver_verdict ──► ggml may be touched? ──► detect
//  CUDA driver, Vulkan loader     (no ggml)        (GPU device)          {ai_ok, reason,
//                                                                         device, console}

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace rumor::launcher {

// The oldest NVIDIA driver that runs a CUDA 12.x build (CUDA minor version
// compatibility): the one of CUDA 12.0, 525.60.13 on Linux and 528.33 on
// Windows. cuDriverGetVersion() gives it as 1000 * major + 10 * minor.
inline constexpr int kMinCudaDriver = 12000;

// The language of the console: Spanish when the system is, English otherwise.
enum class UiLang { es, en };

// An environment lookup: the value of a variable, or nullopt when unset.
using EnvFn = std::function<std::optional<std::string>(const std::string& name)>;

// Spanish when the first set of LC_ALL, LC_MESSAGES and LANG starts with "es".
UiLang lang_from_env(const EnvFn& env);

// What was found. The driver probes come first and never touch ggml; the ggml
// ones are filled only when driver_verdict() gives a backend.
struct Probes {
    std::string backends = "none";  // compiled_backends(): "cuda", "vulkan", "cuda vulkan", "none"
    // The NVIDIA driver library (libcuda.so.1, nvcuda.dll); looked at in CUDA builds.
    bool cuda_library = false;
    bool cuda_init = false;  // cuInit(0) succeeded
    int cuda_devices = 0;    // cuDeviceGetCount
    int cuda_driver = 0;     // cuDriverGetVersion; 0: unknown
    std::string cuda_name;   // name of the first NVIDIA card
    // The Vulkan loader (libvulkan.so.1, vulkan-1.dll); looked at in Vulkan builds.
    bool vulkan_loader = false;
    // ggml, as llm/llama_batch.cpp picks the device: CUDA0, or the first GPU.
    bool ggml_checked = false;
    std::string gpu_name;         // "CUDA0", "Vulkan0"; empty: no GPU device
    std::string gpu_description;  // "NVIDIA GeForce RTX 5070 Ti"
};

// The backend the drivers allow ("cuda" or "vulkan"), or empty with the
// reason. Only with a backend may ggml be touched: without the library of the
// backend, ggml can abort (and on Windows vulkan-1.dll is delay-loaded).
struct DriverVerdict {
    std::string backend;
    std::string reason;
};
DriverVerdict driver_verdict(const Probes& probes);

struct Detection {
    bool ai_ok = false;
    // Empty when ai_ok; else a key of aiReasons (viewer/js/game/strings.js),
    // what GET /state says in ai.reason.
    std::string reason;
    std::string backend;               // "cuda" or "vulkan" when ai_ok
    std::string device;                // the ggml device when ai_ok
    std::vector<std::string> console;  // what was found, one line each
};

Detection detect(const Probes& probes, UiLang lang);

// What a message may need besides its reason.
struct MessageArgs {
    std::string folder;        // no_space, no_model, no_curl: where the model goes
    std::string file;          // no_model: the file of the model
    std::string url;           // no_curl: where to download it by hand
    std::uint64_t bytes = 0;   // no_space: what is needed
};

// The console message of a reason (the table of the phase file, plus
// no_curl, no_model and model_error).
std::string reason_message(const std::string& reason, UiLang lang, const MessageArgs& args = {});

// "5,34" (es) or "5.34" (en): gigabytes (10^9 bytes) with two decimals.
std::string gigabytes(std::uint64_t bytes, UiLang lang);

// The mode line: "Modo: Con IA" / "Mode: With AI", "Modo: Sin IA" / "Mode: Without AI".
std::string mode_line(bool ai, UiLang lang);

}  // namespace rumor::launcher
