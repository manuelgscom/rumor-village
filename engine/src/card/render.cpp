// The renderer of the model prompts (contract, sections 1, 3 and 5): the
// common prefix, the situation card and the action grammar, in the language of
// the run. Texts and fixed phrases come from data/prompts/<lang>/:
//
//   prefix_full.txt  rules, schema, lists and examples ({count} {places} {neighbors})
//   prefix_card.txt  the lists only ({places} {neighbors})
//   card.json        weekdays, place articles, slot labels and card phrases
//
// The grammar is written here by hand; only the lists of places, neighbors and
// the two day words come from the vocabulary and the population.

#include <algorithm>
#include <array>
#include <cstddef>
#include <fstream>
#include <initializer_list>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/render.h"
#include "core/catalog.h"
#include "core/time.h"

namespace rumor {
namespace {

using Json = nlohmann::json;

std::string read_file(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open " + path);
    std::ostringstream out;
    out << in.rdbuf();
    return out.str();
}

bool is_space(char c) { return c == ' ' || c == '\n' || c == '\r' || c == '\t'; }

std::string trim(std::string_view s) {
    std::size_t a = 0, b = s.size();
    while (a < b && is_space(s[a])) ++a;
    while (b > a && is_space(s[b - 1])) --b;
    return std::string(s.substr(a, b - a));
}

bool is_var_char(char c) { return (c >= 'a' && c <= 'z') || c == '_'; }

// The placeholders "{name}" of a template, in order of appearance. Other braces
// (the JSON of the examples) are not placeholders.
std::vector<std::string> placeholders(std::string_view text) {
    std::vector<std::string> out;
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] != '{') continue;
        std::size_t j = i + 1;
        while (j < text.size() && is_var_char(text[j])) ++j;
        if (j > i + 1 && j < text.size() && text[j] == '}') {
            out.emplace_back(text.substr(i + 1, j - i - 1));
            i = j;
        }
    }
    return out;
}

using Vars = std::initializer_list<std::pair<std::string_view, std::string_view>>;

// One pass over the template: values are never scanned again.
std::string fill(std::string_view text, Vars vars) {
    std::string out;
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '{') {
            std::size_t j = i + 1;
            while (j < text.size() && is_var_char(text[j])) ++j;
            if (j > i + 1 && j < text.size() && text[j] == '}') {
                const std::string_view name = text.substr(i + 1, j - i - 1);
                const auto var = std::find_if(vars.begin(), vars.end(),
                                              [&](const auto& v) { return v.first == name; });
                if (var != vars.end()) {
                    out += var->second;
                    i = j;
                    continue;
                }
            }
        }
        out += text[i];
    }
    return out;
}

// A template must use exactly the placeholders it is given.
void check_template(const std::string& text, const std::vector<std::string>& vars,
                    const std::string& where) {
    const std::vector<std::string> used = placeholders(text);
    for (const std::string& v : used) {
        if (std::find(vars.begin(), vars.end(), v) == vars.end()) {
            throw std::runtime_error(where + ": unknown placeholder {" + v + "}");
        }
    }
    for (const std::string& v : vars) {
        if (std::find(used.begin(), used.end(), v) == used.end()) {
            throw std::runtime_error(where + ": missing placeholder {" + v + "}");
        }
    }
}

// --- Fixed phrases of the card ------------------------------------------------

struct PhraseSpec {
    const char* key;
    std::vector<std::string> vars;
};

const std::vector<PhraseSpec>& phrase_specs() {
    static const std::vector<PhraseSpec> specs = {
        {"self", {"name", "job", "trait"}},
        {"now", {"weekday", "clock", "place"}},
        {"other", {"name", "relation"}},
        {"relation_plain", {"acquaintance"}},
        {"relation_and", {"acquaintance", "relation"}},
        {"knows", {}},
        {"knows_nothing", {}},
        {"doubt", {"source", "value"}},
        {"doubt_anon", {"value"}},
        {"forgotten", {}},
        {"past", {}},
        {"later", {}},
        {"told_by", {"name"}},
        {"first_hand", {}},
        {"told_other", {"name"}},
        {"not_told_other", {"name"}},
        {"conversation", {}},
        {"conversation_empty", {}},
        {"self_greet", {}},
        {"self_tell", {"fact", "claim"}},
        {"self_ask", {"fact"}},
        {"self_bye", {}},
        {"other_greet", {"name"}},
        {"other_tell", {"name", "fact", "claim"}},
        {"other_ask", {"name", "fact"}},
        {"other_bye", {"name"}},
        {"unknown_fact", {}},
        {"guessed", {"value"}},
        {"decision_turn", {}},
        {"decision_plan", {"fact"}},
    };
    return specs;
}

struct Phrases {
    std::array<std::string, 7> weekdays;
    std::array<std::string, kPlaceCount> articles;  // may be empty
    PerSlot<std::string> slots;
    std::map<std::string, std::string, std::less<>> text;

    const std::string& at(std::string_view key) const {
        const auto it = text.find(key);
        if (it == text.end()) throw std::logic_error("card phrase without spec: " + std::string(key));
        return it->second;
    }
};

std::string string_value(const Json& value, const std::string& where, bool allow_empty) {
    if (!value.is_string() || (!allow_empty && value.get<std::string>().empty())) {
        throw std::runtime_error(where + " must be a" + (allow_empty ? "" : " non-empty") + " string");
    }
    return value.get<std::string>();
}

const Json& member(const Json& obj, const char* key, const std::string& path) {
    const auto it = obj.find(key);
    if (it == obj.end()) throw std::runtime_error(path + ": missing '" + key + "'");
    return *it;
}

Phrases read_phrases(const std::string& path) {
    Json doc;
    try {
        doc = Json::parse(read_file(path));
    } catch (const Json::exception& e) {
        throw std::runtime_error(path + ": " + e.what());
    }
    if (!doc.is_object()) throw std::runtime_error(path + ": expected an object");
    for (const auto& item : doc.items()) {
        const std::string& k = item.key();
        if (k != "weekdays" && k != "articles" && k != "slots" && k != "phrases") {
            throw std::runtime_error(path + ": unknown key '" + k + "'");
        }
    }
    Phrases p;

    const Json& days = member(doc, "weekdays", path);
    if (!days.is_array() || days.size() != p.weekdays.size()) {
        throw std::runtime_error(path + ": 'weekdays' must be an array of 7 strings");
    }
    for (std::size_t i = 0; i < p.weekdays.size(); ++i) {
        p.weekdays[i] = string_value(days[i], path + ": weekdays[" + std::to_string(i) + "]", false);
    }

    const Json& articles = member(doc, "articles", path);
    if (!articles.is_object() || articles.size() != kPlaceCount) {
        throw std::runtime_error(path + ": 'articles' must name every place once");
    }
    for (std::size_t i = 0; i < kPlaceCount; ++i) {
        const std::string place_key(kPlaces[i].key);
        p.articles[i] = string_value(member(articles, place_key.c_str(), path + ": articles"),
                                     path + ": articles." + place_key, true);
    }

    const Json& slots = member(doc, "slots", path);
    if (!slots.is_object() || slots.size() != kSlotCount) {
        throw std::runtime_error(path + ": 'slots' must name the four slots");
    }
    for (Slot s : kSlots) {
        const std::string slot_key(key(s));
        p.slots[idx(s)] = string_value(member(slots, slot_key.c_str(), path + ": slots"),
                                       path + ": slots." + slot_key, false);
    }

    const Json& phrases = member(doc, "phrases", path);
    if (!phrases.is_object()) throw std::runtime_error(path + ": 'phrases' must be an object");
    for (const auto& item : phrases.items()) {
        const auto& specs = phrase_specs();
        const bool known = std::any_of(specs.begin(), specs.end(),
                                       [&](const PhraseSpec& s) { return item.key() == s.key; });
        if (!known) throw std::runtime_error(path + ": phrases: unknown key '" + item.key() + "'");
    }
    for (const PhraseSpec& spec : phrase_specs()) {
        const std::string where = path + ": phrases." + spec.key;
        const std::string text = string_value(member(phrases, spec.key, path + ": phrases"), where, false);
        check_template(text, spec.vars, where);
        p.text.emplace(spec.key, text);
    }
    return p;
}

// --- Grammar ------------------------------------------------------------------

// A name may go inside a GBNF literal and a JSON string as it is.
void check_name(const std::string& name, const std::string& where) {
    if (name.empty()) throw std::runtime_error(where + ": empty name");
    for (const char c : name) {
        if (c == '"' || c == '\\' || static_cast<unsigned char>(c) < 0x20) {
            throw std::runtime_error(where + ": name '" + name +
                                     "' cannot carry quotes, backslashes or control characters");
        }
    }
}

std::string literal(std::string_view s) { return "\"" + std::string(s) + "\""; }

// A word as a list of characters, each the bytes of one UTF-8 code point, so
// that the trie never splits a character between two literals.
using Chars = std::vector<std::string>;

Chars utf8_chars(const std::string& s, const std::string& where) {
    Chars out;
    for (std::size_t i = 0; i < s.size();) {
        const auto lead = static_cast<unsigned char>(s[i]);
        const std::size_t len = lead < 0x80 ? 1 : (lead >> 5) == 0x6 ? 2 : (lead >> 4) == 0xE ? 3
                                : (lead >> 3) == 0x1E ? 4 : 0;
        if (len == 0 || i + len > s.size()) throw std::runtime_error(where + ": '" + s + "' is not UTF-8");
        out.push_back(s.substr(i, len));
        i += len;
    }
    return out;
}

std::string join(const Chars& c, std::size_t from = 0) {
    std::string out;
    for (std::size_t i = from; i < c.size(); ++i) out += c[i];
    return out;
}

// An expression that matches exactly the given words (sorted, unique) as a
// prefix trie: the parser then keeps few stacks open at a name.
std::string trie(const std::vector<Chars>& words) {
    if (words.size() == 1) return literal(join(words[0]));
    std::size_t common = 0;
    for (;; ++common) {
        if (common >= words[0].size()) break;
        const std::string& c = words[0][common];
        const bool all = std::all_of(words.begin(), words.end(), [&](const Chars& w) {
            return common < w.size() && w[common] == c;
        });
        if (!all) break;
    }
    if (common > 0) {
        std::vector<Chars> rest;
        for (const Chars& w : words) rest.emplace_back(w.begin() + static_cast<std::ptrdiff_t>(common), w.end());
        Chars head(words[0].begin(), words[0].begin() + static_cast<std::ptrdiff_t>(common));
        return literal(join(head)) + " " + trie(rest);
    }
    bool optional = false;
    std::vector<std::string> alternatives;
    for (std::size_t i = 0; i < words.size();) {
        if (words[i].empty()) {
            optional = true;
            ++i;
            continue;
        }
        std::size_t j = i;
        std::vector<Chars> group;
        while (j < words.size() && !words[j].empty() && words[j][0] == words[i][0]) group.push_back(words[j++]);
        alternatives.push_back(trie(group));
        i = j;
    }
    std::string expr = alternatives[0];
    if (alternatives.size() > 1) {
        expr = "(" + alternatives[0];
        for (std::size_t i = 1; i < alternatives.size(); ++i) expr += " | " + alternatives[i];
        expr += ")";
    }
    return optional ? "(" + expr + ")?" : expr;
}

std::string name_rule(const std::vector<std::string>& names, const std::string& where) {
    std::set<std::string> unique;
    for (const std::string& n : names) {
        check_name(n, where);
        if (!unique.insert(n).second) throw std::runtime_error(where + ": duplicate name '" + n + "'");
    }
    std::vector<Chars> words;
    for (const std::string& n : unique) words.push_back(utf8_chars(n, where));
    std::sort(words.begin(), words.end());
    return trie(words);
}

std::string action_grammar(DecisionKind kind, const std::string& place_rule,
                           const std::string& neighbor_rule, const std::string& today,
                           const std::string& tomorrow) {
    std::string g;
    if (kind == DecisionKind::turn) {
        g += "# Action of a turn: say (greet, tell, ask, bye) or none.\n";
        g += R"(root ::= "{\"action\":" (say | none) "}")" "\n";
        g += R"(say ::= "\"say\",\"act\":" (greet | tell | ask | bye))" "\n";
        g += R"(greet ::= "\"greet\"" text)" "\n";
        g += R"(tell ::= "\"tell\",\"fact\":" fact ",\"claim\":" claim text)" "\n";
        g += R"(ask ::= "\"ask\",\"fact\":" fact text)" "\n";
        g += R"(bye ::= "\"bye\"" text)" "\n";
    } else {
        g += "# Action of a plan: go or none.\n";
        g += R"(root ::= "{\"action\":" (go | none) "}")" "\n";
        g += R"(go ::= "\"go\",\"fact\":" fact ",\"claim\":" claim)" "\n";
    }
    g += R"(none ::= "\"none\"")" "\n";
    g += "# Number in \"what you know\": the engine checks that it exists.\n";
    g += "fact ::= [1-9] [0-9]?\n";
    g += "# Every slot is present, null when omitted; guess lists the guessed slots.\n";
    g += R"(claim ::= "{\"who\":" who ",\"where\":" where ",\"when\":" when ",\"amount\":" amount ",\"guess\":" guess "}")" "\n";
    g += R"(who ::= "null" | "\"" neighbor "\"")" "\n";
    g += R"(where ::= "null" | "\"" place "\"")" "\n";
    g += R"(when ::= "null" | "\"" day " " hour ":" ("00" | "30") "\"")" "\n";
    g += "day ::= " + literal(today) + " | " + literal(tomorrow) + "\n";
    g += R"(hour ::= [01] [0-9] | "2" [0-3])" "\n";
    g += R"(amount ::= "null" | "0" | [1-9] [0-9]{0,6})" "\n";
    g += R"(guess ::= "[]" | "[" slot ("," slot){0,3} "]")" "\n";
    g += R"(slot ::= "\"" ("who" | "where" | "when" | "amount") "\"")" "\n";
    g += "place ::= " + place_rule + "\n";
    g += "neighbor ::= " + neighbor_rule + "\n";
    if (kind == DecisionKind::turn) {
        g += "# Always last, after exactly ,\"text\":\" (the engine may cut there).\n";
        g += "# One or two sentences: no quotes, backslashes or control characters.\n";
        g += R"(text ::= ",\"text\":\"" [^"\\\x00-\x1F]{1,)" + std::to_string(kTextMaxChars) +
             R"(} "\"")" "\n";
    }
    return g;
}

// --- Renderer -----------------------------------------------------------------

class PromptRenderer final : public Renderer {
  public:
    PromptRenderer(const std::string& data_dir, const Vocab& vocab, const Population& population)
        : vocab_(vocab), population_(population) {
        const std::string dir = data_dir + "/prompts/" + std::string(key(vocab.lang)) + "/";
        phrases_ = read_phrases(dir + "card.json");

        if (population.neighbors.empty()) throw std::runtime_error("renderer: empty population");
        std::vector<std::string> places, neighbors;
        for (std::size_t i = 0; i < kPublicPlaceCount; ++i) places.push_back(vocab.places[i]);
        for (const Neighbor& n : population.neighbors) neighbors.push_back(n.name);
        const std::string place_rule = name_rule(places, "vocab " + std::string(key(vocab.lang)) + ": places");
        const std::string neighbor_rule = name_rule(neighbors, "population: neighbors");
        check_name(vocab.today, "vocab: today");
        check_name(vocab.tomorrow, "vocab: tomorrow");

        const std::string places_text = join_names(places);
        const std::string neighbors_text = join_names(neighbors);
        const std::string count = std::to_string(population.neighbors.size());

        const std::string full_path = dir + "prefix_full.txt";
        const std::string full = trim(read_file(full_path));
        check_template(full, {"count", "places", "neighbors"}, full_path);
        prefix_full_ = fill(full, {{"count", count}, {"places", places_text}, {"neighbors", neighbors_text}});

        const std::string card_path = dir + "prefix_card.txt";
        const std::string card = trim(read_file(card_path));
        check_template(card, {"places", "neighbors"}, card_path);
        prefix_card_ = fill(card, {{"places", places_text}, {"neighbors", neighbors_text}});

        grammar_turn_ = action_grammar(DecisionKind::turn, place_rule, neighbor_rule, vocab.today, vocab.tomorrow);
        grammar_plan_ = action_grammar(DecisionKind::plan, place_rule, neighbor_rule, vocab.today, vocab.tomorrow);
    }

    std::string prefix(PromptMode mode) const override {
        return mode == PromptMode::full ? prefix_full_ : prefix_card_;
    }

    std::string grammar(DecisionKind kind) const override {
        return kind == DecisionKind::turn ? grammar_turn_ : grammar_plan_;
    }

    std::string card(const DecisionRequest& r) const override {
        const Neighbor& self = neighbor(r.self, "self");
        const Neighbor* other = r.other.valid() ? &neighbor(r.other, "other") : nullptr;
        if (r.weekday < 0 || r.weekday > 6) throw std::runtime_error("card: weekday out of range");
        if (!is_place(r.place)) throw std::runtime_error("card: the neighbor is at no place");

        std::string out = fill(at("self"), {{"name", self.name},
                                            {"job", vocab_.job(r.job, self.female)},
                                            {"trait", vocab_.trait(r.trait, self.female)}});
        const std::string clock = clock_text(hour_of_day(r.tick), minute_of_day(r.tick) % kTicksPerHour);
        out += "\n" + fill(at("now"), {{"weekday", phrases_.weekdays[static_cast<std::size_t>(r.weekday)]},
                                       {"clock", clock},
                                       {"place", place_phrase(r.place)}});
        if (other) {
            out += "\n" + fill(at("other"), {{"name", other->name},
                                             {"relation", relation_phrase(r.relation, other->female)}});
        }

        out += "\n\n";
        if (r.facts.empty()) {
            out += at("knows_nothing");
        } else {
            out += at("knows");
            for (std::size_t i = 0; i < r.facts.size(); ++i) out += "\n" + fact_lines(r, i, other);
        }

        if (r.kind == DecisionKind::turn || !r.conversation.empty()) {
            out += "\n\n" + at("conversation");
            if (r.conversation.empty()) out += "\n" + at("conversation_empty");
            for (const ConvEntry& e : r.conversation) out += "\n" + conv_line(r, e);
        }

        out += "\n\n";
        if (r.kind == DecisionKind::turn) {
            out += at("decision_turn");
        } else {
            if (r.trigger_fact < 1 || static_cast<std::size_t>(r.trigger_fact) > r.facts.size()) {
                throw std::runtime_error("card: the trigger fact of a plan is not in its list");
            }
            out += fill(at("decision_plan"), {{"fact", "[" + std::to_string(r.trigger_fact) + "]"}});
        }
        return trim(out);
    }

  private:
    const std::string& at(std::string_view key) const { return phrases_.at(key); }

    static std::string join_names(const std::vector<std::string>& names) {
        std::string out;
        for (const std::string& n : names) out += (out.empty() ? "" : ", ") + n;
        return out;
    }

    const Neighbor& neighbor(NeighborId id, const char* role) const {
        if (!id.valid() || id.index() >= population_.neighbors.size()) {
            throw std::runtime_error(std::string("card: ") + role + " is not a neighbor of the run");
        }
        return population_.at(id);
    }

    std::string place_phrase(PlaceId p) const {
        const std::string& article = phrases_.articles[p.index()];
        return article.empty() ? vocab_.place(p) : article + " " + vocab_.place(p);
    }

    std::string relation_phrase(Relation rel, bool female) const {
        const std::string& acquaintance = vocab_.relation(Relation::acquaintance, female);
        if (rel == Relation::acquaintance) return fill(at("relation_plain"), {{"acquaintance", acquaintance}});
        return fill(at("relation_and"), {{"acquaintance", acquaintance},
                                         {"relation", vocab_.relation(rel, female)}});
    }

    // A slot value as the model reads and writes it; an amount of a fact of
    // the catalog carries the unit of its `what` ("50 personas").
    std::string value_text(Slot slot, SlotValue v, Tick now, std::string_view what) const {
        switch (slot) {
            case Slot::who:
                return neighbor(NeighborId(static_cast<std::uint32_t>(v)), "a who value").name;
            case Slot::where: {
                const PlaceId p(static_cast<std::uint32_t>(v));
                if (v <= 0 || !is_place(p)) throw std::runtime_error("card: a where value is not a place");
                return vocab_.place(p);
            }
            case Slot::when: {
                if (v < 0) throw std::runtime_error("card: negative when value");
                if (const auto rel = to_relative(v, now)) {
                    return (rel->day == 0 ? vocab_.today : vocab_.tomorrow) + " " +
                           clock_text(rel->hour, rel->minute);
                }
                // Neither today nor tomorrow: the model cannot write it, so
                // only whether it has passed is shown.
                return v / kSlotsPerDay < day_of(now) ? at("past") : at("later");
            }
            case Slot::amount: {
                if (v < 0) throw std::runtime_error("card: negative amount");
                const std::string unit = vocab_.amount_unit(what);
                return unit.empty() ? std::to_string(v) : std::to_string(v) + " " + unit;
            }
        }
        throw std::logic_error("card: unknown slot");
    }

    std::string fact_ref(const DecisionRequest& r, FactId fact) const {
        for (std::size_t i = 0; i < r.facts.size(); ++i) {
            if (r.facts[i].fact == fact) return "[" + std::to_string(i + 1) + "]";
        }
        return at("unknown_fact");
    }

    std::string fact_lines(const DecisionRequest& r, std::size_t i, const Neighbor* other) const {
        const Belief& b = r.facts[i];
        std::string out = "[" + std::to_string(i + 1) + "] " + vocab_.what_label(b.what);
        for (Slot s : kSlots) {
            const SlotBelief& sb = b.slots[idx(s)];
            if (sb.state == SlotState::unknown) continue;
            std::string value;
            if (sb.state == SlotState::forgotten) {
                value = at("forgotten");
            } else {
                if (!sb.value) throw std::runtime_error("card: a sure or doubtful slot without value");
                value = value_text(s, *sb.value, r.tick, b.what);
                if (sb.state == SlotState::doubt) {
                    value = sb.source.valid()
                                ? fill(at("doubt"), {{"source", neighbor(sb.source, "a source").name},
                                                     {"value", value}})
                                : fill(at("doubt_anon"), {{"value", value}});
                }
            }
            out += " · " + phrases_.slots[idx(s)] + ": " + value;
        }
        out += "\n    ";
        out += b.told_by.valid() ? fill(at("told_by"), {{"name", neighbor(b.told_by, "told_by").name}})
                                 : at("first_hand");
        // Nothing to say about telling it to the neighbor in front when that
        // neighbor is the one who told it: "you have not told Carmen yet" would
        // invite the model to tell it back.
        if (other && other->id != b.told_by) {
            const bool told = std::find(b.told_to.begin(), b.told_to.end(), other->id) != b.told_to.end();
            out += " " + fill(at(told ? "told_other" : "not_told_other"), {{"name", other->name}});
        }
        return out;
    }

    // The `what` of a fact of the list; empty if it is not there.
    static std::string_view fact_what(const DecisionRequest& r, FactId fact) {
        for (const Belief& b : r.facts) {
            if (b.fact == fact) return b.what;
        }
        return {};
    }

    std::string claim_text(const DecisionRequest& r, FactId fact, const std::optional<Claim>& claim) const {
        if (!claim) return "";
        const std::string_view what = fact_what(r, fact);
        std::string values;
        for (Slot s : kSlots) {
            const auto& v = claim->slots[idx(s)];
            if (!v) continue;
            std::string text = value_text(s, *v, r.tick, what);
            if (claim->guess[idx(s)]) text = fill(at("guessed"), {{"value", text}});
            values += (values.empty() ? "" : ", ") + text;
        }
        return values.empty() ? "" : ": " + values;
    }

    std::string conv_line(const DecisionRequest& r, const ConvEntry& e) const {
        const bool mine = e.speaker == r.self;
        const std::string name = mine ? std::string() : neighbor(e.speaker, "a speaker").name;
        const std::string fact = e.act == Act::tell || e.act == Act::ask ? fact_ref(r, e.fact) : "";
        const std::string claim = e.act == Act::tell ? claim_text(r, e.fact, e.claim) : "";
        const char* phrase = nullptr;
        switch (e.act) {
            case Act::greet: phrase = mine ? "self_greet" : "other_greet"; break;
            case Act::tell: phrase = mine ? "self_tell" : "other_tell"; break;
            case Act::ask: phrase = mine ? "self_ask" : "other_ask"; break;
            case Act::bye: phrase = mine ? "self_bye" : "other_bye"; break;
        }
        return fill(at(phrase), {{"name", name}, {"fact", fact}, {"claim", claim}});
    }

    const Vocab& vocab_;
    const Population& population_;
    Phrases phrases_;
    std::string prefix_full_, prefix_card_;
    std::string grammar_turn_, grammar_plan_;
};

}  // namespace

std::unique_ptr<Renderer> make_renderer(const std::string& data_dir, const Vocab& vocab,
                                        const Population& population) {
    return std::make_unique<PromptRenderer>(data_dir, vocab, population);
}

}  // namespace rumor
