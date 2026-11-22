#pragma once
// `rumor bench`: N runs of one scenario in one language, and a results card
// in JSON and Markdown (docs/medicion.md, "El comando de benchmark").
// Implemented in src/cli/bench*.
//
//   rumor bench --model <gguf> | --policy baseline
//               --scenario <name> --lang <es|en> --runs <N>
//               [--seed-base <S>] [--out <dir>] [--data <dir>] [--trace]
//               [--text <all|none>] [--prompt <full|card>] [--batch <N>]
//               [--device <name>] [--sample-threads <N>]
//
//   <out>/seed-<s>.jsonl         one log per run, seeds S, S+1, ... (S defaults to 1)
//   <out>/seed-<s>.trace.jsonl   with --trace: card and raw answer of every decision
//   <out>/card.json, card.md     the results card
//   <out>/setup.json             prompt and text modes: {"prompt","text"}
//
// The model is loaded once. Resumable: a run whose log already ends with an
// `end` event is skipped, an incomplete one is run again; a folder whose
// setup.json says other modes is an error (bench_card.h, claim_bench_setup).
// <out> defaults to runs/bench/<model file or "baseline">/<scenario>-<lang>,
// with "-notext" appended when --text none and "-card" when --prompt card.
//
// The card: for every number of `rumor metrics`, mean and 95 % confidence
// interval over the runs (bootstrap with a fixed seed), plus the contract
// version, engine and llama.cpp commits, model, device, batch size, sampling,
// text and prompt modes, and the seeds.

namespace rumor {

// Returns the exit code; throws UsageError (cli/usage.h) on a bad command line.
int bench_command(int argc, char** argv);

}  // namespace rumor
