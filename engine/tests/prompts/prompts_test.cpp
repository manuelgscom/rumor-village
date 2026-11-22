// Tests of `rumor prompts` (cli/prompts.h): the prompt of each mode in both
// languages, the card rendered again from the state of real cards of the test
// set, the checks that stop the command, and the tokens of the whole prompt
// (with the tokenizer of the model, when models/ has it).

#include <doctest/doctest.h>

#ifdef _WIN32
#include <process.h>  // _getpid
#define getpid _getpid
#else
#include <unistd.h>
#endif

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/record.h"
#include "card/render.h"
#include "cli/prompts.h"
#include "cli/usage.h"
#include "core/population_api.h"
#include "extract/prompt.h"
#include "support/model_file.h"

namespace rumor {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

const std::string kData = RUMOR_DATA_DIR;

std::string testset(const std::string& lang) {
    return kData + "/../training/testset/decision/" + lang + ".jsonl";
}

// Every `step`-th card of a file, from the first.
std::vector<CardRecord> sample(const std::string& path, std::size_t step) {
    const std::vector<CardRecord> all = read_card_file(path);
    std::vector<CardRecord> out;
    for (std::size_t i = 0; i < all.size(); i += step) out.push_back(all[i]);
    return out;
}

const CardRecord& first_of(const std::vector<CardRecord>& cards, CardTask task) {
    for (const CardRecord& c : cards) {
        if (c.task == task) return c;
    }
    throw std::runtime_error("no card of that task");
}

std::string card_prefix(Lang lang, int neighbors) {
    const Vocab vocab = load_vocab(kData, lang);
    const Population population = make_population(kData, neighbors, Layout::village, 1);
    return make_renderer(kData, vocab, population)->prefix(PromptMode::card);
}

fs::path temp_dir() {
    static int runs = 0;
    const fs::path dir = fs::temp_directory_path() /
                         ("rumor-prompts-" + std::to_string(getpid()) + "-" + std::to_string(++runs));
    fs::remove_all(dir);
    fs::create_directories(dir);
    return dir;
}

int run_prompts(std::vector<std::string> args) {
    args.insert(args.begin(), {"rumor", "prompts"});
    std::vector<char*> argv;
    for (std::string& a : args) argv.push_back(a.data());
    return prompts_command(static_cast<int>(argv.size()), argv.data());
}

std::vector<std::string> lines_of(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    std::vector<std::string> lines;
    for (std::string line; std::getline(in, line);) lines.push_back(line);
    return lines;
}

}  // namespace

TEST_SUITE("prompts") {

TEST_CASE("prompts: card mode, the lists as system and the card as user, in both languages") {
    for (const char* lang : {"es", "en"}) {
        CAPTURE(lang);
        const std::vector<CardRecord> cards = sample(testset(lang), 7);
        PromptBuilder builder(kData, PromptMode::card);
        const CardRecord& decide = first_of(cards, CardTask::decide);
        const CardPrompt p = builder.build(decide);
        CHECK(p.user == decide.card);
        const std::string head = std::string(lang) == "es" ? "Lugares: " : "Places: ";
        const std::string second = std::string(lang) == "es" ? "\nVecinos: " : "\nNeighbors: ";
        CHECK(p.system.starts_with(head));
        CHECK(p.system.find(second) != std::string::npos);
        CHECK(p.system.find('\n') == p.system.rfind('\n'));  // two lines
        CHECK(p.system == card_prefix(decide.lang, decide.state.village.neighbors));
        CHECK(p.grammar.starts_with("# Action of a "));

        // Extract in card mode: the same lists, of the village of 100, and the
        // sentence as user.
        const CardRecord& extract = first_of(cards, CardTask::extract);
        const CardPrompt e = builder.build(extract);
        CHECK(e.user == extract.card);
        CHECK(e.system == card_prefix(extract.lang, 100));
        CHECK(e.grammar.starts_with("root ::= "));
    }
}

TEST_CASE("prompts: full mode, the prefix of the record, in both languages") {
    for (const char* lang : {"es", "en"}) {
        CAPTURE(lang);
        const std::vector<CardRecord> cards = sample(testset(lang), 7);
        PromptBuilder builder(kData, PromptMode::full);
        for (const CardRecord& c : cards) {
            const CardPrompt p = builder.build(c);
            CHECK(prefix_id(p.system) == c.prefix);
            CHECK(p.user == c.card);
        }
        const CardRecord& extract = first_of(cards, CardTask::extract);
        const Vocab vocab = load_vocab(kData, extract.lang);
        const Population population = make_population(kData, 100, Layout::village, 1);
        CHECK(builder.build(extract).system ==
              extraction::system_message(kData, vocab, population, PromptMode::full));
    }
}

TEST_CASE("prompts: the card rendered from the state is the card of the test set") {
    // A sample of es.jsonl, of every village size and kind it has.
    const std::vector<CardRecord> cards = sample(testset("es"), 11);
    REQUIRE(cards.size() > 100);
    PromptBuilder builder(kData, PromptMode::card);
    std::size_t decide = 0;
    for (const CardRecord& c : cards) {
        CAPTURE(c.id);
        const CardPrompt p = builder.build(c);
        CHECK(p.user == c.card);
        if (c.task == CardTask::decide) ++decide;
    }
    CHECK(decide > 50);
}

TEST_CASE("prompts: a card that differs from its state, or a prefix that differs, stops") {
    const std::vector<CardRecord> cards = sample(testset("es"), 50);
    CardRecord changed = first_of(cards, CardTask::decide);
    changed.card += " ";
    PromptBuilder card_mode(kData, PromptMode::card);
    CHECK_THROWS_WITH_AS(card_mode.build(changed), doctest::Contains(changed.id.c_str()), std::runtime_error);

    CardRecord other_prefix = first_of(cards, CardTask::extract);
    other_prefix.prefix = "000000000000";
    PromptBuilder full_mode(kData, PromptMode::full);
    CHECK_THROWS_AS(full_mode.build(other_prefix), std::runtime_error);
    CHECK_NOTHROW(card_mode.build(other_prefix));  // card mode has no prefix to compare
}

TEST_CASE("prompts: the command writes one line per card, in order, or nothing") {
    const fs::path dir = temp_dir();
    const std::vector<CardRecord> cards = sample(testset("en"), 40);
    {
        std::ofstream out(dir / "cards.jsonl", std::ios::binary);
        for (const CardRecord& c : cards) out << write_card(c) << '\n';
    }
    REQUIRE(run_prompts({"--cards", (dir / "cards.jsonl").string(), "--prompt", "card", "--out",
                         (dir / "prompts.jsonl").string()}) == 0);
    const std::vector<std::string> lines = lines_of(dir / "prompts.jsonl");
    REQUIRE(lines.size() == cards.size());
    PromptBuilder builder(kData, PromptMode::card);
    for (std::size_t i = 0; i < cards.size(); ++i) {
        const json j = json::parse(lines[i]);
        std::vector<std::string> keys;
        for (const auto& item : j.items()) keys.push_back(item.key());
        // nlohmann::json sorts keys; the order is checked on the raw line.
        CHECK(lines[i].starts_with("{\"id\":\"" + cards[i].id + "\",\"task\":\""));
        CHECK(lines[i].find("\"prompt\":\"card\",\"system\":") != std::string::npos);
        CHECK(keys.size() == 6);
        CHECK(j["lang"] == "en");
        CHECK(j["task"] == std::string(key(cards[i].task)));
        const CardPrompt p = builder.build(cards[i]);
        CHECK(j["system"] == p.system);
        CHECK(j["user"] == p.user);
    }

    // A decide card whose text no longer matches its state (its identity
    // comes from the state, so the record still reads): nothing is written.
    CardRecord bad = first_of(cards, CardTask::decide);
    bad.card += "!";
    {
        std::ofstream out(dir / "bad.jsonl", std::ios::binary);
        out << write_card(cards.back()) << '\n';
        out << write_card(bad) << '\n';
    }
    CHECK_THROWS_AS(run_prompts({"--cards", (dir / "bad.jsonl").string(), "--prompt", "card",
                                 "--out", (dir / "bad-prompts.jsonl").string()}),
                    std::runtime_error);
    CHECK_FALSE(fs::exists(dir / "bad-prompts.jsonl"));

    CHECK_THROWS_AS(run_prompts({"--cards", (dir / "cards.jsonl").string(), "--out",
                                 (dir / "x.jsonl").string()}),
                    UsageError);
    CHECK_THROWS_AS(run_prompts({"--cards", (dir / "cards.jsonl").string(), "--prompt", "short",
                                 "--out", (dir / "x.jsonl").string()}),
                    UsageError);
    fs::remove_all(dir);
}

TEST_CASE("prompts: the tokens of the whole prompt, as the batch reads it") {
    RUMOR_SKIP_WITHOUT_MODEL();
    const llm::ModelVocab& vocab = *testing::model_vocab();
    const llm::ChatWrap wrap = vocab.chat_wrap();
    const std::vector<CardRecord> cards = sample(testset("es"), 97);
    PromptBuilder builder(kData, PromptMode::card);
    for (const CardRecord& c : cards) {
        const CardPrompt p = builder.build(c);
        const std::vector<std::int32_t> tokens = prompt_tokens(vocab, wrap, p);
        // The same tokens as the whole text in one piece: BOS once, the
        // template marks as single tokens, the turn of the model at the end.
        CHECK(tokens == vocab.tokenize(wrap.pre + p.system + wrap.mid + p.user + wrap.post, true));
        const std::vector<std::int32_t> tail = vocab.tokenize(wrap.post, false);
        REQUIRE(tokens.size() > tail.size());
        CHECK(std::vector<std::int32_t>(tokens.end() - static_cast<std::ptrdiff_t>(tail.size()),
                                        tokens.end()) == tail);
    }

    // The command with --vocab writes them.
    const fs::path dir = temp_dir();
    {
        std::ofstream out(dir / "cards.jsonl", std::ios::binary);
        out << write_card(cards.front()) << '\n';
    }
    REQUIRE(run_prompts({"--cards", (dir / "cards.jsonl").string(), "--prompt", "card", "--out",
                         (dir / "prompts.jsonl").string(), "--vocab", *testing::model_path()}) == 0);
    const json line = json::parse(lines_of(dir / "prompts.jsonl").at(0));
    CHECK(line["tokens"].get<std::vector<std::int32_t>>() ==
          prompt_tokens(vocab, wrap, builder.build(cards.front())));
    fs::remove_all(dir);
}

}  // TEST_SUITE

}  // namespace rumor
