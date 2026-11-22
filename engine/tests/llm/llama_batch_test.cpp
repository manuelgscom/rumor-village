// The llama.cpp batch (package A of phase 2). TEST_SUITE("llm") runs without a
// GPU and never runs the model; TEST_SUITE("llm_gpu") runs the Gemma 4 E4B on
// the GPU (scripts/engine-test.sh --gpu --only llm). Inputs: the prompts and
// grammar of phase 0 (bench/prompts, bench/grammar).

#include <doctest/doctest.h>

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "llm/batch.h"
#include "llm/fake_batch.h"
#include "llm/llama_batch.h"
#include "support/model_file.h"

using namespace rumor;
using namespace rumor::llm;

namespace {

const std::string kBench = std::string(RUMOR_DATA_DIR) + "/../bench";

std::string read_file(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot read " + path);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

struct Card {
    std::string id;
    std::string kind;  // turn or plan
    std::string text;
};

std::vector<Card> cards(const std::string& lang) {
    std::vector<Card> out;
    std::istringstream in(read_file(kBench + "/prompts/" + lang + "/cards.jsonl"));
    for (std::string line; std::getline(in, line);) {
        if (line.empty()) continue;
        const nlohmann::json j = nlohmann::json::parse(line);
        out.push_back({j.at("id"), j.at("kind"), j.at("text")});
    }
    return out;
}

std::string prefix(const std::string& lang) {
    return read_file(kBench + "/prompts/" + lang + "/prefix.txt");
}

const std::string& full_grammar() {
    static const std::string g = read_file(kBench + "/grammar/action_full.gbnf");
    return g;
}

const std::string& notext_grammar() {
    static const std::string g = read_file(kBench + "/grammar/action_notext.gbnf");
    return g;
}

// Phase 0 limits: 112 output tokens with text, 64 without.
Request request(const Card& card, std::uint64_t seed, bool want_text) {
    Request r;
    r.seed = seed;
    r.card = card.text;
    r.grammar = full_grammar();
    r.want_text = want_text;
    r.max_tokens = want_text ? 112 : 64;
    return r;
}

// The vocabulary is loaded before any batch: ModelVocab sets a log callback
// that keeps only errors, and the batch sets one that keeps warnings too.
const ModelVocab& vocab() {
    const ModelVocab* v = testing::model_vocab();
    if (!v) throw std::runtime_error("RUMOR_MODEL is not set");
    return *v;
}

std::unique_ptr<Batch> batch(int n, PrefixMode mode = PrefixMode::copy, int threads = 0) {
    vocab();
    BatchOptions o;
    o.model_path = *testing::model_path();
    o.n_parallel = n;
    o.prefix_mode = mode;
    o.sample_threads = threads;
    return make_llama_batch(o);
}

// A finished output of the full grammar, or its cut before "text".
bool valid(const Result& r) {
    if (r.truncated) return false;
    return vocab().grammar_accepts(r.cut_before_text ? notext_grammar() : full_grammar(), r.json);
}

double decisions_per_s(const std::vector<PerfSample>& perf) {
    double sum = 0;
    for (const PerfSample& p : perf) sum += p.decisions_per_s_milli / 1000.0;
    return perf.empty() ? 0 : sum / static_cast<double>(perf.size());
}

}  // namespace

TEST_SUITE("llm") {

TEST_CASE("fold_seed: deterministic, uses both halves, never the random seed") {
    CHECK(fold_seed(42) == fold_seed(42));
    CHECK(fold_seed(42) != fold_seed(42ULL | (1ULL << 40)));
    CHECK(fold_seed(0xFFFFFFFFULL) != 0xFFFFFFFFu);
    CHECK(fold_seed(0xFFFFFFFF00000000ULL) != 0xFFFFFFFFu);
}

TEST_CASE("the batch refuses the CPU") {
    BatchOptions o;
    o.model_path = "/nonexistent.gguf";
    o.device = "CPU";
    CHECK_THROWS_WITH_AS(make_llama_batch(o), doctest::Contains("not a GPU"), std::runtime_error);
    o.device = "NoSuchDevice0";
    CHECK_THROWS_AS(make_llama_batch(o), std::runtime_error);
    o.n_parallel = 0;
    CHECK_THROWS_AS(make_llama_batch(o), std::runtime_error);
}

TEST_CASE("the internal views only take a llama.cpp batch") {
    FakeBatch fake([](const std::string&, const Request&) { return Result{}; });
    CHECK_THROWS_AS(memory_positions(fake), std::runtime_error);
    CHECK_THROWS_AS(shared_tokens(fake), std::runtime_error);
}

}  // TEST_SUITE("llm")

TEST_SUITE("llm_gpu") {

TEST_CASE("info: file, device and the sampling of the GGUF") {
    const auto b = batch(2);
    const ModelInfo info = b->info();
    CHECK(info.file == testing::model_path()->substr(testing::model_path()->find_last_of('/') + 1));
    CHECK(info.device.starts_with("CUDA0: "));
    CHECK_FALSE(info.description.empty());
    CHECK(info.n_parallel == 2);
    CHECK(info.temperature == doctest::Approx(1.0));
    CHECK(info.top_k == 64);
    CHECK(info.top_p == doctest::Approx(0.95));
    MESSAGE(info.description << " on " << info.device);
}

TEST_CASE("errors: run before set_prefix, a card too long, a bad max_tokens or grammar") {
    const auto b = batch(1);
    const Card card = cards("es").front();
    CHECK_THROWS_AS(b->run({request(card, 1, true)}), std::runtime_error);
    b->set_prefix(prefix("es"));
    Request long_card = request(card, 1, true);
    for (int i = 0; i < 6; ++i) long_card.card += long_card.card;
    CHECK_THROWS_WITH_AS(b->run({long_card}), doctest::Contains("tokens, more than"), std::runtime_error);
    Request bad = request(card, 1, true);
    bad.max_tokens = kMaxOutputTokens + 1;
    CHECK_THROWS_AS(b->run({bad}), std::runtime_error);
    bad = request(card, 1, true);
    bad.grammar = "root ::= (";
    CHECK_THROWS_AS(b->run({bad}), std::runtime_error);
    // Nothing is left behind by a failed run.
    const auto pos = memory_positions(*b);
    CHECK(pos[0] == std::pair<int, int>(0, shared_tokens(*b) - 1));
    CHECK(pos[1] == std::pair<int, int>(-1, -1));
}

// Phase 0 (greedy): 17 of 20 cards identical; the copy itself is exact and the
// difference comes from processing the prompt in one call or in two. With
// sampling, a small change of the logits can change one token and the rest of
// the output after it. So the case asserts what is exact (copy against copy,
// prompt tokens, valid outputs), loose floors for copy against reprocess (same
// action; identical outputs, greedy), and records the figures.
TEST_CASE("copy and reprocess, N = 1: the same output up to rounding") {
    const std::vector<Card> all = cards("es");
    const std::size_t n = all.size();
    auto req = [&](std::size_t i, bool greedy) {
        Request r = request(all[i], 7000 + i, true);
        r.greedy = greedy;
        return r;
    };
    // [greedy][card]
    std::vector<Result> copy[2], copy_again[2], reprocess[2];
    {
        const auto b = batch(1, PrefixMode::copy);
        b->set_prefix(prefix("es"));
        for (int g = 0; g < 2; ++g) {
            for (std::size_t i = 0; i < n; ++i) copy[g].push_back(b->run({req(i, g == 1)}).at(0));
            for (std::size_t i = 0; i < n; ++i) copy_again[g].push_back(b->run({req(i, g == 1)}).at(0));
        }
    }
    {
        const auto b = batch(1, PrefixMode::reprocess);
        b->set_prefix(prefix("es"));
        for (int g = 0; g < 2; ++g) {
            for (std::size_t i = 0; i < n; ++i) reprocess[g].push_back(b->run({req(i, g == 1)}).at(0));
        }
    }
    const auto action = [](const std::string& json) {
        return nlohmann::json::parse(json).at("action").get<std::string>();
    };
    int identical[2] = {0, 0};
    int same_action[2] = {0, 0};
    for (int g = 0; g < 2; ++g) {
        for (std::size_t i = 0; i < n; ++i) {
            CAPTURE(all[i].id);
            CAPTURE(g);
            CHECK(copy[g][i].json == copy_again[g][i].json);  // deterministic
            CHECK(copy[g][i].prompt_tokens == reprocess[g][i].prompt_tokens);
            REQUIRE(valid(copy[g][i]));
            REQUIRE(valid(reprocess[g][i]));
            identical[g] += copy[g][i].json == reprocess[g][i].json;
            same_action[g] += action(copy[g][i].json) == action(reprocess[g][i].json);
        }
    }
    MESSAGE("copy vs reprocess, N=1, es, 20 cards: sampled " << identical[0] << " identical, "
            << same_action[0] << " same action; greedy " << identical[1] << " identical, "
            << same_action[1] << " same action");
    CHECK(same_action[0] >= 16);
    CHECK(same_action[1] >= 16);
    CHECK(identical[1] >= 12);
}

TEST_CASE("two sequences with different grammars each follow their own") {
    const std::string greet =
        "root ::= \"{\\\"action\\\":\\\"say\\\",\\\"act\\\":\\\"greet\\\",\\\"text\\\":\\\"\" "
        "[^\"\\\\\\x00-\\x1F]{1,60} \"\\\"}\"";
    REQUIRE(vocab().grammar_accepts(greet, "{\"action\":\"say\",\"act\":\"greet\",\"text\":\"Hola.\"}"));
    const auto b = batch(4);
    b->set_prefix(prefix("es"));
    const std::vector<Card> all = cards("es");
    std::vector<Request> reqs;
    for (int i = 0; i < 4; ++i) {
        Request r = request(all[static_cast<std::size_t>(i)], 300 + static_cast<std::uint64_t>(i), true);
        if (i % 2 == 1) r.grammar = greet;
        reqs.push_back(r);
    }
    const std::vector<Result> out = b->run(reqs);
    REQUIRE(out.size() == 4);
    for (std::size_t i = 0; i < out.size(); ++i) {
        CAPTURE(out[i].json);
        CHECK_FALSE(out[i].truncated);
        CHECK(vocab().grammar_accepts(reqs[i].grammar, out[i].json));
        if (i % 2 == 1) CHECK(out[i].json.starts_with("{\"action\":\"say\",\"act\":\"greet\""));
    }
}

// N = 1, so that both runs decode exactly the same batches until the cut.
TEST_CASE("the cut output matches the full one field by field up to text") {
    const auto b = batch(1);
    b->set_prefix(prefix("es"));
    const std::vector<Card> all = cards("es");
    int cut = 0;
    for (std::size_t i = 0; i < all.size(); ++i) {
        const Result full = b->run({request(all[i], 500 + i, true)}).at(0);
        const Result part = b->run({request(all[i], 500 + i, false)}).at(0);
        CAPTURE(all[i].id);
        CAPTURE(full.json);
        REQUIRE(valid(full));
        REQUIRE(valid(part));
        std::string expected = full.json;
        const bool has_text = cut_before_text(expected);
        CHECK(part.cut_before_text == has_text);
        CHECK(part.json == expected);
        CHECK(part.output_tokens <= full.output_tokens);
        cut += part.cut_before_text;
    }
    MESSAGE(cut << " of " << all.size() << " outputs were cut before text");
    CHECK(cut > 0);
}

TEST_CASE("after a hundred batches the memory holds only the prefix") {
    const auto b = batch(4);
    b->set_prefix(prefix("es"));
    const int shared = shared_tokens(*b);
    REQUIRE(shared > 0);
    const std::vector<Card> all = cards("es");
    const Request probe = request(all[0], 99, true);
    const Result before = b->run({probe}).at(0);

    for (int round = 0; round < 100; ++round) {
        std::vector<Request> reqs;
        for (int k = 0; k < 4; ++k) {
            const std::size_t c = static_cast<std::size_t>(round * 4 + k) % all.size();
            Request r = request(all[c], static_cast<std::uint64_t>(round * 4 + k), k % 2 == 0);
            r.max_tokens = 4 + k * 4;  // short: some are cut by the limit
            reqs.push_back(r);
        }
        const std::vector<Result> out = b->run(reqs);
        REQUIRE(out.size() == 4);
    }
    const auto pos = memory_positions(*b);
    REQUIRE(pos.size() == 5);
    CHECK(pos[0] == std::pair<int, int>(0, shared - 1));
    for (std::size_t s = 1; s < pos.size(); ++s) CHECK(pos[s] == std::pair<int, int>(-1, -1));
    // The master still answers the same: the same request alone, the same output.
    CHECK(b->run({probe}).at(0).json == before.json);
    CHECK(b->take_perf().size() == 102);
}

TEST_CASE("more requests than N: several rounds in request order, timed and sampled") {
    const auto b = batch(4);
    b->set_prefix(prefix("en"));
    const std::vector<Card> all = cards("en");
    std::vector<Request> reqs;
    for (std::size_t i = 0; i < 10; ++i) reqs.push_back(request(all[i], 40 + i, all[i].kind == "turn"));
    const std::vector<Result> out = b->run(reqs);
    REQUIRE(out.size() == 10);
    for (const Result& r : out) {
        CAPTURE(r.json);
        CHECK(valid(r));
        CHECK(r.prompt_tokens > shared_tokens(*b));
        CHECK(r.t_end_ms > r.t_start_ms);
    }
    // Rounds 4 + 4 + 2, one after the other.
    CHECK(out[4].t_start_ms >= std::max({out[0].t_end_ms, out[1].t_end_ms, out[2].t_end_ms, out[3].t_end_ms}));
    CHECK(out[4].t_start_ms == out[7].t_start_ms);
    const std::vector<PerfSample> perf = b->take_perf();
    REQUIRE(perf.size() == 3);
    CHECK(perf[0].batch == 4);
    CHECK(perf[2].batch == 2);
    CHECK(perf[0].vram_mb > 0);
    CHECK(perf[0].tokens_per_s > 0);
}

TEST_CASE("run_single: its own system message, the master untouched") {
    const auto b = batch(1);
    b->set_prefix(prefix("es"));
    const std::vector<Card> all = cards("es");
    const Result before = b->run({request(all[2], 11, true)}).at(0);
    Request r;
    r.seed = 5;
    r.card = "esta noche hay fiesta en la plaza a las 9";
    r.grammar = "root ::= \"{\\\"what\\\":\\\"\" [a-z ]{1,20} \"\\\"}\"";
    r.max_tokens = 32;
    const Result single = b->run_single("Extrae el hecho de la frase como JSON.", r);
    CAPTURE(single.json);
    CHECK_FALSE(single.truncated);
    CHECK(vocab().grammar_accepts(r.grammar, single.json));
    CHECK(single.prompt_tokens > 0);
    CHECK(b->take_perf().size() == 1);  // run_single leaves no sample
    CHECK(b->run({request(all[2], 11, true)}).at(0).json == before.json);
}

TEST_CASE("greedy: the seed does not matter") {
    const auto b = batch(2);
    b->set_prefix(prefix("es"));
    const Card card = cards("es").at(0);
    Request a = request(card, 1, true);
    a.greedy = true;
    Request c = a;
    c.seed = 987654321987ULL;
    const std::vector<Result> one = b->run({a});
    const std::vector<Result> two = b->run({c});
    CAPTURE(one[0].json);
    CHECK(valid(one[0]));
    CHECK(one[0].json == two[0].json);
    const Result s1 = b->run_single(prefix("es"), a);
    const Result s2 = b->run_single(prefix("es"), c);
    CHECK(s1.json == s2.json);
}

// As `rumor extract` uses it: N = 1, no set_prefix, a system message of about
// a thousand tokens. One longer than kMaxSharedTokens is a clear error.
TEST_CASE("run_single without set_prefix: a long system message fits, a too long one is an error") {
    const auto b = batch(1);
    const std::string system = prefix("es") + "\n" + prefix("en").substr(0, 400);
    Request r;
    r.card = "esta noche hay fiesta en la plaza a las 9";
    r.grammar = "root ::= \"{\\\"what\\\":\\\"\" [a-z ]{1,20} \"\\\"}\"";
    r.max_tokens = 32;
    r.greedy = true;
    const Result out = b->run_single(system, r);
    CAPTURE(out.json);
    CHECK(out.prompt_tokens > 900);
    CHECK(vocab().grammar_accepts(r.grammar, out.json));
    std::string huge = system;
    while (vocab().count(huge) <= kMaxSharedTokens) huge += system;
    CHECK_THROWS_WITH_AS(b->run_single(huge, r), doctest::Contains("more than"), std::runtime_error);
    const auto pos = memory_positions(*b);
    CHECK(pos[0] == std::pair<int, int>(-1, -1));
    CHECK(pos[1] == std::pair<int, int>(-1, -1));
}

// Smoke test with batch 32 and the measure of the sampling threads.
TEST_CASE("batch 32: every output valid; decisions per second and VRAM") {
    const std::vector<Card> all = cards("es");
    std::vector<Request> reqs;
    for (std::size_t i = 0; i < 32; ++i) {
        const Card& c = all[i % all.size()];
        reqs.push_back(request(c, 9000 + i, c.kind == "turn"));
    }
    double rate[2] = {0, 0};
    int vram = 0;
    const int threads[2] = {0, 1};
    for (int t = 0; t < 2; ++t) {
        const auto b = batch(32, PrefixMode::copy, threads[t]);
        b->set_prefix(prefix("es"));
        b->run(reqs);  // warm-up
        b->take_perf();
        int ok = 0;
        long tokens = 0;
        for (int round = 0; round < 3; ++round) {
            const std::vector<Result> out = b->run(reqs);
            REQUIRE(out.size() == 32);
            for (const Result& r : out) {
                ok += valid(r);
                tokens += r.output_tokens;
            }
        }
        CHECK(ok == 96);
        const std::vector<PerfSample> perf = b->take_perf();
        REQUIRE(perf.size() == 3);
        rate[t] = decisions_per_s(perf);
        for (const PerfSample& p : perf) vram = std::max(vram, p.vram_mb);
        MESSAGE("batch 32, es, sample_threads " << threads[t] << ": " << rate[t] << " decisions/s, "
                                                << perf.back().tokens_per_s << " output tokens/s, "
                                                << tokens / 96.0 << " tokens per decision, VRAM "
                                                << vram << " MB");
    }
    CHECK(rate[0] > 0);
    CHECK(rate[1] > 0);
}

}  // TEST_SUITE("llm_gpu")
