// load_vocab: data/vocab/<lang>.json, every name by catalog identifier, and
// the unit of the amount of every `what` key.

#include <array>
#include <cstddef>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "core/population_api.h"
#include "people/json_file.h"

namespace rumor {
namespace {

using people::Json;

// The section `name` of `doc`: an object with exactly the keys `keys`.
// Returns the values in the order of `keys`.
template <class Keys>
std::vector<const Json*> section(const Json& doc, const std::string& name, const Keys& keys,
                                 const std::string& where) {
    const auto it = doc.find(name);
    if (it == doc.end() || !it->is_object()) {
        throw std::runtime_error(where + ": missing object '" + name + "'");
    }
    std::vector<const Json*> values;
    for (std::string_view k : keys) {
        const auto value = it->find(std::string(k));
        if (value == it->end()) {
            throw std::runtime_error(where + ": " + name + ": no name for '" + std::string(k) +
                                     "'");
        }
        values.push_back(&*value);
    }
    for (const auto& item : it->items()) {
        const std::string& k = item.key();
        bool known = false;
        for (std::string_view catalog_key : keys) known = known || catalog_key == k;
        if (!known) {
            throw std::runtime_error(where + ": " + name + ": unknown key '" + k + "'");
        }
    }
    return values;
}

std::string plain_name(const Json& value, const std::string& where) {
    if (!value.is_string() || value.get<std::string>().empty()) {
        throw std::runtime_error(where + ": the name must be a non-empty string");
    }
    return value.get<std::string>();
}

// [female, male].
std::array<std::string, 2> gendered_name(const Json& value, const std::string& where) {
    if (!value.is_array() || value.size() != 2) {
        throw std::runtime_error(where + ": expected [female, male]");
    }
    return {plain_name(value[0], where), plain_name(value[1], where)};
}

template <class E, std::size_t N>
void read_gendered(const Json& doc, const std::string& name, const std::string& where,
                   std::array<std::array<std::string, 2>, N>& out) {
    const auto values = section(doc, name, EnumKeys<E>::keys, where);
    for (std::size_t i = 0; i < N; ++i) {
        out[i] = gendered_name(*values[i], where + ": " + name + "." +
                                               std::string(EnumKeys<E>::keys[i]));
    }
}

}  // namespace

Vocab load_vocab(const std::string& data_dir, Lang lang) {
    const std::string where = data_dir + "/vocab/" + std::string(key(lang)) + ".json";
    const Json doc = people::read_json_file(where);
    if (!doc.is_object()) throw std::runtime_error(where + ": expected an object");
    for (const auto& item : doc.items()) {
        const std::string& k = item.key();
        static constexpr std::string_view kSections[] = {
            "places", "jobs", "traits", "relations", "today", "tomorrow", "what", "amount_units"};
        bool known = false;
        for (std::string_view s : kSections) known = known || s == k;
        if (!known) throw std::runtime_error(where + ": unknown key '" + k + "'");
    }

    Vocab vocab;
    vocab.lang = lang;

    std::vector<std::string_view> place_keys;
    for (const PlaceInfo& p : kPlaces) place_keys.push_back(p.key);
    const auto places = section(doc, "places", place_keys, where);
    std::set<std::string> seen;
    for (std::size_t i = 0; i < kPlaceCount; ++i) {
        vocab.places[i] = plain_name(*places[i], where + ": places." + std::string(place_keys[i]));
        if (!seen.insert(vocab.places[i]).second) {
            throw std::runtime_error(where + ": places: the name '" + vocab.places[i] +
                                     "' is used twice");
        }
    }

    read_gendered<Job>(doc, "jobs", where, vocab.jobs);
    read_gendered<Trait>(doc, "traits", where, vocab.traits);
    read_gendered<Relation>(doc, "relations", where, vocab.relations);

    vocab.today = people::string_member(doc, "today", where);
    vocab.tomorrow = people::string_member(doc, "tomorrow", where);

    const auto what = section(doc, "what", kWhatKeys, where);
    for (std::size_t i = 0; i < kWhatKeys.size(); ++i) {
        vocab.what.emplace_back(std::string(kWhatKeys[i]),
                                plain_name(*what[i], where + ": what." + std::string(kWhatKeys[i])));
    }

    const auto units = section(doc, "amount_units", kWhatKeys, where);
    for (std::size_t i = 0; i < kWhatKeys.size(); ++i) {
        vocab.amount_units.emplace_back(
            std::string(kWhatKeys[i]),
            plain_name(*units[i], where + ": amount_units." + std::string(kWhatKeys[i])));
    }
    return vocab;
}

}  // namespace rumor
