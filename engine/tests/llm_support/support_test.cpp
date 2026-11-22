// What package 0 gives the others: the simulated batch and the model file as
// a vocabulary (tokenizer, chat template, metadata, grammar parser).

#include <doctest/doctest.h>

#include <string>
#include <vector>

#include "llm/batch.h"
#include "llm/fake_batch.h"
#include "llm/model_vocab.h"
#include "support/model_file.h"

using namespace rumor;
using namespace rumor::llm;

namespace {

const char* const kSay =
    "{\"action\":\"say\",\"act\":\"greet\",\"text\":\"Hola, Luis.\"}";

Request request(std::uint64_t seed, bool want_text) {
    Request r;
    r.seed = seed;
    r.card = "card " + std::to_string(seed);
    r.grammar = "root ::= \"x\"";
    r.want_text = want_text;
    r.max_tokens = 64;
    return r;
}

}  // namespace

TEST_SUITE("llm_support") {

TEST_CASE("cut_before_text keeps the fields before the text") {
    std::string json = kSay;
    CHECK(cut_before_text(json));
    CHECK(json == "{\"action\":\"say\",\"act\":\"greet\"}");

    std::string none = "{\"action\":\"none\"}";
    CHECK_FALSE(cut_before_text(none));
    CHECK(none == "{\"action\":\"none\"}");
}

TEST_CASE("fake batch: order, batches of N, cut and perf") {
    FakeBatch batch([](const std::string& system, const Request& q) {
        Result r;
        r.json = q.seed == 3 ? "{\"action\":\"none\"}" : kSay;
        CHECK(system == "PREFIX");
        return r;
    }, 2);
    batch.set_prefix("PREFIX");
    CHECK(batch.prefix_sets() == 1);

    const std::vector<Request> requests = {request(1, true), request(2, false),
                                                   request(3, false), request(4, true),
                                                   request(5, false)};
    const std::vector<Result> out = batch.run(requests);
    REQUIRE(out.size() == 5);
    CHECK(out[0].json == kSay);
    CHECK_FALSE(out[0].cut_before_text);
    CHECK(out[1].json == "{\"action\":\"say\",\"act\":\"greet\"}");
    CHECK(out[1].cut_before_text);
    CHECK(out[2].json == "{\"action\":\"none\"}");
    CHECK_FALSE(out[2].cut_before_text);  // nothing to cut
    CHECK(out[4].cut_before_text);
    for (const Result& r : out) {
        CHECK(r.prompt_tokens > 0);
        CHECK(r.output_tokens > 0);
        CHECK(r.t_end_ms > r.t_start_ms);
    }
    // Three batches: 2 + 2 + 1, in request order, and time only goes forward.
    REQUIRE(batch.batches().size() == 3);
    CHECK(batch.batches()[0].size() == 2);
    CHECK(batch.batches()[2].size() == 1);
    CHECK(batch.batches()[1][0].seed == 3);
    CHECK(out[2].t_start_ms >= out[1].t_end_ms);

    const std::vector<PerfSample> perf = batch.take_perf();
    REQUIRE(perf.size() == 3);
    CHECK(perf[0].batch == 2);
    CHECK(perf[2].batch == 1);
    CHECK(perf[0].decisions_per_s_milli > 0);
    CHECK(batch.take_perf().empty());
}

TEST_CASE("fake batch: truncated answers are not cut, run_single has its own system") {
    FakeBatch batch([](const std::string& system, const Request&) {
        Result r;
        r.json = "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"cla";
        r.truncated = system == "PREFIX";
        return r;
    });
    batch.set_prefix("PREFIX");
    CHECK(batch.run({request(1, false)})[0].truncated);
    const Result single = batch.run_single("OTHER", request(2, true));
    CHECK_FALSE(single.truncated);
    CHECK(batch.prefix() == "PREFIX");
    CHECK(batch.batches().size() == 1);  // run_single is not a batch of the village
}

TEST_CASE("model vocab: the chat template of the GGUF is the one measured in phase 0") {
    RUMOR_SKIP_WITHOUT_MODEL();
    const ChatWrap wrap = testing::model_vocab()->chat_wrap();
    // bench/prompts/wrap.json, family gemma4.
    CHECK(wrap.pre == "<|turn>system\n");
    CHECK(wrap.mid == "<turn|>\n<|turn>user\n");
    CHECK(wrap.post == "<turn|>\n<|turn>model\n");
}

TEST_CASE("model vocab: prefix and card tokenize apart as they do together") {
    RUMOR_SKIP_WITHOUT_MODEL();
    const ModelVocab& vocab = *testing::model_vocab();
    const ChatWrap wrap = vocab.chat_wrap();
    const std::string shared = wrap.pre + "Eres un vecino de un pueblo. Lugares: plaza, bar." + wrap.mid;
    const std::string card = "Eres Carmen, panadera.\nEs martes, 18:30. Estás en el bar." + wrap.post;

    std::vector<std::int32_t> apart = vocab.tokenize(shared, true);
    const std::vector<std::int32_t> second = vocab.tokenize(card, false);
    apart.insert(apart.end(), second.begin(), second.end());
    CHECK(apart == vocab.tokenize(shared + card, true));
    // The template tokens are single special tokens, and BOS is added once.
    CHECK(vocab.count("<|turn>") == 1);
    CHECK(vocab.tokenize("a", true).size() == vocab.tokenize("a", false).size() + 1);
}

TEST_CASE("model vocab: the grammar parser accepts and rejects whole sentences") {
    RUMOR_SKIP_WITHOUT_MODEL();
    const ModelVocab& vocab = *testing::model_vocab();
    const std::string grammar =
        "root ::= \"{\\\"action\\\":\" (none | go) \"}\"\n"
        "none ::= \"\\\"none\\\"\"\n"
        "go ::= \"\\\"go\\\",\\\"where\\\":\\\"\" (\"plaza\" | \"bar\") \"\\\"\"\n";
    CHECK(vocab.grammar_accepts(grammar, "{\"action\":\"none\"}"));
    CHECK(vocab.grammar_accepts(grammar, "{\"action\":\"go\",\"where\":\"plaza\"}"));
    CHECK_FALSE(vocab.grammar_accepts(grammar, "{\"action\":\"go\",\"where\":\"molino\"}"));
    CHECK_FALSE(vocab.grammar_accepts(grammar, "{\"action\":\"go\",\"where\":\"plaza\""));  // incomplete
    CHECK_FALSE(vocab.grammar_accepts(grammar, " {\"action\":\"none\"}"));
    CHECK_THROWS(vocab.grammar_accepts("root ::= (", "x"));
}

TEST_CASE("model vocab: the GGUF brings its recommended sampling") {
    RUMOR_SKIP_WITHOUT_MODEL();
    const ModelVocab& vocab = *testing::model_vocab();
    const auto temp = vocab.meta("general.sampling.temp");
    const auto top_k = vocab.meta("general.sampling.top_k");
    const auto top_p = vocab.meta("general.sampling.top_p");
    REQUIRE(temp);
    REQUIRE(top_k);
    REQUIRE(top_p);
    MESSAGE("sampling of the model: temp " << *temp << ", top_k " << *top_k << ", top_p " << *top_p);
    CHECK_FALSE(vocab.meta("general.sampling.does_not_exist"));
}

}  // TEST_SUITE
