// `rumor answer` (cli/answer.h): the cards of a file answered by a model with
// the prompt of the engine, resumable, one batch written at a time.

#include "cli/answer.h"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <memory>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "cli/usage.h"
#include "core/rng.h"
#include "extract/extract.h"
#include "policy/model.h"

namespace rumor {
namespace {

namespace fs = std::filesystem;
using Json = nlohmann::ordered_json;

// The ids already answered in `path`. A last line without its newline (a
// crash while writing) is cut off the file first.
std::set<std::string> read_done(const std::string& path, const std::set<std::string>& ids) {
    std::set<std::string> done;
    std::error_code ec;
    if (!fs::exists(path, ec)) return done;
    std::string text;
    {
        std::ifstream in(path, std::ios::binary);
        if (!in) throw std::runtime_error("cannot open '" + path + "'");
        text.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
        if (in.bad()) throw std::runtime_error("cannot read '" + path + "'");
    }
    if (!text.empty() && text.back() != '\n') {
        const std::size_t keep = text.rfind('\n') == std::string::npos ? 0 : text.rfind('\n') + 1;
        std::cerr << "answer: " << path << ": dropping a last line cut short ("
                  << text.size() - keep << " bytes)\n";
        text.resize(keep);
        fs::resize_file(path, keep);
    }
    std::istringstream lines(text);
    std::string line;
    for (std::size_t n = 1; std::getline(lines, line); ++n) {
        const std::string where = path + ":" + std::to_string(n) + ": ";
        const nlohmann::json j = nlohmann::json::parse(line, nullptr, false);
        const auto id = j.is_object() ? j.find("id") : j.end();
        if (!j.is_object() || id == j.end() || !id->is_string()) {
            throw std::runtime_error(where + "not an answer line; use another --out");
        }
        const std::string& value = id->get_ref<const std::string&>();
        if (!ids.contains(value)) {
            throw std::runtime_error(where + "'" + value + "' is not a card of the file; use another --out");
        }
        if (!done.insert(value).second) throw std::runtime_error(where + "repeated id '" + value + "'");
    }
    return done;
}

// The cards of a batch, all with the same system message.
struct Group {
    std::string system;
    std::vector<std::size_t> cards;  // indexes into the card file
};

void write_perf(const std::string& path, const AnswerStats& stats, int batch, PromptMode prompt) {
    const double s = std::max(stats.seconds, 1e-9);
    Json perf;
    perf["cards"] = stats.cards;
    perf["seconds"] = stats.seconds;
    perf["decisions_per_s"] = static_cast<double>(stats.cards) / s;
    perf["tokens_per_s"] = static_cast<double>(stats.tokens_out) / s;
    perf["vram_mb"] = stats.vram_mb;
    perf["batch"] = batch;
    perf["prompt"] = std::string(key(prompt));
    const fs::path p(path);
    if (p.has_parent_path()) fs::create_directories(p.parent_path());
    std::ofstream out(p, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("cannot write '" + path + "'");
    out << perf.dump(2) << '\n';
    out.close();
    if (!out) throw std::runtime_error("cannot write '" + path + "'");
}

// A non-negative integer option. Not parse_uint (cli.cpp): the isolated build
// of this package does not link the rest of the command.
std::uint64_t number(std::string_view flag, const std::string& value) {
    std::uint64_t n = 0;
    const char* end = value.data() + value.size();
    const auto [ptr, ec] = std::from_chars(value.data(), end, n);
    if (value.empty() || ec != std::errc() || ptr != end) {
        throw UsageError("bad " + std::string(flag.substr(2)) + " '" + value + "'");
    }
    return n;
}

}  // namespace

std::uint64_t card_seed(std::uint64_t seed, std::string_view fingerprint) {
    std::uint64_t head = 0;
    for (std::size_t i = 0; i < 16 && i < fingerprint.size(); ++i) {
        const char c = fingerprint[i];
        const std::uint64_t digit = c >= '0' && c <= '9'   ? static_cast<std::uint64_t>(c - '0')
                                    : c >= 'a' && c <= 'f' ? static_cast<std::uint64_t>(c - 'a' + 10)
                                                           : 0;
        head = head << 4 | digit;
    }
    return mix64(mix64(seed + 0x9E3779B97F4A7C15ULL) ^ head);
}

llm::Request answer_request(const CardRecord& card, const CardPrompt& prompt,
                            const AnswerOptions& options) {
    llm::Request r;
    r.seed = card_seed(options.seed, card.fingerprint);
    r.card = prompt.user;
    if (options.grammar) r.grammar = prompt.grammar;
    r.greedy = options.sampling == Sampling::greedy;
    if (card.task == CardTask::extract) {
        r.want_text = true;  // no "text" field: nothing to cut
        r.max_tokens = kExtractMaxTokens;
        r.greedy = true;  // reading a sentence must not vary
    } else if (card.kind == DecisionKind::turn) {
        r.want_text = true;
        r.max_tokens = kMaxTokensWithText;
    } else {
        r.want_text = false;
        r.max_tokens = kMaxTokensWithoutText;
    }
    return r;
}

AnswerStats answer_cards(const AnswerOptions& options,
                         const std::function<llm::Batch&()>& get_batch) {
    const std::vector<CardRecord> cards = read_card_file(options.cards_path);
    const std::size_t count = std::min(cards.size(), options.limit.value_or(cards.size()));
    std::set<std::string> ids;
    for (const CardRecord& c : cards) ids.insert(c.id);
    const std::set<std::string> done = read_done(options.out_path, ids);

    // Every prompt is built (and checked) before the model is touched.
    AnswerStats stats;
    PromptBuilder builder(options.data_dir, options.prompt);
    std::vector<CardPrompt> prompts(cards.size());
    std::vector<Group> groups;
    for (std::size_t i = 0; i < count; ++i) {
        if (done.contains(cards[i].id)) {
            ++stats.skipped;
            continue;
        }
        prompts[i] = builder.build(cards[i]);
        auto g = std::find_if(groups.begin(), groups.end(),
                              [&](const Group& x) { return x.system == prompts[i].system; });
        if (g == groups.end()) g = groups.insert(groups.end(), Group{prompts[i].system, {}});
        g->cards.push_back(i);
    }
    if (groups.empty()) return stats;

    llm::Batch& batch = get_batch();
    const int n_parallel = std::max(1, batch.info().n_parallel);
    const fs::path out_path(options.out_path);
    if (out_path.has_parent_path()) fs::create_directories(out_path.parent_path());
    std::ofstream out(out_path, std::ios::binary | std::ios::app);
    if (!out) throw std::runtime_error("cannot write '" + options.out_path + "'");

    const auto t0 = std::chrono::steady_clock::now();
    batch.take_perf();  // nothing from before this call
    for (const Group& group : groups) {
        batch.set_prefix(group.system);
        for (std::size_t first = 0; first < group.cards.size();
             first += static_cast<std::size_t>(n_parallel)) {
            const std::size_t last =
                std::min(group.cards.size(), first + static_cast<std::size_t>(n_parallel));
            std::vector<llm::Request> requests;
            for (std::size_t k = first; k < last; ++k) {
                const std::size_t i = group.cards[k];
                requests.push_back(answer_request(cards[i], prompts[i], options));
            }
            const std::vector<llm::Result> results = batch.run(requests);
            if (results.size() != requests.size()) {
                throw std::runtime_error("answer: the batch returned " +
                                         std::to_string(results.size()) + " results for " +
                                         std::to_string(requests.size()) + " requests");
            }
            std::string lines;
            for (std::size_t k = first; k < last; ++k) {
                const llm::Result& r = results[k - first];
                Json line;
                line["id"] = cards[group.cards[k]].id;
                line["raw"] = r.json;
                line["tokens_in"] = r.prompt_tokens;
                line["tokens_out"] = r.output_tokens;
                // A cut output may end inside a UTF-8 character: replaced.
                lines += line.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace) + '\n';
                stats.tokens_out += r.output_tokens;
                ++stats.cards;
            }
            out << lines;
            out.flush();
            if (!out) throw std::runtime_error("cannot write '" + options.out_path + "'");
            for (const PerfSample& p : batch.take_perf()) stats.vram_mb = std::max(stats.vram_mb, p.vram_mb);
        }
        std::cerr << "answer: " << group.cards.size() << " cards of one system message done\n";
    }
    stats.seconds =
        std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    out.close();
    if (!out) throw std::runtime_error("cannot write '" + options.out_path + "'");
    if (!options.perf_path.empty()) write_perf(options.perf_path, stats, n_parallel, options.prompt);
    return stats;
}

int answer_command(int argc, char** argv) {
    AnswerOptions options;
    llm::BatchOptions batch_options;
    bool has_prompt = false;
    for (int i = 2; i < argc; i += 2) {
        const std::string_view flag = argv[i];
        if (i + 1 >= argc) throw UsageError("missing value for " + std::string(flag));
        const std::string value = argv[i + 1];
        if (flag == "--cards") {
            options.cards_path = value;
        } else if (flag == "--model") {
            batch_options.model_path = value;
        } else if (flag == "--out") {
            options.out_path = value;
        } else if (flag == "--perf") {
            options.perf_path = value;
        } else if (flag == "--data") {
            options.data_dir = value;
        } else if (flag == "--device") {
            batch_options.device = value;
        } else if (flag == "--prompt") {
            const auto mode = from_key<PromptMode>(value);
            if (!mode) throw UsageError("unknown prompt mode '" + value + "'");
            options.prompt = *mode;
            has_prompt = true;
        } else if (flag == "--grammar") {
            if (value != "on" && value != "off") throw UsageError("bad grammar '" + value + "'");
            options.grammar = value == "on";
        } else if (flag == "--sampling") {
            const auto sampling = from_key<Sampling>(value);
            if (!sampling) throw UsageError("unknown sampling '" + value + "'");
            options.sampling = *sampling;
        } else if (flag == "--batch") {
            const std::uint64_t n = number(flag, value);
            if (n < 1 || n > 1024) throw UsageError("bad batch '" + value + "'");
            batch_options.n_parallel = static_cast<int>(n);
        } else if (flag == "--seed") {
            options.seed = number(flag, value);
        } else if (flag == "--limit") {
            options.limit = static_cast<std::size_t>(number(flag, value));
        } else {
            throw UsageError("unknown option '" + std::string(flag) + "'");
        }
    }
    if (options.cards_path.empty() || batch_options.model_path.empty() ||
        options.out_path.empty() || !has_prompt) {
        throw UsageError("answer needs --cards, --model, --prompt and --out");
    }
    if (options.cards_path == options.out_path) throw UsageError("--cards and --out are the same file");

    std::unique_ptr<llm::Batch> batch;
    const AnswerStats stats = answer_cards(options, [&]() -> llm::Batch& {
        const auto t0 = std::chrono::steady_clock::now();
        batch = llm::make_llama_batch(batch_options);
        std::cerr << "answer: model loaded in "
                  << std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count()
                  << " s\n";
        return *batch;
    });
    std::cerr << "answer: " << stats.cards << " cards answered in " << stats.seconds << " s, "
              << stats.skipped << " already in " << options.out_path << '\n';
    return 0;
}

}  // namespace rumor
