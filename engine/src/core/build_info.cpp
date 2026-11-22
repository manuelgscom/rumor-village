#include "core/build_info.h"

// Defined for this file only by engine/CMakeLists.txt.
#ifndef RUMOR_ENGINE_COMMIT
#define RUMOR_ENGINE_COMMIT "unknown"
#endif
#ifndef RUMOR_LLAMA_COMMIT
#define RUMOR_LLAMA_COMMIT "unknown"
#endif
#ifndef RUMOR_VERSION
#define RUMOR_VERSION "unknown"
#endif
#ifndef RUMOR_BACKENDS
#define RUMOR_BACKENDS "none"
#endif

namespace rumor {

std::string_view engine_commit() { return RUMOR_ENGINE_COMMIT; }
std::string_view llama_commit() { return RUMOR_LLAMA_COMMIT; }
std::string_view engine_version() { return RUMOR_VERSION; }
std::string_view compiled_backends() { return RUMOR_BACKENDS; }

}  // namespace rumor
