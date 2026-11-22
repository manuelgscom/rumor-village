// Stand-in for `rumor cards` (phase 4, package A).
#include <stdexcept>

#include "cli/cards.h"

namespace rumor {

int cards_command(int, char**) {
    throw std::runtime_error("cards is not implemented in this build");
}

}  // namespace rumor
