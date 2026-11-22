#pragma once
// What the tests may look at inside the llama.cpp batch (llama_batch.cpp).
// Not for the rest of the engine: it only needs batch.h.

#include <cstdint>
#include <utility>
#include <vector>

#include "llm/batch.h"

namespace rumor::llm {

// Largest output a request may ask for (Request::max_tokens). The context is
// sized with it. Phase 0 measured 64 without text and 112 with text.
inline constexpr int kMaxOutputTokens = 128;

// Largest shared part (pre + prefix + mid of set_prefix, or the system message
// of run_single with its template). The context is sized with it.
inline constexpr int kMaxSharedTokens = 2048;

// The 32-bit seed of the sampler of a request: the two halves of the 64-bit
// seed folded together. Never LLAMA_DEFAULT_SEED, which llama.cpp would
// replace with a random one.
std::uint32_t fold_seed(std::uint64_t seed);

// Positions held in the memory by each sequence 0..N of a batch made by
// make_llama_batch, as {pos_min, pos_max}; {-1, -1} when it holds nothing.
// Throws std::runtime_error for any other Batch.
std::vector<std::pair<int, int>> memory_positions(const Batch& batch);

// Tokens of the shared part processed by set_prefix (0 before it).
int shared_tokens(const Batch& batch);

}  // namespace rumor::llm
