// Stand-in for the card renderer (package B).
#include <stdexcept>

#include "card/render.h"

namespace rumor {

std::unique_ptr<Renderer> make_renderer(const std::string&, const Vocab&, const Population&) {
    throw std::runtime_error("the card renderer is not implemented in this build");
}

}  // namespace rumor
