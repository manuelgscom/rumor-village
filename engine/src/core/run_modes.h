#pragma once
// The two switches of a run with a model.

#include <cstdint>

#include "core/enum_keys.h"

namespace rumor {

// Whether the bubbles are written. The decision is the same either way: without
// text the generation stops before the `text` field (contract, section 3).
//   all     every turn
//   none    no turn
//   camera  the turns whose speaker or listener is on screen, as the live
//           server last said (Policy::set_visible); before it says, nobody is
enum class TextMode : std::uint8_t { all, none, camera };
RUMOR_ENUM_KEYS(TextMode, "all", "none", "camera");

// What goes before the card. `full`: rules, action schema, vocabulary lists,
// language instructions and examples, for base models. `card`: the vocabulary
// lists only, for fine-tuned models (contract, "La ficha de situación").
enum class PromptMode : std::uint8_t { full, card };
RUMOR_ENUM_KEYS(PromptMode, "full", "card");

}  // namespace rumor
