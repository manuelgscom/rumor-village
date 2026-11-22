#pragma once
// `rumor answer`: a model answers every card of a cards.jsonl (card/record.h)
// with the prompt of the engine, for the evaluation of phase 5
// (training/finetune/README.md, "rumor answer"). Package M. Implemented in
// src/cli/answer*.
//
//   rumor answer --cards <cards.jsonl> --model <gguf> --prompt full|card --out <labels.jsonl>
//                [--grammar on|off] [--sampling model|greedy] [--batch 16] [--seed 1]
//                [--limit N] [--perf <perf.json>] [--data <dir>] [--device <name>]
//
// One line per card, {"id","raw","tokens_in","tokens_out"}: what `rumor
// validate --in` reads. `raw` is the output as the model wrote it, also when
// the token limit cut it (validate then finds it unreadable).
//
//   prompt     that of `rumor prompts` (cli/prompts.h), checked the same way:
//              system message once per village (Batch::set_prefix), the card or
//              the sentence as user message
//   grammar    on: the grammar of the policy for the kind of the card in its
//              village (card/render.h), or that of the extractor; off: none
//   sampling   model: the sampling of the GGUF with the seed of each card,
//              card_seed(--seed, fingerprint); greedy: the most likely token.
//              Extract cards are always greedy, as in the engine
//   text       a turn always writes its `text` (as --text all); a plan never
//              has one (as the policy). Token limits those of the policy
//              (policy/model.h) and of the extractor (extract/extract.h)
//   --limit N  only the first N cards of the file
//   --perf     {"cards","seconds","decisions_per_s","tokens_per_s","vram_mb",
//              "batch","prompt"} of the cards answered by this call; not
//              written when there was nothing to answer
//
// Resumable: the ids already in --out are skipped and new lines are appended,
// one batch at a time. A last line cut by a crash (no final newline) is
// dropped first. A line of --out that does not read, or whose id is not a card
// of the file, stops the command: the file belongs to something else. The
// cards are answered grouped by system message (in order of first
// appearance), so the lines of --out need not follow the order of the cards.

#include <cstdint>
#include <cstddef>
#include <functional>
#include <optional>
#include <string>
#include <string_view>

#include "card/record.h"
#include "cli/prompts.h"
#include "core/enum_keys.h"
#include "core/run_modes.h"
#include "llm/batch.h"

namespace rumor {

// Returns the exit code; throws UsageError (cli/usage.h) on a bad command line.
int answer_command(int argc, char** argv);

enum class Sampling : std::uint8_t { model, greedy };
RUMOR_ENUM_KEYS(Sampling, "model", "greedy");

struct AnswerOptions {
    std::string cards_path;
    std::string out_path;
    std::string perf_path;  // empty: no perf.json
    std::string data_dir = "data";
    PromptMode prompt = PromptMode::full;
    bool grammar = true;
    Sampling sampling = Sampling::model;
    std::uint64_t seed = 1;
    std::optional<std::size_t> limit;
};

struct AnswerStats {
    std::size_t cards = 0;    // answered by this call
    std::size_t skipped = 0;  // already in --out
    double seconds = 0;       // generation only, without loading the model
    std::int64_t tokens_out = 0;
    int vram_mb = 0;  // largest of the samples of the batch
};

// The seed of a card: from the seed of the command and the first 64 bits of
// its fingerprint, so a card has the same seed in every model and every order.
std::uint64_t card_seed(std::uint64_t seed, std::string_view fingerprint);

// The request of one card (see above).
llm::Request answer_request(const CardRecord& card, const CardPrompt& prompt,
                            const AnswerOptions& options);

// The whole command without parsing and without loading the model: reads the
// cards and --out, then answers what is missing with the batch that
// `get_batch` returns (called once, and only when something is missing), and
// writes --perf. Throws std::runtime_error.
AnswerStats answer_cards(const AnswerOptions& options,
                         const std::function<llm::Batch&()>& get_batch);

}  // namespace rumor
