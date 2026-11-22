#include <doctest/doctest.h>

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/population_api.h"
#include "core/rng.h"

using namespace rumor;

namespace {

const std::string kData = RUMOR_DATA_DIR;

nlohmann::json read_json(const std::string& path) {
    std::ifstream in(path);
    REQUIRE(in.good());
    return nlohmann::json::parse(in);
}

nlohmann::json bench_vocab() { return read_json(kData + "/../bench/prompts/vocab.json"); }

struct Expected {
    const char* name;
    bool female;
    Job job;
    Trait trait;
    const char* home;
};

const Expected kCharacters[] = {
    {"Carmen", true, Job::baker, Trait::gossip, "upper_quarter"},
    {"Luis", false, Job::clerk, Trait::discreet, "upper_quarter"},
    {"Ana", true, Job::seamstress, Trait::sociable, "west_quarter"},
    {"Pedro", false, Job::carpenter, Trait::shy, "east_quarter"},
    {"Elena", true, Job::teacher, Trait::prudent, "west_quarter"},
    {"Manuel", false, Job::bartender, Trait::exaggerator, "lower_quarter"},
};

const int kSizes[] = {100, 70, 50, 25, 20, 10};

std::vector<RelationEdge> among_characters(const Population& pop) {
    std::vector<RelationEdge> out;
    for (const RelationEdge& e : pop.relations) {
        if (e.b.v <= 6) out.push_back(e);
    }
    return out;
}

}  // namespace

TEST_SUITE("people") {

TEST_CASE("same arguments give the same population; another seed, another one") {
    for (int size : kSizes) {
        for (Layout layout : {Layout::village, Layout::line}) {
            CAPTURE(size);
            const Population a = make_population(kData, size, layout, 7);
            CHECK(a == make_population(kData, size, layout, 7));
            CHECK_FALSE(a == make_population(kData, size, layout, 8));
        }
    }
}

TEST_CASE("the six characters are the same in every population") {
    const Population ref = make_population(kData, 100, Layout::village, 1);
    for (std::size_t i = 0; i < 6; ++i) {
        const Neighbor& n = ref.neighbors[i];
        CHECK(n.name == kCharacters[i].name);
        CHECK(n.female == kCharacters[i].female);
        CHECK(n.job == kCharacters[i].job);
        CHECK(n.trait == kCharacters[i].trait);
        CHECK(n.home == *place_from_key(kCharacters[i].home));
    }
    CHECK(ref.relation(NeighborId(1), NeighborId(2)) == Relation::friend_);
    CHECK_FALSE(among_characters(ref).empty());
    for (int size : kSizes) {
        for (std::uint64_t seed : {1u, 2u, 99u}) {
            const Population pop = make_population(kData, size, Layout::village, seed);
            for (std::size_t i = 0; i < 6; ++i) CHECK(pop.neighbors[i] == ref.neighbors[i]);
            CHECK(among_characters(pop) == among_characters(ref));
        }
    }
}

TEST_CASE("identifiers are contiguous and names are unique, fixed and balanced") {
    const nlohmann::json vocab = bench_vocab();
    std::map<std::string, bool> bench_female;
    for (std::size_t i = 0; i < vocab["neighbors"].size(); ++i) {
        bench_female[vocab["neighbors"][i].get<std::string>()] = i < 50;
    }
    REQUIRE(bench_female.size() == 100);

    const Population full = make_population(kData, 100, Layout::village, 3);
    std::set<std::string> names;
    int balance = 0;
    for (std::size_t i = 0; i < full.neighbors.size(); ++i) {
        const Neighbor& n = full.neighbors[i];
        CHECK(n.id == NeighborId::from_index(i));
        CHECK(names.insert(n.name).second);
        REQUIRE(bench_female.count(n.name) == 1);
        CHECK(bench_female[n.name] == n.female);
        balance += n.female ? 1 : -1;
        CHECK(balance >= -1);
        CHECK(balance <= 1);
    }
    CHECK(names.size() == 100);

    for (int size : kSizes) {
        for (Layout layout : {Layout::village, Layout::line}) {
            const Population pop = make_population(kData, size, layout, 12345);
            REQUIRE(pop.neighbors.size() == static_cast<std::size_t>(size));
            for (std::size_t i = 0; i < pop.neighbors.size(); ++i) {
                CHECK(pop.neighbors[i].id == NeighborId::from_index(i));
                CHECK(pop.neighbors[i].name == full.neighbors[i].name);
                CHECK(pop.neighbors[i].female == full.neighbors[i].female);
            }
        }
    }
}

TEST_CASE("home is always a quarter and jobs are credible") {
    for (int size : kSizes) {
        for (std::uint64_t seed = 1; seed <= 20; ++seed) {
            CAPTURE(size);
            CAPTURE(seed);
            const Population pop = make_population(kData, size, Layout::village, seed);
            std::map<Job, int> jobs;
            for (const Neighbor& n : pop.neighbors) {
                REQUIRE(is_place(n.home));
                CHECK(place_info(n.home).kind == PlaceKind::home);
                ++jobs[n.job];
                if (n.job == Job::priest) CHECK_FALSE(n.female);
            }
            CHECK(jobs[Job::priest] == 1);
            if (static_cast<std::size_t>(size) < kJobCount) {
                // Too few for every job: all different, the priest included.
                CHECK(jobs.size() == static_cast<std::size_t>(size));
                continue;
            }
            CHECK(jobs.size() == kJobCount);
            CHECK(jobs[Job::farmer] >= jobs[Job::pharmacist]);
            CHECK(jobs[Job::retired] >= jobs[Job::pharmacist]);
            if (size == 100) {
                CHECK(jobs[Job::farmer] > jobs[Job::pharmacist]);
                CHECK(jobs[Job::retired] > jobs[Job::pharmacist]);
            }
        }
    }
}

TEST_CASE("the village graph is well formed and leaves nobody alone") {
    for (int size : kSizes) {
        for (std::uint64_t seed = 0; seed < 50; ++seed) {
            CAPTURE(size);
            CAPTURE(seed);
            const Population pop = make_population(kData, size, Layout::village, seed);
            std::vector<int> degree(static_cast<std::size_t>(size), 0);
            std::set<Relation> kinds;
            for (std::size_t i = 0; i < pop.relations.size(); ++i) {
                const RelationEdge& e = pop.relations[i];
                CHECK(e.a < e.b);
                CHECK(e.a.valid());
                CHECK(e.b.index() < static_cast<std::size_t>(size));
                CHECK(e.type != Relation::acquaintance);
                if (i > 0) {
                    const RelationEdge& p = pop.relations[i - 1];
                    CHECK((p.a < e.a || (p.a == e.a && p.b < e.b)));
                }
                if (e.type == Relation::family) CHECK(pop.at(e.a).home == pop.at(e.b).home);
                ++degree[e.a.index()];
                ++degree[e.b.index()];
                kinds.insert(e.type);
            }
            for (int d : degree) CHECK(d > 0);
            CHECK(kinds.count(Relation::family) == 1);
            CHECK(kinds.count(Relation::friend_) == 1);
            // Below kJobCount every job is different: nobody has a coworker.
            CHECK(kinds.count(Relation::coworker) ==
                  (static_cast<std::size_t>(size) > kJobCount ? 1u : 0u));
            CHECK(kinds.count(Relation::rival) == 1);
        }
    }
}

TEST_CASE("the line joins each neighbor with the next one and nothing else") {
    for (std::uint64_t seed = 0; seed < 20; ++seed) {
        CAPTURE(seed);
        const Population pop = make_population(kData, 20, Layout::line, seed);
        REQUIRE(pop.relations.size() == 19);
        for (std::size_t i = 0; i < 19; ++i) {
            const RelationEdge& e = pop.relations[i];
            CHECK(e.a == NeighborId::from_index(i));
            CHECK(e.b == NeighborId::from_index(i + 1));
            CHECK((e.type == Relation::family || e.type == Relation::friend_ ||
                   e.type == Relation::coworker));
        }
        CHECK(pop.relation(NeighborId(1), NeighborId(2)) == Relation::friend_);
    }
}

TEST_CASE("make_population rejects sizes the data cannot hold") {
    CHECK_THROWS_AS(make_population(kData, 5, Layout::village, 1), std::runtime_error);
    CHECK_THROWS_AS(make_population(kData, 101, Layout::village, 1), std::runtime_error);
    CHECK_THROWS_AS(make_population(kData + "/missing", 20, Layout::village, 1),
                    std::runtime_error);
}

TEST_CASE("every catalog identifier has a name in both languages") {
    for (Lang lang : {Lang::es, Lang::en}) {
        CAPTURE(key(lang));
        const Vocab v = load_vocab(kData, lang);
        CHECK(v.lang == lang);
        std::set<std::string> places;
        for (const std::string& p : v.places) {
            CHECK_FALSE(p.empty());
            CHECK(places.insert(p).second);
            for (char c : p) CHECK_FALSE((c >= 'A' && c <= 'Z'));
        }
        for (const auto& forms : v.jobs) {
            CHECK_FALSE(forms[0].empty());
            CHECK_FALSE(forms[1].empty());
            if (lang == Lang::en) CHECK(forms[0] == forms[1]);
        }
        for (const auto& forms : v.traits) {
            CHECK_FALSE(forms[0].empty());
            CHECK_FALSE(forms[1].empty());
            if (lang == Lang::en) CHECK(forms[0] == forms[1]);
        }
        for (const auto& forms : v.relations) {
            CHECK_FALSE(forms[0].empty());
            CHECK_FALSE(forms[1].empty());
            if (lang == Lang::en) CHECK(forms[0] == forms[1]);
        }
        REQUIRE(v.what.size() == kWhatKeys.size());
        for (std::size_t i = 0; i < kWhatKeys.size(); ++i) {
            CHECK(v.what[i].first == kWhatKeys[i]);
            CHECK_FALSE(v.what[i].second.empty());
        }
        CHECK(v.what_label("something else") == "something else");
        REQUIRE(v.amount_units.size() == kWhatKeys.size());
        for (std::size_t i = 0; i < kWhatKeys.size(); ++i) {
            CHECK(v.amount_units[i].first == kWhatKeys[i]);
            CHECK_FALSE(v.amount_units[i].second.empty());
        }
        CHECK(v.amount_unit("something else").empty());
    }
    const Vocab es = load_vocab(kData, Lang::es);
    CHECK(es.today == "hoy");
    CHECK(es.tomorrow == "mañana");
    CHECK(es.job(Job::baker, true) == "panadera");
    CHECK(es.job(Job::baker, false) == "panadero");
    CHECK(es.relation(Relation::acquaintance, true) == "vecina");
    CHECK(es.trait(Trait::gossip, false) == "cotilla");
    CHECK(es.what_label("lottery") == "premio de lotería");
    CHECK(es.amount_unit("party") == "personas");
    CHECK(es.amount_unit("works") == "días");
    const Vocab en = load_vocab(kData, Lang::en);
    CHECK(en.today == "today");
    CHECK(en.tomorrow == "tomorrow");
    CHECK(en.what_label("wedding") == "wedding");
    CHECK(en.amount_unit("wedding") == "guests");
    CHECK(en.amount_unit("fine") == "euros");
}

TEST_CASE("the public places match the names of phase 0") {
    const nlohmann::json bench = bench_vocab();
    for (Lang lang : {Lang::es, Lang::en}) {
        const Vocab v = load_vocab(kData, lang);
        const auto& expected = bench["places"][std::string(key(lang))];
        REQUIRE(expected.size() == kPublicPlaceCount);
        for (std::size_t i = 0; i < kPublicPlaceCount; ++i) {
            CHECK(v.places[i] == expected[i].get<std::string>());
        }
    }
}

TEST_CASE("load_vocab fails on a missing name or an unknown key") {
    namespace fs = std::filesystem;
    const fs::path dir = fs::temp_directory_path() / "rumor-people-test";
    fs::create_directories(dir / "vocab");
    const nlohmann::json good = read_json(kData + "/vocab/es.json");
    const auto write = [&](const nlohmann::json& doc) {
        std::ofstream(dir / "vocab" / "es.json") << doc.dump();
    };

    write(good);
    CHECK_NOTHROW(load_vocab(dir.string(), Lang::es));

    nlohmann::json missing = good;
    missing["jobs"].erase("miller");
    write(missing);
    CHECK_THROWS_WITH_AS(load_vocab(dir.string(), Lang::es), doctest::Contains("miller"),
                         std::runtime_error);

    nlohmann::json unknown = good;
    unknown["places"]["castle"] = "castillo";
    write(unknown);
    CHECK_THROWS_WITH_AS(load_vocab(dir.string(), Lang::es), doctest::Contains("castle"),
                         std::runtime_error);

    nlohmann::json empty = good;
    empty["what"]["fine"] = "";
    write(empty);
    CHECK_THROWS_AS(load_vocab(dir.string(), Lang::es), std::runtime_error);

    // The units of the amount, as strict as the labels.
    nlohmann::json no_unit = good;
    no_unit["amount_units"].erase("lottery");
    write(no_unit);
    CHECK_THROWS_WITH_AS(load_vocab(dir.string(), Lang::es), doctest::Contains("lottery"),
                         std::runtime_error);
    nlohmann::json odd_unit = good;
    odd_unit["amount_units"]["picnic"] = "personas";
    write(odd_unit);
    CHECK_THROWS_WITH_AS(load_vocab(dir.string(), Lang::es), doctest::Contains("picnic"),
                         std::runtime_error);
    nlohmann::json empty_unit = good;
    empty_unit["amount_units"]["party"] = "";
    write(empty_unit);
    CHECK_THROWS_AS(load_vocab(dir.string(), Lang::es), std::runtime_error);
    nlohmann::json without_units = good;
    without_units.erase("amount_units");
    write(without_units);
    CHECK_THROWS_WITH_AS(load_vocab(dir.string(), Lang::es), doctest::Contains("amount_units"),
                         std::runtime_error);

    CHECK_THROWS_AS(load_vocab(dir.string(), Lang::en), std::runtime_error);
    fs::remove_all(dir);
}


// --- Character of the village (trait_mix, phase 9) ------------------------------

namespace {

constexpr std::size_t kFixed = 6;  // the characters of kCharacters

// The trait draw as it was before trait_mix existed: the population stream
// shuffles the jobs of the generated neighbors (one below(i) per step of the
// Fisher-Yates, whatever they hold) and then draws one below(kTraitCount) each.
std::vector<Trait> old_traits(int count, std::uint64_t seed) {
    Rng rng(derive_seed(seed, 0, 0u, Stream::population));
    std::vector<int> jobs(static_cast<std::size_t>(count) - kFixed);
    rng.shuffle(jobs);
    std::vector<Trait> out;
    for (std::size_t i = kFixed; i < static_cast<std::size_t>(count); ++i) {
        out.push_back(static_cast<Trait>(rng.below(kTraitCount)));
    }
    return out;
}

std::vector<Trait> generated_traits(const Population& pop) {
    std::vector<Trait> out;
    for (std::size_t i = kFixed; i < pop.neighbors.size(); ++i) out.push_back(pop.neighbors[i].trait);
    return out;
}

bool quiet(Trait t) { return t == Trait::prudent || t == Trait::discreet || t == Trait::shy; }

// Share of quiet traits among the generated neighbors of 100 in ten seeds, in
// parts per thousand.
int quiet_permille(int trait_mix) {
    int quiet_count = 0;
    int total = 0;
    for (std::uint64_t seed = 1; seed <= 10; ++seed) {
        for (Trait t : generated_traits(make_population(kData, 100, Layout::village, seed, trait_mix))) {
            quiet_count += quiet(t) ? 1 : 0;
            ++total;
        }
    }
    return quiet_count * 1000 / total;
}

}  // namespace

TEST_CASE("trait_mix 0 draws the traits of before, for every size and seed") {
    for (int size : kSizes) {
        const Layout layout = size == 20 ? Layout::line : Layout::village;
        for (std::uint64_t seed : {1ull, 2ull, 4ull, 5ull, 417ull, 123456789ull}) {
            const Population pop = make_population(kData, size, layout, seed, 0);
            CHECK(generated_traits(pop) == old_traits(size, seed));
            CHECK(pop == make_population(kData, size, layout, seed));
        }
    }
}

TEST_CASE("trait_mix leans the traits and nothing else") {
    for (int mix : {-2, -1, 1, 2}) {
        for (std::uint64_t seed : {1ull, 7ull}) {
            const Population lean = make_population(kData, 100, Layout::village, seed, mix);
            Population plain = make_population(kData, 100, Layout::village, seed, 0);
            // The characters keep theirs; jobs, homes and graph are the same
            // (the weighted draw takes one number per neighbor, as before).
            for (std::size_t i = 0; i < kFixed; ++i) CHECK(lean.neighbors[i].trait == kCharacters[i].trait);
            for (std::size_t i = kFixed; i < plain.neighbors.size(); ++i) {
                plain.neighbors[i].trait = lean.neighbors[i].trait;
            }
            CHECK(lean == plain);
            CHECK(lean == make_population(kData, 100, Layout::village, seed, mix));
        }
    }
    // Weights 4:1, 2:1, 1:1, 1:2 and 1:4 per side give 800, 667, 500, 333 and
    // 200 per thousand quiet; 940 neighbors leave room for chance.
    const int very_quiet = quiet_permille(-2);
    const int a_bit_quiet = quiet_permille(-1);
    const int normal = quiet_permille(0);
    const int a_bit_talkative = quiet_permille(1);
    const int very_talkative = quiet_permille(2);
    CHECK(very_quiet > 740);
    CHECK(very_quiet > a_bit_quiet);
    CHECK(a_bit_quiet > 600);
    CHECK(a_bit_quiet > normal);
    CHECK(normal > 430);
    CHECK(normal < 570);
    CHECK(normal > a_bit_talkative);
    CHECK(a_bit_talkative < 400);
    CHECK(a_bit_talkative > very_talkative);
    CHECK(very_talkative < 260);
}

TEST_CASE("trait_mix outside -2..2 or without its data is an error") {
    CHECK_THROWS_AS(make_population(kData, 25, Layout::village, 1, 3), std::runtime_error);
    CHECK_THROWS_AS(make_population(kData, 25, Layout::village, 1, -3), std::runtime_error);

    namespace fs = std::filesystem;
    const fs::path dir = fs::temp_directory_path() / "rumor-trait-mix-test";
    fs::remove_all(dir);
    fs::create_directories(dir / "people");
    fs::copy_file(kData + "/people/people.json", dir / "people" / "people.json");
    // Without data/game/ the draw of 0 still works: it never reads it.
    CHECK(make_population(dir.string(), 25, Layout::village, 3) ==
          make_population(kData, 25, Layout::village, 3));
    CHECK_THROWS_AS(make_population(dir.string(), 25, Layout::village, 3, 1), std::runtime_error);

    fs::create_directories(dir / "game");
    const nlohmann::json good = read_json(kData + "/game/settings.json");
    const auto write = [&](const nlohmann::json& doc) {
        std::ofstream(dir / "game" / "settings.json") << doc.dump();
    };
    write(good);
    CHECK(make_population(dir.string(), 25, Layout::village, 3, 1) ==
          make_population(kData, 25, Layout::village, 3, 1));

    nlohmann::json no_side = good;
    no_side["trait_mix"]["quiet"] = {"prudent", "discreet"};  // shy has no side
    write(no_side);
    CHECK_THROWS_WITH_AS(make_population(dir.string(), 25, Layout::village, 3, 1),
                         doctest::Contains("shy"), std::runtime_error);
    nlohmann::json twice = good;
    twice["trait_mix"]["talkative"].push_back("shy");
    write(twice);
    CHECK_THROWS_AS(make_population(dir.string(), 25, Layout::village, 3, 1), std::runtime_error);
    nlohmann::json no_level = good;
    no_level["trait_mix"]["weights"].erase("-1");
    write(no_level);
    CHECK_NOTHROW(make_population(dir.string(), 25, Layout::village, 3, 1));
    CHECK_THROWS_AS(make_population(dir.string(), 25, Layout::village, 3, -1), std::runtime_error);
    nlohmann::json zero = good;
    zero["trait_mix"]["weights"]["2"]["quiet"] = 0;
    write(zero);
    CHECK_THROWS_AS(make_population(dir.string(), 25, Layout::village, 3, 2), std::runtime_error);
    fs::remove_all(dir);
}

}  // TEST_SUITE("people")
