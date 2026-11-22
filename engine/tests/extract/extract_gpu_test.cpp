// The `extract` task with the real model on the GPU: twenty sentences per
// language. There is no threshold: the case prints the share of sentences
// whose five slots all match, the share per slot and every miss.

#include <doctest/doctest.h>

#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

#include "core/catalog.h"
#include "core/population_api.h"
#include "core/scenario.h"
#include "extract/extract.h"
#include "llm/batch.h"
#include "support/model_file.h"

using namespace rumor;

namespace {

const std::string kData = RUMOR_DATA_DIR;

// Expected fact. `who` and `where`: "" is null, "?" an unknown name (slot
// empty, name kept), anything else a neighbor name or a place key.
struct Case {
    const char* text;
    const char* what;  // a key of kWhatKeys
    const char* who;
    const char* where;
    std::optional<RelativeWhen> when;
    std::optional<int> amount;
};

constexpr std::nullopt_t none = std::nullopt;

const std::vector<Case> kSpanish = {
    {"hay fiesta en el bar esta noche a las diez", "party", "", "bar", RelativeWhen{0, 22, 0}, none},
    {"Carmen ha ganado 500 euros en la lotería", "lottery", "Carmen", "", none, 500},
    {"mañana se casa Ana en la ermita a las 12", "wedding", "Ana", "chapel", RelativeWhen{1, 12, 0}, none},
    {"concierto en la plaza mañana a las nueve y media de la noche", "concert", "", "square",
     RelativeWhen{1, 21, 30}, none},
    {"han multado a Manuel con 300 euros", "fine", "Manuel", "", none, 300},
    {"hay obras en el molino", "works", "", "mill", none, none},
    {"Juan ha recibido una herencia de 20000 euros", "inheritance", "Juan", "", none, 20000},
    {"fiesta en el mercado hoy a las 6", "party", "", "market", RelativeWhen{0, 18, 0}, none},
    {"mañana a las 10 de la mañana hay concierto en la escuela", "concert", "", "school",
     RelativeWhen{1, 10, 0}, none},
    {"Marta se casa en la iglesia", "wedding", "Marta", "church", none, none},
    {"esta noche a las 11 hay fiesta en el polideportivo", "party", "", "?", RelativeWhen{0, 23, 0}, none},
    {"a Paco le ha tocado la lotería", "lottery", "?", "", none, none},
    {"mañana a las 8 de la tarde habrá una fiesta en la fuente con 100 personas", "party", "",
     "fountain", RelativeWhen{1, 20, 0}, 100},
    {"Antonio tiene una multa de 50 euros", "fine", "Antonio", "", none, 50},
    {"obras en la farmacia mañana a las 8 de la mañana", "works", "", "pharmacy",
     RelativeWhen{1, 8, 0}, none},
    {"esta tarde a las cinco hay boda en la iglesia", "wedding", "", "church", RelativeWhen{0, 17, 0}, none},
    {"Laura se ha llevado 1000 euros en la lotería", "lottery", "Laura", "", none, 1000},
    {"concierto en el río a mediodía", "concert", "", "river", RelativeWhen{0, 12, 0}, none},
    {"en la panadería hacen fiesta mañana a las siete y media de la tarde", "party", "", "bakery",
     RelativeWhen{1, 19, 30}, none},
    {"Pedro ha heredado la casa de su tía", "inheritance", "Pedro", "", none, none},
};

const std::vector<Case> kEnglish = {
    {"there is a party at the bar tonight at ten", "party", "", "bar", RelativeWhen{0, 22, 0}, none},
    {"Carmen has won 500 euros in the lottery", "lottery", "Carmen", "", none, 500},
    {"Ana gets married at the chapel tomorrow at 12", "wedding", "Ana", "chapel", RelativeWhen{1, 12, 0},
     none},
    {"concert in the square tomorrow at half past nine at night", "concert", "", "square",
     RelativeWhen{1, 21, 30}, none},
    {"Manuel has been fined 300 euros", "fine", "Manuel", "", none, 300},
    {"there are building works at the mill", "works", "", "mill", none, none},
    {"Juan has received an inheritance of 20000 euros", "inheritance", "Juan", "", none, 20000},
    {"party at the market today at 6", "party", "", "market", RelativeWhen{0, 18, 0}, none},
    {"tomorrow at 10 am there is a concert at the school", "concert", "", "school",
     RelativeWhen{1, 10, 0}, none},
    {"Marta is getting married at the church", "wedding", "Marta", "church", none, none},
    {"tonight at 11 there is a party at the sports hall", "party", "", "?", RelativeWhen{0, 23, 0}, none},
    {"Paco has won the lottery", "lottery", "?", "", none, none},
    {"tomorrow at 8 pm there will be a party at the fountain with 100 people", "party", "",
     "fountain", RelativeWhen{1, 20, 0}, 100},
    {"Antonio got a fine of 50 euros", "fine", "Antonio", "", none, 50},
    {"building works at the pharmacy tomorrow at 8 in the morning", "works", "", "pharmacy",
     RelativeWhen{1, 8, 0}, none},
    {"this afternoon at five there is a wedding at the church", "wedding", "", "church",
     RelativeWhen{0, 17, 0}, none},
    {"Laura has taken 1000 euros in the lottery", "lottery", "Laura", "", none, 1000},
    {"concert by the river at noon", "concert", "", "river", RelativeWhen{0, 12, 0}, none},
    {"the bakery is throwing a party tomorrow at half past seven in the evening", "party", "",
     "bakery", RelativeWhen{1, 19, 30}, none},
    {"Pedro has inherited his aunt's house", "inheritance", "Pedro", "", none, none},
};

bool who_matches(const Case& c, const Extracted& f, const Population& population) {
    const std::string expected = c.who;
    if (expected.empty()) return !f.who && !f.unknown_who;
    if (expected == "?") return !f.who && f.unknown_who.has_value();
    return f.who && population.at(*f.who).name == expected;
}

bool where_matches(const Case& c, const Extracted& f) {
    const std::string expected = c.where;
    if (expected.empty()) return !f.where && !f.unknown_where;
    if (expected == "?") return !f.where && f.unknown_where.has_value();
    return f.where && f.where == place_from_key(expected);
}

int percent(int hits, int total) { return total == 0 ? 0 : (100 * hits + total / 2) / total; }

void measure(Extractor& extractor, const std::vector<Case>& cases, Lang lang, const Vocab& vocab,
             const Population& population) {
    int all = 0, what = 0, who = 0, where = 0, when = 0, amount = 0;
    std::ostringstream misses;
    for (const Case& c : cases) {
        const Extracted f = extractor.extract(c.text);
        const bool ok_what = f.ok && f.what == c.what;
        const bool ok_who = f.ok && who_matches(c, f, population);
        const bool ok_where = f.ok && where_matches(c, f);
        const bool ok_when = f.ok && f.when == c.when;
        const bool ok_amount = f.ok && f.amount == c.amount;
        what += ok_what;
        who += ok_who;
        where += ok_where;
        when += ok_when;
        amount += ok_amount;
        if (ok_what && ok_who && ok_where && ok_when && ok_amount) {
            ++all;
        } else {
            misses << "\n  \"" << c.text << "\" -> " << f.raw << "  ("
                   << understood_message(f, vocab, population) << ")";
        }
    }
    const int n = static_cast<int>(cases.size());
    MESSAGE("extract " << key(lang) << ": " << all << "/" << n << " sentences right ("
                       << percent(all, n) << " %); per slot: what " << percent(what, n)
                       << " %, who " << percent(who, n) << " %, where " << percent(where, n)
                       << " %, when " << percent(when, n) << " %, amount " << percent(amount, n)
                       << " %" << (all == n ? std::string() : "\nmisses:" + misses.str()));
}

}  // namespace

TEST_SUITE("extract_gpu") {

TEST_CASE("extract: twenty sentences per language with the model") {
    RUMOR_SKIP_WITHOUT_MODEL();
    llm::BatchOptions options;
    options.model_path = *testing::model_path();
    options.n_parallel = 1;
    const std::unique_ptr<llm::Batch> batch = llm::make_llama_batch(options);
    const Population population = make_population(kData, 100, Layout::village, 1);
    REQUIRE(kSpanish.size() == 20);
    REQUIRE(kEnglish.size() == 20);
    for (Lang lang : {Lang::es, Lang::en}) {
        const Vocab vocab = load_vocab(kData, lang);
        const std::unique_ptr<Extractor> extractor = make_extractor(*batch, kData, vocab, population);
        measure(*extractor, lang == Lang::es ? kSpanish : kEnglish, lang, vocab, population);
    }
}

}  // TEST_SUITE
