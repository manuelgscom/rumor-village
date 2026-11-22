// Loads data/world/: places.json (map coordinates), paths.json (path graph and
// walking speed) and timetable.json (where each job is at each hour), and
// computes the shortest route between every ordered pair of places.
//
// Everything is integer arithmetic and ordered containers, so two loads of the
// same files give the same World.

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/world_api.h"

namespace rumor {
namespace {

using nlohmann::json;
namespace fs = std::filesystem;

[[noreturn]] void fail(const std::string& file, const std::string& what) {
    throw std::runtime_error("world: " + file + ": " + what);
}

json read_json(const fs::path& path) {
    std::ifstream in(path);
    if (!in) fail(path.string(), "cannot open file");
    try {
        return json::parse(in);
    } catch (const json::exception& e) {
        fail(path.string(), std::string("invalid JSON: ") + e.what());
    }
}

// Largest r with r * r <= n.
std::int64_t isqrt(std::int64_t n) {
    std::int64_t lo = 0;
    std::int64_t hi = 3037000499;  // floor(sqrt(INT64_MAX))
    while (lo < hi) {
        const std::int64_t mid = lo + (hi - lo + 1) / 2;
        if (mid * mid <= n) lo = mid; else hi = mid - 1;
    }
    return lo;
}

std::int64_t distance(Point a, Point b) {
    const std::int64_t dx = a.x - b.x;
    const std::int64_t dy = a.y - b.y;
    return isqrt(dx * dx + dy * dy);
}

int read_int(const json& j, const char* name, const std::string& file) {
    const json& v = j.at(name);
    if (!v.is_number_integer()) fail(file, std::string("'") + name + "' must be an integer");
    return v.get<int>();
}

Point read_point(const json& j, const std::string& file) {
    return Point{read_int(j, "x", file), read_int(j, "y", file)};
}

std::vector<Place> load_places(const fs::path& path) {
    const json doc = read_json(path);
    const std::string file = path.string();
    std::vector<bool> seen(kPlaceCount, false);
    std::vector<Place> places(kPlaceCount);
    try {
        for (const json& entry : doc.at("places")) {
            const std::string k = entry.at("key").get<std::string>();
            const auto id = place_from_key(k);
            if (!id) fail(file, "unknown place '" + k + "'");
            if (seen[id->index()]) fail(file, "place '" + k + "' appears twice");
            seen[id->index()] = true;
            places[id->index()] = Place{*id, read_point(entry, file)};
        }
    } catch (const json::exception& e) {
        fail(file, e.what());
    }
    for (std::size_t i = 0; i < kPlaceCount; ++i) {
        if (!seen[i]) fail(file, "catalog place '" + std::string(kPlaces[i].key) + "' has no data");
    }
    return places;
}

// The path graph: nodes 0..kPlaceCount-1 are the catalog places, junctions
// follow in file order.
struct Graph {
    std::vector<Point> at;
    std::vector<std::vector<std::pair<std::size_t, std::int64_t>>> next;  // sorted by node
    std::int64_t units_per_tick = 1;
};

Graph load_graph(const fs::path& path, const std::vector<Place>& places) {
    const json doc = read_json(path);
    const std::string file = path.string();
    Graph g;
    std::map<std::string, std::size_t> node_of;
    for (const Place& p : places) {
        node_of[std::string(place_info(p.id).key)] = g.at.size();
        g.at.push_back(p.at);
    }
    try {
        g.units_per_tick = read_int(doc, "units_per_tick", file);
        if (g.units_per_tick < 1) fail(file, "units_per_tick must be at least 1");
        if (doc.contains("junctions")) {
            for (const json& entry : doc.at("junctions")) {
                const std::string k = entry.at("key").get<std::string>();
                if (!node_of.emplace(k, g.at.size()).second) {
                    fail(file, "junction '" + k + "' repeats a node key");
                }
                g.at.push_back(read_point(entry, file));
            }
        }
        g.next.resize(g.at.size());
        for (const json& edge : doc.at("edges")) {
            if (!edge.is_array() || edge.size() != 2) fail(file, "an edge must be a pair of node keys");
            std::size_t ends[2] = {};
            for (std::size_t i = 0; i < 2; ++i) {
                const std::string k = edge[i].get<std::string>();
                const auto it = node_of.find(k);
                if (it == node_of.end()) fail(file, "unknown node '" + k + "' in an edge");
                ends[i] = it->second;
            }
            if (ends[0] == ends[1]) fail(file, "edge from a node to itself");
            const std::int64_t len = distance(g.at[ends[0]], g.at[ends[1]]);
            for (std::size_t i = 0; i < 2; ++i) {
                auto& list = g.next[ends[i]];
                const std::size_t other = ends[1 - i];
                for (const auto& [n, l] : list) {
                    if (n == other) fail(file, "repeated edge");
                }
                list.emplace_back(other, len);
            }
        }
    } catch (const json::exception& e) {
        fail(file, e.what());
    }
    for (auto& list : g.next) std::sort(list.begin(), list.end());
    return g;
}

// Shortest distances and predecessors from one node. Ties go to the lowest
// node index, and only a strictly shorter path replaces a known one, so the
// result is stable.
struct Tree {
    std::vector<std::int64_t> dist;
    std::vector<std::size_t> prev;
};

constexpr std::int64_t kUnreached = std::numeric_limits<std::int64_t>::max();

Tree shortest_from(const Graph& g, std::size_t source) {
    const std::size_t n = g.at.size();
    Tree t{std::vector<std::int64_t>(n, kUnreached), std::vector<std::size_t>(n, n)};
    std::vector<bool> done(n, false);
    t.dist[source] = 0;
    for (;;) {
        std::size_t u = n;
        for (std::size_t i = 0; i < n; ++i) {
            if (!done[i] && t.dist[i] != kUnreached && (u == n || t.dist[i] < t.dist[u])) u = i;
        }
        if (u == n) break;
        done[u] = true;
        for (const auto& [v, len] : g.next[u]) {
            if (!done[v] && t.dist[u] + len < t.dist[v]) {
                t.dist[v] = t.dist[u] + len;
                t.prev[v] = u;
            }
        }
    }
    return t;
}

std::vector<Route> compute_routes(const Graph& g, const std::string& file) {
    const std::size_t n = kPlaceCount;
    std::vector<Route> routes(n * n);
    for (std::size_t a = 0; a < n; ++a) {
        const Tree t = shortest_from(g, a);
        if (a == 0) {
            for (std::size_t v = 0; v < g.at.size(); ++v) {
                if (t.dist[v] == kUnreached) fail(file, "the path graph is not connected");
            }
        }
        for (std::size_t b = a + 1; b < n; ++b) {
            Route r;
            r.from = PlaceId::from_index(a);
            r.to = PlaceId::from_index(b);
            const std::int64_t ticks = (t.dist[b] + g.units_per_tick - 1) / g.units_per_tick;
            r.ticks = static_cast<Tick>(std::max<std::int64_t>(1, ticks));
            // The graph is connected, so the walk back from b always reaches a.
            for (std::size_t v = b;; v = t.prev[v]) {
                r.path.push_back(g.at[v]);
                if (v == a) break;
            }
            std::reverse(r.path.begin(), r.path.end());

            Route back{r.to, r.from, r.ticks, std::vector<Point>(r.path.rbegin(), r.path.rend())};
            routes[a * n + b] = std::move(r);
            routes[b * n + a] = std::move(back);
        }
    }
    return routes;
}

std::array<std::array<PlaceId, 24>, kJobCount> load_timetable(const fs::path& path) {
    const json doc = read_json(path);
    const std::string file = path.string();
    std::array<std::array<PlaceId, 24>, kJobCount> table = {};
    std::vector<bool> seen(kJobCount, false);
    try {
        for (const auto& [k, hours] : doc.at("jobs").items()) {
            const auto job = from_key<Job>(k);
            if (!job) fail(file, "unknown job '" + k + "'");
            const auto j = static_cast<std::size_t>(*job);
            seen[j] = true;
            if (!hours.is_array() || hours.size() != 24) {
                fail(file, "job '" + k + "' must list 24 hours");
            }
            for (std::size_t h = 0; h < 24; ++h) {
                const std::string where = hours[h].get<std::string>();
                if (where == "home") continue;  // none: each neighbor's own home
                const auto place = place_from_key(where);
                if (!place) fail(file, "job '" + k + "': unknown place '" + where + "'");
                if (!is_public(*place)) {
                    fail(file, "job '" + k + "': '" + where + "' is not a public place (use \"home\")");
                }
                table[j][h] = *place;
            }
        }
    } catch (const json::exception& e) {
        fail(file, e.what());
    }
    for (std::size_t j = 0; j < kJobCount; ++j) {
        if (!seen[j]) fail(file, "catalog job '" + std::string(EnumKeys<Job>::keys[j]) + "' has no timetable");
    }
    return table;
}

}  // namespace

World load_world(const std::string& data_dir) {
    const fs::path dir = fs::path(data_dir) / "world";
    World w;
    w.places = load_places(dir / "places.json");
    const fs::path paths_file = dir / "paths.json";
    w.routes = compute_routes(load_graph(paths_file, w.places), paths_file.string());
    w.timetable = load_timetable(dir / "timetable.json");
    return w;
}

}  // namespace rumor
