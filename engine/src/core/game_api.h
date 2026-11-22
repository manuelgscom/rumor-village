#pragma once
// The game (phase 9, docs/juego.md): `rumor play` waits with a still village,
// the player prepares settings and rumors, and a game is an ordinary run built
// from them. Nothing here changes what a neighbor decides: the settings only
// choose the scenario, the seed, the trait mix, the forgetting and the policy,
// and the rumors enter as live injections at their tick.
//
//  draft (JSON) ──► GameSettings ──► make_game_world ──► GameWorld ──► run_simulation
//                   (src/sim)        (src/sim, src/people)   │            ▲
//                   rumors ──► GameRumor (src/server) ───────┴─ fit_end ──┘ (as LiveInjection)
//
// The formats of the draft, the game data and the profile are in
// docs/arquitectura.md, section "Modo juego".

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json_fwd.hpp>

#include "core/catalog.h"
#include "core/decision.h"
#include "core/enum_keys.h"
#include "core/ids.h"
#include "core/live_api.h"
#include "core/population_api.h"
#include "core/scenario.h"
#include "core/time.h"

namespace rumor {

// --- Settings (package B, src/sim) -------------------------------------------

enum class GameType : std::uint8_t {
    village,    // party-N (N in kVillageSizes): neighbors meet where they coincide
    telephone,  // telephone-20: twenty in a row, one rumor, to the first one
};
RUMOR_ENUM_KEYS(GameType, "village", "telephone");

// The distortion dial: multipliers of forget_ppm and doubt_drop_ppm read from
// data/game/settings.json. Normal keeps the values of the scenario.
enum class Distortion : std::uint8_t { low, normal, high };
RUMOR_ENUM_KEYS(Distortion, "low", "normal", "high");

// The character of the village (contract, section 7): -2 very discreet .. +2
// very gossipy. 0 is the draw of every scenario before phase 9.
inline constexpr int kTraitMixMin = -2;
inline constexpr int kTraitMixMax = 2;

// The sizes of a village game (phase 9-6). Each one has its scenario
// data/scenarios/party-N.json; 25 is the default.
inline constexpr std::array<int, 5> kVillageSizes = {10, 25, 50, 70, 100};

struct GameSettings {
    GameType type = GameType::village;
    int neighbors = 25;             // one of kVillageSizes in the village; always 20 in telephone
    std::uint64_t town = 1;         // "Pueblo n.º": the seed of the run
    Lang lang = Lang::es;
    int trait_mix = 0;              // kTraitMixMin..kTraitMixMax
    Distortion distortion = Distortion::normal;
    bool ai = false;                // "Con IA": the model decides (JSON "mode": "ai" | "rules")
    std::optional<Tick> until;      // only from a challenge: the game ends at this tick at the latest

    friend bool operator==(const GameSettings&, const GameSettings&) = default;
};

// Reads the "settings" object of a draft. Missing keys take the defaults
// above; `until` is "HH:MM" of day 0 (tick = HH*60+MM). Throws
// std::invalid_argument naming the first wrong key.
GameSettings game_settings_from_json(const nlohmann::json& settings);
nlohmann::json game_settings_to_json(const GameSettings& settings);

// Whether two settings give the same village (header): type, neighbors, town,
// lang and trait_mix. The viewer reloads when this changes.
bool same_village(const GameSettings& a, const GameSettings& b);

// The scenario a game starts from: "party-N" (N in kVillageSizes) or "telephone-20".
std::string game_scenario_name(const GameSettings& settings);

struct GameWorld {
    ScenarioParams scenario;  // the game scenario without its built-in injections
    Population population;
    std::uint64_t seed = 0;
};

// Loads the scenario of the settings from data_dir, drops its injections,
// applies trait_mix (to the population and to scenario.trait_mix) and the
// distortion dial, and builds the population. Throws std::runtime_error.
GameWorld make_game_world(const GameSettings& settings, const std::string& data_dir);

// Moves the end of a game scenario: later when a rumor needs it (a rumor for
// "tomorrow" lasts until after its hour: `last_needed` is the latest tick a
// rumor enters or happens), earlier with `until`. Never before start_tick + 1.
void fit_end(ScenarioParams& scenario, Tick last_needed, std::optional<Tick> until);

// --- Rumors of a game (package A, src/server) ---------------------------------

// One rumor of the player, validated: what enters, to whom, and at which tick.
// It is handed to the run as a LiveInjection at `at`, with the same code as
// POST /inject (a rumor by place goes to whoever is there then).
struct GameRumor {
    Tick at = 0;
    LiveInjection injection;
};

// --- Baseline explanation (package A, src/policy) ------------------------------

// One draw of the baseline dice, as it happened.
struct RuleRoll {
    std::string name;             // "tell", "guess_forgotten", "go", "pick_fact"
    std::uint32_t chance_ppm = 0; // the chance it had (for pick: 1e6 / candidates)
    std::uint32_t roll_ppm = 0;   // what came out, in the same scale
    bool hit = false;
};

// Why the baseline decided what it decided ("¿Qué pensó?" without the model).
struct RuleExplanation {
    std::string rule;  // "greet_first", "answer_question", "tell_chance", "greet_back", "bye", "plan_go", "plan_no_time"
    std::vector<RuleRoll> rolls;
};

// Replays the dice of the baseline for `request` with its own seed: the same
// draws, so the explanation always matches the decision and never changes it.
RuleExplanation explain_baseline(const DecisionRequest& request);

// --- Command -------------------------------------------------------------------

// `rumor play` (src/cli/play*.cpp). Returns the exit code.
int play_command(int argc, char** argv);

}  // namespace rumor
