#pragma once
// `rumor prompts`: the prompt of every card of a cards.jsonl (card/record.h) as
// the engine gives it to the model, without running any model. Phase 5,
// package M (training/finetune/README.md, "rumor prompts"). Implemented in
// src/cli/prompts*; `rumor answer` (cli/answer.h) builds its prompts here too.
//
//   rumor prompts --cards <cards.jsonl> --prompt full|card --out <prompts.jsonl>
//                 [--vocab <gguf>] [--data <dir>]
//
// One line per card, in the order of the file:
//
//   {"id","task","lang","prompt","system","user"[,"tokens"]}
//
//   system  the system message the engine uses in that mode for the language,
//           the task and the village of the card (full: rules, schema, lists
//           and examples; card: the lists only)
//   user    the card (decide) or the sentence (extract)
//   tokens  with --vocab: the ids of the whole prompt as the engine tokenizes
//           it, from the BOS to the opening of the model turn included:
//             tokenize(pre + system + mid, BOS) + tokenize(user + post)
//           Only the vocabulary of the GGUF is loaded (llm/model_vocab.h).
//           (--vocab and not --model: scripts/rumor.sh sends every command
//           with --model to the GPU image.)
//
// The card of a decide record is rendered again from its `state`; when it is
// not the `card` of the record the command fails naming the id. In full mode
// the system message must also have the `prefix` id of the record. Nothing is
// written when a card fails.
//
// The village of an extract card is that of `rumor cards` and `rumor extract`:
// 100 neighbors, layout village, seed 1, in the language of the card.

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <tuple>
#include <vector>

#include "card/record.h"
#include "core/run_modes.h"
#include "llm/model_vocab.h"

namespace rumor {

// Returns the exit code; throws UsageError (cli/usage.h) on a bad command line.
int prompts_command(int argc, char** argv);

// The prompt of one card.
struct CardPrompt {
    std::string system;   // the system message
    std::string user;     // the card (decide) or the sentence (extract)
    std::string grammar;  // GBNF of the answer: that of the policy (by kind) or the extractor
};

// Builds the prompts of the cards of one mode, loading each village once.
class PromptBuilder {
  public:
    PromptBuilder(std::string data_dir, PromptMode mode);
    ~PromptBuilder();
    PromptBuilder(const PromptBuilder&) = delete;
    PromptBuilder& operator=(const PromptBuilder&) = delete;

    PromptMode mode() const { return mode_; }

    // Throws std::runtime_error ("<id>: ...") when the rendered card or, in
    // full mode, the prefix id is not that of the record.
    CardPrompt build(const CardRecord& record);

  private:
    struct Village;
    using VillageKey = std::tuple<Lang, int, Layout, std::uint64_t>;
    Village& village(const VillageKey& key);

    std::string data_dir_;
    PromptMode mode_;
    std::map<VillageKey, std::unique_ptr<Village>> villages_;
};

// The cards of a cards.jsonl, in order. Throws std::runtime_error with the
// line on a card that does not read or a repeated id.
std::vector<CardRecord> read_card_file(const std::string& path);

// The tokens of a whole prompt (see above).
std::vector<std::int32_t> prompt_tokens(const llm::ModelVocab& vocab, const llm::ChatWrap& wrap,
                                        const CardPrompt& prompt);

// One line of prompts.jsonl, without the final newline. `tokens` may be null.
std::string prompt_line(const CardRecord& record, PromptMode mode, const CardPrompt& prompt,
                        const std::vector<std::int32_t>* tokens);

}  // namespace rumor
