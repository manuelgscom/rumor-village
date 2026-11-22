// Stand-in for `rumor run --serve` (cli/serve.cpp): there is no live server in
// this build.
#include <stdexcept>

#include "cli/serve.h"

namespace rumor {

void block_stop_signals() {}

void serve_to_stream(const RunOptions&, const LiveOptions&, std::ostream&, llm::Batch*,
                     std::ostream*, const OnListen&) {
    throw std::runtime_error("serve is not implemented in this build");
}

}  // namespace rumor
