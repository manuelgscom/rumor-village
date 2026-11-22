#pragma once
// What this binary was built from. A results card carries it, so that a figure
// can be traced to the code that produced it (docs/medicion.md, "Reglas").

#include <string_view>

namespace rumor {

// The version of the contract (docs/contrato.md): the log format 1 together
// with the `when` encoding closed in phase 1. A change in the card, the action
// or the log bumps it; datasets and results cards are only comparable within
// one version.
inline constexpr int kContractVersion = 1;

// `git describe --always --dirty` of the repo at build time, or "unknown".
std::string_view engine_commit();

// Commit of the llama.cpp submodule at build time, or "unknown".
std::string_view llama_commit();

// The version of the game (dist/VERSION, phase 10): "1.0.0", or "unknown".
std::string_view engine_version();

// The GPU backends of llama.cpp linked in: "cuda", "vulkan", "cuda vulkan" or
// "none" (a build without them, or without llama.cpp).
std::string_view compiled_backends();

}  // namespace rumor
