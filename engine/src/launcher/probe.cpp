// The probes of this computer (probe.h).

#include "launcher/probe.h"

#include <cstddef>
#include <string>

#include <ggml-backend.h>

#include "core/build_info.h"
#include "launcher/os.h"

namespace rumor::launcher {
namespace {

bool is_gpu(ggml_backend_dev_t dev) {
    const auto type = ggml_backend_dev_type(dev);
    return type == GGML_BACKEND_DEVICE_TYPE_GPU || type == GGML_BACKEND_DEVICE_TYPE_IGPU;
}

// The device llm/llama_batch.cpp (pick_device) would take: CUDA0, or the
// first GPU.
void probe_ggml(Probes& p) {
    p.ggml_checked = true;
    ggml_backend_dev_t chosen = ggml_backend_dev_by_name("CUDA0");
    if (chosen && !is_gpu(chosen)) chosen = nullptr;
    for (std::size_t i = 0; !chosen && i < ggml_backend_dev_count(); ++i) {
        ggml_backend_dev_t dev = ggml_backend_dev_get(i);
        if (is_gpu(dev)) chosen = dev;
    }
    if (!chosen) return;
    p.gpu_name = ggml_backend_dev_name(chosen);
    const char* description = ggml_backend_dev_description(chosen);
    if (description) p.gpu_description = description;
}

}  // namespace

Probes gather_probes() {
    Probes p;
    p.backends = std::string(compiled_backends());
    if (p.backends.find("cuda") != std::string::npos) os::probe_cuda(p);
    if (p.backends.find("vulkan") != std::string::npos) os::probe_vulkan(p);
    if (!driver_verdict(p).backend.empty()) probe_ggml(p);
    return p;
}

}  // namespace rumor::launcher
