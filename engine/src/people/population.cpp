// make_population: the neighbors of data/people/people.json and their social
// graph. The recognizable characters (the first entries with job, trait and
// home) and the relations among them are fixed; everything else comes from the
// population stream of the seed.

#include <array>
#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "core/population_api.h"
#include "core/rng.h"
#include "people/json_file.h"

namespace rumor {
namespace {

using people::Json;

struct PeopleData {
    std::vector<Neighbor> neighbors;  // all names; job, trait and home only for characters
    std::size_t characters = 0;       // the first ones
    std::vector<RelationEdge> relations;  // among characters
    std::array<std::uint32_t, kJobCount> job_weights{};
};

template <class E>
E enum_member(const Json& obj, const char* member, const std::string& where) {
    const std::string text = people::string_member(obj, member, where);
    const auto value = from_key<E>(text);
    if (!value) throw std::runtime_error(where + ": unknown " + member + " '" + text + "'");
    return *value;
}

NeighborId id_member(const Json& obj, const char* member, const std::string& where) {
    const std::string text = people::string_member(obj, member, where);
    const auto id = NeighborId::parse(text);
    if (!id) throw std::runtime_error(where + ": bad neighbor identifier '" + text + "'");
    return *id;
}

PeopleData read_people(const std::string& data_dir) {
    const std::string path = data_dir + "/people/people.json";
    const Json doc = people::read_json_file(path);
    PeopleData data;

    const auto weights = doc.find("job_weights");
    if (weights == doc.end() || !weights->is_object()) {
        throw std::runtime_error(path + ": missing object 'job_weights'");
    }
    for (const auto& [k, value] : weights->items()) {
        const auto job = from_key<Job>(k);
        if (!job) throw std::runtime_error(path + ": job_weights: unknown job '" + k + "'");
        if (!value.is_number_unsigned()) {
            throw std::runtime_error(path + ": job_weights." + k + " must be a non-negative integer");
        }
        data.job_weights[static_cast<std::size_t>(*job)] = value.get<std::uint32_t>();
    }

    const auto list = doc.find("neighbors");
    if (list == doc.end() || !list->is_array() || list->empty()) {
        throw std::runtime_error(path + ": missing array 'neighbors'");
    }
    std::set<std::string> names;
    for (const Json& entry : *list) {
        const std::string where = path + ": neighbor " + std::to_string(data.neighbors.size() + 1);
        if (!entry.is_object()) throw std::runtime_error(where + ": expected an object");
        for (const auto& item : entry.items()) {
            const std::string& k = item.key();
            if (k != "name" && k != "female" && k != "job" && k != "trait" && k != "home") {
                throw std::runtime_error(where + ": unknown key '" + k + "'");
            }
        }
        Neighbor n;
        n.id = NeighborId::from_index(data.neighbors.size());
        n.name = people::string_member(entry, "name", where);
        if (!names.insert(n.name).second) {
            throw std::runtime_error(where + ": the name '" + n.name + "' is used twice");
        }
        const auto female = entry.find("female");
        if (female == entry.end() || !female->is_boolean()) {
            throw std::runtime_error(where + ": 'female' must be true or false");
        }
        n.female = female->get<bool>();
        if (entry.contains("job") || entry.contains("trait") || entry.contains("home")) {
            if (data.characters != data.neighbors.size()) {
                throw std::runtime_error(where + ": characters must come first");
            }
            n.job = enum_member<Job>(entry, "job", where);
            n.trait = enum_member<Trait>(entry, "trait", where);
            const std::string home = people::string_member(entry, "home", where);
            const auto place = place_from_key(home);
            if (!place || place_info(*place).kind != PlaceKind::home) {
                throw std::runtime_error(where + ": '" + home + "' is not a home place");
            }
            n.home = *place;
            ++data.characters;
        }
        data.neighbors.push_back(std::move(n));
    }

    const auto relations = doc.find("relations");
    if (relations == doc.end() || !relations->is_array()) {
        throw std::runtime_error(path + ": missing array 'relations'");
    }
    for (const Json& entry : *relations) {
        const std::string where = path + ": relation " + entry.dump();
        if (!entry.is_object()) throw std::runtime_error(where + ": expected an object");
        RelationEdge edge{id_member(entry, "a", where), id_member(entry, "b", where),
                          enum_member<Relation>(entry, "type", where)};
        if (!(edge.a < edge.b) || edge.b.index() >= data.characters) {
            throw std::runtime_error(where + ": needs a < b, both characters");
        }
        if (edge.type == Relation::acquaintance) {
            throw std::runtime_error(where + ": acquaintance is the absence of an edge");
        }
        for (const RelationEdge& other : data.relations) {
            if (other.a == edge.a && other.b == edge.b) {
                throw std::runtime_error(where + ": the pair appears twice");
            }
        }
        data.relations.push_back(edge);
    }
    return data;
}

// The jobs of a population of `count`, in a fixed order that does not depend
// on the seed: the jobs of the characters, then every job that is still
// missing, then the weights by smooth weighted round robin, so that every
// prefix follows them (a single priest when its weight is 1).
std::vector<Job> job_deck(const PeopleData& data, std::size_t count) {
    std::array<std::int64_t, kJobCount> left{};
    for (std::size_t j = 0; j < kJobCount; ++j) left[j] = data.job_weights[j];
    std::array<bool, kJobCount> present{};
    std::vector<Job> deck;
    const auto take = [&](std::size_t j) {
        deck.push_back(static_cast<Job>(j));
        present[j] = true;
        if (left[j] > 0) --left[j];
    };
    for (std::size_t i = 0; i < data.characters; ++i) {
        take(static_cast<std::size_t>(data.neighbors[i].job));
    }
    for (std::size_t j = 0; j < kJobCount; ++j) {
        if (!present[j] && left[j] > 0) take(j);
    }
    std::int64_t total = 0;
    for (std::int64_t w : left) total += w;
    std::array<std::int64_t, kJobCount> current{};
    while (deck.size() < count) {
        if (total == 0) throw std::runtime_error("people.json: job_weights are too small");
        std::size_t best = 0;
        for (std::size_t j = 0; j < kJobCount; ++j) {
            current[j] += left[j];
            if (current[j] > current[best]) best = j;
        }
        current[best] -= total;
        deck.push_back(static_cast<Job>(best));
    }
    deck.resize(count);
    return deck;
}

// The weight of each trait for a trait_mix other than 0, from the "trait_mix"
// object of data_dir/game/settings.json: every trait is on the quiet or the
// talkative side, and each level gives the weight of each side.
std::array<std::uint32_t, kTraitCount> trait_weights(const std::string& data_dir, int trait_mix) {
    const std::string path = data_dir + "/game/settings.json";
    const Json doc = people::read_json_file(path);
    const auto mix = doc.find("trait_mix");
    if (mix == doc.end() || !mix->is_object()) {
        throw std::runtime_error(path + ": missing object 'trait_mix'");
    }
    std::array<int, kTraitCount> side{};  // 0 unassigned, 1 quiet, 2 talkative
    for (const auto& [member, value] : {std::pair{"quiet", 1}, std::pair{"talkative", 2}}) {
        const auto list = mix->find(member);
        if (list == mix->end() || !list->is_array()) {
            throw std::runtime_error(path + ": trait_mix." + member + " must be a list of traits");
        }
        for (const Json& item : *list) {
            const auto trait = item.is_string() ? from_key<Trait>(item.get<std::string>()) : std::nullopt;
            if (!trait) throw std::runtime_error(path + ": trait_mix." + member + ": unknown trait " + item.dump());
            int& slot = side[static_cast<std::size_t>(*trait)];
            if (slot != 0) throw std::runtime_error(path + ": trait_mix: " + item.dump() + " appears twice");
            slot = value;
        }
    }
    for (std::size_t t = 0; t < kTraitCount; ++t) {
        if (side[t] == 0) {
            throw std::runtime_error(path + ": trait_mix: the trait '" +
                                     std::string(key(static_cast<Trait>(t))) + "' has no side");
        }
    }
    const std::string level = std::to_string(trait_mix);
    const auto weights = mix->find("weights");
    if (weights == mix->end() || !weights->is_object() || !weights->contains(level)) {
        throw std::runtime_error(path + ": missing trait_mix.weights." + level);
    }
    const Json& w = (*weights)[level];
    std::array<std::uint32_t, 3> per_side{};
    for (const auto& [member, value] : {std::pair{"quiet", 1}, std::pair{"talkative", 2}}) {
        const auto it = w.is_object() ? w.find(member) : w.end();
        if (it == w.end() || !it->is_number_unsigned() || it->get<std::uint64_t>() < 1 ||
            it->get<std::uint64_t>() > 1000) {
            throw std::runtime_error(path + ": trait_mix.weights." + level + "." + member +
                                     " must be an integer from 1 to 1000");
        }
        per_side[static_cast<std::size_t>(value)] = it->get<std::uint32_t>();
    }
    std::array<std::uint32_t, kTraitCount> out{};
    for (std::size_t t = 0; t < kTraitCount; ++t) out[t] = per_side[static_cast<std::size_t>(side[t])];
    return out;
}

// The social graph while it is built: first edge of a pair wins.
class Graph {
  public:
    Graph(std::size_t count, std::size_t characters) : degree_(count), characters_(characters) {}

    bool add(NeighborId x, NeighborId y, Relation type) {
        if (x == y) return false;
        const auto key = x < y ? std::make_pair(x, y) : std::make_pair(y, x);
        if (!edges_.emplace(key, type).second) return false;
        ++degree_[x.index()];
        ++degree_[y.index()];
        return true;
    }
    // Generated edges never join two characters: those are fixed.
    bool add_generated(NeighborId x, NeighborId y, Relation type) {
        if (x.index() < characters_ && y.index() < characters_) return false;
        return add(x, y, type);
    }
    std::size_t degree(NeighborId n) const { return degree_[n.index()]; }

    std::vector<RelationEdge> edges() const {
        std::vector<RelationEdge> out;
        for (const auto& [pair, type] : edges_) out.push_back({pair.first, pair.second, type});
        return out;
    }

  private:
    std::map<std::pair<NeighborId, NeighborId>, Relation> edges_;
    std::vector<std::size_t> degree_;
    std::size_t characters_;
};

}  // namespace

Population make_population(const std::string& data_dir, int count, Layout layout,
                           std::uint64_t seed, int trait_mix) {
    if (trait_mix < -2 || trait_mix > 2) {
        throw std::runtime_error("make_population: trait_mix " + std::to_string(trait_mix) +
                                 " is outside -2..2");
    }
    const PeopleData data = read_people(data_dir);
    if (count < static_cast<int>(data.characters) || count < 2 ||
        count > static_cast<int>(data.neighbors.size())) {
        throw std::runtime_error("make_population: " + std::to_string(count) +
                                 " neighbors requested; the data allows " +
                                 std::to_string(data.characters) + " to " +
                                 std::to_string(data.neighbors.size()));
    }
    const auto n = static_cast<std::size_t>(count);
    const std::size_t fixed = data.characters;
    Rng rng(derive_seed(seed, 0, 0u, Stream::population));

    Population pop;
    pop.neighbors.assign(data.neighbors.begin(), data.neighbors.begin() + count);

    // Jobs: the deck of this size, dealt at random to the generated neighbors.
    const std::vector<Job> deck = job_deck(data, n);
    std::vector<Job> dealt(deck.begin() + static_cast<std::ptrdiff_t>(fixed), deck.end());
    rng.shuffle(dealt);
    for (std::size_t i = fixed; i < n; ++i) pop.neighbors[i].job = dealt[i - fixed];
    // The village priest is a man.
    for (std::size_t i = fixed; i < n; ++i) {
        Neighbor& priest = pop.neighbors[i];
        if (priest.job != Job::priest || !priest.female) continue;
        for (std::size_t k = fixed; k < n; ++k) {
            if (!pop.neighbors[k].female) {
                std::swap(priest.job, pop.neighbors[k].job);
                break;
            }
        }
    }

    // Traits: uniform with trait_mix 0 (one below(kTraitCount) per neighbor,
    // as before phase 9), weighted otherwise.
    if (trait_mix == 0) {
        for (std::size_t i = fixed; i < n; ++i) {
            pop.neighbors[i].trait = static_cast<Trait>(rng.below(kTraitCount));
        }
    } else {
        const std::array<std::uint32_t, kTraitCount> weights = trait_weights(data_dir, trait_mix);
        std::uint32_t total = 0;
        for (std::uint32_t w : weights) total += w;
        for (std::size_t i = fixed; i < n; ++i) {
            std::uint32_t roll = rng.below(total);
            std::size_t t = 0;
            while (roll >= weights[t]) roll -= weights[t++];
            pop.neighbors[i].trait = static_cast<Trait>(t);
        }
    }

    // Small families (1 to 3) of generated neighbors share a home quarter.
    std::vector<NeighborId> order;
    for (std::size_t i = fixed; i < n; ++i) order.push_back(NeighborId::from_index(i));
    rng.shuffle(order);
    std::vector<std::vector<NeighborId>> families;
    for (std::size_t i = 0; i < order.size();) {
        const auto size = static_cast<std::size_t>(rng.range(1, 3));
        const PlaceId home = PlaceId::from_index(kPublicPlaceCount + rng.below(kHomePlaceCount));
        families.emplace_back();
        for (; i < order.size() && families.back().size() < size; ++i) {
            pop.neighbors[order[i].index()].home = home;
            families.back().push_back(order[i]);
        }
    }

    Graph graph(n, fixed);
    if (layout == Layout::line) {
        // Telephone game: each neighbor with the next one, and nothing else.
        for (std::size_t i = 0; i + 1 < n; ++i) {
            const NeighborId a = NeighborId::from_index(i);
            const NeighborId b = NeighborId::from_index(i + 1);
            // The first three relations: family, friend or coworker.
            Relation type = static_cast<Relation>(rng.below(3));
            for (const RelationEdge& edge : data.relations) {
                if (edge.a == a && edge.b == b && edge.type != Relation::rival) type = edge.type;
            }
            graph.add(a, b, type);
        }
        pop.relations = graph.edges();
        return pop;
    }

    for (const RelationEdge& edge : data.relations) {
        if (edge.b.index() < n) graph.add(edge.a, edge.b, edge.type);
    }
    for (const auto& family : families) {
        for (std::size_t i = 0; i < family.size(); ++i) {
            for (std::size_t k = i + 1; k < family.size(); ++k) {
                graph.add_generated(family[i], family[k], Relation::family);
            }
        }
    }
    // Coworkers: the members of each job in a random chain. The retired have
    // no workplace.
    for (std::size_t j = 0; j < kJobCount; ++j) {
        if (static_cast<Job>(j) == Job::retired) continue;
        std::vector<NeighborId> members;
        for (const Neighbor& nb : pop.neighbors) {
            if (nb.job == static_cast<Job>(j)) members.push_back(nb.id);
        }
        rng.shuffle(members);
        for (std::size_t i = 0; i + 1 < members.size(); ++i) {
            graph.add_generated(members[i], members[i + 1], Relation::coworker);
        }
    }
    const auto random_neighbor = [&] {
        return NeighborId::from_index(rng.below(static_cast<std::uint32_t>(n)));
    };
    for (std::size_t i = 0; i < n / 2; ++i) {
        const NeighborId x = random_neighbor();
        graph.add_generated(x, random_neighbor(), Relation::friend_);
    }
    for (std::size_t i = 0; i < (n + 19) / 20; ++i) {
        const NeighborId x = random_neighbor();
        graph.add_generated(x, random_neighbor(), Relation::rival);
    }
    // Nobody alone: a friend for whoever is still without an edge.
    for (std::size_t i = 0; i < n; ++i) {
        const NeighborId x = NeighborId::from_index(i);
        if (graph.degree(x) > 0) continue;
        const std::size_t start = rng.below(static_cast<std::uint32_t>(n));
        bool added = false;
        for (std::size_t k = 0; k < n && !added; ++k) {
            added = graph.add_generated(x, NeighborId::from_index((start + k) % n),
                                        Relation::friend_);
        }
        if (!added) throw std::runtime_error("make_population: neighbor " + x.str() + " is alone");
    }
    pop.relations = graph.edges();
    return pop;
}

}  // namespace rumor
