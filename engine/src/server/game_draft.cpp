// The draft of a game read into settings and rumors (game_draft.h).

#include "server/game_draft.h"

#include <algorithm>
#include <stdexcept>
#include <utility>

#include "core/fact.h"
#include "server/draft_parse.h"

namespace rumor {
namespace {

using Json = nlohmann::json;

// "HH:MM" -> minutes of the day; empty when it is not one.
std::optional<Tick> clock_tick(const std::string& text) {
    const auto digit = [&](std::size_t i) { return text[i] >= '0' && text[i] <= '9'; };
    if (text.size() != 5 || text[2] != ':' || !digit(0) || !digit(1) || !digit(3) || !digit(4)) {
        return std::nullopt;
    }
    const int hour = (text[0] - '0') * 10 + (text[1] - '0');
    const int minute = (text[3] - '0') * 10 + (text[4] - '0');
    if (hour > 23 || minute > 59) return std::nullopt;
    return hour * kTicksPerHour + minute;
}

const Json& member(const Json& object, const char* key) {
    static const Json null;
    const auto it = object.find(key);
    return it == object.end() ? null : *it;
}

}  // namespace

Json draft_errors_json(const std::vector<DraftError>& errors) {
    Json list = Json::array();
    for (const DraftError& e : errors) {
        list.push_back({{"rumor", e.rumor ? Json(*e.rumor) : Json(nullptr)},
                        {"field", e.field},
                        {"error", e.error}});
    }
    return Json{{"errors", list}};
}

GameSettings draft_settings(const Json& draft, bool ai_default) {
    if (!draft.is_object()) throw std::invalid_argument("draft: expected an object");
    Json settings = member(draft, "settings");
    if (settings.is_null()) settings = Json::object();
    if (settings.is_object() && !settings.contains("mode")) settings["mode"] = ai_default ? "ai" : "rules";
    return game_settings_from_json(settings);
}

Json normalized_draft(const Json& draft, bool ai_default) {
    const GameSettings settings = draft_settings(draft, ai_default);
    Json rumors = member(draft, "rumors");
    if (rumors.is_null()) rumors = Json::array();
    if (!rumors.is_array()) throw std::invalid_argument("rumors: expected an array");
    Json out = Json::object();
    out["settings"] = game_settings_to_json(settings);
    out["rumors"] = rumors;
    out["challenge"] = member(draft, "challenge");
    out["bets"] = member(draft, "bets");
    out["race"] = member(draft, "race");
    return out;
}

Json default_draft(bool ai_default) { return normalized_draft(Json::object(), ai_default); }

DraftRumors draft_rumors(const Json& draft, const GameSettings& settings,
                         const ScenarioParams& scenario, const Population& population,
                         const Vocab& vocab) {
    DraftRumors out;
    const Json& list = draft.is_object() ? member(draft, "rumors") : Json();
    if (!list.is_null() && !list.is_array()) {
        out.errors.push_back({std::nullopt, "rumors", "invalid"});
        return out;
    }
    if (list.is_null() || list.empty()) {
        out.errors.push_back({std::nullopt, "rumors", "empty"});
        return out;
    }
    const bool telephone = settings.type == GameType::telephone;
    if (telephone && list.size() > 1) {
        out.errors.push_back({std::nullopt, "rumors", "too_many"});
        return out;
    }

    out.last_needed = scenario.start_tick;
    for (std::size_t i = 0; i < list.size(); ++i) {
        const int index = static_cast<int>(i);
        const Json& rumor = list[i];
        const auto fail = [&](std::string field, std::string error) {
            out.errors.push_back({index, std::move(field), std::move(error)});
        };
        if (!rumor.is_object()) {
            fail("rumor", "invalid");
            continue;
        }

        http::ParsedFact fact = http::parse_fact(member(rumor, "fact"), vocab, population, true);
        if (fact.error) {
            fail(fact.field, fact.code);
            continue;
        }
        GameRumor game;
        Injection& inj = game.injection.fact;
        const Extracted& f = fact.fact;

        const Json& text = member(rumor, "text");
        if (text.is_string()) {
            if (!text.get_ref<const std::string&>().empty()) inj.text = text.get<std::string>();
        } else if (!text.is_null()) {
            fail("text", "invalid");
            continue;
        }

        // When it enters: at the start, or at an hour of day 0 inside the game.
        game.at = scenario.start_tick;
        const Json& at = member(rumor, "at");
        if (!telephone && !at.is_null() && at != "start") {
            const std::optional<Tick> tick =
                at.is_string() ? clock_tick(at.get<std::string>()) : std::nullopt;
            if (!tick) {
                fail("at", "invalid");
                continue;
            }
            if (*tick < scenario.start_tick || *tick >= scenario.end_tick ||
                (settings.until && *tick >= *settings.until)) {
                fail("at", "out_of_range");
                continue;
            }
            game.at = *tick;
        }

        // Who receives it: the first of the row in the telephone game.
        if (telephone) {
            inj.to.push_back(NeighborId::from_index(0));
        } else {
            http::ParsedTo to = http::parse_to(member(rumor, "to"), vocab, population);
            if (to.error) {
                fail("to", to.code);
                continue;
            }
            game.injection.place = to.place;
            inj.to = std::move(to.neighbors);
        }

        inj.tick = game.at;
        inj.what = f.what;
        if (f.who) inj.slots[idx(Slot::who)] = static_cast<SlotValue>(f.who->v);
        if (f.where) inj.slots[idx(Slot::where)] = static_cast<SlotValue>(f.where->v);
        Tick needed = game.at;
        if (f.when) {
            // "Today" is day 0, whatever the hour the rumor enters.
            const std::optional<TimeSlot> slot = from_relative(*f.when, scenario.start_tick);
            if (!slot) {
                fail("when", "invalid");
                continue;
            }
            inj.slots[idx(Slot::when)] = *slot;
            needed = std::max(needed, tick_of(*slot));
        }
        if (f.amount) inj.slots[idx(Slot::amount)] = static_cast<SlotValue>(*f.amount);
        out.last_needed = std::max(out.last_needed, needed);
        out.rumors.push_back(std::move(game));
    }
    if (!out.errors.empty()) out.rumors.clear();
    return out;
}

}  // namespace rumor
