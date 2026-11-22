// Stand-in for the model policy (package D).
#include <stdexcept>

#include "policy/model.h"

namespace rumor {

std::unique_ptr<Policy> make_model_policy(llm::Batch&, const Renderer&, const Vocab&,
                                          const Population&, const ModelPolicyOptions&) {
    throw std::runtime_error("the model policy is not implemented in this build");
}

}  // namespace rumor
