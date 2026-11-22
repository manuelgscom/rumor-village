#include <doctest/doctest.h>

#include <fstream>
#include <functional>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/sim_api.h"
#include "sim/scenario_file.h"

using namespace rumor;
using nlohmann::json;

namespace {

json read_file(const std::string& name) {
    std::ifstream in(std::string(RUMOR_DATA_DIR) + "/scenarios/" + name + ".json");
    REQUIRE(in.good());
    return json::parse(in);
}

}  // namespace

TEST_SUITE("sim") {

TEST_CASE("the party scenarios load") {
    for (const auto& [name, count] : {std::pair<std::string, int>{"party-100", 100}, {"party-70", 70},
                                      {"party-50", 50}, {"party-25", 25}, {"party-10", 10}}) {
        const ScenarioParams p = load_scenario(RUMOR_DATA_DIR, name, Lang::en);
        CHECK(p.name == name);
        CHECK(p.lang == Lang::en);
        CHECK(p.neighbors == count);
        CHECK(p.layout == Layout::village);
        CHECK(p.start_tick == 420);
        CHECK(p.end_tick == 1440);
        CHECK(p.start_weekday == 1);
        CHECK(p.forget_ppm == 300);
        CHECK(p.doubt_drop_ppm == 2000);
        CHECK(p.max_turns == 8);
        CHECK(p.meet_ppm == 50000);
        CHECK(p.pair_cooldown == 120);
        CHECK(p.rest_ticks == 5);
        CHECK(p.stay_ticks == 90);
        REQUIRE(p.injections.size() == 1);
        const Injection& inj = p.injections[0];
        CHECK(inj.tick == 450);
        CHECK(inj.what == "party");
        CHECK_FALSE(inj.text.has_value());
        CHECK(inj.slots[idx(Slot::who)] == 6);
        CHECK(inj.slots[idx(Slot::where)] == 1);
        CHECK(inj.slots[idx(Slot::when)] == 42);
        CHECK(inj.slots[idx(Slot::amount)] == 50);
        CHECK(inj.to == std::vector<NeighborId>{NeighborId(1)});
    }
}

TEST_CASE("the telephone scenario loads") {
    const ScenarioParams p = load_scenario(RUMOR_DATA_DIR, "telephone-20", Lang::es);
    CHECK(p.layout == Layout::line);
    CHECK(p.neighbors == 20);
    CHECK(p.start_tick == 600);
    CHECK(p.hop_gap == 20);
    CHECK(p.hop_retries == 5);
    CHECK(p.forget_ppm == 5000);
    CHECK(p.doubt_drop_ppm == 20000);
    CHECK(p.max_turns == 8);
    REQUIRE(p.injections.size() == 1);
    CHECK(p.injections[0].tick == p.start_tick);
    CHECK(p.injections[0].to == std::vector<NeighborId>{NeighborId(1)});
    // Room for the 19 hops with all their retries.
    CHECK(p.end_tick - p.start_tick >= 19 * (p.hop_retries + 1) * (p.hop_gap + p.max_turns));
}

TEST_CASE("a missing or malformed scenario is rejected") {
    CHECK_THROWS_AS(load_scenario(RUMOR_DATA_DIR, "no-such-scenario", Lang::es), std::runtime_error);

    const json good = read_file("party-25");
    CHECK_NOTHROW(parse_scenario(good, "party-25", Lang::es));

    const std::vector<std::function<void(json&)>> breakages = {
        [](json& d) { d.erase("max_turns"); },
        [](json& d) { d["colour"] = 1; },
        [](json& d) { d["layout"] = "circle"; },
        [](json& d) { d["forget_ppm"] = 1000001; },
        [](json& d) { d["neighbors"] = "25"; },
        [](json& d) { d["meet_ppm"] = 0.5; },
        [](json& d) { d["end"] = d["start"]; },
        [](json& d) { d["start"]["time"] = "8:00"; },
        [](json& d) { d["start"]["time"] = "25:00"; },
        [](json& d) { d["name"] = "party-100"; },
        [](json& d) { d["injections"][0]["when"]["time"] = "21:10"; },
        [](json& d) { d["injections"][0]["where"] = "upper_quarter"; },
        [](json& d) { d["injections"][0]["where"] = "moon"; },
        [](json& d) { d["injections"][0]["who"] = "n026"; },
        [](json& d) { d["injections"][0]["who"] = "n6"; },
        [](json& d) { d["injections"][0]["amount"] = -1; },
        [](json& d) { d["injections"][0]["to"] = json::array(); },
        [](json& d) { d["injections"][0]["to"] = json::array({"n001", "n001"}); },
        [](json& d) { d["injections"][0]["at"] = {{"day", 1}, {"time", "09:00"}}; },
        [](json& d) { d["injections"][0].erase("text"); },
        [](json& d) { d["layout"] = "line"; d["hop_gap"] = 0; },
        [](json& d) { d["trait_mix"] = 3; },
        [](json& d) { d["trait_mix"] = -3; },
        [](json& d) { d["trait_mix"] = "2"; },
    };
    for (std::size_t i = 0; i < breakages.size(); ++i) {
        CAPTURE(i);
        json bad = good;
        breakages[i](bad);
        CHECK_THROWS_AS(parse_scenario(bad, "party-25", Lang::es), std::runtime_error);
    }
}

TEST_CASE("trait_mix is an optional key of the scenario, 0 when absent") {
    json doc = read_file("party-25");
    CHECK(parse_scenario(doc, "party-25", Lang::es).trait_mix == 0);
    for (int mix : {-2, -1, 0, 1, 2}) {
        doc["trait_mix"] = mix;
        CHECK(parse_scenario(doc, "party-25", Lang::es).trait_mix == mix);
    }
}

}  // TEST_SUITE
