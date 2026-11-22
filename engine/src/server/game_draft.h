#pragma once
// The draft of a game (docs/arquitectura.md, "Modo juego" > "Formatos" >
// "Borrador"): what POST /preview and POST /start receive, read into settings
// and validated rumors.
//
//  {"settings": {...}, "rumors": [{"fact", "text", "to", "at"}, ...],
//   "challenge": null | "<id>", "bets": null | {...}, "race": null | {...}}
//
// A rumor is the body of POST /inject plus `at` ("start" or "HH:MM" of day 0).
// Its `when` is read against day 0. In the telephone game there is exactly
// one rumor and it goes to the first of the row at the start.

#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/game_api.h"
#include "core/population_api.h"
#include "core/time.h"

namespace rumor {

// One thing wrong in a draft: {"rumor": i | null, "field", "error"}.
struct DraftError {
    std::optional<int> rumor;  // index in "rumors"; none for the draft itself
    std::string field;         // "settings", "mode", "rumors", "fact", "who", "where", "when", "to", "at", "text"
    std::string error;         // "invalid", "unknown", "empty", "too_many", "out_of_range", "no_model" or a message
};

// {"errors": [...]}, the body of a 400 of POST /start.
nlohmann::json draft_errors_json(const std::vector<DraftError>& errors);

// The settings of a draft. A missing "mode" is "ai" when `ai_default`
// (a model is loaded), "rules" otherwise. Throws std::invalid_argument naming
// the wrong key.
GameSettings draft_settings(const nlohmann::json& draft, bool ai_default);

// The draft as GET /state gives it back: the settings complete, the other
// keys as they came (null when missing). Throws std::invalid_argument when
// the draft is not an object, "rumors" not an array or the settings wrong.
nlohmann::json normalized_draft(const nlohmann::json& draft, bool ai_default);

// The draft of a fresh start: default settings, no rumors.
nlohmann::json default_draft(bool ai_default);

struct DraftRumors {
    std::vector<GameRumor> rumors;
    Tick last_needed = 0;  // the latest tick a rumor enters or happens (for fit_end)
    std::vector<DraftError> errors;
};

// The rumors of a draft for the world of its settings, with `vocab` of the
// settings' language. `scenario` is that of the world before fit_end: a rumor
// enters in [start_tick, end_tick) and before `settings.until`.
DraftRumors draft_rumors(const nlohmann::json& draft, const GameSettings& settings,
                         const ScenarioParams& scenario, const Population& population,
                         const Vocab& vocab);

}  // namespace rumor
