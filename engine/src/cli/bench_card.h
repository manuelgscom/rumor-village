#pragma once
// The parts of `rumor bench` (cli/bench.h) that the tests reach: the bootstrap
// interval, the card built from the metrics of each run and its Markdown.
// Implemented in src/cli/bench_card.cpp.

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/catalog.h"
#include "core/run_modes.h"
#include "core/sim_api.h"
#include "llm/batch.h"

namespace rumor {

// Version of the layout of card.json. A change in its keys bumps it.
inline constexpr int kBenchCardFormat = 1;

// The interval: percentile bootstrap of the mean, always with the same seed,
// so that the same logs give the same card.
inline constexpr int kBootstrapResamples = 2000;
inline constexpr std::uint64_t kBootstrapSeed = 0x62656E6368ULL;  // "bench"
inline constexpr double kConfidence = 0.95;

struct Interval {
    int runs = 0;  // values that went in; 0: no run brings the number
    double mean = 0;
    double lo = 0;  // 2.5 % percentile of the resampled means
    double hi = 0;  // 97.5 %
};

// Mean and 95 % interval of `values` (in seed order). With one value the
// interval is the value itself.
Interval bootstrap(const std::vector<double>& values);

// The metrics of several runs (compute_metrics, one per run) merged into one
// tree with the same keys: every number becomes
//   {"runs": k, "mean": m, "lo": a, "hi": b}
// over the k runs in which it is a number (null mean, lo and hi when k is 0);
// a string stays when every run has the same one. Objects and arrays are
// merged key by key and index by index. The keys that identify a run (format,
// scenario, lang, policy, model, seed) are left out: the card says them once.
nlohmann::ordered_json aggregate_metrics(const std::vector<nlohmann::ordered_json>& runs);

// What the card says about how the runs were made.
struct BenchSetup {
    std::string scenario;
    Lang lang = Lang::es;
    std::string policy;                   // "baseline" or "model"
    std::optional<llm::ModelInfo> model;  // only with the model policy
    TextMode text = TextMode::all;        // only with the model policy
    PromptMode prompt = PromptMode::full;
    std::vector<std::uint64_t> seeds;
};

// card.json:
//   {"card","contract_version","engine_commit","llama_commit","scenario",
//    "lang","policy","model","text","prompt","runs","seeds","interval",
//    "metrics"}
// "model" is {"file","description","device","n_parallel","temperature",
// "top_k","top_p"} or null; "text" and "prompt" are null with the baseline.
nlohmann::ordered_json make_card(const BenchSetup& setup,
                                 const std::vector<nlohmann::ordered_json>& metrics);

// card.md, in Spanish, from a card made by make_card.
std::string card_markdown(const nlohmann::ordered_json& card);

// runs/bench/<model file without extension, or "baseline">/<scenario>-<lang>,
// plus "-notext" with the model and --text none, or "-camera" with --text camera
// (which, without the live server, writes no text either), and then "-card"
// with the model and --prompt card.
std::filesystem::path bench_default_out(const RunOptions& options,
                                        const llm::BatchOptions& batch);

// <out>/setup.json: the prompt and text modes of the runs, {"prompt","text"},
// both null with the baseline. The log does not say them.
nlohmann::ordered_json bench_setup(const RunOptions& options);

// Makes sure the runs in `out` were made with these modes, and writes
// setup.json when it is not there yet. Throws std::runtime_error ("use
// another --out") when setup.json says other modes, or when there is no
// setup.json but there are logs and the prompt is card: logs written before
// setup.json existed are of the full prompt.
void claim_bench_setup(const std::filesystem::path& out, const RunOptions& options);

}  // namespace rumor
