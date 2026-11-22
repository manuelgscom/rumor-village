#pragma once
// The parsing of the rumors of /inject and of a game draft: places and
// neighbors by identifier, key or name, a fact and its "to". Pure: no HTTP,
// so the web build (phase 10) links it without httplib. Internal to src/server.

#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/ids.h"
#include "core/population_api.h"
#include "extract/extract.h"

namespace rumor::http {

using Json = nlohmann::json;

// Any place of the catalog: its name in the language of the run, its key or
// its identifier ("plaza", "square", "p01").
std::optional<PlaceId> find_place(const std::string& text, const Vocab& vocab);

// A neighbor of the run by identifier or name ("n001", "Rosa").
std::optional<NeighborId> find_neighbor(const std::string& text, const Population& population);

// The "fact" of /inject and of a rumor of a draft: an object with the slots
// of the extract task, missing ones null. When `error` is set, `field` says
// where ("fact", "who" or "where"), `code` is "invalid" or "unknown" and
// `error` is a message for a person. /inject takes names, as the extract task
// writes them; with `ids_and_keys` (a draft) "who" may also be an identifier,
// "where" an identifier or a key, and "when" may use the day words of either
// language ("hoy 21:00", "today 21:00").
struct ParsedFact {
    Extracted fact;
    std::string field;
    std::string code;
    std::optional<std::string> error;
};
ParsedFact parse_fact(const Json& given, const Vocab& vocab, const Population& population,
                      bool ids_and_keys = false);

// The "to" of /inject and of a rumor: {"place": ...} or {"neighbors": [...]},
// by identifier, key or name. On failure `code` and `error` as above.
struct ParsedTo {
    std::optional<PlaceId> place;
    std::vector<NeighborId> neighbors;  // without repetitions, in the given order
    std::string code;
    std::optional<std::string> error;
};
ParsedTo parse_to(const Json& to, const Vocab& vocab, const Population& population);

}  // namespace rumor::http
