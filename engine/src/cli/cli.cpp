// The `rumor` command: `run` writes a log (and serves it live with --serve,
// serve.cpp), `metrics` prints the results card, `bench` (bench*.cpp) repeats
// runs and `extract` (extract*.cpp) reads a sentence. For the dataset (phase
// 4), `cards` (cards*.cpp) rebuilds the card records of a log and `validate`
// (validate*.cpp) judges answers against them. For the fine-tuning (phase 5),
// `prompts` (prompts*.cpp) writes the prompt of each card and `answer`
// (answer*.cpp) has a model answer them. For the game (phase 9), `play`
// (play*.cpp) serves the game.

#include <charconv>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/render.h"
#include "card/textcheck.h"
#include "cli/answer.h"
#include "cli/bench.h"
#include "cli/cards.h"
#include "cli/prompts.h"
#include "cli/serve.h"
#include "cli/usage.h"
#include "cli/validate.h"
#include "core/build_info.h"
#include "core/game_api.h"
#include "core/log_api.h"
#include "core/metrics_api.h"
#include "core/sim_api.h"
#include "extract/extract.h"
#include "launcher/launcher.h"
#include "llm/batch.h"
#include "policy/model.h"
#include "server/live_server.h"

namespace rumor {
namespace {

constexpr const char* kUsage =
    "usage: rumor run --scenario <name> --lang <es|en> --seed <N> --out <file> [--data <dir>]\n"
    "                 [--policy baseline | --model <gguf> [model options] [--trace <file>]]\n"
    "                 [--serve <port> [--bind <address>] [--speed <N|max>] [--viewer <dir>]]\n"
    "       rumor metrics <log>\n"
    "       rumor textcheck <log>\n"
    "       rumor bench (--model <gguf> [model options] | --policy baseline)\n"
    "                   --scenario <name> --lang <es|en> --runs <N>\n"
    "                   [--seed-base <S>] [--out <dir>] [--data <dir>] [--trace]\n"
    "       rumor extract --model <gguf> --lang <es|en> --text \"<sentence>\"\n"
    "                     [--prompt <full|card>] [--data <dir>] [--device <name>]\n"
    "       rumor cards --log <run.jsonl> --out <cards.jsonl> --prefixes <prefixes.jsonl>\n"
    "                   [--rival-twins] [--data <dir>]\n"
    "       rumor validate --in <labels.jsonl|train.jsonl> --cards <cards.jsonl>\n"
    "                      --out <verdicts.jsonl> [--strict] [--data <dir>]\n"
    "       rumor prompts --cards <cards.jsonl> --prompt <full|card> --out <prompts.jsonl>\n"
    "                     [--vocab <gguf>] [--data <dir>]\n"
    "       rumor answer --cards <cards.jsonl> --model <gguf> --prompt <full|card>\n"
    "                    --out <labels.jsonl> [--grammar <on|off>] [--sampling <model|greedy>]\n"
    "                    [--batch <N>] [--seed <S>] [--limit <N>] [--perf <perf.json>]\n"
    "                    [--data <dir>] [--device <name>]\n"
    "       rumor --version\n"
    "       rumor [--data-dir <dir>] [--no-browser] [--model-url <url>] [--port <N>]\n"
    "       rumor play [--port <N>] [--bind <address>] [--viewer <dir>] [--data <dir>]\n"
    "                  [--out <dir>] [--speed <N|max>] [--quiet-speed <N>]\n"
    "                  [--model <gguf> [--prompt <full|card>] [--batch <N>] [--device <name>]\n"
    "                   [--text <all|none|camera>]] [--once <draft.json>]\n"
    "model options: --text <all|none|camera> --prompt <full|card> --batch <N> --device <name>\n"
    "               --sample-threads <N> --prefix-mode <copy|reprocess>\n"
    "live (--serve): the run is served at http://<address>:<port>/ (default address\n"
    "               127.0.0.1) at <N> ticks per second (default 2) with the viewer\n"
    "               from <dir> (default viewer); it keeps serving until SIGINT or\n"
    "               SIGTERM, which also end a run early with its end event.\n"
    "               --text camera writes the text of what is on screen only.\n"
    "no command: the launcher of the downloaded game (phase 10): detects the GPU,\n"
    "               downloads the model, serves the game and opens the browser.\n"
    "play: the game (docs/juego.md), waiting at http://127.0.0.1:8080/?play=1 (default\n"
    "               --out runs/play, --speed 2, --quiet-speed 10, --text camera); --once\n"
    "               plays a draft at full speed without HTTP and prints the game id.\n";

int run_command(int argc, char** argv) {
    RunOptions options;
    llm::BatchOptions batch_options;
    std::string out_path;
    std::string trace_path;
    LiveOptions live;
    live.viewer_dir = "viewer";
    bool serve = false, live_only = false;
    bool has_scenario = false, has_lang = false, has_seed = false;
    for (int i = 2; i < argc; i += 2) {
        const std::string_view flag = argv[i];
        if (i + 1 >= argc) throw UsageError("missing value for " + std::string(flag));
        const std::string value = argv[i + 1];
        if (flag == "--scenario") {
            options.scenario = value;
            has_scenario = true;
        } else if (flag == "--lang") {
            const auto lang = from_key<Lang>(value);
            if (!lang) throw UsageError("unknown language '" + value + "'");
            options.lang = *lang;
            has_lang = true;
        } else if (flag == "--seed") {
            options.seed = parse_uint(flag, value);
            has_seed = true;
        } else if (flag == "--policy") {
            options.policy = value;
        } else if (flag == "--out") {
            out_path = value;
        } else if (flag == "--data") {
            options.data_dir = value;
        } else if (flag == "--trace") {
            trace_path = value;
        } else if (flag == "--serve") {
            const std::uint64_t port = parse_uint(flag, value);
            if (port > 65535) throw UsageError("bad serve '" + value + "'");
            live.port = static_cast<int>(port);
            serve = true;
        } else if (flag == "--bind") {
            live.bind = value;
            live_only = true;
        } else if (flag == "--speed") {
            const std::uint64_t speed = value == "max" ? 0 : parse_uint(flag, value);
            if (value != "max" && (speed < 1 || speed > 1000)) {
                throw UsageError("bad speed '" + value + "'");
            }
            live.speed = static_cast<int>(speed);
            live_only = true;
        } else if (flag == "--viewer") {
            live.viewer_dir = value;
            live_only = true;
        } else if (!parse_model_flag(flag, value, options, batch_options)) {
            throw UsageError("unknown option '" + std::string(flag) + "'");
        }
    }
    if (!has_scenario || !has_lang || !has_seed || out_path.empty()) {
        throw UsageError("run needs --scenario, --lang, --seed and --out");
    }
    const bool with_model = options.policy == "model";
    if (with_model && batch_options.model_path.empty()) {
        throw UsageError("--policy model needs --model");
    }
    if (!with_model && !trace_path.empty()) throw UsageError("--trace needs --model");
    if (live_only && !serve) throw UsageError("--bind, --speed and --viewer need --serve");

    // Before the model runtime starts its threads (serve.h).
    if (serve) block_stop_signals();
    std::unique_ptr<llm::Batch> batch;
    if (with_model) batch = llm::make_llama_batch(batch_options);

    std::ofstream trace;
    if (!trace_path.empty()) {
        const std::filesystem::path path(trace_path);
        if (path.has_parent_path()) std::filesystem::create_directories(path.parent_path());
        trace.open(path, std::ios::binary);
        if (!trace) throw std::runtime_error("cannot write '" + trace_path + "'");
    }

    const std::filesystem::path out(out_path);
    if (out.has_parent_path()) std::filesystem::create_directories(out.parent_path());
    std::ofstream file(out, std::ios::binary);
    if (!file) throw std::runtime_error("cannot write '" + out_path + "'");
    try {
        std::ostream* const trace_out = trace.is_open() ? &trace : nullptr;
        if (serve) serve_to_stream(options, live, file, batch.get(), trace_out);
        else run_to_stream(options, file, batch.get(), trace_out);
        file.close();
        if (!file) throw std::runtime_error("cannot write '" + out_path + "'");
    } catch (...) {
        // A half-written log must not pass for a run.
        file.close();
        std::error_code ignored;
        std::filesystem::remove(out, ignored);
        throw;
    }
    return 0;
}

int metrics_command(int argc, char** argv) {
    if (argc != 3) throw UsageError("metrics takes one log file");
    const std::string path = argv[2];
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open '" + path + "'");
    Log log;
    try {
        log = read_log(in);
    } catch (const LogError& e) {
        throw std::runtime_error(path + ": " + e.what());
    }
    std::cout << compute_metrics(log.header, log.events).dump(2) << '\n';
    return 0;
}

// `rumor textcheck <log>`: the turns whose text contradicts their claim, one
// JSON line each, to read what the detector marks. The same check as the
// `incoherent_text` figure of `rumor metrics`.
int textcheck_command(int argc, char** argv) {
    if (argc != 3) throw UsageError("textcheck takes one log file");
    const std::string path = argv[2];
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open '" + path + "'");
    Log log;
    try {
        log = read_log(in);
    } catch (const LogError& e) {
        throw std::runtime_error(path + ": " + e.what());
    }
    TextCheckContext context;
    context.lang = log.header.lang;
    context.places.resize(kPlaceCount);
    for (const HeaderPlace& p : log.header.places) {
        if (is_place(p.id)) context.places[p.id.index()] = p.name;
    }
    context.neighbors.resize(log.header.neighbors.size());
    for (const Neighbor& n : log.header.neighbors) {
        if (n.id.valid() && n.id.index() < context.neighbors.size()) {
            context.neighbors[n.id.index()] = n.name;
        }
    }
    const auto name_of = [](const std::vector<std::string>& names, SlotValue v) {
        const auto i = static_cast<std::size_t>(v) - 1;
        return v >= 1 && i < names.size() ? names[i] : std::to_string(v);
    };
    for (const Event& event : log.events) {
        const auto* turn = std::get_if<TurnEvent>(&event);
        if (!turn || !turn->text || !turn->claim || turn->verdict.reject != RejectReason::none) {
            continue;
        }
        context.speaker = turn->who;
        context.listener = turn->to;
        const TextCheck check = check_text(context, *turn->claim, turn->tick, *turn->text);
        if (!check.any()) continue;
        nlohmann::ordered_json line;
        line["tick"] = turn->tick;
        line["who"] = turn->who.str();
        line["slots"] = nlohmann::ordered_json::array();
        for (Slot s : kSlots) {
            if (check.contradicts[idx(s)]) line["slots"].push_back(std::string(key(s)));
        }
        nlohmann::ordered_json& claim = line["claim"];
        const auto& slots = turn->claim->slots;
        if (slots[idx(Slot::who)]) claim["who"] = name_of(context.neighbors, *slots[idx(Slot::who)]);
        if (slots[idx(Slot::where)]) claim["where"] = name_of(context.places, *slots[idx(Slot::where)]);
        if (const auto& when = slots[idx(Slot::when)]) {
            claim["when"] = "day " + std::to_string(*when / kSlotsPerDay) + " " +
                            clock_text((*when % kSlotsPerDay) / 2, (*when % 2) * 30);
        }
        if (slots[idx(Slot::amount)]) claim["amount"] = *slots[idx(Slot::amount)];
        line["text"] = *turn->text;
        std::cout << line.dump() << '\n';
    }
    return 0;
}

}  // namespace

std::uint64_t parse_uint(std::string_view flag, const std::string& value) {
    std::uint64_t number = 0;
    const char* end = value.data() + value.size();
    const auto [ptr, ec] = std::from_chars(value.data(), end, number);
    if (value.empty() || ec != std::errc() || ptr != end) {
        throw UsageError("bad " + std::string(flag.substr(flag.find_first_not_of('-'))) + " '" +
                         value + "'");
    }
    return number;
}

bool parse_model_flag(std::string_view flag, const std::string& value, RunOptions& options,
                      llm::BatchOptions& batch) {
    if (flag == "--model") {
        batch.model_path = value;
        options.policy = "model";
    } else if (flag == "--text") {
        const auto mode = from_key<TextMode>(value);
        if (!mode) throw UsageError("unknown text mode '" + value + "'");
        options.text = *mode;
    } else if (flag == "--prompt") {
        const auto mode = from_key<PromptMode>(value);
        if (!mode) throw UsageError("unknown prompt mode '" + value + "'");
        options.prompt = *mode;
    } else if (flag == "--batch") {
        const std::uint64_t n = parse_uint(flag, value);
        if (n < 1 || n > 1024) throw UsageError("bad batch '" + value + "'");
        batch.n_parallel = static_cast<int>(n);
    } else if (flag == "--device") {
        batch.device = value;
    } else if (flag == "--sample-threads") {
        const std::uint64_t n = parse_uint(flag, value);
        if (n > 1024) throw UsageError("bad sample-threads '" + value + "'");
        batch.sample_threads = static_cast<int>(n);
    } else if (flag == "--prefix-mode") {
        if (value == "copy") batch.prefix_mode = llm::PrefixMode::copy;
        else if (value == "reprocess") batch.prefix_mode = llm::PrefixMode::reprocess;
        else throw UsageError("unknown prefix mode '" + value + "'");
    } else {
        return false;
    }
    return true;
}

namespace {

// Whether the run has the model policy; checked before anything is loaded.
bool checked_policy(const RunOptions& options, const llm::Batch* batch) {
    const bool with_model = options.policy == "model";
    if (!with_model && options.policy != "baseline") {
        throw std::runtime_error("unknown policy '" + options.policy + "'");
    }
    if (with_model && !batch) throw std::runtime_error("the model policy needs a model");
    return with_model;
}

}  // namespace

LoadedRun::LoadedRun(const RunOptions& options, llm::Batch* batch, std::ostream* trace)
    : with_model(checked_policy(options, batch)),
      params(load_scenario(options.data_dir, options.scenario, options.lang)),
      world(load_world(options.data_dir)),
      population(make_population(options.data_dir, params.neighbors, params.layout, options.seed,
                                  params.trait_mix)),
      vocab(load_vocab(options.data_dir, options.lang)) {
    if (with_model) {
        renderer = make_renderer(options.data_dir, vocab, population);
        ModelPolicyOptions model_options;
        model_options.text = options.text;
        model_options.prompt = options.prompt;
        model_options.trace = trace;
        policy = make_model_policy(*batch, *renderer, vocab, population, model_options);
    } else {
        policy = make_baseline_policy();
    }
}

void run_to_stream(const RunOptions& options, std::ostream& out, llm::Batch* batch,
                   std::ostream* trace) {
    const LoadedRun run(options, batch, trace);
    RunSink sink;
    sink.header = [&](const LogHeader& header) { out << write_header(header) << '\n'; };
    sink.event = [&](const Event& event) { out << write_event(event) << '\n'; };
    run_simulation(run.params, run.world, run.population, run.vocab, *run.policy, options.seed,
                   sink);
    out.flush();
    if (!out) throw std::runtime_error("cannot write the log");
    if (trace) {
        trace->flush();
        if (!*trace) throw std::runtime_error("cannot write the trace");
    }
}

int cli_main(int argc, char** argv) {
    try {
        const std::string_view command = argc > 1 ? argv[1] : "";
        if (command == "--version") {
            std::cout << "rumor-village " << engine_version() << " (engine " << engine_commit()
                      << ", llama.cpp " << llama_commit() << ", backends: " << compiled_backends()
                      << ")\n";
            return 0;
        }
        // No command, or only options: the launcher of the downloaded game
        // (phase 10, launcher/launcher.h).
        if (command.empty() || command.substr(0, 2) == "--") return launcher_main(argc, argv);
        if (command == "run") return run_command(argc, argv);
        if (command == "metrics") return metrics_command(argc, argv);
        if (command == "textcheck") return textcheck_command(argc, argv);
        if (command == "bench") return bench_command(argc, argv);
        if (command == "extract") return extract_command(argc, argv);
        if (command == "cards") return cards_command(argc, argv);
        if (command == "validate") return validate_command(argc, argv);
        if (command == "prompts") return prompts_command(argc, argv);
        if (command == "answer") return answer_command(argc, argv);
        if (command == "play") return play_command(argc, argv);
        throw UsageError(command.empty() ? "" : "unknown command '" + std::string(command) + "'");
    } catch (const UsageError& e) {
        if (*e.what() != '\0') std::cerr << "rumor: " << e.what() << '\n';
        std::cerr << kUsage;
        return 2;
    } catch (const std::exception& e) {
        std::cerr << "rumor: " << e.what() << '\n';
        return 1;
    }
}

}  // namespace rumor
