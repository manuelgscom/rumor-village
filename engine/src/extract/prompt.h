#pragma once
// Inside the extract package: the grammar and the system message of the
// `extract` task. Exposed for the tests of the package.
//
//   data/prompts/extract/system.<lang>.txt     rules, with {placeholders}
//   data/prompts/extract/examples.<lang>.jsonl one {"text","answer"} per line

#include <string>

#include "core/population_api.h"
#include "core/run_modes.h"

namespace rumor::extraction {

// GBNF, start rule "root": one compact JSON object with the keys what, who,
// where, when, amount in that order. `what`, `who` and `where` are short free
// strings, so a name outside the vocabulary reaches the validation; `when` is
// "<today|tomorrow> HH:MM" in steps of 30 minutes with the day words of
// `vocab`; `amount` is a non-negative integer.
std::string grammar(const Vocab& vocab);

// The system message.
//   full  the rules of data_dir/prompts/extract/system.<lang>.txt with the
//         lists of public places, neighbors and `what` labels and the examples
//   card  the lists of places and neighbors only, the same message as the
//         decisions in card mode (data_dir/prompts/<lang>/prefix_card.txt,
//         as card/render.cpp fills it): for fine-tuned models
// Throws std::runtime_error when a file is missing or wrong, or an example is
// not a valid fact.
std::string system_message(const std::string& data_dir, const Vocab& vocab,
                           const Population& population, PromptMode mode = PromptMode::full);

}  // namespace rumor::extraction
