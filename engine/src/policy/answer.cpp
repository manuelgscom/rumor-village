// Reading an answer of a model as an action (policy/answer.h).

#include "policy/answer.h"

#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/catalog.h"
#include "core/fact.h"
#include "core/time.h"

namespace rumor {
namespace {

using json = nlohmann::json;

// The context a value is read in: the names of the run and the tick of the
// decision, against which `when` is relative.
struct Reader {
    const Vocab& vocab;
    const Population& population;
    Tick now = 0;

    // An integer that fits in 32 bits, sign included. Validation decides on
    // the sign.
    static std::optional<std::int32_t> integer(const json& v) {
        constexpr auto lo = std::numeric_limits<std::int32_t>::min();
        constexpr auto hi = std::numeric_limits<std::int32_t>::max();
        if (v.is_number_unsigned()) {
            const auto u = v.get<std::uint64_t>();
            if (u > static_cast<std::uint64_t>(hi)) return std::nullopt;
            return static_cast<std::int32_t>(u);
        }
        if (v.is_number_integer()) {
            const auto s = v.get<std::int64_t>();
            if (s < lo || s > hi) return std::nullopt;
            return static_cast<std::int32_t>(s);
        }
        return std::nullopt;
    }

    std::optional<SlotValue> who(const std::string& name) const {
        for (const Neighbor& n : population.neighbors) {
            if (n.name == name) return static_cast<SlotValue>(n.id.v);
        }
        return std::nullopt;
    }

    // Any place of the vocabulary: a home is read too, and validation rejects
    // it as outside the `where` vocabulary.
    std::optional<SlotValue> where(const std::string& name) const {
        for (std::size_t i = 0; i < kPlaceCount; ++i) {
            if (vocab.places[i] == name) return static_cast<SlotValue>(PlaceId::from_index(i).v);
        }
        return std::nullopt;
    }

    // "<today|tomorrow> HH:MM", with the day words of the run.
    std::optional<SlotValue> when(const std::string& text) const {
        RelativeWhen rel;
        std::string_view clock;
        const std::string_view s = text;
        const auto starts = [&](const std::string& word) {
            return s.size() > word.size() && s.substr(0, word.size()) == word &&
                   s[word.size()] == ' ';
        };
        if (starts(vocab.today)) {
            rel.day = 0;
            clock = s.substr(vocab.today.size() + 1);
        } else if (starts(vocab.tomorrow)) {
            rel.day = 1;
            clock = s.substr(vocab.tomorrow.size() + 1);
        } else {
            return std::nullopt;
        }
        const auto digit = [&](std::size_t i) { return clock[i] >= '0' && clock[i] <= '9'; };
        if (clock.size() != 5 || clock[2] != ':' || !digit(0) || !digit(1) || !digit(3) ||
            !digit(4)) {
            return std::nullopt;
        }
        rel.hour = (clock[0] - '0') * 10 + (clock[1] - '0');
        rel.minute = (clock[3] - '0') * 10 + (clock[4] - '0');
        const std::optional<TimeSlot> slot = from_relative(rel, now);
        if (!slot) return std::nullopt;
        return *slot;
    }

    // One slot value; `null` is an omission. False if it cannot be read.
    bool slot(Slot s, const json& v, std::optional<SlotValue>& out) const {
        if (v.is_null()) return true;
        if (s == Slot::amount) {
            out = integer(v);
            return out.has_value();
        }
        if (!v.is_string()) return false;
        const std::string& text = v.get_ref<const std::string&>();
        switch (s) {
            case Slot::who: out = who(text); break;
            case Slot::where: out = where(text); break;
            case Slot::when: out = when(text); break;
            case Slot::amount: break;
        }
        return out.has_value();
    }

    std::optional<Claim> claim(const json& v) const {
        if (!v.is_object()) return std::nullopt;
        Claim c;
        for (const auto& [k, value] : v.items()) {
            if (k == "guess") {
                if (value.is_null()) continue;
                if (!value.is_array()) return std::nullopt;
                for (const json& g : value) {
                    if (!g.is_string()) return std::nullopt;
                    const std::optional<Slot> s = from_key<Slot>(g.get_ref<const std::string&>());
                    if (!s) return std::nullopt;
                    c.guess[idx(*s)] = true;
                }
                continue;
            }
            const std::optional<Slot> s = from_key<Slot>(k);
            if (!s || !slot(*s, value, c.slots[idx(*s)])) return std::nullopt;
        }
        return c;
    }

    // The answer as an action, or nothing if it is not one.
    std::optional<Action> action(std::string_view text) const {
        const json doc = json::parse(text.begin(), text.end(), nullptr, /*allow_exceptions=*/false);
        if (!doc.is_object()) return std::nullopt;
        Action a;
        bool has_type = false;
        for (const auto& [k, v] : doc.items()) {
            if (k == "action") {
                if (!v.is_string()) return std::nullopt;
                const auto type = from_key<ActionType>(v.get_ref<const std::string&>());
                if (!type) return std::nullopt;
                a.type = *type;
                has_type = true;
            } else if (v.is_null()) {
                if (k != "act" && k != "fact" && k != "claim" && k != "text") return std::nullopt;
            } else if (k == "act") {
                if (!v.is_string()) return std::nullopt;
                a.act = from_key<Act>(v.get_ref<const std::string&>());
                if (!a.act) return std::nullopt;
            } else if (k == "fact") {
                a.fact = integer(v);
                if (!a.fact) return std::nullopt;
            } else if (k == "claim") {
                a.claim = claim(v);
                if (!a.claim) return std::nullopt;
            } else if (k == "text") {
                if (!v.is_string()) return std::nullopt;
                a.text = v.get<std::string>();
            } else {
                return std::nullopt;
            }
        }
        if (!has_type) return std::nullopt;
        return a;
    }
};

}  // namespace

Decision read_answer(std::string_view json_text, const DecisionRequest& request,
                     const Vocab& vocab, const Population& population) {
    Decision d;
    if (auto a = Reader{vocab, population, request.tick}.action(json_text)) {
        d.action = std::move(*a);
    } else {
        d.reject = RejectReason::malformed;
    }
    return d;
}

}  // namespace rumor
