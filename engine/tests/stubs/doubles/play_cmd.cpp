// Stand-in for `rumor play` (phase 9, package A) in the isolated builds that
// link cli/cli without the game.
#include <stdexcept>

#include "core/game_api.h"

namespace rumor {

int play_command(int, char**) {
    throw std::runtime_error("play is not implemented in this build");
}

}  // namespace rumor
