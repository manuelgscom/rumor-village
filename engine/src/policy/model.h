#pragma once
// The policy that decides with the model. Per tick: one card and one grammar
// per request, one call to the batch, and each JSON read back as an action.
// The model proposes; validation (src/card/validate*) decides afterwards.
// Implemented in src/policy/model*.

#include <memory>
#include <ostream>

#include "card/render.h"
#include "core/policy.h"
#include "core/population_api.h"
#include "core/run_modes.h"
#include "llm/batch.h"

namespace rumor {

// Limits of output tokens, measured in phase 0: with less, some actions were
// cut and stopped being valid JSON.
inline constexpr int kMaxTokensWithoutText = 64;
inline constexpr int kMaxTokensWithText = 112;

struct ModelPolicyOptions {
    TextMode text = TextMode::all;
    PromptMode prompt = PromptMode::full;
    // If set, one line per decision, in request order, for the dialogue
    // review: the card as the model read it and its raw answer.
    //   {"tick":612,"who":"n001","kind":"turn","card":"...","output":"{...}",
    //    "cut":false,"truncated":false}
    // It is not the log: cards never go there.
    std::ostream* trace = nullptr;
};

// Sets the prefix of the batch (renderer.prefix(options.prompt)) once, here.
// Everything passed by reference must outlive the policy.
//
//   name()     "model"
//   model()    batch.info().file
//   decide()   seed, card and grammar of each request; want_text only for
//              turns: always with TextMode::all, never with none, and with
//              camera when the speaker or the listener is in the last list of
//              set_visible (none before the first); a JSON that cannot be read
//              gives RejectReason::malformed and a truncated one
//              RejectReason::truncated; `gen` is filled in every decision
//   take_perf  the samples of the batch
//   set_visible  keeps the list for TextMode::camera
std::unique_ptr<Policy> make_model_policy(llm::Batch& batch, const Renderer& renderer,
                                          const Vocab& vocab, const Population& population,
                                          const ModelPolicyOptions& options);

}  // namespace rumor
