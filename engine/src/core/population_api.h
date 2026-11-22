#pragma once
// The neighbors, their social graph and the vocabulary of each language.
// Implemented in src/people from data/people/ and data/vocab/. Population and
// Vocab are plain data: tests may build small ones by hand.

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "core/catalog.h"
#include "core/ids.h"
#include "core/scenario.h"

namespace rumor {

struct Neighbor {
    NeighborId id;
    std::string name;  // unique in the village and the same in every language
    bool female = false;
    Job job = Job::retired;
    Trait trait = Trait::sociable;
    PlaceId home;  // one of the home places

    friend bool operator==(const Neighbor&, const Neighbor&) = default;
};

// An edge of the social graph. a < b, and at most one edge per pair.
struct RelationEdge {
    NeighborId a;
    NeighborId b;
    Relation type = Relation::acquaintance;

    friend bool operator==(const RelationEdge&, const RelationEdge&) = default;
};

struct Population {
    // neighbors[n.index()].id == n.
    std::vector<Neighbor> neighbors;
    // Sorted by (a, b).
    std::vector<RelationEdge> relations;

    const Neighbor& at(NeighborId id) const { return neighbors[id.index()]; }

    // What joins two neighbors: acquaintance when there is no edge.
    Relation relation(NeighborId x, NeighborId y) const {
        const NeighborId a = x < y ? x : y;
        const NeighborId b = x < y ? y : x;
        for (const RelationEdge& edge : relations) {
            if (edge.a == a && edge.b == b) return edge.type;
        }
        return Relation::acquaintance;
    }

    friend bool operator==(const Population&, const Population&) = default;
};

// A population of `count` neighbors (a village size, 20 in telephone). The recognizable
// characters of data/people/ are always the first ones, the same in every
// population; job, trait, home and graph of the rest come from the seed. In
// the line layout every neighbor has an edge with the next one. Nobody is left
// without an edge. Same arguments, same population. Throws std::runtime_error
// when the data is missing or wrong. `trait_mix` (-2..2, phase 9) leans the
// trait draw of the generated neighbors with the weights of
// data/game/settings.json; 0 makes exactly the same draws as before it existed.
Population make_population(const std::string& data_dir, int count, Layout layout,
                           std::uint64_t seed, int trait_mix = 0);

// Names of everything the model reads, by identifier, in one language. Words
// with gender come in two forms: [0] female, [1] male (both the same in
// English).
struct Vocab {
    Lang lang = Lang::es;
    std::array<std::string, kPlaceCount> places;
    std::array<std::array<std::string, 2>, kJobCount> jobs;
    std::array<std::array<std::string, 2>, kTraitCount> traits;
    std::array<std::array<std::string, 2>, kRelationCount> relations;
    std::string today;     // "hoy", "today"
    std::string tomorrow;  // "mañana", "tomorrow"
    // Label of each key of kWhatKeys, in that order.
    std::vector<std::pair<std::string, std::string>> what;
    // Unit of the amount of each key of kWhatKeys, in that order ("party" ->
    // "personas"). The unit is not data of the fact: the card writes it next
    // to the number.
    std::vector<std::pair<std::string, std::string>> amount_units;

    const std::string& place(PlaceId p) const { return places[p.index()]; }
    const std::string& job(Job j, bool female) const {
        return jobs[static_cast<std::size_t>(j)][female ? 0 : 1];
    }
    const std::string& trait(Trait t, bool female) const {
        return traits[static_cast<std::size_t>(t)][female ? 0 : 1];
    }
    // The gender is that of the neighbor the word describes.
    const std::string& relation(Relation r, bool female) const {
        return relations[static_cast<std::size_t>(r)][female ? 0 : 1];
    }
    // The label of a `what`; a text outside the catalog is returned as it is.
    std::string what_label(std::string_view what_key) const {
        for (const auto& [k, label] : what) {
            if (k == what_key) return label;
        }
        return std::string(what_key);
    }
    // The unit of the amount of a `what`; empty for a text outside the
    // catalog, which has no unit.
    std::string amount_unit(std::string_view what_key) const {
        for (const auto& [k, unit] : amount_units) {
            if (k == what_key) return unit;
        }
        return {};
    }
};

// Reads data_dir/vocab/. Throws std::runtime_error when a catalog identifier
// has no name.
Vocab load_vocab(const std::string& data_dir, Lang lang);

}  // namespace rumor
