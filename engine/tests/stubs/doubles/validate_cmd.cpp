// Stand-in for `rumor validate` (phase 4, package C).
#include <stdexcept>

#include "cli/validate.h"

namespace rumor {

int validate_command(int, char**) {
    throw std::runtime_error("validate is not implemented in this build");
}

}  // namespace rumor
