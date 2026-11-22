#pragma once
// The probes of this computer (detect.h): first the drivers (os.h), then, only
// if driver_verdict() allows it, the GPU devices of ggml.

#include "launcher/detect.h"

namespace rumor::launcher {

Probes gather_probes();

}  // namespace rumor::launcher
