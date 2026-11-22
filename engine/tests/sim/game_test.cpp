#include <doctest/doctest.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/game_api.h"
#include "core/log_api.h"
#include "core/policy.h"
#include "core/sim_api.h"

using namespace rumor;
using nlohmann::json;

namespace {

const std::string kData = RUMOR_DATA_DIR;

json read_json(const std::string& path) {
    std::ifstream in(path);
    REQUIRE(in.good());
    return json::parse(in);
}

// Gives the scripted injections at their tick and nothing else.
class InjectingControl : public RunControl {
  public:
    TickOrders before_tick(Tick t) override {
        TickOrders orders;
        const auto it = script.find(t);
        if (it != script.end()) orders.injections = it->second;
        return orders;
    }
    void after_tick(Tick, bool quiet) override { quiet_ticks += quiet ? 1 : 0; }

    std::map<Tick, std::vector<LiveInjection>> script;
    int quiet_ticks = 0;
};

// The log of a whole run with the baseline, as the bytes of its JSONL.
std::string run_bytes(const ScenarioParams& params, const Population& population, std::uint64_t seed,
                      RunControl* control = nullptr) {
    const World world = load_world(kData);
    const Vocab vocab = load_vocab(kData, params.lang);
    const std::unique_ptr<Policy> policy = make_baseline_policy();
    std::string out;
    RunSink sink;
    sink.header = [&](const LogHeader& h) { out += write_header(h) + '\n'; };
    sink.event = [&](const Event& e) { out += write_event(e) + '\n'; };
    run_simulation(params, world, population, vocab, *policy, seed, sink, control);
    return out;
}

std::uint32_t scaled(std::uint32_t ppm, const json& level, const char* member) {
    const std::uint64_t value = std::uint64_t{ppm} * level.at(member).get<std::uint64_t>() / 1000;
    return static_cast<std::uint32_t>(std::min<std::uint64_t>(value, 1'000'000));
}

}  // namespace

TEST_SUITE("sim") {

TEST_CASE("game settings: defaults, round trip and the telephone") {
    const GameSettings defaults = game_settings_from_json(json::object());
    CHECK(defaults == GameSettings{});
    CHECK(defaults.type == GameType::village);
    CHECK(defaults.neighbors == 25);
    CHECK(defaults.town == 1);
    CHECK(defaults.lang == Lang::es);
    CHECK(defaults.trait_mix == 0);
    CHECK(defaults.distortion == Distortion::normal);
    CHECK_FALSE(defaults.ai);
    CHECK_FALSE(defaults.until.has_value());

    const json full = json::parse(R"({"type": "village", "neighbors": 100, "town": 417, "lang": "en",
        "trait_mix": -2, "distortion": "high", "mode": "ai", "until": "14:30"})");
    const GameSettings s = game_settings_from_json(full);
    CHECK(s.neighbors == 100);
    CHECK(s.town == 417);
    CHECK(s.lang == Lang::en);
    CHECK(s.trait_mix == -2);
    CHECK(s.distortion == Distortion::high);
    CHECK(s.ai);
    CHECK(s.until == 14 * 60 + 30);
    CHECK(game_settings_to_json(s) == full);
    CHECK(game_settings_from_json(game_settings_to_json(s)) == s);
    CHECK(game_settings_from_json(game_settings_to_json(defaults)) == defaults);
    CHECK(game_settings_to_json(defaults)["until"].is_null());
    CHECK(game_settings_to_json(defaults)["mode"] == "rules");
    CHECK(game_settings_from_json(json{{"mode", "rules"}, {"until", nullptr}}) == defaults);
    CHECK(game_settings_from_json(json{{"until", "00:05"}}).until == 5);

    // The telephone game is always twenty, whatever "neighbors" says.
    const GameSettings tel = game_settings_from_json(json{{"type", "telephone"}, {"neighbors", 100}});
    CHECK(tel.type == GameType::telephone);
    CHECK(tel.neighbors == 20);
    CHECK(game_settings_from_json(game_settings_to_json(tel)) == tel);
    CHECK(game_settings_from_json(json{{"type", "telephone"}, {"neighbors", 7}}) == tel);
}

TEST_CASE("game settings: a wrong key is named") {
    const std::vector<std::pair<json, std::string>> cases = {
        {json{{"colour", 1}}, "colour"},
        {json{{"type", "city"}}, "type"},
        {json{{"type", 1}}, "type"},
        {json{{"neighbors", 30}}, "neighbors"},
        {json{{"neighbors", 7}}, "neighbors"},
        {json{{"neighbors", 20}}, "neighbors"},
        {json{{"neighbors", 25.5}}, "neighbors"},
        {json{{"neighbors", "25"}}, "neighbors"},
        {json{{"town", -1}}, "town"},
        {json{{"town", 1.5}}, "town"},
        {json{{"lang", "fr"}}, "lang"},
        {json{{"trait_mix", 3}}, "trait_mix"},
        {json{{"trait_mix", -3}}, "trait_mix"},
        {json{{"trait_mix", 18446744073709551614ull}}, "trait_mix"},
        {json{{"distortion", "extreme"}}, "distortion"},
        {json{{"mode", "model"}}, "mode"},
        {json{{"until", "25:00"}}, "until"},
        {json{{"until", "9:00"}}, "until"},
        {json{{"until", 600}}, "until"},
    };
    for (const auto& [doc, key] : cases) {
        CAPTURE(doc.dump());
        CHECK_THROWS_WITH_AS(game_settings_from_json(doc), doctest::Contains(key.c_str()),
                             std::invalid_argument);
    }
    CHECK_THROWS_AS(game_settings_from_json(json::array()), std::invalid_argument);
}

TEST_CASE("game settings: the village, its scenario and its name") {
    GameSettings a;
    CHECK(game_scenario_name(a) == "party-25");
    GameSettings b = a;
    b.distortion = Distortion::low;
    b.ai = true;
    b.until = 600;
    CHECK(same_village(a, b));
    for (const auto& change : std::vector<std::function<void(GameSettings&)>>{
             [](GameSettings& s) { s.neighbors = 100; },
             [](GameSettings& s) { s.town = 2; },
             [](GameSettings& s) { s.lang = Lang::en; },
             [](GameSettings& s) { s.trait_mix = 1; },
             [](GameSettings& s) { s.type = GameType::telephone; s.neighbors = 20; },
         }) {
        GameSettings c = a;
        change(c);
        CHECK_FALSE(same_village(a, c));
    }
    b.neighbors = 100;
    CHECK(game_scenario_name(b) == "party-100");
    const GameSettings tel = game_settings_from_json(json{{"type", "telephone"}});
    CHECK(game_scenario_name(tel) == "telephone-20");
}

TEST_CASE("game settings: every village size has its scenario") {
    CHECK(kVillageSizes == std::array<int, 5>{10, 25, 50, 70, 100});
    for (const int size : kVillageSizes) {
        CAPTURE(size);
        const GameSettings s = game_settings_from_json(json{{"neighbors", size}});
        CHECK(s.neighbors == size);
        CHECK(game_scenario_name(s) == "party-" + std::to_string(size));
        CHECK(game_settings_from_json(game_settings_to_json(s)) == s);
        const GameWorld w = make_game_world(s, kData);
        CHECK(w.scenario.name == game_scenario_name(s));
        CHECK(w.scenario.neighbors == size);
        CHECK(w.population.neighbors.size() == static_cast<std::size_t>(size));
        CHECK(w.scenario.injections.empty());
    }
    try {
        (void)game_settings_from_json(json{{"neighbors", 30}});
        FAIL("30 neighbors was accepted");
    } catch (const std::invalid_argument& e) {
        CHECK(std::string(e.what()).find("10, 25, 50, 70 or 100") != std::string::npos);
    }
}

TEST_CASE("make_game_world: the default game is party-25 without its rumor") {
    const GameWorld w = make_game_world(GameSettings{}, kData);
    ScenarioParams expected = load_scenario(kData, "party-25", Lang::es);
    expected.injections.clear();
    CHECK(w.scenario.name == expected.name);
    CHECK(w.scenario.lang == expected.lang);
    CHECK(w.scenario.neighbors == expected.neighbors);
    CHECK(w.scenario.start_tick == expected.start_tick);
    CHECK(w.scenario.end_tick == expected.end_tick);
    CHECK(w.scenario.forget_ppm == expected.forget_ppm);
    CHECK(w.scenario.doubt_drop_ppm == expected.doubt_drop_ppm);
    CHECK(w.scenario.meet_ppm == expected.meet_ppm);
    CHECK(w.scenario.trait_mix == 0);
    CHECK(w.scenario.injections.empty());
    CHECK(w.seed == 1);
    CHECK(w.population == make_population(kData, 25, Layout::village, 1));

    // Another town, language and character.
    GameSettings s;
    s.type = GameType::telephone;
    s.neighbors = 20;
    s.town = 5;
    s.lang = Lang::en;
    s.trait_mix = 2;
    const GameWorld tel = make_game_world(s, kData);
    CHECK(tel.scenario.name == "telephone-20");
    CHECK(tel.scenario.lang == Lang::en);
    CHECK(tel.scenario.layout == Layout::line);
    CHECK(tel.scenario.injections.empty());
    CHECK(tel.scenario.trait_mix == 2);
    CHECK(tel.seed == 5);
    CHECK(tel.population == make_population(kData, 20, Layout::line, 5, 2));
}

TEST_CASE("make_game_world: the distortion dial scales forgetting and doubt") {
    const json levels = read_json(kData + "/game/settings.json").at("distortion");
    const ScenarioParams base = load_scenario(kData, "party-100", Lang::es);
    GameSettings s;
    s.neighbors = 100;
    for (Distortion d : {Distortion::low, Distortion::normal, Distortion::high}) {
        s.distortion = d;
        const GameWorld w = make_game_world(s, kData);
        if (d == Distortion::normal) {
            CHECK(w.scenario.forget_ppm == base.forget_ppm);
            CHECK(w.scenario.doubt_drop_ppm == base.doubt_drop_ppm);
            continue;
        }
        const json& level = levels.at(std::string(key(d)));
        CHECK(w.scenario.forget_ppm == scaled(base.forget_ppm, level, "forget_permille"));
        CHECK(w.scenario.doubt_drop_ppm == scaled(base.doubt_drop_ppm, level, "doubt_drop_permille"));
    }
    s.distortion = Distortion::low;
    CHECK(make_game_world(s, kData).scenario.forget_ppm < base.forget_ppm);
    s.distortion = Distortion::high;
    CHECK(make_game_world(s, kData).scenario.forget_ppm > base.forget_ppm);

    // A data folder of its own: the cap at 1'000'000, and a missing level.
    namespace fs = std::filesystem;
    const fs::path dir = fs::temp_directory_path() / "rumor-game-test";
    fs::remove_all(dir);
    for (const char* sub : {"people", "scenarios", "game"}) fs::create_directories(dir / sub);
    fs::copy_file(kData + "/people/people.json", dir / "people" / "people.json");
    fs::copy_file(kData + "/scenarios/party-25.json", dir / "scenarios" / "party-25.json");
    s = GameSettings{};
    // Normal needs no game data.
    CHECK(make_game_world(s, dir.string()).scenario.forget_ppm == 300);
    json data = read_json(kData + "/game/settings.json");
    data["distortion"]["high"]["doubt_drop_permille"] = 1'000'000;
    std::ofstream(dir / "game" / "settings.json") << data.dump();
    s.distortion = Distortion::high;
    CHECK(make_game_world(s, dir.string()).scenario.doubt_drop_ppm == 1'000'000);
    data["distortion"].erase("low");
    std::ofstream(dir / "game" / "settings.json") << data.dump();
    s.distortion = Distortion::low;
    CHECK_THROWS_AS(make_game_world(s, dir.string()), std::runtime_error);
    s.neighbors = 100;  // no party-100 in that folder
    s.distortion = Distortion::normal;
    CHECK_THROWS_AS(make_game_world(s, dir.string()), std::runtime_error);
    fs::remove_all(dir);
}

TEST_CASE("fit_end: tomorrow extends, until cuts, never before start + 1") {
    ScenarioParams p;
    p.start_tick = 420;
    p.end_tick = 1440;
    fit_end(p, 600, std::nullopt);  // a rumor of today changes nothing
    CHECK(p.end_tick == 1440);
    fit_end(p, 1440 + 9 * 60, std::nullopt);  // tomorrow 09:00, plus the margin
    CHECK(p.end_tick == 1440 + 9 * 60 + 120);
    const Tick late = p.end_tick;
    fit_end(p, 0, 14 * 60);  // a challenge until 14:00
    CHECK(p.end_tick == 14 * 60);
    p.end_tick = late;
    fit_end(p, 1440 + 9 * 60, 22 * 60);  // until wins over tomorrow
    CHECK(p.end_tick == 22 * 60);
    fit_end(p, 0, 60);  // until before the start
    CHECK(p.end_tick == 421);
    p.end_tick = 1440;
    fit_end(p, 1440 - 180, std::nullopt);  // the margin is still inside the run
    CHECK(p.end_tick == 1440);
    fit_end(p, 1440 - 60, std::nullopt);  // the margin passes midnight
    CHECK(p.end_tick == 1440 + 60);
    p.end_tick = 1440;
    fit_end(p, 1440 - 180, 1440 + 600);  // until after the end does not extend it
    CHECK(p.end_tick == 1440);
}

TEST_CASE("the default game with the scenario's rumor live is the scenario itself") {
    struct Case {
        GameSettings settings;
        std::uint64_t seed;
    };
    GameSettings party;
    GameSettings tel = game_settings_from_json(json{{"type", "telephone"}, {"lang", "en"}, {"town", 5}});
    for (const Case& c : {Case{party, 1}, Case{tel, 5}}) {
        const std::string name = game_scenario_name(c.settings);
        CAPTURE(name);
        const ScenarioParams scenario = load_scenario(kData, name, c.settings.lang);
        REQUIRE(scenario.injections.size() == 1);
        const Population population =
            make_population(kData, scenario.neighbors, scenario.layout, c.seed);
        const std::string expected = run_bytes(scenario, population, c.seed);

        const GameWorld w = make_game_world(c.settings, kData);
        InjectingControl control;
        const Injection& rumor = scenario.injections[0];
        control.script[rumor.tick] = {LiveInjection{rumor, std::nullopt}};
        const std::string game = run_bytes(w.scenario, w.population, w.seed, &control);
        // Same header (scenario name and params included) and same events.
        CHECK(game == expected);
        CHECK(control.quiet_ticks > 0);
    }
}

}  // TEST_SUITE
