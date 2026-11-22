// The `extract` task: validation of the model answer against the vocabulary,
// the "understood" message and the extractor on top of Batch::run_single.

#include "extract/extract.h"

#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/catalog.h"
#include "extract/prompt.h"

namespace rumor {
namespace {

using Json = nlohmann::json;

// The same seed for every sentence: the same sentence, the same fact.
constexpr std::uint64_t kSeed = 1;

std::string_view trimmed(std::string_view text) {
    const auto space = [](char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; };
    while (!text.empty() && space(text.front())) text.remove_prefix(1);
    while (!text.empty() && space(text.back())) text.remove_suffix(1);
    return text;
}

// Trimmed and in ASCII lower case: how names are compared. Accented letters
// are left as they are.
std::string folded(std::string_view text) {
    std::string out(trimmed(text));
    for (char& c : out) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return out;
}

// "la plaza" -> "plaza": the model sometimes keeps the article of the sentence.
std::string without_article(const std::string& name, Lang lang) {
    static const std::vector<std::string_view> es = {"el ", "la ", "los ", "las "};
    static const std::vector<std::string_view> en = {"the "};
    for (std::string_view article : lang == Lang::es ? es : en) {
        if (name.size() > article.size() && name.compare(0, article.size(), article) == 0) {
            return name.substr(article.size());
        }
    }
    return name;
}

std::optional<PlaceId> public_place(const std::string& name, const Vocab& vocab) {
    const std::string wanted = folded(name);
    const std::string bare = without_article(wanted, vocab.lang);
    for (std::size_t i = 0; i < kPublicPlaceCount; ++i) {
        const std::string place = folded(vocab.places[i]);
        if (place == wanted || place == bare) return PlaceId::from_index(i);
    }
    return std::nullopt;
}

std::optional<NeighborId> neighbor(const std::string& name, const Population& population) {
    const std::string wanted = folded(name);
    for (const Neighbor& n : population.neighbors) {
        if (folded(n.name) == wanted) return n.id;
    }
    return std::nullopt;
}

bool two_digits(std::string_view text, int& value) {
    if (text.size() != 2 || text[0] < '0' || text[0] > '9' || text[1] < '0' || text[1] > '9') {
        return false;
    }
    value = (text[0] - '0') * 10 + (text[1] - '0');
    return true;
}

// "<today|tomorrow> HH:MM", minutes 00 or 30.
std::optional<RelativeWhen> parse_when(std::string_view text, const Vocab& vocab) {
    const std::size_t space = text.rfind(' ');
    if (space == std::string_view::npos) return std::nullopt;
    const std::string day = folded(text.substr(0, space));
    const std::string_view clock = text.substr(space + 1);
    RelativeWhen when;
    if (day == folded(vocab.today)) when.day = 0;
    else if (day == folded(vocab.tomorrow)) when.day = 1;
    else return std::nullopt;
    if (clock.size() != 5 || clock[2] != ':' || !two_digits(clock.substr(0, 2), when.hour) ||
        !two_digits(clock.substr(3, 2), when.minute)) {
        return std::nullopt;
    }
    if (when.hour > 23 || (when.minute != 0 && when.minute != 30)) return std::nullopt;
    return when;
}

// A free name slot: null, or a string that may be empty after trimming (then
// it counts as null). False when it is neither.
bool name_slot(const Json& value, std::optional<std::string>& name) {
    if (value.is_null()) return true;
    if (!value.is_string()) return false;
    const std::string_view text = trimmed(value.get_ref<const std::string&>());
    if (!text.empty()) name = std::string(text);
    return true;
}

// Everything but `ok` and `raw`; false when the JSON is not a fact.
bool read_fact(const Json& j, const Vocab& vocab, const Population& population, Extracted& out) {
    if (!j.is_object() || j.size() != 5) return false;
    for (const char* k : {"what", "who", "where", "when", "amount"}) {
        if (!j.contains(k)) return false;
    }

    const Json& what = j["what"];
    if (!what.is_string()) return false;
    const std::string_view label = trimmed(what.get_ref<const std::string&>());
    if (label.empty()) return false;
    out.what = std::string(label);
    // A label of the vocabulary becomes its key ("fiesta" -> "party"), as the
    // scenarios write it; any other text stays as it is.
    for (const auto& [what_key, what_label] : vocab.what) {
        if (folded(what_label) == folded(label)) out.what = what_key;
    }

    std::optional<std::string> who, where;
    if (!name_slot(j["who"], who) || !name_slot(j["where"], where)) return false;
    if (who) {
        out.who = neighbor(*who, population);
        if (!out.who) out.unknown_who = who;
    }
    if (where) {
        out.where = public_place(*where, vocab);
        if (!out.where) out.unknown_where = where;
    }

    const Json& when = j["when"];
    if (!when.is_null()) {
        if (!when.is_string()) return false;
        out.when = parse_when(when.get_ref<const std::string&>(), vocab);
        if (!out.when) return false;
    }

    const Json& amount = j["amount"];
    if (!amount.is_null()) {
        if (!amount.is_number_integer()) return false;
        if (amount.is_number_unsigned()) {
            const auto n = amount.get<std::uint64_t>();
            if (n > static_cast<std::uint64_t>(std::numeric_limits<int>::max())) return false;
            out.amount = static_cast<int>(n);
        } else {
            const auto n = amount.get<std::int64_t>();
            if (n < 0 || n > std::numeric_limits<int>::max()) return false;
            out.amount = static_cast<int>(n);
        }
    }
    return true;
}

class ModelExtractor : public Extractor {
  public:
    ModelExtractor(llm::Batch& batch, std::string system, std::string grammar, const Vocab& vocab,
                   const Population& population)
        : batch_(batch),
          system_(std::move(system)),
          grammar_(std::move(grammar)),
          vocab_(vocab),
          population_(population) {}

    Extracted extract(const std::string& text) override {
        const std::string_view sentence = trimmed(text);
        if (sentence.empty()) return Extracted{};
        llm::Request request;
        request.seed = kSeed;
        request.card = std::string(sentence);
        request.grammar = grammar_;
        request.want_text = true;  // the answer has no "text" field: nothing to cut
        request.max_tokens = kExtractMaxTokens;
        request.greedy = true;  // reading a sentence must not vary
        const llm::Result result = batch_.run_single(system_, request);
        if (result.truncated) {
            Extracted bad;
            bad.raw = result.json;
            return bad;
        }
        return validate_extracted(result.json, vocab_, population_);
    }

  private:
    llm::Batch& batch_;
    std::string system_;
    std::string grammar_;
    const Vocab& vocab_;
    const Population& population_;
};

}  // namespace

Extracted validate_extracted(const std::string& json, const Vocab& vocab,
                             const Population& population) {
    Extracted out;
    const Json j = Json::parse(json, nullptr, false);
    if (!j.is_discarded() && read_fact(j, vocab, population, out)) {
        out.ok = true;
    } else {
        out = Extracted{};
    }
    out.raw = json;
    return out;
}

std::string understood_message(const Extracted& fact, const Vocab& vocab,
                               const Population& population) {
    const bool es = vocab.lang == Lang::es;
    if (!fact.ok) return es ? "No lo he entendido." : "I did not understand that.";

    std::string out = es ? "Entendido: " : "Understood: ";
    out += vocab.what_label(fact.what);
    const auto add = [&out](const std::string& part) { out += " · " + part; };
    if (fact.who && fact.who->valid() && fact.who->index() < population.neighbors.size()) {
        add(population.at(*fact.who).name);
    } else if (fact.unknown_who) {
        add(*fact.unknown_who + (es ? " (vecino desconocido)" : " (unknown neighbor)"));
    }
    if (fact.where && is_place(*fact.where)) {
        add(vocab.place(*fact.where));
    } else if (fact.unknown_where) {
        add(*fact.unknown_where + (es ? " (lugar desconocido)" : " (unknown place)"));
    }
    if (fact.when) {
        add((fact.when->day == 0 ? vocab.today : vocab.tomorrow) + " " +
            clock_text(fact.when->hour, fact.when->minute));
    }
    if (fact.amount) add(std::to_string(*fact.amount));
    return out;
}

std::unique_ptr<Extractor> make_extractor(llm::Batch& batch, const std::string& data_dir,
                                          const Vocab& vocab, const Population& population,
                                          PromptMode mode) {
    return std::make_unique<ModelExtractor>(batch,
                                            extraction::system_message(data_dir, vocab, population, mode),
                                            extraction::grammar(vocab), vocab, population);
}

}  // namespace rumor
