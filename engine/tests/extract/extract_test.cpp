// The `extract` task without GPU: validation of facts already structured, the
// grammar with the parser of the model, the whole flow with FakeBatch and the
// "understood" message in both languages.

#include <doctest/doctest.h>

#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/catalog.h"
#include "core/population_api.h"
#include "core/scenario.h"
#include "extract/extract.h"
#include "extract/prompt.h"
#include "llm/batch.h"
#include "llm/fake_batch.h"
#include "support/model_file.h"

using namespace rumor;

namespace {

const std::string kData = RUMOR_DATA_DIR;

const Population& population() {
    static const Population p = make_population(kData, 100, Layout::village, 1);
    return p;
}

const Vocab& vocab(Lang lang) {
    static const Vocab es = load_vocab(kData, Lang::es);
    static const Vocab en = load_vocab(kData, Lang::en);
    return lang == Lang::es ? es : en;
}

NeighborId neighbor_named(const std::string& name) {
    for (const Neighbor& n : population().neighbors) {
        if (n.name == name) return n.id;
    }
    throw std::runtime_error("no neighbor " + name);
}

PlaceId place(const char* key) { return *place_from_key(key); }

Extracted check(const std::string& json, Lang lang = Lang::es) {
    return validate_extracted(json, vocab(lang), population());
}

std::string fact_json(const std::string& who, const std::string& where, const std::string& when,
                      const std::string& amount, const std::string& what = "\"fiesta\"") {
    return "{\"what\":" + what + ",\"who\":" + who + ",\"where\":" + where + ",\"when\":" + when +
           ",\"amount\":" + amount + "}";
}

}  // namespace

TEST_SUITE("extract") {

TEST_CASE("validation: places and neighbors of the vocabulary") {
    const Extracted f = check(
        "{\"what\":\"fiesta\",\"who\":\"Luis\",\"where\":\"plaza\",\"when\":\"hoy 21:00\",\"amount\":50}");
    REQUIRE(f.ok);
    CHECK(f.what == "party");  // a label of the vocabulary becomes its key
    CHECK(f.who == neighbor_named("Luis"));
    CHECK(f.where == place("square"));
    CHECK(f.when == RelativeWhen{0, 21, 0});
    CHECK(f.amount == 50);
    CHECK_FALSE(f.unknown_who);
    CHECK_FALSE(f.unknown_where);
    CHECK(f.raw.find("Luis") != std::string::npos);

    // Case, surrounding spaces and the article of the sentence do not matter.
    const Extracted g = check(fact_json("\" luis\"", "\"la Panadería\"", "null", "null"));
    REQUIRE(g.ok);
    CHECK(g.who == neighbor_named("Luis"));
    CHECK(g.where == place("bakery"));

    const Extracted en = check(fact_json("\"Carmen\"", "\"the town hall\"", "\"tomorrow 09:30\"",
                                         "null", "\"lottery prize\""),
                               Lang::en);
    REQUIRE(en.ok);
    CHECK(en.what == "lottery");
    CHECK(en.who == neighbor_named("Carmen"));
    CHECK(en.where == place("town_hall"));
    CHECK(en.when == RelativeWhen{1, 9, 30});

    // A neighbor beyond the 25 of a small village is not in it.
    const Population small = make_population(kData, 25, Layout::village, 1);
    const std::string last = population().neighbors.back().name;
    const Extracted s = validate_extracted(fact_json("\"" + last + "\"", "null", "null", "null"),
                                           vocab(Lang::es), small);
    REQUIRE(s.ok);
    CHECK_FALSE(s.who);
    CHECK(s.unknown_who == last);
}

TEST_CASE("validation: unknown places and neighbors leave the slot empty and keep the name") {
    const Extracted f = check(fact_json("\"Paco\"", "\"polideportivo\"", "\"hoy 22:00\"", "null"));
    REQUIRE(f.ok);
    CHECK_FALSE(f.who);
    CHECK(f.unknown_who == "Paco");
    CHECK_FALSE(f.where);
    CHECK(f.unknown_where == "polideportivo");
    CHECK(f.when == RelativeWhen{0, 22, 0});

    // A home quarter is not a public place, and an English name in Spanish is
    // not a place either.
    CHECK(check(fact_json("null", "\"barrio alto\"", "null", "null")).unknown_where == "barrio alto");
    CHECK(check(fact_json("null", "\"square\"", "null", "null")).unknown_where == "square");
    // An empty name counts as null.
    const Extracted e = check(fact_json("\" \"", "\"\"", "null", "null"));
    REQUIRE(e.ok);
    CHECK_FALSE(e.who);
    CHECK_FALSE(e.unknown_who);
    CHECK_FALSE(e.unknown_where);
}

TEST_CASE("validation: what is free text") {
    const Extracted f = check(fact_json("null", "null", "null", "null", "\" incendio \""));
    REQUIRE(f.ok);
    CHECK(f.what == "incendio");
    CHECK(check(fact_json("null", "null", "null", "null", "\"Boda\"")).what == "wedding");
    CHECK_FALSE(check(fact_json("null", "null", "null", "null", "\"  \"")).ok);
    CHECK_FALSE(check(fact_json("null", "null", "null", "null", "null")).ok);
    CHECK_FALSE(check(fact_json("null", "null", "null", "null", "3")).ok);
}

TEST_CASE("validation: a broken answer is not a fact and does not throw") {
    for (const std::string& bad : {
             std::string(""), std::string("{"), std::string("fiesta en la plaza"),
             std::string("[]"), std::string("null"),
             std::string("{\"what\":\"fiesta\",\"who\":null,\"where\":\"plaza\",\"when\":\"hoy 21:00\""),
             // A key missing, a key too many.
             std::string("{\"what\":\"fiesta\",\"who\":null,\"where\":null,\"when\":null}"),
             fact_json("null", "null", "null", "null").insert(1, "\"x\":1,"),
             // Wrong types.
             fact_json("3", "null", "null", "null"), fact_json("null", "[]", "null", "null"),
         }) {
        const Extracted f = check(bad);
        CHECK_MESSAGE(!f.ok, bad);
        CHECK(f.raw == bad);
        CHECK(f.what.empty());
        CHECK_FALSE(f.where);
    }
}

TEST_CASE("validation: times") {
    CHECK(check(fact_json("null", "null", "\"hoy 00:00\"", "null")).when == RelativeWhen{0, 0, 0});
    CHECK(check(fact_json("null", "null", "\"mañana 23:30\"", "null")).when == RelativeWhen{1, 23, 30});
    CHECK(check(fact_json("null", "null", "\"tomorrow 07:00\"", "null"), Lang::en).when ==
          RelativeWhen{1, 7, 0});
    CHECK_FALSE(check(fact_json("null", "null", "null", "null")).when);
    for (const char* bad : {"\"hoy 21:15\"", "\"hoy 24:00\"", "\"hoy 9:00\"", "\"ayer 10:00\"",
                            "\"today 10:00\"", "\"hoy\"", "\"hoy 21:00:00\"", "42"}) {
        CHECK_MESSAGE(!check(fact_json("null", "null", bad, "null")).ok, bad);
    }
}

TEST_CASE("validation: amounts") {
    CHECK(check(fact_json("null", "null", "null", "0")).amount == 0);
    CHECK(check(fact_json("null", "null", "null", "9999999")).amount == 9999999);
    CHECK_FALSE(check(fact_json("null", "null", "null", "null")).amount);
    for (const char* bad : {"-1", "3.5", "\"50\"", "99999999999", "true"}) {
        CHECK_MESSAGE(!check(fact_json("null", "null", "null", bad)).ok, bad);
    }
}

TEST_CASE("understood message in both languages") {
    const Vocab& es = vocab(Lang::es);
    const Vocab& en = vocab(Lang::en);
    const Extracted party = check(
        "{\"what\":\"fiesta\",\"who\":null,\"where\":\"plaza\",\"when\":\"hoy 21:00\",\"amount\":null}");
    CHECK(understood_message(party, es, population()) == "Entendido: fiesta · plaza · hoy 21:00");
    // The same fact, in English: the slots are identifiers.
    CHECK(understood_message(party, en, population()) == "Understood: party · square · today 21:00");

    const Extracted full = check(fact_json("\"Luis\"", "\"bar\"", "\"mañana 09:30\"", "50",
                                           "\"premio de lotería\""));
    CHECK(understood_message(full, es, population()) ==
          "Entendido: premio de lotería · Luis · bar · mañana 09:30 · 50");
    CHECK(understood_message(full, en, population()) ==
          "Understood: lottery prize · Luis · bar · tomorrow 09:30 · 50");

    const Extracted unknown = check(fact_json("\"Paco\"", "\"polideportivo\"", "null", "null",
                                              "\"incendio\""));
    CHECK(understood_message(unknown, es, population()) ==
          "Entendido: incendio · Paco (vecino desconocido) · polideportivo (lugar desconocido)");
    CHECK(understood_message(unknown, en, population()) ==
          "Understood: incendio · Paco (unknown neighbor) · polideportivo (unknown place)");

    const Extracted bad = check("{");
    CHECK(understood_message(bad, es, population()) == "No lo he entendido.");
    CHECK(understood_message(bad, en, population()) == "I did not understand that.");
}

TEST_CASE("system message: lists, rules and examples of each language") {
    for (Lang lang : {Lang::es, Lang::en}) {
        const Vocab& v = vocab(lang);
        const std::string system = extraction::system_message(kData, v, population());
        CHECK(system.find(v.places[0]) != std::string::npos);
        CHECK(system.find(v.places[kPublicPlaceCount - 1]) != std::string::npos);
        // Home quarters are not where a fact happens.
        CHECK(system.find(v.places[kPublicPlaceCount]) == std::string::npos);
        CHECK(system.find(population().neighbors.front().name + ", ") != std::string::npos);
        CHECK(system.find(population().neighbors.back().name) != std::string::npos);
        CHECK(system.find(v.what_label("lottery")) != std::string::npos);
        CHECK(system.find(v.tomorrow + " HH:MM") != std::string::npos);
        // Every placeholder was filled.
        for (const char* mark : {"{today}", "{tomorrow}", "{what_labels}", "{places}",
                                 "{neighbors}", "{examples}"}) {
            CHECK(system.find(mark) == std::string::npos);
        }
        if (const llm::ModelVocab* model = testing::model_vocab()) {
            MESSAGE("extract system message, " << key(lang) << ": " << model->count(system)
                                               << " tokens");
        }
    }
    CHECK_THROWS_AS(extraction::system_message("/nonexistent", vocab(Lang::es), population()),
                    std::runtime_error);
}

TEST_CASE("system message: a wrong example is an error") {
    const std::filesystem::path dir =
        std::filesystem::temp_directory_path() / "rumor-extract-test" / "prompts" / "extract";
    std::filesystem::create_directories(dir);
    std::filesystem::copy_file(kData + "/prompts/extract/system.es.txt", dir / "system.es.txt",
                               std::filesystem::copy_options::overwrite_existing);
    const std::string data = dir.parent_path().parent_path().string();
    const auto write_examples = [&](const std::string& line) {
        std::ofstream(dir / "examples.es.jsonl") << line << '\n';
    };

    write_examples(
        "{\"text\":\"t\",\"answer\":{\"what\":\"fiesta\",\"who\":null,\"where\":null,\"when\":null,\"amount\":null}}");
    CHECK_NOTHROW(extraction::system_message(data, vocab(Lang::es), population()));
    write_examples(  // keys out of order
        "{\"text\":\"t\",\"answer\":{\"who\":null,\"what\":\"fiesta\",\"where\":null,\"when\":null,\"amount\":null}}");
    CHECK_THROWS_AS(extraction::system_message(data, vocab(Lang::es), population()),
                    std::runtime_error);
    write_examples(  // not a valid time
        "{\"text\":\"t\",\"answer\":{\"what\":\"fiesta\",\"who\":null,\"where\":null,\"when\":\"hoy 21:15\",\"amount\":null}}");
    CHECK_THROWS_AS(extraction::system_message(data, vocab(Lang::es), population()),
                    std::runtime_error);
    write_examples("not json");
    CHECK_THROWS_AS(extraction::system_message(data, vocab(Lang::es), population()),
                    std::runtime_error);
    std::filesystem::remove_all(dir.parent_path().parent_path());
}

TEST_CASE("grammar: accepts valid answers and rejects the rest") {
    RUMOR_SKIP_WITHOUT_MODEL();
    const llm::ModelVocab& model = *testing::model_vocab();
    const std::string es = extraction::grammar(vocab(Lang::es));
    const std::string en = extraction::grammar(vocab(Lang::en));

    CHECK(model.grammar_accepts(
        es, "{\"what\":\"fiesta\",\"who\":null,\"where\":\"plaza\",\"when\":\"hoy 21:00\",\"amount\":null}"));
    CHECK(model.grammar_accepts(es, fact_json("\"Luis\"", "\"panadería\"", "\"mañana 09:30\"", "0")));
    CHECK(model.grammar_accepts(es, fact_json("null", "null", "null", "1234567", "\"premio de lotería\"")));
    // Unknown names pass the grammar: the engine finds them.
    CHECK(model.grammar_accepts(es, fact_json("\"Paco\"", "\"polideportivo\"", "null", "null")));
    CHECK(model.grammar_accepts(en, fact_json("\"Ana\"", "\"town hall\"", "\"tomorrow 23:30\"", "50")));

    for (const std::string& bad : {
             fact_json("null", "null", "\"hoy 21:15\"", "null"),    // off the half hour
             fact_json("null", "null", "\"hoy 24:00\"", "null"),
             fact_json("null", "null", "\"hoy 9:00\"", "null"),
             fact_json("null", "null", "\"tomorrow 21:00\"", "null"),  // English day in Spanish
             fact_json("null", "null", "null", "-1"),
             fact_json("null", "null", "null", "007"),
             fact_json("null", "null", "null", "null", "\"\""),       // empty what
             fact_json("null", "null", "null", "null", "\"a\\\"b\""),  // escapes
             // Keys out of order.
             std::string("{\"who\":null,\"what\":\"fiesta\",\"where\":null,\"when\":null,\"amount\":null}"),
             // Incomplete, with spaces, or with something before.
             std::string("{\"what\":\"fiesta\",\"who\":null,\"where\":\"plaza\""),
             std::string("{\"what\": \"fiesta\",\"who\":null,\"where\":null,\"when\":null,\"amount\":null}"),
             " " + fact_json("null", "null", "null", "null"),
             fact_json("null", "null", "null", "null") + "}",
         }) {
        CHECK_MESSAGE(!model.grammar_accepts(es, bad), bad);
    }
    CHECK_FALSE(model.grammar_accepts(en, fact_json("null", "null", "\"mañana 21:00\"", "null")));
}

TEST_CASE("grammar: the answers of the examples are sentences of it") {
    RUMOR_SKIP_WITHOUT_MODEL();
    const llm::ModelVocab& model = *testing::model_vocab();
    for (Lang lang : {Lang::es, Lang::en}) {
        const std::string grammar = extraction::grammar(vocab(lang));
        std::ifstream in(kData + "/prompts/extract/examples." + std::string(key(lang)) + ".jsonl");
        REQUIRE(in.good());
        std::string line;
        int count = 0;
        while (std::getline(in, line)) {
            if (line.empty()) continue;
            const std::string answer = nlohmann::ordered_json::parse(line)["answer"].dump();
            CHECK_MESSAGE(model.grammar_accepts(grammar, answer), answer);
            ++count;
        }
        CHECK(count >= 4);
    }
}

TEST_CASE("extractor: the whole flow with a simulated model") {
    const Vocab& es = vocab(Lang::es);
    std::vector<std::string> systems;
    std::vector<llm::Request> requests;
    std::string answer =
        "{\"what\":\"fiesta\",\"who\":null,\"where\":\"plaza\",\"when\":\"hoy 21:00\",\"amount\":null}";
    bool truncate = false;
    llm::FakeBatch batch([&](const std::string& system, const llm::Request& request) {
        systems.push_back(system);
        requests.push_back(request);
        llm::Result r;
        r.json = answer;
        r.truncated = truncate;
        return r;
    }, 1);
    batch.set_prefix("PREFIX OF THE VILLAGE");

    const std::unique_ptr<Extractor> extractor = make_extractor(batch, kData, es, population());
    const Extracted f = extractor->extract("esta noche hay fiesta en la plaza a las 9");
    REQUIRE(f.ok);
    CHECK(understood_message(f, es, population()) == "Entendido: fiesta · plaza · hoy 21:00");

    REQUIRE(requests.size() == 1);
    CHECK(systems[0] == extraction::system_message(kData, es, population()));
    CHECK(requests[0].card == "esta noche hay fiesta en la plaza a las 9");
    CHECK(requests[0].grammar == extraction::grammar(es));
    CHECK(requests[0].want_text);
    CHECK(requests[0].max_tokens >= 64);
    // run_single: the prefix of the village is left alone and no batch of it runs.
    CHECK(batch.prefix() == "PREFIX OF THE VILLAGE");
    CHECK(batch.prefix_sets() == 1);
    CHECK(batch.batches().empty());

    // Same sentence, same request: the seed is fixed.
    answer = fact_json("\"Pepe\"", "\"bar\"", "null", "20", "\"multa\"");
    const Extracted g = extractor->extract("  esta noche hay fiesta en la plaza a las 9\n");
    REQUIRE(requests.size() == 2);
    CHECK(requests[1].seed == requests[0].seed);
    CHECK(requests[1].card == requests[0].card);
    REQUIRE(g.ok);
    CHECK(g.what == "fine");
    CHECK(g.unknown_who == "Pepe");
    CHECK(g.where == place("bar"));
    CHECK(g.amount == 20);

    // Cut by the token limit, or not JSON: not a fact.
    truncate = true;
    const Extracted cut = extractor->extract("algo");
    CHECK_FALSE(cut.ok);
    CHECK(cut.raw == answer);
    truncate = false;
    answer = "{\"what\":";
    CHECK_FALSE(extractor->extract("algo").ok);

    // An empty sentence does not reach the model.
    const std::size_t asked = requests.size();
    CHECK_FALSE(extractor->extract(" \n").ok);
    CHECK(requests.size() == asked);

    CHECK_THROWS_AS(make_extractor(batch, "/nonexistent", es, population()), std::runtime_error);
}

}  // TEST_SUITE
