// The settings of a game and the world they build (core/game_api.h, docs/
// arquitectura.md "Modo juego"). A game is an ordinary run: the settings only
// pick the scenario, the seed, the trait mix and the forgetting.
//
// data/game/settings.json, the levels of the game as data:
//   "trait_mix":  the two sides of the trait draw and the weight of each side
//                 per level (read by make_population, src/people);
//   "distortion": per level, "forget_permille" and "doubt_drop_permille", the
//                 multipliers of forget_ppm and doubt_drop_ppm in parts per
//                 thousand. "normal" is never read: it keeps the scenario.
// The file is only read when a setting needs it (trait_mix != 0 or a
// distortion other than normal), so the default game works without it.

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <stdexcept>
#include <string>

#include <nlohmann/json.hpp>

#include "core/game_api.h"
#include "core/rng.h"
#include "core/sim_api.h"

namespace rumor {
namespace {

using nlohmann::json;

// Ticks a game lasts past the latest tick a rumor needs (fit_end): two hours,
// time to go to a party announced for "tomorrow 09:00" and talk there.
constexpr Tick kEndMarginTicks = 2 * kTicksPerHour;

[[noreturn]] void bad(const std::string& key, const std::string& message) {
    throw std::invalid_argument(key + ": " + message);
}

std::string string_value(const json& v, const std::string& key) {
    if (!v.is_string()) bad(key, "expected a string");
    return v.get<std::string>();
}

template <class E>
E enum_value(const json& v, const std::string& key) {
    const std::string text = string_value(v, key);
    const auto value = from_key<E>(text);
    if (!value) bad(key, "unknown value \"" + text + "\"");
    return *value;
}

// "HH:MM" of day 0 -> tick.
Tick clock_value(const json& v, const std::string& key) {
    const std::string time = string_value(v, key);
    const auto digit = [&](std::size_t i) { return time[i] >= '0' && time[i] <= '9'; };
    if (time.size() != 5 || time[2] != ':' || !digit(0) || !digit(1) || !digit(3) || !digit(4)) {
        bad(key, "expected \"HH:MM\", got \"" + time + "\"");
    }
    const int hour = (time[0] - '0') * 10 + (time[1] - '0');
    const int minute = (time[3] - '0') * 10 + (time[4] - '0');
    if (hour > 23 || minute > 59) bad(key, "no such time \"" + time + "\"");
    return hour * kTicksPerHour + minute;
}

std::string clock_text(Tick t) {
    const int hour = t / kTicksPerHour;
    const int minute = t % kTicksPerHour;
    std::string out;
    out += static_cast<char>('0' + hour / 10);
    out += static_cast<char>('0' + hour % 10);
    out += ':';
    out += static_cast<char>('0' + minute / 10);
    out += static_cast<char>('0' + minute % 10);
    return out;
}

json read_game_data(const std::string& data_dir) {
    const std::string path = data_dir + "/game/settings.json";
    std::ifstream in(path);
    if (!in) throw std::runtime_error("cannot open " + path);
    try {
        return json::parse(in);
    } catch (const json::exception& e) {
        throw std::runtime_error(path + ": " + e.what());
    }
}

// The multiplier (per mille) of one member of a distortion level.
std::uint32_t permille(const json& level, const char* member, const std::string& where) {
    const auto it = level.find(member);
    if (it == level.end() || !it->is_number_unsigned() || it->get<std::uint64_t>() > 1'000'000) {
        throw std::runtime_error(where + "." + member + " must be an integer from 0 to 1000000");
    }
    return it->get<std::uint32_t>();
}

// Whether v is an integer from lo to hi (any JSON integer, also a huge one).
// hi >= 0.
bool int_in(const json& v, std::int64_t lo, std::int64_t hi) {
    if (!v.is_number_integer()) return false;
    if (v.is_number_unsigned()) {
        const auto u = v.get<std::uint64_t>();
        return u <= static_cast<std::uint64_t>(hi) && static_cast<std::int64_t>(u) >= lo;
    }
    const auto x = v.get<std::int64_t>();
    return x >= lo && x <= hi;
}

std::uint32_t scaled(std::uint32_t ppm, std::uint32_t per_mille) {
    const std::uint64_t value = static_cast<std::uint64_t>(ppm) * per_mille / 1000;
    return static_cast<std::uint32_t>(std::min<std::uint64_t>(value, kPpm));
}

}  // namespace

GameSettings game_settings_from_json(const json& settings) {
    if (!settings.is_object()) bad("settings", "expected an object");
    GameSettings s;
    for (const auto& [k, v] : settings.items()) {
        if (k == "type") {
            s.type = enum_value<GameType>(v, k);
        } else if (k == "neighbors") {
            // Checked below, once the type is known.
        } else if (k == "town") {
            if (!v.is_number_integer() || (!v.is_number_unsigned() && v.get<std::int64_t>() < 0)) {
                bad(k, "must be an integer >= 0");
            }
            s.town = v.get<std::uint64_t>();
        } else if (k == "lang") {
            s.lang = enum_value<Lang>(v, k);
        } else if (k == "trait_mix") {
            if (!int_in(v, kTraitMixMin, kTraitMixMax)) bad(k, "must be an integer from -2 to 2");
            s.trait_mix = v.get<int>();
        } else if (k == "distortion") {
            s.distortion = enum_value<Distortion>(v, k);
        } else if (k == "mode") {
            const std::string mode = string_value(v, k);
            if (mode != "ai" && mode != "rules") bad(k, "must be \"ai\" or \"rules\"");
            s.ai = mode == "ai";
        } else if (k == "until") {
            if (v.is_null()) s.until.reset();
            else s.until = clock_value(v, k);
        } else {
            bad(k, "unknown key");
        }
    }
    // The telephone game always has twenty in a row, whatever "neighbors" says.
    if (s.type == GameType::telephone) {
        s.neighbors = 20;
    } else if (const auto it = settings.find("neighbors"); it != settings.end()) {
        const bool known = std::any_of(kVillageSizes.begin(), kVillageSizes.end(),
                                       [&](int size) { return int_in(*it, size, size); });
        if (!known) {
            std::string sizes;
            for (const int size : kVillageSizes) {
                if (!sizes.empty()) sizes += size == kVillageSizes.back() ? " or " : ", ";
                sizes += std::to_string(size);
            }
            bad("neighbors", "must be " + sizes);
        }
        s.neighbors = it->get<int>();
    }
    return s;
}

json game_settings_to_json(const GameSettings& s) {
    json out = json::object();
    out["type"] = std::string(key(s.type));
    out["neighbors"] = s.neighbors;
    out["town"] = s.town;
    out["lang"] = std::string(key(s.lang));
    out["trait_mix"] = s.trait_mix;
    out["distortion"] = std::string(key(s.distortion));
    out["mode"] = s.ai ? "ai" : "rules";
    out["until"] = s.until ? json(clock_text(*s.until)) : json(nullptr);
    return out;
}

bool same_village(const GameSettings& a, const GameSettings& b) {
    return a.type == b.type && a.neighbors == b.neighbors && a.town == b.town && a.lang == b.lang &&
           a.trait_mix == b.trait_mix;
}

std::string game_scenario_name(const GameSettings& settings) {
    if (settings.type == GameType::telephone) return "telephone-20";
    return "party-" + std::to_string(settings.neighbors);
}

GameWorld make_game_world(const GameSettings& settings, const std::string& data_dir) {
    GameWorld w;
    w.scenario = load_scenario(data_dir, game_scenario_name(settings), settings.lang);
    w.scenario.injections.clear();
    w.scenario.trait_mix = settings.trait_mix;
    if (settings.distortion != Distortion::normal) {
        const json doc = read_game_data(data_dir);
        const std::string level_key(key(settings.distortion));
        const std::string where = data_dir + "/game/settings.json: distortion." + level_key;
        const auto table = doc.find("distortion");
        if (table == doc.end() || !table->is_object() || !table->contains(level_key) ||
            !(*table)[level_key].is_object()) {
            throw std::runtime_error(where + ": missing");
        }
        const json& level = (*table)[level_key];
        w.scenario.forget_ppm = scaled(w.scenario.forget_ppm, permille(level, "forget_permille", where));
        w.scenario.doubt_drop_ppm =
            scaled(w.scenario.doubt_drop_ppm, permille(level, "doubt_drop_permille", where));
    }
    w.seed = settings.town;
    w.population = make_population(data_dir, w.scenario.neighbors, w.scenario.layout, w.seed,
                                   settings.trait_mix);
    return w;
}

void fit_end(ScenarioParams& scenario, Tick last_needed, std::optional<Tick> until) {
    scenario.end_tick = std::max(scenario.end_tick, last_needed + kEndMarginTicks);
    if (until) scenario.end_tick = std::min(scenario.end_tick, *until);
    scenario.end_tick = std::max(scenario.end_tick, scenario.start_tick + 1);
}

}  // namespace rumor
