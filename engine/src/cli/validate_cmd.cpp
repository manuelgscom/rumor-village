// `rumor validate --in <labels.jsonl|train.jsonl> --cards <cards.jsonl>
//                 --out <verdicts.jsonl> [--strict] [--data <dir>]`
// (cli/validate.h). Package C of phase 4.
//
// Every input line gets one verdict line, in the same order. An input line
// that cannot be read, a repeated id or an id without card is an error (exit
// 1, nothing written): no answer is skipped silently.
//
// A row of train.jsonl carries its answer already in canonical form: an
// `output` that differs from the `canonical` of its verdict is counted, and
// fails --strict like a verdict that is not ok.

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/record.h"
#include "cli/usage.h"
#include "cli/validate.h"
#include "cli/validate_judge.h"

namespace rumor {
namespace {

using json = nlohmann::json;

struct Options {
    std::string in, cards, out;
    std::string data_dir = "data";
    bool strict = false;
};

Options parse_options(int argc, char** argv) {
    Options o;
    for (int i = 2; i < argc; ++i) {
        const std::string_view flag = argv[i];
        if (flag == "--strict") {
            o.strict = true;
            continue;
        }
        if (i + 1 >= argc) throw UsageError("missing value for " + std::string(flag));
        const std::string value = argv[++i];
        if (flag == "--in") o.in = value;
        else if (flag == "--cards") o.cards = value;
        else if (flag == "--out") o.out = value;
        else if (flag == "--data") o.data_dir = value;
        else throw UsageError("unknown option '" + std::string(flag) + "'");
    }
    if (o.in.empty() || o.cards.empty() || o.out.empty()) {
        throw UsageError("validate needs --in, --cards and --out");
    }
    return o;
}

// Calls `each(line, number)` for every line of a JSONL file (number from 1).
// A blank line is an error.
template <class F>
void for_each_line(const std::string& path, F each) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open '" + path + "'");
    std::string line;
    for (std::size_t n = 1; std::getline(in, line); ++n) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.find_first_not_of(" \t") == std::string::npos) {
            throw std::runtime_error(path + ":" + std::to_string(n) + ": empty line");
        }
        each(line, n);
    }
    if (in.bad()) throw std::runtime_error("cannot read '" + path + "'");
}

std::map<std::string, CardRecord> read_cards(const std::string& path) {
    std::map<std::string, CardRecord> cards;
    for_each_line(path, [&](const std::string& line, std::size_t n) {
        const std::string where = path + ":" + std::to_string(n) + ": ";
        CardRecord record;
        try {
            record = read_card(line);
        } catch (const std::exception& e) {
            throw std::runtime_error(where + e.what());
        }
        const std::string id = record.id;
        if (!cards.emplace(id, std::move(record)).second) {
            throw std::runtime_error(where + "repeated card id '" + id + "'");
        }
    });
    return cards;
}

// One answer of the input: its id and the answer text (`raw` in labels.jsonl,
// `output` in train.jsonl). A null answer is an empty one.
struct Input {
    std::string id;
    std::string answer;
    bool output = false;  // read from `output`: a row of train.jsonl
};

Input read_input(const std::string& line, const std::string& where) {
    const json j = json::parse(line, nullptr, /*allow_exceptions=*/false);
    if (!j.is_object()) throw std::runtime_error(where + "not a JSON object");
    const auto id = j.find("id");
    if (id == j.end() || !id->is_string() || id->get_ref<const std::string&>().empty()) {
        throw std::runtime_error(where + "no 'id'");
    }
    auto answer = j.find("raw");
    const bool output = answer == j.end();
    if (output) answer = j.find("output");
    if (answer == j.end()) throw std::runtime_error(where + "neither 'raw' nor 'output'");
    if (answer->is_null()) return {id->get<std::string>(), "", output};
    if (!answer->is_string()) {
        throw std::runtime_error(where + "'" + answer.key() + "' is not a string");
    }
    return {id->get<std::string>(), answer->get<std::string>(), output};
}

}  // namespace

int validate_command(int argc, char** argv) {
    const Options options = parse_options(argc, argv);
    const std::map<std::string, CardRecord> cards = read_cards(options.cards);

    // The villages of the cards: few, each loaded once.
    using VillageKey = std::tuple<Lang, int, Layout, std::uint64_t>;
    std::map<VillageKey, JudgeVillage> villages;

    std::vector<std::string> lines;
    std::set<std::string> seen;
    std::map<std::string, int> reasons;  // how many verdicts give each reason
    std::size_t failed = 0;
    std::size_t not_canonical = 0;  // train rows whose output is not their canonical
    for_each_line(options.in, [&](const std::string& line, std::size_t n) {
        const std::string where = options.in + ":" + std::to_string(n) + ": ";
        const Input input = read_input(line, where);
        const std::string& id = input.id;
        if (!seen.insert(id).second) throw std::runtime_error(where + "repeated id '" + id + "'");
        const auto card = cards.find(id);
        if (card == cards.end()) throw std::runtime_error(where + "no card for id '" + id + "'");
        const CardRecord& record = card->second;
        const CardVillage& v = record.state.village;
        const VillageKey village_key{record.lang, v.neighbors, v.layout, v.seed};
        auto village = villages.find(village_key);
        if (village == villages.end()) {
            village =
                villages.emplace(village_key, load_judge_village(options.data_dir, record)).first;
        }
        const AnswerVerdict verdict = judge_answer(record, input.answer, village->second);
        if (!verdict.ok()) ++failed;
        if (input.output && verdict.canonical && *verdict.canonical != input.answer) {
            ++not_canonical;
        }
        for (const std::string& r : verdict.reasons) ++reasons[r];
        lines.push_back(verdict_line(id, verdict));
    });

    std::ofstream out(options.out, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("cannot write '" + options.out + "'");
    for (const std::string& l : lines) out << l << '\n';
    out.close();
    if (!out) throw std::runtime_error("cannot write '" + options.out + "'");

    std::string summary = "validate: " + std::to_string(lines.size()) + " answers, " +
                          std::to_string(lines.size() - failed) + " ok, " +
                          std::to_string(failed) + " discarded";
    if (!reasons.empty()) {
        std::vector<std::pair<std::string, int>> by_count(reasons.begin(), reasons.end());
        std::stable_sort(by_count.begin(), by_count.end(),
                         [](const auto& a, const auto& b) { return a.second > b.second; });
        summary += " (";
        for (std::size_t i = 0; i < by_count.size(); ++i) {
            if (i > 0) summary += ", ";
            summary += by_count[i].first + " " + std::to_string(by_count[i].second);
        }
        summary += ")";
    }
    if (not_canonical > 0) {
        summary += "; " + std::to_string(not_canonical) + " outputs differ from their canonical";
    }
    std::cerr << summary << '\n';
    if (options.strict && (failed > 0 || not_canonical > 0)) {
        std::cerr << "validate: --strict: " << failed << " answers are not ok, " << not_canonical
                  << " outputs are not canonical\n";
        return 1;
    }
    return 0;
}

}  // namespace rumor
