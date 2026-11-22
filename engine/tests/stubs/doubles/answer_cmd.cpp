// Stand-in for `rumor answer` (phase 5, package M).
#include <stdexcept>

#include "cli/answer.h"

namespace rumor {

int answer_command(int, char**) {
    throw std::runtime_error("answer is not implemented in this build");
}

}  // namespace rumor
