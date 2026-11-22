// `rumor bench` (cli/bench.h): N runs of one scenario in one language with one
// model loaded once, resumable, and the results card computed from the logs
// saved on disk.
//
// A run is written to seed-<s>.jsonl.part (and .trace.jsonl.part) and renamed
// when it ends, so a log under its final name is always whole; a log that does
// not end with an `end` event (an older crash, a copy cut short) is run again.

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "cli/bench.h"
#include "cli/bench_card.h"
#include "cli/usage.h"
#include "core/log_api.h"
#include "core/metrics_api.h"
#include "core/sim_api.h"
#include "llm/batch.h"

namespace rumor {
namespace {

namespace fs = std::filesystem;
using Json = nlohmann::ordered_json;

constexpr std::uint64_t kMaxRuns = 10'000;

struct BenchArgs {
    RunOptions run;
    llm::BatchOptions batch;
    std::uint64_t runs = 0;
    std::uint64_t seed_base = 1;
    std::string out;
    bool trace = false;
    std::string model_option;  // the first model option other than --model, if any
};

BenchArgs parse_args(int argc, char** argv) {
    BenchArgs a;
    std::string policy;
    bool has_scenario = false, has_lang = false, has_runs = false;
    for (int i = 2; i < argc; ++i) {
        const std::string_view flag = argv[i];
        if (flag == "--trace") {
            a.trace = true;
            continue;
        }
        if (i + 1 >= argc) throw UsageError("missing value for " + std::string(flag));
        const std::string value = argv[++i];
        if (flag == "--scenario") {
            a.run.scenario = value;
            has_scenario = true;
        } else if (flag == "--lang") {
            const auto lang = from_key<Lang>(value);
            if (!lang) throw UsageError("unknown language '" + value + "'");
            a.run.lang = *lang;
            has_lang = true;
        } else if (flag == "--runs") {
            a.runs = parse_uint(flag, value);
            if (a.runs < 1 || a.runs > kMaxRuns) throw UsageError("bad runs '" + value + "'");
            has_runs = true;
        } else if (flag == "--seed-base") {
            a.seed_base = parse_uint(flag, value);
        } else if (flag == "--out") {
            a.out = value;
        } else if (flag == "--data") {
            a.run.data_dir = value;
        } else if (flag == "--policy") {
            policy = value;
        } else if (parse_model_flag(flag, value, a.run, a.batch)) {
            if (flag != "--model" && a.model_option.empty()) a.model_option = flag;
        } else {
            throw UsageError("unknown option '" + std::string(flag) + "'");
        }
    }
    if (!has_scenario || !has_lang || !has_runs) {
        throw UsageError("bench needs --scenario, --lang and --runs");
    }
    if (a.seed_base > std::numeric_limits<std::uint64_t>::max() - a.runs) {
        throw UsageError("bad seed-base '" + std::to_string(a.seed_base) + "'");
    }

    const bool has_model = !a.batch.model_path.empty();
    if (has_model) {
        if (!policy.empty() && policy != "model") {
            throw UsageError("--model and --policy " + policy + " exclude each other");
        }
        a.run.policy = "model";
    } else {
        if (policy == "model") throw UsageError("--policy model needs --model");
        if (policy.empty()) throw UsageError("bench needs --model or --policy baseline");
        if (policy != "baseline") throw UsageError("unknown policy '" + policy + "'");
        a.run.policy = "baseline";
        if (!a.model_option.empty()) throw UsageError(a.model_option + " needs --model");
        if (a.trace) throw UsageError("--trace needs --model");
    }
    return a;
}

fs::path log_path(const fs::path& out, std::uint64_t seed) {
    return out / ("seed-" + std::to_string(seed) + ".jsonl");
}
fs::path trace_path(const fs::path& out, std::uint64_t seed) {
    return out / ("seed-" + std::to_string(seed) + ".trace.jsonl");
}
fs::path part(const fs::path& p) { return fs::path(p.string() + ".part"); }

// The log of a run, if it is whole: it reads and ends with an `end` event.
std::optional<Log> read_complete(const fs::path& path) {
    std::error_code ec;
    if (!fs::is_regular_file(path, ec)) return std::nullopt;
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    try {
        Log log = read_log(in);
        if (log.events.empty() || !std::holds_alternative<EndEvent>(log.events.back())) {
            return std::nullopt;
        }
        return log;
    } catch (const LogError&) {
        return std::nullopt;
    }
}

// A whole log that belongs to another bench must not be mixed into this card.
void check_header(const fs::path& path, const LogHeader& h, const RunOptions& run,
                  std::uint64_t seed, const std::optional<std::string>& model) {
    const auto who = [](const std::string& policy, const std::optional<std::string>& m) {
        return policy + (m ? " " + *m : "");
    };
    if (h.scenario != run.scenario || h.lang != run.lang || h.seed != seed ||
        h.policy != run.policy || h.model != model) {
        throw std::runtime_error(path.string() + " is a run of " + h.scenario + " " +
                                 std::string(key(h.lang)) + " seed " + std::to_string(h.seed) +
                                 " with " + who(h.policy, h.model) + ", not of " + run.scenario +
                                 " " + std::string(key(run.lang)) + " seed " +
                                 std::to_string(seed) + " with " + who(run.policy, model) +
                                 "; use another --out");
    }
}

void open_for_write(std::ofstream& file, const fs::path& path) {
    file.open(path, std::ios::binary | std::ios::trunc);
    if (!file) throw std::runtime_error("cannot write '" + path.string() + "'");
}

void close_checked(std::ofstream& file, const fs::path& path) {
    file.close();
    if (!file) throw std::runtime_error("cannot write '" + path.string() + "'");
}

// One run, written under .part names and renamed when it is whole: the trace
// first, so that a log under its final name always has its trace.
void run_one(const RunOptions& options, llm::Batch* batch, const fs::path& log,
             const std::optional<fs::path>& trace) {
    const fs::path log_part = part(log);
    const std::optional<fs::path> trace_part = trace ? std::optional(part(*trace)) : std::nullopt;
    std::ofstream file;
    std::ofstream trace_file;
    try {
        open_for_write(file, log_part);
        if (trace_part) open_for_write(trace_file, *trace_part);
        run_to_stream(options, file, batch, trace_part ? &trace_file : nullptr);
        close_checked(file, log_part);
        if (trace_part) {
            close_checked(trace_file, *trace_part);
            fs::rename(*trace_part, *trace);
        }
        fs::rename(log_part, log);
    } catch (...) {
        file.close();
        trace_file.close();
        std::error_code ignored;
        fs::remove(log_part, ignored);
        if (trace_part) fs::remove(*trace_part, ignored);
        throw;
    }
}

void write_text(const fs::path& path, const std::string& text) {
    const fs::path tmp = part(path);
    std::ofstream file;
    open_for_write(file, tmp);
    file << text;
    close_checked(file, tmp);
    fs::rename(tmp, path);
}

double seconds_since(std::chrono::steady_clock::time_point t0) {
    return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
}

}  // namespace

int bench_command(int argc, char** argv) {
    const BenchArgs a = parse_args(argc, argv);
    const bool with_model = a.run.policy == "model";
    const fs::path out = a.out.empty() ? bench_default_out(a.run, a.batch) : fs::path(a.out);
    fs::create_directories(out);
    claim_bench_setup(out, a.run);

    // The model is loaded once and serves every run.
    std::unique_ptr<llm::Batch> batch;
    std::optional<llm::ModelInfo> info;
    if (with_model) {
        const auto t0 = std::chrono::steady_clock::now();
        batch = llm::make_llama_batch(a.batch);
        info = batch->info();
        // bench/eval/run-queue.sh reads this line and the "done in" ones.
        std::cerr << "bench: model loaded in " << seconds_since(t0) << " s\n";
    }
    const std::optional<std::string> model = info ? std::optional(info->file) : std::nullopt;

    BenchSetup setup;
    setup.scenario = a.run.scenario;
    setup.lang = a.run.lang;
    setup.policy = a.run.policy;
    setup.model = info;
    setup.text = a.run.text;
    setup.prompt = a.run.prompt;

    std::vector<Json> metrics;
    int done = 0, skipped = 0;
    for (std::uint64_t i = 0; i < a.runs; ++i) {
        const std::uint64_t seed = a.seed_base + i;
        setup.seeds.push_back(seed);
        const fs::path log = log_path(out, seed);
        const std::optional<fs::path> trace =
            a.trace ? std::optional(trace_path(out, seed)) : std::nullopt;
        const std::string tag = "seed " + std::to_string(seed) + " (" + std::to_string(i + 1) +
                                "/" + std::to_string(a.runs) + ")";

        std::optional<Log> whole = read_complete(log);
        std::error_code ec;
        if (whole && (!trace || fs::is_regular_file(*trace, ec))) {
            check_header(log, whole->header, a.run, seed, model);
            ++skipped;
            std::cerr << "bench: " << tag << " already done\n";
        } else {
            whole.reset();
            RunOptions options = a.run;
            options.seed = seed;
            const auto t0 = std::chrono::steady_clock::now();
            run_one(options, batch.get(), log, trace);
            ++done;
            std::cerr << "bench: " << tag << " done in " << seconds_since(t0) << " s\n";
            // The card is computed from the saved log, never from memory.
            whole = read_complete(log);
            if (!whole) throw std::runtime_error(log.string() + " is not a whole log");
            check_header(log, whole->header, a.run, seed, model);
        }
        metrics.push_back(compute_metrics(whole->header, whole->events));
    }

    const Json card = make_card(setup, metrics);
    write_text(out / "card.json", card.dump(2) + "\n");
    write_text(out / "card.md", card_markdown(card));
    std::cerr << "bench: " << done << " run(s) made, " << skipped << " already done\n";
    std::cout << (out / "card.md").string() << '\n';
    return 0;
}

}  // namespace rumor
