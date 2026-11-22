// The parsing of a fact and of a "to" (draft_parse.h).

#include "server/draft_parse.h"

#include <algorithm>
#include <array>
#include <string_view>

#include "core/catalog.h"
#include "core/time.h"

namespace rumor::http {
namespace {

constexpr std::array<const char*, 5> kFactKeys = {"what", "who", "where", "when", "amount"};

// Trimmed and in ASCII lower case, as the extract task compares names.
std::string folded(std::string_view text) {
    const auto space = [](char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; };
    while (!text.empty() && space(text.front())) text.remove_prefix(1);
    while (!text.empty() && space(text.back())) text.remove_suffix(1);
    std::string out(text);
    for (char& c : out) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return out;
}

}  // namespace

std::optional<PlaceId> find_place(const std::string& text, const Vocab& vocab) {
    if (const auto id = PlaceId::parse(text); id && is_place(*id)) return id;
    if (const auto key = place_from_key(text)) return key;
    const std::string wanted = folded(text);
    for (std::size_t i = 0; i < kPlaceCount; ++i) {
        if (folded(vocab.places[i]) == wanted) return PlaceId::from_index(i);
    }
    return std::nullopt;
}

std::optional<NeighborId> find_neighbor(const std::string& text, const Population& population) {
    if (const auto id = NeighborId::parse(text)) {
        if (id->index() < population.neighbors.size()) return id;
        return std::nullopt;
    }
    const std::string wanted = folded(text);
    for (const Neighbor& n : population.neighbors) {
        if (folded(n.name) == wanted) return n.id;
    }
    return std::nullopt;
}

ParsedFact parse_fact(const Json& given, const Vocab& vocab, const Population& population,
                      bool ids_and_keys) {
    ParsedFact out;
    const auto fail = [&out](std::string field, std::string code, std::string message) {
        out.field = std::move(field);
        out.code = std::move(code);
        out.error = std::move(message);
        return out;
    };
    if (!given.is_object()) return fail("fact", "invalid", "fact is an object");
    Json full = Json::object();
    for (const char* key : kFactKeys) full[key] = nullptr;
    for (const auto& [key, value] : given.items()) {
        if (!full.contains(key)) return fail("fact", "invalid", "unknown slot '" + key + "' in fact");
        full[key] = value;
    }
    if (ids_and_keys) {
        // To the names validate_extracted reads.
        if (full["who"].is_string()) {
            const auto id = NeighborId::parse(full["who"].get<std::string>());
            if (id && id->index() < population.neighbors.size()) full["who"] = population.at(*id).name;
        }
        if (full["where"].is_string()) {
            const auto place = find_place(full["where"].get<std::string>(), vocab);
            if (place && is_public(*place)) full["where"] = vocab.place(*place);
        }
        if (full["when"].is_string()) {
            const std::string when = full["when"].get<std::string>();
            const std::size_t space = when.rfind(' ');
            if (space != std::string::npos) {
                const std::string day = folded(when.substr(0, space));
                if (day == "hoy" || day == "today") full["when"] = vocab.today + when.substr(space);
                else if (day == "mañana" || day == "tomorrow") full["when"] = vocab.tomorrow + when.substr(space);
            }
        }
    }
    out.fact = validate_extracted(full.dump(), vocab, population);
    if (!out.fact.ok) return fail("fact", "invalid", "the fact is not valid");
    if (out.fact.unknown_who) return fail("who", "unknown", "unknown neighbor: " + *out.fact.unknown_who);
    if (out.fact.unknown_where) {
        return fail("where", "unknown", "unknown place: " + *out.fact.unknown_where);
    }
    return out;
}

ParsedTo parse_to(const Json& to, const Vocab& vocab, const Population& population) {
    ParsedTo out;
    const auto fail = [&out](std::string code, std::string message) {
        out.code = std::move(code);
        out.error = std::move(message);
        return out;
    };
    const char* shape = "to is {\"place\":...} or {\"neighbors\":[...]}";
    if (!to.is_object() || to.size() != 1) return fail("invalid", shape);
    if (to.contains("place")) {
        const Json& place = to["place"];
        if (!place.is_string()) return fail("invalid", "to.place is a string");
        out.place = find_place(place.get<std::string>(), vocab);
        if (!out.place) return fail("unknown", "unknown place: " + place.get<std::string>());
        return out;
    }
    if (to.contains("neighbors") && to["neighbors"].is_array() && !to["neighbors"].empty()) {
        for (const Json& item : to["neighbors"]) {
            const auto id = item.is_string()
                                ? find_neighbor(item.get_ref<const std::string&>(), population)
                                : std::nullopt;
            if (!id) return fail("unknown", "unknown neighbor " + item.dump());
            if (std::find(out.neighbors.begin(), out.neighbors.end(), *id) == out.neighbors.end()) {
                out.neighbors.push_back(*id);
            }
        }
        return out;
    }
    return fail("invalid", shape);
}

}  // namespace rumor::http
