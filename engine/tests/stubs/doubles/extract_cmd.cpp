// Stand-in for `rumor extract` (package C).
#include <stdexcept>

#include "extract/extract.h"

namespace rumor {

int extract_command(int, char**) {
    throw std::runtime_error("extract is not implemented in this build");
}

}  // namespace rumor
