#include <doctest/doctest.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <functional>
#include <set>
#include <stdexcept>
#include <string>

#include <nlohmann/json.hpp>

#include "core/catalog.h"
#include "core/world_api.h"

using namespace rumor;
using nlohmann::json;
namespace fs = std::filesystem;

namespace {

json read_file(const fs::path& path) {
    std::ifstream in(path);
    return json::parse(in);
}

// A copy of data/world/ in a scratch folder, with one file changed by `edit`.
// Returns the data root to pass to load_world.
fs::path broken_copy(const std::string& name, const std::string& file,
                     const std::function<void(json&)>& edit) {
    const fs::path root = fs::temp_directory_path() / ("rumor-world-test-" + name);
    fs::remove_all(root);
    fs::create_directories(root / "world");
    for (const char* f : {"places.json", "paths.json", "timetable.json"}) {
        json doc = read_file(fs::path(RUMOR_DATA_DIR) / "world" / f);
        if (file == f) edit(doc);
        std::ofstream(root / "world" / f) << doc.dump(2);
    }
    return root;
}

std::string load_error(const fs::path& root) {
    try {
        load_world(root.string());
    } catch (const std::runtime_error& e) {
        return e.what();
    }
    return "";
}

bool contains(const std::string& text, const std::string& part) {
    return text.find(part) != std::string::npos;
}

}  // namespace

TEST_SUITE("world") {

TEST_CASE("every catalog place is on the map, in catalog order") {
    const World w = load_world(RUMOR_DATA_DIR);
    REQUIRE(w.places.size() == kPlaceCount);
    std::set<std::pair<int, int>> spots;
    for (std::size_t i = 0; i < kPlaceCount; ++i) {
        CHECK(w.places[i].id == PlaceId::from_index(i));
        CHECK(w.places[i].at.x >= 0);
        CHECK(w.places[i].at.x <= 1000);
        CHECK(w.places[i].at.y >= 0);
        CHECK(w.places[i].at.y <= 700);
        spots.insert({w.places[i].at.x, w.places[i].at.y});
    }
    CHECK(spots.size() == kPlaceCount);  // no two places on the same spot
}

TEST_CASE("every pair of places has a route, and the way back is the same") {
    const World w = load_world(RUMOR_DATA_DIR);
    REQUIRE(w.routes.size() == kPlaceCount * kPlaceCount);
    Tick longest = 0;
    for (std::size_t a = 0; a < kPlaceCount; ++a) {
        for (std::size_t b = 0; b < kPlaceCount; ++b) {
            const PlaceId from = PlaceId::from_index(a);
            const PlaceId to = PlaceId::from_index(b);
            const Route& r = w.route(from, to);
            if (a == b) {
                CHECK(r.ticks == 0);
                CHECK(r.path.empty());
                continue;
            }
            CHECK(r.from == from);
            CHECK(r.to == to);
            CHECK(r.ticks >= 1);
            REQUIRE(r.path.size() >= 2);
            CHECK(r.path.front() == w.places[a].at);
            CHECK(r.path.back() == w.places[b].at);
            const Route& back = w.route(to, from);
            CHECK(back.ticks == r.ticks);
            CHECK(std::equal(r.path.begin(), r.path.end(), back.path.rbegin(), back.path.rend()));
            longest = std::max(longest, r.ticks);
        }
    }
    // Crossing the village takes a short walk, not hours.
    CHECK(longest >= 10);
    CHECK(longest <= 20);
}

TEST_CASE("route duration is the ceiling of the integer length over the speed") {
    const World w = load_world(RUMOR_DATA_DIR);
    const PlaceId square = *place_from_key("square");
    const PlaceId church = *place_from_key("church");
    const Route& r = w.route(square, church);
    // A direct edge: (500,350) to (440,290) is isqrt(7200) = 84 units, 60 per tick.
    REQUIRE(r.path.size() == 2);
    CHECK(r.ticks == 2);
}

TEST_CASE("every job has 24 hours of timetable, only public places or home") {
    const World w = load_world(RUMOR_DATA_DIR);
    std::set<PlaceId> used;
    for (std::size_t j = 0; j < kJobCount; ++j) {
        for (int h = 0; h < 24; ++h) {
            const PlaceId p = w.timetable[j][static_cast<std::size_t>(h)];
            if (h <= 6) CHECK_MESSAGE(!p.valid(), "job ", j, " out at night, hour ", h);
            if (p.valid()) {
                CHECK(is_public(p));
                used.insert(p);
            }
        }
    }
    CHECK(used.size() == kPublicPlaceCount);  // every public place gets visitors
}

TEST_CASE("the timetable does not fill the square at 21:00") {
    const World w = load_world(RUMOR_DATA_DIR);
    const PlaceId square = *place_from_key("square");
    int at_square = 0;
    for (std::size_t j = 0; j < kJobCount; ++j) {
        if (w.timetable[j][21] == square) ++at_square;
    }
    CHECK(at_square <= 2);
}

TEST_CASE("scheduled falls back to the neighbor's home") {
    const World w = load_world(RUMOR_DATA_DIR);
    const PlaceId home = *place_from_key("east_quarter");
    CHECK(w.scheduled(Job::baker, 3, home) == home);
    CHECK(w.scheduled(Job::baker, 9, home) == *place_from_key("bakery"));
}

TEST_CASE("two loads give the same world") {
    const World a = load_world(RUMOR_DATA_DIR);
    const World b = load_world(RUMOR_DATA_DIR);
    CHECK(a.places == b.places);
    CHECK(a.routes == b.routes);
    CHECK(a.timetable == b.timetable);
}

TEST_CASE("errors name the file and the problem") {
    SUBCASE("missing folder") {
        const std::string msg = load_error(fs::temp_directory_path() / "rumor-world-test-nowhere");
        CHECK(contains(msg, "places.json"));
        CHECK(contains(msg, "cannot open"));
    }
    SUBCASE("unknown place") {
        const auto root = broken_copy("unknown-place", "places.json", [](json& d) {
            d["places"].push_back({{"key", "castle"}, {"x", 1}, {"y", 1}});
        });
        CHECK(contains(load_error(root), "unknown place 'castle'"));
    }
    SUBCASE("catalog place without data") {
        const auto root = broken_copy("missing-place", "places.json", [](json& d) {
            d["places"].erase(d["places"].size() - 1);
        });
        CHECK(contains(load_error(root), "'west_quarter' has no data"));
    }
    SUBCASE("non-integer coordinate") {
        const auto root = broken_copy("float-place", "places.json", [](json& d) {
            d["places"][0]["x"] = 1.5;
        });
        CHECK(contains(load_error(root), "must be an integer"));
    }
    SUBCASE("unknown node in an edge") {
        const auto root = broken_copy("unknown-node", "paths.json", [](json& d) {
            d["edges"].push_back({"square", "harbour"});
        });
        const std::string msg = load_error(root);
        CHECK(contains(msg, "paths.json"));
        CHECK(contains(msg, "unknown node 'harbour'"));
    }
    SUBCASE("graph not connected") {
        const auto root = broken_copy("disconnected", "paths.json", [](json& d) {
            json kept = json::array();
            for (const json& e : d["edges"]) {
                if (e[0] != "chapel" && e[1] != "chapel") {
                    kept.push_back(e);
                }
            }
            d["edges"] = kept;
        });
        CHECK(contains(load_error(root), "not connected"));
    }
    SUBCASE("unknown job") {
        const auto root = broken_copy("unknown-job", "timetable.json", [](json& d) {
            d["jobs"]["pirate"] = d["jobs"]["baker"];
        });
        CHECK(contains(load_error(root), "unknown job 'pirate'"));
    }
    SUBCASE("catalog job without timetable") {
        const auto root = broken_copy("missing-job", "timetable.json", [](json& d) {
            d["jobs"].erase("retired");
        });
        CHECK(contains(load_error(root), "'retired' has no timetable"));
    }
    SUBCASE("timetable without 24 hours") {
        const auto root = broken_copy("short-day", "timetable.json", [](json& d) {
            d["jobs"]["miller"].erase(23);
        });
        CHECK(contains(load_error(root), "'miller' must list 24 hours"));
    }
    SUBCASE("home quarter in the timetable") {
        const auto root = broken_copy("quarter", "timetable.json", [](json& d) {
            d["jobs"]["clerk"][10] = "upper_quarter";
        });
        CHECK(contains(load_error(root), "not a public place"));
    }
}

}  // TEST_SUITE
