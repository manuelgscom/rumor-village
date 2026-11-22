// From the probes to Con IA or Sin IA, and the console (detect.h).

#include "launcher/detect.h"

#include <string_view>

namespace rumor::launcher {
namespace {

bool has_word(std::string_view list, std::string_view word) {
    std::size_t at = 0;
    while (at <= list.size()) {
        std::size_t end = list.find(' ', at);
        if (end == std::string_view::npos) end = list.size();
        if (list.substr(at, end - at) == word) return true;
        at = end + 1;
    }
    return false;
}

std::string replace_all(std::string text, std::string_view key, const std::string& value) {
    for (std::size_t at = text.find(key); at != std::string::npos; at = text.find(key, at + value.size())) {
        text.replace(at, key.size(), value);
    }
    return text;
}

// "12.9" from 12090.
std::string cuda_version_text(int version) {
    return std::to_string(version / 1000) + "." + std::to_string(version % 1000 / 10);
}

std::string backends_text(const std::string& backends, UiLang lang) {
    const bool es = lang == UiLang::es;
    const bool cuda = has_word(backends, "cuda");
    const bool vulkan = has_word(backends, "vulkan");
    if (cuda && vulkan) return es ? "CUDA y Vulkan" : "CUDA and Vulkan";
    if (cuda) return "CUDA";
    if (vulkan) return "Vulkan";
    return es ? "ninguno (sin GPU)" : "none (no GPU)";
}

}  // namespace

UiLang lang_from_env(const EnvFn& env) {
    for (const char* name : {"LC_ALL", "LC_MESSAGES", "LANG"}) {
        const std::optional<std::string> value = env(name);
        if (!value || value->empty()) continue;
        return value->rfind("es", 0) == 0 ? UiLang::es : UiLang::en;
    }
    return UiLang::en;
}

DriverVerdict driver_verdict(const Probes& p) {
    const bool cuda = has_word(p.backends, "cuda");
    const bool vulkan = has_word(p.backends, "vulkan");
    if (!cuda && !vulkan) return {"", "no_gpu"};
    std::string cuda_reason;
    if (cuda) {
        const bool nvidia = p.cuda_library && p.cuda_init && p.cuda_devices > 0;
        if (nvidia && p.cuda_driver >= kMinCudaDriver) return {"cuda", ""};
        cuda_reason = nvidia ? "old_driver" : "no_nvidia";
        if (!vulkan) return {"", cuda_reason};
    }
    if (p.vulkan_loader) return {"vulkan", ""};
    // A build with both (the one of the repo): an old NVIDIA driver says so;
    // nothing at all is no GPU.
    if (cuda) return {"", cuda_reason == "old_driver" ? cuda_reason : "no_gpu"};
    return {"", "no_vulkan"};
}

Detection detect(const Probes& p, UiLang lang) {
    const bool es = lang == UiLang::es;
    Detection d;
    d.console.push_back((es ? "Precompilado: " : "Build: ") + backends_text(p.backends, lang));
    if (has_word(p.backends, "cuda")) {
        std::string line = "NVIDIA: ";
        if (!p.cuda_library) {
            line += es ? "no se encuentra el controlador" : "no driver found";
        } else if (!p.cuda_init || p.cuda_devices == 0) {
            line += es ? "el controlador no ve ninguna tarjeta" : "the driver sees no card";
        } else {
            line += (p.cuda_name.empty() ? std::string("?") : p.cuda_name);
            if (p.cuda_devices > 1) line += " (+" + std::to_string(p.cuda_devices - 1) + ")";
        }
        if (p.cuda_library && p.cuda_driver > 0) {
            line += (es ? ", controlador para CUDA " : ", driver for CUDA ") + cuda_version_text(p.cuda_driver);
            if (p.cuda_driver < kMinCudaDriver) {
                line += (es ? " (hace falta " : " (needs ") + cuda_version_text(kMinCudaDriver) + ")";
            }
        }
        d.console.push_back(line);
    }
    if (has_word(p.backends, "vulkan")) {
        d.console.push_back(p.vulkan_loader ? (es ? "Vulkan: encontrado" : "Vulkan: found")
                                            : (es ? "Vulkan: no se encuentra" : "Vulkan: not found"));
    }

    const DriverVerdict verdict = driver_verdict(p);
    if (verdict.backend.empty()) {
        d.reason = verdict.reason;
    } else if (!p.ggml_checked || p.gpu_name.empty()) {
        if (p.ggml_checked) {
            d.console.push_back(es ? "Tarjeta gráfica: ninguna que pueda mover la IA"
                                   : "Graphics card: none that can run the AI");
        }
        d.reason = "no_gpu";
    } else {
        d.ai_ok = true;
        d.backend = verdict.backend;
        d.device = p.gpu_name;
        std::string line = (es ? "Tarjeta gráfica: " : "Graphics card: ");
        line += p.gpu_description.empty() ? p.gpu_name : p.gpu_description + " (" + p.gpu_name + ")";
        d.console.push_back(line);
    }
    return d;
}

std::string gigabytes(std::uint64_t bytes, UiLang lang) {
    // Rounded to hundredths of a gigabyte, in integers.
    const std::uint64_t hundredths = (bytes + 5'000'000) / 10'000'000;
    const auto cents = static_cast<int>(hundredths % 100);
    const std::string decimals{static_cast<char>('0' + cents / 10), static_cast<char>('0' + cents % 10)};
    return std::to_string(hundredths / 100) + (lang == UiLang::es ? "," : ".") + decimals;
}

std::string reason_message(const std::string& reason, UiLang lang, const MessageArgs& args) {
    const bool es = lang == UiLang::es;
    std::string text;
    if (reason == "no_gpu") {
        text = es ? "No hay una tarjeta gráfica que pueda mover la IA. Juegas en modo Sin IA."
                  : "There is no graphics card that can run the AI. You play in Without AI mode.";
    } else if (reason == "no_nvidia") {
        text = es ? "Este precompilado es para tarjetas NVIDIA y tu equipo no tiene una. Para jugar con IA, "
                    "descarga el de Vulkan."
                  : "This build is for NVIDIA cards and your computer has none. To play with AI, download "
                    "the Vulkan one.";
    } else if (reason == "old_driver") {
        text = es ? "Tu controlador de NVIDIA es anterior al que hace falta. Actualiza el controlador o usa el "
                    "precompilado de Vulkan."
                  : "Your NVIDIA driver is older than the one needed. Update the driver or use the Vulkan "
                    "build.";
    } else if (reason == "no_vulkan") {
        text = es ? "No se encuentra Vulkan. Actualiza el controlador de tu tarjeta gráfica."
                  : "Vulkan was not found. Update the driver of your graphics card.";
    } else if (reason == "no_space") {
        text = es ? "Hacen falta {gb} GB libres en {folder}." : "{gb} GB of free space are needed in {folder}.";
    } else if (reason == "download_cut") {
        text = es ? "La descarga se reanudará la próxima vez." : "The download will resume next time.";
    } else if (reason == "download_bad") {
        text = es ? "El modelo descargado está dañado. Se volverá a descargar."
                  : "The downloaded model is damaged. It will be downloaded again.";
    } else if (reason == "no_curl") {
        text = es ? "No se encuentra el programa curl para descargar el modelo. Puedes bajarlo a mano de "
                    "{url} y dejarlo en {folder}."
                  : "The program curl, needed to download the model, was not found. You can download it "
                    "by hand from {url} and put it in {folder}.";
    } else if (reason == "no_model") {
        text = es ? "Falta el modelo. Para jugar con IA, pon el fichero {file} en {folder}."
                  : "The model is missing. To play with AI, put the file {file} in {folder}.";
    } else if (reason == "model_error") {
        text = es ? "El modelo no ha arrancado en tu tarjeta gráfica." : "The model did not start on your graphics card.";
    } else {
        text = reason;
    }
    text = replace_all(text, "{gb}", gigabytes(args.bytes, lang));
    text = replace_all(text, "{folder}", args.folder);
    text = replace_all(text, "{file}", args.file);
    text = replace_all(text, "{url}", args.url);
    return text;
}

std::string mode_line(bool ai, UiLang lang) {
    if (lang == UiLang::es) return ai ? "Modo: Con IA" : "Modo: Sin IA";
    return ai ? "Mode: With AI" : "Mode: Without AI";
}

}  // namespace rumor::launcher
