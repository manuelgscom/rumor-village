// The judgement of one answer against its card (cli/validate_judge.h).

#include "cli/validate_judge.h"

#include <algorithm>
#include <cstddef>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/validate_api.h"
#include "extract/extract.h"
#include "policy/answer.h"

namespace rumor {
namespace {

using json = nlohmann::json;

// The longest `what` the grammar of extract lets a model write
// (extract/prompt.cpp), in code points.
constexpr int kWhatMaxChars = 40;
// The largest amount both grammars let a model write: up to 7 digits.
constexpr SlotValue kAmountMax = 9'999'999;

// Whether a JSON text repeats a key inside one object: read_answer and
// validate_extracted parse into maps, which keep only the last one.
class RepeatedKey final : public nlohmann::json_sax<json> {
  public:
    bool repeated = false;

    bool null() override { return true; }
    bool boolean(bool) override { return true; }
    bool number_integer(number_integer_t) override { return true; }
    bool number_unsigned(number_unsigned_t) override { return true; }
    bool number_float(number_float_t, const string_t&) override { return true; }
    bool string(string_t&) override { return true; }
    bool binary(binary_t&) override { return true; }
    bool start_object(std::size_t) override {
        open_.emplace_back();
        return true;
    }
    bool key(string_t& k) override {
        std::vector<std::string>& keys = open_.back();
        if (std::find(keys.begin(), keys.end(), k) != keys.end()) repeated = true;
        keys.push_back(k);
        return true;
    }
    bool end_object() override {
        open_.pop_back();
        return true;
    }
    bool start_array(std::size_t) override { return true; }
    bool end_array() override { return true; }
    bool parse_error(std::size_t, const std::string&, const nlohmann::detail::exception&) override {
        return false;
    }

  private:
    std::vector<std::vector<std::string>> open_;  // keys of each open object
};

// The callers have already read `text` as JSON.
bool repeats_a_key(std::string_view text) {
    RepeatedKey sax;
    return !json::sax_parse(text.begin(), text.end(), &sax) || sax.repeated;
}

// A free string of a grammar: 1 to `max_chars` code points, without quotes,
// backslashes or control characters.
bool grammar_string(const std::string& text, int max_chars) {
    int chars = 0;
    for (const char ch : text) {
        const auto c = static_cast<unsigned char>(ch);
        if (c < 0x20 || c == '"' || c == '\\') return false;
        if ((c & 0xC0) != 0x80) ++chars;
    }
    return chars >= 1 && chars <= max_chars;
}

// Only whitespace, or nothing.
bool blank(std::string_view text) {
    return text.find_first_not_of(" \t\r\n") == std::string_view::npos;
}

// A JSON string literal (UTF-8 kept as it is).
std::string quoted(const std::string& text) { return json(text).dump(); }

// "hoy 21:00": a slot relative to `now`, with the day words of `vocab`.
std::string when_text(TimeSlot slot, Tick now, const Vocab& vocab) {
    const std::optional<RelativeWhen> rel = to_relative(slot, now);
    if (!rel) return "null";  // not reachable: read_answer only reads today and tomorrow
    return quoted((rel->day == 0 ? vocab.today : vocab.tomorrow) + " " +
                  clock_text(rel->hour, rel->minute));
}

std::string neighbor_name(SlotValue v, const Population& population) {
    const auto i = static_cast<std::size_t>(v) - 1;
    return v >= 1 && i < population.neighbors.size() ? quoted(population.neighbors[i].name)
                                                     : "null";
}

std::string place_name(SlotValue v, const Vocab& vocab) {
    const auto i = static_cast<std::size_t>(v) - 1;
    return v >= 1 && i < kPlaceCount ? quoted(vocab.places[i]) : "null";
}

// The action as the grammar of card/render.cpp writes it.
std::string canonical_action(const Action& a, Tick now, const Vocab& vocab,
                             const Population& population) {
    std::string out = "{\"action\":\"" + std::string(key(a.type)) + "\"";
    if (a.act) out += ",\"act\":\"" + std::string(key(*a.act)) + "\"";
    if (a.fact) out += ",\"fact\":" + std::to_string(*a.fact);
    if (a.claim) {
        const auto& s = a.claim->slots;
        const auto& who = s[idx(Slot::who)];
        const auto& where = s[idx(Slot::where)];
        const auto& when = s[idx(Slot::when)];
        const auto& amount = s[idx(Slot::amount)];
        out += ",\"claim\":{\"who\":" + (who ? neighbor_name(*who, population) : "null");
        out += ",\"where\":" + (where ? place_name(*where, vocab) : "null");
        out += ",\"when\":" + (when ? when_text(*when, now, vocab) : "null");
        out += ",\"amount\":" + (amount ? std::to_string(*amount) : "null");
        out += ",\"guess\":[";
        bool first = true;
        for (const Slot slot : kSlots) {
            if (!a.claim->guess[idx(slot)]) continue;
            if (!first) out += ",";
            out += "\"" + std::string(key(slot)) + "\"";
            first = false;
        }
        out += "]}";
    }
    if (a.text) out += ",\"text\":" + quoted(*a.text);
    return out + "}";
}

// The fact as the grammar of extract/prompt.cpp writes it. A name outside the
// vocabulary is kept as written.
std::string canonical_fact(const Extracted& f, const Vocab& vocab, const Population& population) {
    std::string out = "{\"what\":" + quoted(vocab.what_label(f.what));
    out += ",\"who\":";
    if (f.who) out += neighbor_name(static_cast<SlotValue>(f.who->v), population);
    else out += f.unknown_who ? quoted(*f.unknown_who) : "null";
    out += ",\"where\":";
    if (f.where) out += place_name(static_cast<SlotValue>(f.where->v), vocab);
    else out += f.unknown_where ? quoted(*f.unknown_where) : "null";
    out += ",\"when\":";
    if (f.when) {
        out += quoted((f.when->day == 0 ? vocab.today : vocab.tomorrow) + " " +
                      clock_text(f.when->hour, f.when->minute));
    } else {
        out += "null";
    }
    out += ",\"amount\":" + (f.amount ? std::to_string(*f.amount) : "null");
    return out + "}";
}

// The reasons of a verdict, each once, in the order of cli/validate_judge.h.
class Reasons {
  public:
    void add(std::string reason) {
        if (std::find(list_.begin(), list_.end(), reason) == list_.end()) {
            list_.push_back(std::move(reason));
        }
    }
    std::vector<std::string> sorted() const {
        static const std::vector<std::string_view> order = {
            "unreadable", "bad_shape", "rejected:", "contradiction", "invented", "hardened_doubt",
            "go_without_place_or_time", "incoherent_text", "bad_vocab", "contract_version"};
        const auto rank = [](const std::string& r) {
            for (std::size_t i = 0; i < order.size(); ++i) {
                if (r.rfind(order[i], 0) == 0) return i;
            }
            return order.size();
        };
        std::vector<std::string> out = list_;
        std::stable_sort(out.begin(), out.end(), [&](const std::string& a, const std::string& b) {
            return rank(a) < rank(b);
        });
        return out;
    }

  private:
    std::vector<std::string> list_;
};

void judge_decide(const CardRecord& record, std::string_view raw, const JudgeVillage& village,
                  Reasons& reasons, AnswerVerdict& verdict) {
    const DecisionRequest& request = *record.state.request;
    const Decision decision = read_answer(raw, request, village.vocab, village.population);
    if (decision.reject == RejectReason::malformed) {
        reasons.add("unreadable");
        return;
    }
    const Action& action = decision.action;

    // Values the grammar would not let through.
    if (repeats_a_key(raw)) reasons.add("bad_shape");
    if (action.type == ActionType::say &&
        (!action.text || !grammar_string(*action.text, kTextMaxChars))) {
        reasons.add("bad_shape");
    }
    if (action.claim) {
        const auto& amount = action.claim->slots[idx(Slot::amount)];
        if (amount && *amount > kAmountMax) reasons.add("bad_shape");
    }

    const Validated validated = validate(request, decision);
    if (validated.verdict.reject != RejectReason::none) {
        reasons.add("rejected:" + std::string(key(validated.verdict.reject)));
        return;
    }
    verdict.canonical = canonical_action(action, request.tick, village.vocab, village.population);
    verdict.slots = validated.verdict.slots;
    if (verdict.slots) {
        for (const SlotVerdict v : *verdict.slots) {
            if (v == SlotVerdict::contradiction) reasons.add("contradiction");
            if (v == SlotVerdict::invented) reasons.add("invented");
            if (v == SlotVerdict::hardened_doubt) reasons.add("hardened_doubt");
        }
    }
    if (validated.action.type == ActionType::go) {
        const Claim* claim = validated.action.claim ? &*validated.action.claim : nullptr;
        if (!claim || !claim->slots[idx(Slot::where)] || !claim->slots[idx(Slot::when)]) {
            reasons.add("go_without_place_or_time");
        }
    }
    // As the metrics judge a turn of the log: the claim as proposed.
    if (action.text && action.claim) {
        TextCheckContext context = village.text;
        context.speaker = request.self;
        context.listener = request.other;
        if (check_text(context, *action.claim, request.tick, *action.text).any()) {
            reasons.add("incoherent_text");
        }
    }
}

void judge_extract(const CardRecord& record, std::string_view raw, const JudgeVillage& village,
                   Reasons& reasons, AnswerVerdict& verdict) {
    const Extracted fact = validate_extracted(std::string(raw), village.vocab, village.population);
    if (!fact.ok) {
        reasons.add("unreadable");
        return;
    }
    verdict.canonical = canonical_fact(fact, village.vocab, village.population);
    if (repeats_a_key(raw) || !grammar_string(village.vocab.what_label(fact.what), kWhatMaxChars) ||
        (fact.amount && *fact.amount > kAmountMax)) {
        reasons.add("bad_shape");
    }
    if (fact.unknown_who || fact.unknown_where) reasons.add("bad_vocab");

    const std::optional<Fact>& expected = record.state.fact;
    if (!expected) return;
    PerSlot<std::optional<SlotValue>> said;
    if (fact.who) said[idx(Slot::who)] = static_cast<SlotValue>(fact.who->v);
    if (fact.where) said[idx(Slot::where)] = static_cast<SlotValue>(fact.where->v);
    if (fact.when) said[idx(Slot::when)] = from_relative(*fact.when, record.state.tick);
    if (fact.amount) said[idx(Slot::amount)] = *fact.amount;

    PerSlot<SlotVerdict> slots{};
    for (const Slot s : kSlots) {
        const std::optional<SlotValue>& got = said[idx(s)];
        const std::optional<SlotValue>& want = expected->slots[idx(s)];
        SlotVerdict& v = slots[idx(s)];
        if (!got) {
            v = SlotVerdict::omitted;
        } else if (!want) {
            v = SlotVerdict::invented;
            reasons.add("invented");
        } else if (*got != *want) {
            v = SlotVerdict::contradiction;
            reasons.add("contradiction");
        } else {
            v = SlotVerdict::faithful;
        }
    }
    verdict.slots = slots;
}

}  // namespace

JudgeVillage load_judge_village(const std::string& data_dir, const CardRecord& record) {
    const CardVillage& v = record.state.village;
    JudgeVillage out{load_vocab(data_dir, record.lang),
                     make_population(data_dir, v.neighbors, v.layout, v.seed),
                     {}};
    out.text.lang = record.lang;
    out.text.places.assign(out.vocab.places.begin(), out.vocab.places.end());
    for (const Neighbor& n : out.population.neighbors) out.text.neighbors.push_back(n.name);
    return out;
}

AnswerVerdict judge_answer(const CardRecord& record, std::string_view raw,
                           const JudgeVillage& village) {
    AnswerVerdict verdict;
    Reasons reasons;
    if (record.contract_version != kContractVersion) reasons.add("contract_version");
    if (blank(raw)) {
        reasons.add("unreadable");
    } else if (record.task == CardTask::decide) {
        judge_decide(record, raw, village, reasons, verdict);
    } else {
        judge_extract(record, raw, village, reasons, verdict);
    }
    verdict.reasons = reasons.sorted();
    return verdict;
}

std::string verdict_line(const std::string& id, const AnswerVerdict& verdict) {
    nlohmann::ordered_json line;
    line["id"] = id;
    line["ok"] = verdict.ok();
    line["reasons"] = verdict.reasons;
    if (verdict.slots) {
        nlohmann::ordered_json slots;
        for (const Slot s : kSlots) {
            slots[std::string(key(s))] = std::string(key((*verdict.slots)[idx(s)]));
        }
        line["slots"] = slots;
    } else {
        line["slots"] = nullptr;
    }
    if (verdict.canonical) {
        line["canonical"] = *verdict.canonical;
    } else {
        line["canonical"] = nullptr;
    }
    return line.dump();
}

}  // namespace rumor
