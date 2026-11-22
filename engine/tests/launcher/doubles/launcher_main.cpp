// Stand-in for the launcher (phase 10, launcher/launcher.h) in the isolated
// builds that link cli/cli without it.
#include <stdexcept>

#include "launcher/launcher.h"

namespace rumor {

int launcher_main(int, char**) { throw std::runtime_error("the launcher is not in this build"); }

}  // namespace rumor
