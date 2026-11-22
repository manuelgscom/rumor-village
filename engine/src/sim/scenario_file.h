#pragma once
// Scenario files (data/scenarios/<name>.json) as JSON. load_scenario (core/
// sim_api.h) reads the file and hands the document to parse_scenario.

#include <string>

#include <nlohmann/json.hpp>

#include "core/catalog.h"
#include "core/scenario.h"

namespace rumor {

// Builds and checks the parameters of a scenario. `name` is the file name
// without extension and must match the "name" key. Throws std::runtime_error
// with a message that names the offending key.
ScenarioParams parse_scenario(const nlohmann::json& doc, const std::string& name, Lang lang);

}  // namespace rumor
