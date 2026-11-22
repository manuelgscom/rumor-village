// The grammar and the system message of the `extract` task.

#include "extract/prompt.h"

#include <array>
#include <cstddef>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

#include "core/catalog.h"
#include "core/enum_keys.h"
#include "extract/extract.h"

namespace rumor::extraction {
namespace {

using OrderedJson = nlohmann::ordered_json;

// The keys of the answer, in the order of the grammar.
constexpr std::array<std::string_view, 5> kKeys = {"what", "who", "where", "when", "amount"};

// A literal of the GBNF: quotes and backslashes escaped.
std::string gbnf_literal(std::string_view text) {
    std::string out = "\"";
    for (char c : text) {
        if (c == '"' || c == '\\') out += '\\';
        out += c;
    }
    return out + '"';
}

std::string read_file(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open " + path);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

// Replaces every occurrence of `name` in `text`. Throws when there is none: a
// template that drifts from the code must not pass silently.
void fill(std::string& text, const std::string& name, const std::string& value,
          const std::string& path) {
    const std::string mark = "{" + name + "}";
    std::size_t at = text.find(mark);
    if (at == std::string::npos) throw std::runtime_error(path + ": '" + mark + "' is missing");
    while (at != std::string::npos) {
        text.replace(at, mark.size(), value);
        at = text.find(mark, at + value.size());
    }
}

std::string joined(const std::string& a, const std::string& b) { return a.empty() ? b : a + ", " + b; }

// "<sentence>\n<answer>" for each example, separated by blank lines. Every
// answer is checked: keys in the order of the grammar and a valid fact.
std::string examples(const std::string& path, const Vocab& vocab, const Population& population) {
    std::istringstream lines(read_file(path));
    std::string line, out;
    int number = 0;
    while (std::getline(lines, line)) {
        ++number;
        if (line.empty()) continue;
        const std::string where = path + ":" + std::to_string(number);
        const OrderedJson example = OrderedJson::parse(line, nullptr, false);
        if (example.is_discarded() || !example.is_object() || example.size() != 2 ||
            !example.contains("text") || !example["text"].is_string() ||
            !example.contains("answer") || !example["answer"].is_object()) {
            throw std::runtime_error(where + ": expected {\"text\":\"...\",\"answer\":{...}}");
        }
        const OrderedJson& answer = example["answer"];
        std::size_t k = 0;
        for (const auto& item : answer.items()) {
            if (k >= kKeys.size() || item.key() != kKeys[k]) {
                throw std::runtime_error(where + ": the answer keys must be what, who, where, when, amount");
            }
            ++k;
        }
        const std::string json = answer.dump();
        if (k != kKeys.size() || !validate_extracted(json, vocab, population).ok) {
            throw std::runtime_error(where + ": the answer is not a valid fact");
        }
        if (!out.empty()) out += "\n\n";
        out += example["text"].get<std::string>() + "\n" + json;
    }
    if (out.empty()) throw std::runtime_error(path + ": no examples");
    return out;
}

}  // namespace

std::string grammar(const Vocab& vocab) {
    // No quotes, backslashes or control characters in a free string: the JSON
    // never needs an escape.
    const std::string free_text = "[^\"\\\\\\x00-\\x1F]";
    std::string g;
    g += "root ::= \"{\\\"what\\\":\\\"\" what \"\\\",\\\"who\\\":\" name \",\\\"where\\\":\" name "
         "\",\\\"when\\\":\" when \",\\\"amount\\\":\" amount \"}\"\n";
    g += "what ::= " + free_text + "{1,40}\n";
    g += "name ::= \"null\" | \"\\\"\" " + free_text + "{1,30} \"\\\"\"\n";
    g += "when ::= \"null\" | \"\\\"\" day \" \" hour \":\" (\"00\" | \"30\") \"\\\"\"\n";
    g += "day ::= " + gbnf_literal(vocab.today) + " | " + gbnf_literal(vocab.tomorrow) + "\n";
    g += "hour ::= [01] [0-9] | \"2\" [0-3]\n";
    g += "amount ::= \"null\" | \"0\" | [1-9] [0-9]{0,6}\n";
    return g;
}

std::string system_message(const std::string& data_dir, const Vocab& vocab,
                           const Population& population, PromptMode mode) {
    const std::string lang(key(vocab.lang));
    std::string places, neighbors, labels;
    for (std::size_t i = 0; i < kPublicPlaceCount; ++i) places = joined(places, vocab.places[i]);
    for (const Neighbor& n : population.neighbors) neighbors = joined(neighbors, n.name);
    for (const auto& [what_key, label] : vocab.what) labels = joined(labels, label);

    if (mode == PromptMode::card) {
        // The template is trimmed before it is filled, as the renderer does.
        const std::string path = data_dir + "/prompts/" + lang + "/prefix_card.txt";
        const std::string raw = read_file(path);
        const std::size_t first = raw.find_first_not_of(" \t\r\n");
        if (first == std::string::npos) throw std::runtime_error(path + ": empty");
        std::string text = raw.substr(first, raw.find_last_not_of(" \t\r\n") + 1 - first);
        fill(text, "places", places, path);
        fill(text, "neighbors", neighbors, path);
        return text;
    }

    const std::string dir = data_dir + "/prompts/extract/";
    const std::string path = dir + "system." + lang + ".txt";
    std::string text = read_file(path);

    fill(text, "today", vocab.today, path);
    fill(text, "tomorrow", vocab.tomorrow, path);
    fill(text, "what_labels", labels, path);
    fill(text, "places", places, path);
    fill(text, "neighbors", neighbors, path);
    fill(text, "examples", examples(dir + "examples." + lang + ".jsonl", vocab, population), path);
    while (!text.empty() && (text.back() == '\n' || text.back() == ' ')) text.pop_back();
    return text;
}

}  // namespace rumor::extraction
