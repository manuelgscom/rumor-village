#include "sim/scenario_file.h"

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <initializer_list>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "core/rng.h"
#include "core/sim_api.h"

namespace rumor {
namespace {

using nlohmann::json;

[[noreturn]] void fail(const std::string& message) { throw std::runtime_error(message); }

const json& field(const json& obj, const char* key, const std::string& where) {
    const auto it = obj.find(key);
    if (it == obj.end()) fail(where + ": missing key '" + key + "'");
    return *it;
}

void only_keys(const json& obj, std::initializer_list<std::string_view> keys,
               const std::string& where) {
    if (!obj.is_object()) fail(where + ": expected an object");
    for (auto it = obj.begin(); it != obj.end(); ++it) {
        if (std::find(keys.begin(), keys.end(), it.key()) == keys.end()) {
            fail(where + ": unknown key '" + it.key() + "'");
        }
    }
}

std::int64_t integer(const json& v, const std::string& what, std::int64_t lo, std::int64_t hi) {
    if (!v.is_number_integer()) fail(what + ": expected an integer");
    if (v.is_number_unsigned() &&
        v.get<std::uint64_t>() > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
        fail(what + ": out of range");
    }
    const auto x = v.get<std::int64_t>();
    if (x < lo || x > hi) {
        fail(what + ": must be between " + std::to_string(lo) + " and " + std::to_string(hi));
    }
    return x;
}

std::string text(const json& v, const std::string& what) {
    if (!v.is_string()) fail(what + ": expected a string");
    return v.get<std::string>();
}

// {"day": D, "time": "HH:MM"} -> tick.
Tick clock(const json& v, const std::string& what) {
    only_keys(v, {"day", "time"}, what);
    const auto day = integer(field(v, "day", what), what + ".day", 0, 30);
    const std::string time = text(field(v, "time", what), what + ".time");
    const auto digit = [&](std::size_t i) { return time[i] >= '0' && time[i] <= '9'; };
    if (time.size() != 5 || time[2] != ':' || !digit(0) || !digit(1) || !digit(3) || !digit(4)) {
        fail(what + ".time: expected \"HH:MM\", got \"" + time + "\"");
    }
    const int hour = (time[0] - '0') * 10 + (time[1] - '0');
    const int minute = (time[3] - '0') * 10 + (time[4] - '0');
    if (hour > 23 || minute > 59) fail(what + ".time: no such time \"" + time + "\"");
    return static_cast<Tick>(day) * kTicksPerDay + hour * kTicksPerHour + minute;
}

NeighborId neighbor(const json& v, const std::string& what, int count) {
    const std::string s = text(v, what);
    const auto id = NeighborId::parse(s);
    if (!id || id->v > static_cast<std::uint32_t>(count)) {
        fail(what + ": \"" + s + "\" is not a neighbor of the scenario (n001.." +
             NeighborId(static_cast<std::uint32_t>(count)).str() + ")");
    }
    return *id;
}

Injection injection(const json& v, const std::string& where, const ScenarioParams& p) {
    only_keys(v, {"at", "what", "text", "who", "where", "when", "amount", "to"}, where);
    Injection inj;
    inj.tick = clock(field(v, "at", where), where + ".at");
    if (inj.tick < p.start_tick || inj.tick >= p.end_tick) {
        fail(where + ".at: outside the run (from start to before end)");
    }
    inj.what = text(field(v, "what", where), where + ".what");
    if (inj.what.empty()) fail(where + ".what: empty");
    if (const json& t = field(v, "text", where); !t.is_null()) inj.text = text(t, where + ".text");

    if (const json& w = field(v, "who", where); !w.is_null()) {
        inj.slots[idx(Slot::who)] = static_cast<SlotValue>(neighbor(w, where + ".who", p.neighbors).v);
    }
    if (const json& w = field(v, "where", where); !w.is_null()) {
        const std::string key = text(w, where + ".where");
        const auto place = place_from_key(key);
        if (!place || !is_public(*place)) fail(where + ".where: \"" + key + "\" is not a public place");
        inj.slots[idx(Slot::where)] = static_cast<SlotValue>(place->v);
    }
    if (const json& w = field(v, "when", where); !w.is_null()) {
        const Tick t = clock(w, where + ".when");
        if (t % kTicksPerSlot != 0) fail(where + ".when: must be on the hour or the half hour");
        inj.slots[idx(Slot::when)] = slot_of(t);
    }
    if (const json& w = field(v, "amount", where); !w.is_null()) {
        inj.slots[idx(Slot::amount)] = static_cast<SlotValue>(
            integer(w, where + ".amount", 0, std::numeric_limits<SlotValue>::max()));
    }

    const json& to = field(v, "to", where);
    if (!to.is_array() || to.empty()) fail(where + ".to: expected a non-empty list of neighbors");
    for (const json& n : to) inj.to.push_back(neighbor(n, where + ".to", p.neighbors));
    std::sort(inj.to.begin(), inj.to.end());
    if (std::adjacent_find(inj.to.begin(), inj.to.end()) != inj.to.end()) {
        fail(where + ".to: a neighbor appears twice");
    }
    return inj;
}

}  // namespace

ScenarioParams parse_scenario(const json& doc, const std::string& name, Lang lang) {
    const std::string where = "scenario";
    only_keys(doc,
              {"name", "layout", "neighbors", "start", "end", "start_weekday", "forget_ppm",
               "doubt_drop_ppm", "max_turns", "meet_ppm", "pair_cooldown", "rest_ticks",
               "stay_ticks", "hop_gap", "hop_retries", "injections", "trait_mix"},
              where);
    const auto get = [&](const char* key) -> const json& { return field(doc, key, where); };
    const auto num = [&](const char* key, std::int64_t lo, std::int64_t hi) {
        return integer(get(key), key, lo, hi);
    };
    constexpr std::int64_t kMaxTicks = 100 * kTicksPerDay;

    ScenarioParams p;
    p.name = text(get("name"), "name");
    if (p.name != name) fail("name: \"" + p.name + "\" does not match the file name \"" + name + "\"");
    p.lang = lang;

    const std::string layout = text(get("layout"), "layout");
    const auto parsed_layout = from_key<Layout>(layout);
    if (!parsed_layout) fail("layout: unknown layout \"" + layout + "\" (village or line)");
    p.layout = *parsed_layout;

    p.neighbors = static_cast<int>(num("neighbors", 2, 999));
    p.start_tick = clock(get("start"), "start");
    p.end_tick = clock(get("end"), "end");
    if (p.end_tick <= p.start_tick) fail("end: must be after start");
    p.start_weekday = static_cast<int>(num("start_weekday", 0, 6));
    p.forget_ppm = static_cast<std::uint32_t>(num("forget_ppm", 0, kPpm));
    p.doubt_drop_ppm = static_cast<std::uint32_t>(num("doubt_drop_ppm", 0, kPpm));
    p.max_turns = static_cast<int>(num("max_turns", 1, 1000));
    p.meet_ppm = static_cast<std::uint32_t>(num("meet_ppm", 0, kPpm));
    p.pair_cooldown = static_cast<Tick>(num("pair_cooldown", 0, kMaxTicks));
    p.rest_ticks = static_cast<Tick>(num("rest_ticks", 0, kMaxTicks));
    p.stay_ticks = static_cast<Tick>(num("stay_ticks", 0, kMaxTicks));
    p.hop_gap = static_cast<Tick>(num("hop_gap", p.layout == Layout::line ? 1 : 0, kMaxTicks));
    p.hop_retries = static_cast<int>(num("hop_retries", 0, 1000));
    // Optional (phase 9, contract section 7): 0 when absent.
    if (doc.contains("trait_mix")) p.trait_mix = static_cast<int>(num("trait_mix", -2, 2));

    const json& injections = get("injections");
    if (!injections.is_array()) fail("injections: expected a list");
    for (std::size_t i = 0; i < injections.size(); ++i) {
        const std::string at = "injections[" + std::to_string(i) + "]";
        p.injections.push_back(injection(injections[i], at, p));
        if (i > 0 && p.injections[i].tick < p.injections[i - 1].tick) {
            fail(at + ".at: injections must be in time order");
        }
    }
    return p;
}

ScenarioParams load_scenario(const std::string& data_dir, const std::string& name, Lang lang) {
    const std::string path = data_dir + "/scenarios/" + name + ".json";
    std::ifstream in(path);
    if (!in) throw std::runtime_error("unknown scenario '" + name + "': cannot open " + path);
    json doc;
    try {
        doc = json::parse(in);
    } catch (const json::exception& e) {
        throw std::runtime_error(path + ": invalid JSON: " + e.what());
    }
    try {
        return parse_scenario(doc, name, lang);
    } catch (const std::runtime_error& e) {
        throw std::runtime_error(path + ": " + e.what());
    }
}

}  // namespace rumor
