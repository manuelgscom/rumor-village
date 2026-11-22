// Stand-in for `rumor prompts` (phase 5, package M).
#include <stdexcept>

#include "cli/prompts.h"

namespace rumor {

int prompts_command(int, char**) {
    throw std::runtime_error("prompts is not implemented in this build");
}

}  // namespace rumor
