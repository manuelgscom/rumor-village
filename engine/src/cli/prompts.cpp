// `rumor prompts` (cli/prompts.h): the prompt of every card, rebuilt and
// checked, with its tokens if asked. No model runs here.

#include "cli/prompts.h"

#include <cstddef>
#include <fstream>
#include <iostream>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/render.h"
#include "cli/usage.h"
#include "core/population_api.h"
#include "extract/prompt.h"

namespace rumor {
namespace {

// The village of the extract prompt, as `rumor cards` (extract_prefix) and
// `rumor extract` build it. The full mode checks it against the `prefix` of
// each extract card.
constexpr int kExtractNeighbors = 100;
constexpr std::uint64_t kExtractSeed = 1;

}  // namespace

struct PromptBuilder::Village {
    Vocab vocab;
    Population population;
    std::unique_ptr<Renderer> renderer;  // reads vocab and population: they stay here
};

PromptBuilder::PromptBuilder(std::string data_dir, PromptMode mode)
    : data_dir_(std::move(data_dir)), mode_(mode) {}

PromptBuilder::~PromptBuilder() = default;

PromptBuilder::Village& PromptBuilder::village(const VillageKey& key) {
    auto it = villages_.find(key);
    if (it == villages_.end()) {
        const auto& [lang, neighbors, layout, seed] = key;
        auto v = std::make_unique<Village>();
        v->vocab = load_vocab(data_dir_, lang);
        v->population = make_population(data_dir_, neighbors, layout, seed);
        v->renderer = make_renderer(data_dir_, v->vocab, v->population);
        it = villages_.emplace(key, std::move(v)).first;
    }
    return *it->second;
}

CardPrompt PromptBuilder::build(const CardRecord& record) {
    CardPrompt out;
    if (record.task == CardTask::decide) {
        const CardVillage& cv = record.state.village;
        Village& v = village({record.lang, cv.neighbors, cv.layout, cv.seed});
        const DecisionRequest& request = *record.state.request;  // read_card checks it is there
        out.user = v.renderer->card(request);
        if (out.user != record.card) {
            throw std::runtime_error(record.id + ": the card rendered from its state differs from "
                                     "its 'card'");
        }
        out.system = v.renderer->prefix(mode_);
        out.grammar = v.renderer->grammar(request.kind);
    } else {
        Village& v = village({record.lang, kExtractNeighbors, Layout::village, kExtractSeed});
        out.user = record.card;
        out.system = extraction::system_message(data_dir_, v.vocab, v.population, mode_);
        out.grammar = extraction::grammar(v.vocab);
    }
    if (mode_ == PromptMode::full && prefix_id(out.system) != record.prefix) {
        throw std::runtime_error(record.id + ": the system message has prefix " +
                                 prefix_id(out.system) + ", the card " + record.prefix);
    }
    return out;
}

std::vector<CardRecord> read_card_file(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open '" + path + "'");
    std::vector<CardRecord> cards;
    std::set<std::string> ids;
    std::string line;
    for (std::size_t n = 1; std::getline(in, line); ++n) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        const std::string where = path + ":" + std::to_string(n) + ": ";
        if (line.find_first_not_of(" \t") == std::string::npos) {
            throw std::runtime_error(where + "empty line");
        }
        try {
            cards.push_back(read_card(line));
        } catch (const std::exception& e) {
            throw std::runtime_error(where + e.what());
        }
        if (!ids.insert(cards.back().id).second) {
            throw std::runtime_error(where + "repeated card id '" + cards.back().id + "'");
        }
    }
    if (in.bad()) throw std::runtime_error("cannot read '" + path + "'");
    return cards;
}

std::vector<std::int32_t> prompt_tokens(const llm::ModelVocab& vocab, const llm::ChatWrap& wrap,
                                        const CardPrompt& prompt) {
    // As the batch does it (llm/llama_batch.cpp): the shared part with the
    // BOS, then the card without it.
    std::vector<std::int32_t> tokens = vocab.tokenize(wrap.pre + prompt.system + wrap.mid, true);
    const std::vector<std::int32_t> user = vocab.tokenize(prompt.user + wrap.post, false);
    tokens.insert(tokens.end(), user.begin(), user.end());
    return tokens;
}

std::string prompt_line(const CardRecord& record, PromptMode mode, const CardPrompt& prompt,
                        const std::vector<std::int32_t>* tokens) {
    nlohmann::ordered_json line;
    line["id"] = record.id;
    line["task"] = std::string(key(record.task));
    line["lang"] = std::string(key(record.lang));
    line["prompt"] = std::string(key(mode));
    line["system"] = prompt.system;
    line["user"] = prompt.user;
    if (tokens) line["tokens"] = *tokens;
    return line.dump();
}

int prompts_command(int argc, char** argv) {
    std::string cards_path, out_path, vocab_path, data_dir = "data";
    std::optional<PromptMode> mode;
    for (int i = 2; i < argc; i += 2) {
        const std::string_view flag = argv[i];
        if (i + 1 >= argc) throw UsageError("missing value for " + std::string(flag));
        const std::string value = argv[i + 1];
        if (flag == "--cards") {
            cards_path = value;
        } else if (flag == "--out") {
            out_path = value;
        } else if (flag == "--prompt") {
            mode = from_key<PromptMode>(value);
            if (!mode) throw UsageError("unknown prompt mode '" + value + "'");
        } else if (flag == "--vocab") {
            vocab_path = value;
        } else if (flag == "--data") {
            data_dir = value;
        } else {
            throw UsageError("unknown option '" + std::string(flag) + "'");
        }
    }
    if (cards_path.empty() || out_path.empty() || !mode) {
        throw UsageError("prompts needs --cards, --prompt and --out");
    }
    if (cards_path == out_path) throw UsageError("--cards and --out are the same file");

    const std::vector<CardRecord> cards = read_card_file(cards_path);
    std::unique_ptr<llm::ModelVocab> vocab;
    llm::ChatWrap wrap;
    if (!vocab_path.empty()) {
        vocab = std::make_unique<llm::ModelVocab>(vocab_path);
        wrap = vocab->chat_wrap();
    }

    // Everything in memory first: a card that fails writes nothing.
    PromptBuilder builder(data_dir, *mode);
    std::vector<std::string> lines;
    lines.reserve(cards.size());
    std::set<std::string> systems;
    std::size_t decide = 0;
    for (const CardRecord& card : cards) {
        const CardPrompt prompt = builder.build(card);
        systems.insert(prompt.system);
        if (card.task == CardTask::decide) ++decide;
        if (vocab) {
            const std::vector<std::int32_t> tokens = prompt_tokens(*vocab, wrap, prompt);
            lines.push_back(prompt_line(card, *mode, prompt, &tokens));
        } else {
            lines.push_back(prompt_line(card, *mode, prompt, nullptr));
        }
    }

    std::ofstream out(out_path, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("cannot write '" + out_path + "'");
    for (const std::string& l : lines) out << l << '\n';
    out.close();
    if (!out) throw std::runtime_error("cannot write '" + out_path + "'");
    std::cerr << "prompts: " << cards.size() << " cards (" << decide << " decide, "
              << cards.size() - decide << " extract), " << systems.size()
              << " system messages, prompt " << key(*mode) << (vocab ? ", with tokens" : "")
              << '\n';
    return 0;
}

}  // namespace rumor
