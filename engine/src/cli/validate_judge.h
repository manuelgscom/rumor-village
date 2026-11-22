#pragma once
// The judgement of one answer against its card, for `rumor validate`
// (cli/validate.h). Package C of phase 4. Implemented in
// src/cli/validate_judge.cpp.
//
// The reasons of a discard (training/README.md, "Veredicto"), in the order a
// verdict lists them:
//
//   unreadable                the answer cannot be read as an action (decide)
//                             or a fact (extract), or it is empty
//   bad_shape                 it reads, but its values break the grammar: a
//                             `say` without text, a text outside the grammar
//                             (empty, over kTextMaxChars, with quotes,
//                             backslashes or control characters), an amount of
//                             more than 7 digits, an extract `what` over 40
//                             characters or with those characters, or a
//                             repeated key. Key order and null keys are not a
//                             fault: `canonical` writes them as the grammar does
//   rejected:<reason>         validate() rejects the action
//   contradiction, invented   a slot fails (decide: against the memory; extract:
//                             against the expected fact)
//   hardened_doubt            a doubt said as sure (decide)
//   go_without_place_or_time  a `go` left without where or when after validation
//   incoherent_text           check_text() finds the text contradicts the claim
//   bad_vocab                 extract: a neighbor or a place outside the vocabulary
//   contract_version          the card carries another contract version

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "card/record.h"
#include "card/render.h"
#include "card/textcheck.h"
#include "core/population_api.h"
#include "core/verdict.h"

namespace rumor {

// What the judgement needs of the village of a card: its names, as `rumor run`
// loads them, and the names the text detector looks for.
struct JudgeVillage {
    Vocab vocab;
    Population population;
    TextCheckContext text;  // speaker and listener unset: set per answer
};

// Loads the village of `record` from `data_dir` (card/record.h).
JudgeVillage load_judge_village(const std::string& data_dir, const CardRecord& record);

struct AnswerVerdict {
    std::vector<std::string> reasons;  // empty when the answer is kept
    // decide: the verdict of each slot when the action is not rejected and
    // carries a claim. extract: each slot against the expected fact, when the
    // card has one and the answer reads.
    std::optional<PerSlot<SlotVerdict>> slots;
    // The answer as the grammar writes it (card/render.cpp, extract/prompt.cpp):
    // compact, the keys of the contract in grammar order and only those that
    // apply, the claim with its five keys, names instead of identifiers, `when`
    // as "<day> HH:MM" relative to the tick of the card in its language, guess
    // in slot order without repeats. The action as proposed: failed slots stay.
    // An extract fact with its five keys. Null when the answer is unreadable or
    // the action is rejected.
    std::optional<std::string> canonical;

    bool ok() const { return reasons.empty(); }
};

// Judges `raw`, the answer to `record`. Never throws on a bad answer.
AnswerVerdict judge_answer(const CardRecord& record, std::string_view raw,
                           const JudgeVillage& village);

// One line of verdicts.jsonl, without the final newline:
// {"id","ok","reasons","slots","canonical"}.
std::string verdict_line(const std::string& id, const AnswerVerdict& verdict);

}  // namespace rumor
