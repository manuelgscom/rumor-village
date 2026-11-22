#pragma once
// What the model reads and what it may write (contract, section 3): the common
// prefix, the situation card of one decision and the grammar of its answer, in
// the language of the run. Implemented in src/card/render* from data/prompts/.
//
// All three are plain text without the chat template: the batch adds it.

#include <memory>
#include <string>

#include "core/action.h"
#include "core/decision.h"
#include "core/population_api.h"
#include "core/run_modes.h"

namespace rumor {

// Max characters (code points) of "text" in the grammar of a turn: one or two
// sentences, well inside the output limit of 112 tokens together with the
// longest claim (measured in the tests). `rumor validate` holds answers to it.
inline constexpr int kTextMaxChars = 120;

class Renderer {
  public:
    virtual ~Renderer() = default;

    // The system message, identical for every neighbor of the run.
    //   full  the village and its rules, the action schema, the lists of places
    //         and neighbors, the language instructions and examples
    //   card  the lists of places and neighbors only
    // No leading or trailing whitespace.
    virtual std::string prefix(PromptMode mode) const = 0;

    // The situation card of one decision: who you are, time and place, who is
    // in front of you, what you know, what happened in this conversation (from
    // the data, never from an earlier text) and the kind of decision. Names,
    // not identifiers; hours in digits. No leading or trailing whitespace.
    virtual std::string card(const DecisionRequest& request) const = 0;

    // GBNF of the answer to a decision of this kind, start rule "root": one
    // compact JSON object that starts with '{', with the keys of the contract
    // in their order.
    //   turn  say (greet, tell, ask, bye) or none
    //   plan  go or none
    // Places are the public ones in the language of the run, neighbors those of
    // the run, hours in steps of 30 minutes with the two day words. `fact` is a
    // small integer: the engine validates the reference. The grammar does not
    // depend on the request, so there are two per run.
    virtual std::string grammar(DecisionKind kind) const = 0;
};

// Reads data_dir/prompts/<lang>/. `vocab` and `population` must outlive the
// renderer. Throws std::runtime_error when a file is missing or wrong.
std::unique_ptr<Renderer> make_renderer(const std::string& data_dir, const Vocab& vocab,
                                        const Population& population);

}  // namespace rumor
