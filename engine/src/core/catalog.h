#pragma once
// Closed lists shared by every package: languages, places, jobs, character
// traits, relation types and the `what` labels of the scenarios. The data files
// (data/world, data/people, data/vocab) refer to these keys and must cover all
// of them; nothing else may appear there.

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string_view>

#include "core/enum_keys.h"
#include "core/ids.h"

namespace rumor {

enum class Lang : std::uint8_t { es, en };
RUMOR_ENUM_KEYS(Lang, "es", "en");

// --- Places -----------------------------------------------------------------
// Public places are where neighbors meet and where a rumor can happen: they are
// the `where` vocabulary of the model. Home places are the four quarters where
// neighbors live: nobody meets there and no rumor happens there.

enum class PlaceKind : std::uint8_t { public_place, home };
RUMOR_ENUM_KEYS(PlaceKind, "public", "home");

struct PlaceInfo {
    std::string_view key;
    PlaceKind kind;
};

// PlaceId N is kPlaces[N - 1]. Public places come first.
inline constexpr auto kPlaces = std::to_array<PlaceInfo>({
    {"square", PlaceKind::public_place},     // p01
    {"bar", PlaceKind::public_place},        // p02
    {"church", PlaceKind::public_place},     // p03
    {"market", PlaceKind::public_place},     // p04
    {"bakery", PlaceKind::public_place},     // p05
    {"school", PlaceKind::public_place},     // p06
    {"town_hall", PlaceKind::public_place},  // p07
    {"pharmacy", PlaceKind::public_place},   // p08
    {"fountain", PlaceKind::public_place},   // p09
    {"mill", PlaceKind::public_place},       // p10
    {"chapel", PlaceKind::public_place},     // p11
    {"river", PlaceKind::public_place},      // p12
    {"upper_quarter", PlaceKind::home},      // p13
    {"lower_quarter", PlaceKind::home},      // p14
    {"east_quarter", PlaceKind::home},       // p15
    {"west_quarter", PlaceKind::home},       // p16
});
inline constexpr std::size_t kPlaceCount = kPlaces.size();
inline constexpr std::size_t kPublicPlaceCount = 12;  // p01..p12
inline constexpr std::size_t kHomePlaceCount = kPlaceCount - kPublicPlaceCount;

constexpr bool is_place(PlaceId p) { return p.valid() && p.index() < kPlaceCount; }
constexpr const PlaceInfo& place_info(PlaceId p) { return kPlaces[p.index()]; }
constexpr bool is_public(PlaceId p) {
    return is_place(p) && place_info(p).kind == PlaceKind::public_place;
}
constexpr std::optional<PlaceId> place_from_key(std::string_view text) {
    for (std::size_t i = 0; i < kPlaceCount; ++i) {
        if (kPlaces[i].key == text) return PlaceId::from_index(i);
    }
    return std::nullopt;
}

// --- Neighbors ----------------------------------------------------------------

enum class Job : std::uint8_t {
    baker, bartender, teacher, priest, pharmacist, clerk,
    merchant, miller, farmer, carpenter, seamstress, retired,
};
RUMOR_ENUM_KEYS(Job, "baker", "bartender", "teacher", "priest", "pharmacist", "clerk",
                "merchant", "miller", "farmer", "carpenter", "seamstress", "retired");
inline constexpr std::size_t kJobCount = enum_count<Job>;

// One trait per neighbor. It only gives the policy a reason to tell or to keep
// quiet; the engine rules do not depend on it.
enum class Trait : std::uint8_t { gossip, sociable, prudent, discreet, shy, exaggerator };
RUMOR_ENUM_KEYS(Trait, "gossip", "sociable", "prudent", "discreet", "shy", "exaggerator");
inline constexpr std::size_t kTraitCount = enum_count<Trait>;

// What joins two neighbors. Two neighbors without an edge in the social graph
// are acquaintances: in a village everybody knows everybody.
enum class Relation : std::uint8_t { family, friend_, coworker, acquaintance, rival };
RUMOR_ENUM_KEYS(Relation, "family", "friend", "coworker", "acquaintance", "rival");
inline constexpr std::size_t kRelationCount = enum_count<Relation>;

// --- Facts ---------------------------------------------------------------------
// `what` labels the scenarios use. The vocabulary names them in each language.
// `what` stays an open text (contract, section 4): a label outside this list is
// shown as it is.
inline constexpr auto kWhatKeys = std::to_array<std::string_view>(
    {"party", "lottery", "wedding", "concert", "works", "inheritance", "fine"});

}  // namespace rumor
