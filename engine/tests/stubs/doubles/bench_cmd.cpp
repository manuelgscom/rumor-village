// Stand-in for `rumor bench` (package E).
#include <stdexcept>

#include "cli/bench.h"

namespace rumor {

int bench_command(int, char**) {
    throw std::runtime_error("bench is not implemented in this build");
}

}  // namespace rumor
