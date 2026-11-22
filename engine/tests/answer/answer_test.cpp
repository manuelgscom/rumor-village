// Tests of `rumor answer` (cli/answer.h) with the simulated model
// (llm/fake_batch.h): the prompt and the request of every card, grammar on and
// off, greedy and model sampling with a stable seed per card, resuming, the
// limit and perf.json. Also the setup.json of `rumor bench` (cli/bench_card.h),
// which phase 5 added with the card prompt.

#include <doctest/doctest.h>

#ifdef _WIN32
#include <process.h>  // _getpid
#define getpid _getpid
#else
#include <unistd.h>
#endif

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/record.h"
#include "cli/answer.h"
#include "cli/bench_card.h"
#include "cli/prompts.h"
#include "extract/extract.h"
#include "llm/fake_batch.h"
#include "policy/model.h"

namespace rumor {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;

const std::string kData = RUMOR_DATA_DIR;

fs::path temp_dir() {
    static int runs = 0;
    const fs::path dir = fs::temp_directory_path() /
                         ("rumor-answer-" + std::to_string(getpid()) + "-" + std::to_string(++runs));
    fs::remove_all(dir);
    fs::create_directories(dir);
    return dir;
}

// Every `step`-th card of the Spanish decision test set: turns, plans and
// extract cards of villages of 20, 25 and 100.
std::vector<CardRecord> sample(std::size_t step) {
    const std::vector<CardRecord> all =
        read_card_file(kData + "/../training/testset/decision/es.jsonl");
    std::vector<CardRecord> out;
    for (std::size_t i = 0; i < all.size(); i += step) out.push_back(all[i]);
    return out;
}

void write_cards(const fs::path& path, const std::vector<CardRecord>& cards) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    for (const CardRecord& c : cards) out << write_card(c) << '\n';
}

std::vector<std::string> lines_of(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    std::vector<std::string> lines;
    for (std::string line; std::getline(in, line);) lines.push_back(line);
    return lines;
}

// What the simulated model saw of one card.
struct Seen {
    std::string system;
    llm::Request request;
};

// A model that answers every request with a fixed action and remembers, by
// card text, what it was asked.
struct Model {
    std::map<std::string, Seen> seen;  // by user message
    int calls = 0;                     // of get_batch
    llm::FakeBatch batch;

    explicit Model(int n_parallel = 4)
        : batch(
              [this](const std::string& system, const llm::Request& r) {
                  seen[r.card] = Seen{system, r};
                  llm::Result out;
                  out.json = R"({"action":"none"})";
                  out.prompt_tokens = 100;
                  out.output_tokens = 5;
                  return out;
              },
              n_parallel) {}

    std::function<llm::Batch&()> get() {
        return [this]() -> llm::Batch& {
            ++calls;
            return batch;
        };
    }
};

AnswerOptions options_in(const fs::path& dir, PromptMode prompt) {
    AnswerOptions o;
    o.cards_path = (dir / "cards.jsonl").string();
    o.out_path = (dir / "labels.jsonl").string();
    o.data_dir = kData;
    o.prompt = prompt;
    return o;
}

std::set<std::string> ids_in(const fs::path& path) {
    std::set<std::string> ids;
    for (const std::string& line : lines_of(path)) ids.insert(json::parse(line)["id"].get<std::string>());
    return ids;
}

}  // namespace

TEST_SUITE("answer") {

TEST_CASE("answer: each card with its prompt, grammar and limits, in both prompt modes") {
    const std::vector<CardRecord> cards = sample(13);
    for (const PromptMode mode : {PromptMode::card, PromptMode::full}) {
        CAPTURE(key(mode));
        const fs::path dir = temp_dir();
        write_cards(dir / "cards.jsonl", cards);
        Model model;
        const AnswerOptions o = options_in(dir, mode);
        const AnswerStats stats = answer_cards(o, model.get());
        CHECK(stats.cards == cards.size());
        CHECK(stats.skipped == 0);
        CHECK(model.calls == 1);

        // One line per card, the keys validate reads, in order.
        const std::vector<std::string> lines = lines_of(dir / "labels.jsonl");
        REQUIRE(lines.size() == cards.size());
        for (const std::string& line : lines) {
            CHECK(line.find("\",\"raw\":\"{\\\"action\\\":\\\"none\\\"}\",\"tokens_in\":100,"
                            "\"tokens_out\":5}") != std::string::npos);
        }
        CHECK(ids_in(dir / "labels.jsonl").size() == cards.size());

        PromptBuilder builder(kData, mode);
        std::set<std::string> systems;
        bool turn = false, plan = false, extract = false;
        for (const CardRecord& c : cards) {
            CAPTURE(c.id);
            const CardPrompt p = builder.build(c);
            systems.insert(p.system);
            REQUIRE(model.seen.contains(p.user));
            const Seen& s = model.seen.at(p.user);
            CHECK(s.system == p.system);
            CHECK(s.request.grammar == p.grammar);
            CHECK(s.request.seed == card_seed(1, c.fingerprint));
            if (c.task == CardTask::extract) {
                extract = true;
                CHECK(s.request.greedy);
                CHECK(s.request.want_text);
                CHECK(s.request.max_tokens == kExtractMaxTokens);
            } else if (c.kind == DecisionKind::turn) {
                turn = true;
                CHECK_FALSE(s.request.greedy);
                CHECK(s.request.want_text);  // the text is always written
                CHECK(s.request.max_tokens == kMaxTokensWithText);
            } else {
                plan = true;
                CHECK_FALSE(s.request.greedy);
                CHECK_FALSE(s.request.want_text);
                CHECK(s.request.max_tokens == kMaxTokensWithoutText);
            }
        }
        CHECK((turn && plan && extract));
        // The system message is set once per village, and batches hold at most N.
        CHECK(model.batch.prefix_sets() == static_cast<int>(systems.size()));
        for (const auto& b : model.batch.batches()) CHECK(b.size() <= 4);
        fs::remove_all(dir);
    }
}

TEST_CASE("answer: without grammar, and greedy") {
    const std::vector<CardRecord> cards = sample(29);
    const fs::path dir = temp_dir();
    write_cards(dir / "cards.jsonl", cards);
    Model model;
    AnswerOptions o = options_in(dir, PromptMode::card);
    o.grammar = false;
    o.sampling = Sampling::greedy;
    answer_cards(o, model.get());
    REQUIRE(model.seen.size() == cards.size());
    for (const auto& [card, s] : model.seen) {
        CHECK(s.request.grammar.empty());
        CHECK(s.request.greedy);
    }
    fs::remove_all(dir);
}

TEST_CASE("answer: the seed of a card depends on --seed and its fingerprint only") {
    const std::vector<CardRecord> cards = sample(37);
    std::vector<CardRecord> reversed(cards.rbegin(), cards.rend());
    const auto seeds = [&](const std::vector<CardRecord>& file, std::uint64_t seed) {
        const fs::path dir = temp_dir();
        write_cards(dir / "cards.jsonl", file);
        Model model(3);
        AnswerOptions o = options_in(dir, PromptMode::card);
        o.seed = seed;
        answer_cards(o, model.get());
        std::map<std::string, std::uint64_t> out;
        for (const auto& [card, s] : model.seen) out[card] = s.request.seed;
        fs::remove_all(dir);
        return out;
    };
    const auto a = seeds(cards, 1);
    CHECK(a == seeds(reversed, 1));  // not the order of the file, nor the batch
    const auto b = seeds(cards, 2);
    REQUIRE(a.size() == b.size());
    std::size_t same = 0;
    for (const auto& [card, seed] : a) same += b.at(card) == seed;
    CHECK(same == 0);
    // Different cards, different seeds.
    std::set<std::uint64_t> unique;
    for (const auto& [card, seed] : a) unique.insert(seed);
    CHECK(unique.size() == a.size());
    CHECK(card_seed(1, cards[0].fingerprint) == card_seed(1, cards[0].fingerprint));
    CHECK(card_seed(1, cards[0].fingerprint) != card_seed(1, cards[1].fingerprint));
}

TEST_CASE("answer: --limit, resuming, a last line cut short and an --out of something else") {
    const std::vector<CardRecord> cards = sample(41);
    REQUIRE(cards.size() > 20);
    const fs::path dir = temp_dir();
    write_cards(dir / "cards.jsonl", cards);
    AnswerOptions o = options_in(dir, PromptMode::card);

    o.limit = 10;
    Model first;
    CHECK(answer_cards(o, first.get()).cards == 10);
    std::set<std::string> want;
    for (std::size_t i = 0; i < 10; ++i) want.insert(cards[i].id);
    CHECK(ids_in(dir / "labels.jsonl") == want);

    // The same limit again: nothing to do, and the model is not loaded.
    Model again;
    const AnswerStats none = answer_cards(o, again.get());
    CHECK(none.cards == 0);
    CHECK(none.skipped == 10);
    CHECK(again.calls == 0);

    // A crash in the middle of a line: the piece is dropped, the rest goes on.
    {
        std::ofstream out(dir / "labels.jsonl", std::ios::binary | std::ios::app);
        out << "{\"id\":\"" << cards[10].id << "\",\"raw\":\"{\\\"act";
    }
    o.limit.reset();
    Model rest;
    const AnswerStats stats = answer_cards(o, rest.get());
    CHECK(stats.cards == cards.size() - 10);
    CHECK(stats.skipped == 10);
    const std::vector<std::string> lines = lines_of(dir / "labels.jsonl");
    CHECK(lines.size() == cards.size());
    CHECK(ids_in(dir / "labels.jsonl").size() == cards.size());
    for (const std::string& line : lines) {
        CHECK_NOTHROW([&line] { [[maybe_unused]] const json parsed = json::parse(line); }());
    }
    for (std::size_t i = 0; i < 10; ++i) CHECK_FALSE(rest.seen.contains(cards[i].card));

    // An --out with an id that is not a card of the file is not this run.
    {
        std::ofstream out(dir / "labels.jsonl", std::ios::binary | std::ios::app);
        out << "{\"id\":\"decide-es-0000000000000000\",\"raw\":\"\"}\n";
    }
    Model other;
    CHECK_THROWS_AS(answer_cards(o, other.get()), std::runtime_error);
    CHECK(other.calls == 0);
    fs::remove_all(dir);
}

TEST_CASE("answer: perf.json") {
    const std::vector<CardRecord> cards = sample(53);
    const fs::path dir = temp_dir();
    write_cards(dir / "cards.jsonl", cards);
    AnswerOptions o = options_in(dir, PromptMode::full);
    o.perf_path = (dir / "perf.json").string();
    Model model(5);
    answer_cards(o, model.get());
    // Read and closed at once: Windows cannot remove an open file.
    const nlohmann::ordered_json perf = nlohmann::ordered_json::parse(std::ifstream(dir / "perf.json"));
    std::vector<std::string> keys;
    for (const auto& item : perf.items()) keys.push_back(item.key());
    CHECK(keys == std::vector<std::string>{"cards", "seconds", "decisions_per_s", "tokens_per_s",
                                           "vram_mb", "batch", "prompt"});
    CHECK(perf["cards"] == cards.size());
    CHECK(perf["batch"] == 5);
    CHECK(perf["prompt"] == "full");
    CHECK(perf["seconds"].get<double>() >= 0);
    CHECK(perf["decisions_per_s"].get<double>() > 0);
    fs::remove_all(dir);
}

TEST_CASE("bench: -card in the default folder and setup.json") {
    RunOptions run;
    run.scenario = "party-100";
    run.lang = Lang::es;
    run.policy = "model";
    llm::BatchOptions batch;
    batch.model_path = "/models/ft.gguf";
    CHECK(bench_default_out(run, batch) == fs::path("runs/bench/ft/party-100-es"));
    run.prompt = PromptMode::card;
    CHECK(bench_default_out(run, batch) == fs::path("runs/bench/ft/party-100-es-card"));
    run.text = TextMode::none;
    CHECK(bench_default_out(run, batch) == fs::path("runs/bench/ft/party-100-es-notext-card"));
    run.text = TextMode::all;

    const fs::path dir = temp_dir();
    claim_bench_setup(dir, run);
    {
        // Closed before the folder is removed: Windows cannot remove an open file.
        std::ifstream in(dir / "setup.json");
        CHECK(json::parse(in) == json::parse(R"({"prompt":"card","text":"all"})"));
    }
    CHECK_NOTHROW(claim_bench_setup(dir, run));  // the same modes again
    RunOptions full = run;
    full.prompt = PromptMode::full;
    CHECK_THROWS_AS(claim_bench_setup(dir, full), std::runtime_error);
    RunOptions notext = run;
    notext.text = TextMode::none;
    CHECK_THROWS_AS(claim_bench_setup(dir, notext), std::runtime_error);

    // A folder of runs from before setup.json: full prompt only.
    const fs::path old = temp_dir();
    std::ofstream(old / "seed-1.jsonl") << "{}\n";
    CHECK_THROWS_AS(claim_bench_setup(old, run), std::runtime_error);
    CHECK_FALSE(fs::exists(old / "setup.json"));
    CHECK_NOTHROW(claim_bench_setup(old, full));
    CHECK(fs::exists(old / "setup.json"));

    RunOptions baseline;
    baseline.policy = "baseline";
    CHECK(bench_setup(baseline).dump() == R"({"prompt":null,"text":null})");
    fs::remove_all(dir);
    fs::remove_all(old);
}

}  // TEST_SUITE

}  // namespace rumor
