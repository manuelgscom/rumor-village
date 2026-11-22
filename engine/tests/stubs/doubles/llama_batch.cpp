// Stand-in for the llama.cpp batch (package A): there is no model runtime in
// this build.
#include <stdexcept>

#include "llm/batch.h"

namespace rumor::llm {

std::unique_ptr<Batch> make_llama_batch(const BatchOptions&) {
    throw std::runtime_error("the model runtime is not implemented in this build");
}

}  // namespace rumor::llm
