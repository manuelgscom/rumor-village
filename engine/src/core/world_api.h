#pragma once
// The world: where each place is, how long it takes to go from one to another
// and where each job is at each hour. Implemented in src/world from the data in
// data/world/. World is plain data: tests may build a small one by hand.

#include <array>
#include <string>
#include <vector>

#include "core/catalog.h"
#include "core/ids.h"
#include "core/time.h"

namespace rumor {

// A point of the map. Integers, on a canvas of about 1000 by 700.
struct Point {
    int x = 0;
    int y = 0;

    friend bool operator==(const Point&, const Point&) = default;
};

struct Place {
    PlaceId id;
    Point at;

    friend bool operator==(const Place&, const Place&) = default;
};

// How to go from one place to another.
struct Route {
    PlaceId from;
    PlaceId to;
    Tick ticks = 0;           // duration, at least 1
    std::vector<Point> path;  // the line to draw, from `from` to `to`, both ends included

    friend bool operator==(const Route&, const Route&) = default;
};

struct World {
    // One per catalog place, in catalog order: places[p.index()].id == p.
    std::vector<Place> places;

    // One per ordered pair of different places, at from.index() * places.size()
    // + to.index(). The entries of the diagonal are empty. The route from B to
    // A is the route from A to B backwards, with the same duration.
    std::vector<Route> routes;

    // Where each job is at each hour of the day. None means "at home": each
    // neighbor's own home place.
    std::array<std::array<PlaceId, 24>, kJobCount> timetable = {};

    const Route& route(PlaceId from, PlaceId to) const {
        return routes[from.index() * places.size() + to.index()];
    }

    // Where a neighbor with this job and home should be at this hour.
    PlaceId scheduled(Job job, int hour, PlaceId home) const {
        const PlaceId place = timetable[static_cast<std::size_t>(job)][static_cast<std::size_t>(hour)];
        return place.valid() ? place : home;
    }
};

// Reads data_dir/world/. Throws std::runtime_error with a clear message when a
// file is missing or does not cover the catalog.
World load_world(const std::string& data_dir);

}  // namespace rumor
