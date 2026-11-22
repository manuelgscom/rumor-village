#pragma once
// `rumor validate`: judges each answer of labels.jsonl (or train.jsonl) against
// the state of its card in cards.jsonl (card/record.h) and writes one verdict
// per answer in verdicts.jsonl (training/README.md), with the answer in the
// canonical form of the grammar. Package C of phase 4.
// Implemented in src/cli/validate*.
//
//   rumor validate --in <labels.jsonl|train.jsonl> --cards <cards.jsonl>
//                  --out <verdicts.jsonl> [--strict] [--data <dir>]

namespace rumor {

// Returns the exit code; throws UsageError (cli/usage.h) on a bad command line.
int validate_command(int argc, char** argv);

}  // namespace rumor
