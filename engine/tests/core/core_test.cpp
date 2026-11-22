#include <doctest/doctest.h>

#include <algorithm>
#include <ostream>  // doctest prints std::string_view (MSVC: not pulled in by <string>)
#include <set>
#include <string>
#include <vector>

#include "core/catalog.h"
#include "core/decision.h"
#include "core/event.h"
#include "core/ids.h"
#include "core/population_api.h"
#include "core/rng.h"
#include "core/sha256.h"
#include "core/time.h"
#include "core/world_api.h"

using namespace rumor;

TEST_SUITE("core") {

TEST_CASE("identifiers have a fixed text form") {
    CHECK(NeighborId(17).str() == "n017");
    CHECK(NeighborId(100).str() == "n100");
    CHECK(PlaceId(3).str() == "p03");
    CHECK(FactId(1).str() == "f1");
    CHECK(ConvId(12).str() == "c12");
    CHECK(NeighborId(1234).str() == "n1234");
}

TEST_CASE("identifiers are read back only from their exact text") {
    CHECK(NeighborId::parse("n017") == NeighborId(17));
    CHECK(PlaceId::parse("p03") == PlaceId(3));
    CHECK(FactId::parse("f1") == FactId(1));
    CHECK(ConvId::parse("c12") == ConvId(12));
    for (std::uint32_t v : {1u, 9u, 10u, 99u, 100u, 999u, 1000u}) {
        CHECK(NeighborId::parse(NeighborId(v).str()) == NeighborId(v));
    }
    for (const char* bad : {"", "n", "n17", "n0017", "n000", "p3", "p003", "f01", "f0", "x017",
                            "n01a", "n-17", " n017", "n017 ", "N017"}) {
        CAPTURE(bad);
        CHECK_FALSE(NeighborId::parse(bad).has_value());
    }
    CHECK_FALSE(PlaceId::parse("n017").has_value());
    CHECK_FALSE(FactId::parse("f01").has_value());
}

TEST_CASE("identifiers: none, order and index") {
    CHECK_FALSE(NeighborId().valid());
    CHECK(NeighborId(1).valid());
    CHECK(NeighborId(2) < NeighborId(10));
    CHECK(NeighborId(7).index() == 6);
    CHECK(NeighborId::from_index(6) == NeighborId(7));
}

TEST_CASE("ticks, hours and slots") {
    CHECK(kTicksPerDay == 1440);
    const Tick t = 1 * kTicksPerDay + 21 * 60 + 15;  // day 1, 21:15
    CHECK(day_of(t) == 1);
    CHECK(hour_of_day(t) == 21);
    CHECK(minute_of_day(t) == 21 * 60 + 15);
    CHECK(slot_of(t) == 48 + 42);
    CHECK(tick_of(slot_of(t)) == 1 * kTicksPerDay + 21 * 60);
    CHECK(weekday_of(t, 1) == 2);
    CHECK(weekday_of(6 * kTicksPerDay, 1) == 0);
    for (TimeSlot s = 0; s < 3 * kSlotsPerDay; ++s) CHECK(slot_of(tick_of(s)) == s);
}

TEST_CASE("when: engine slot and model form") {
    const Tick now = 18 * 60 + 30;  // day 0, 18:30
    CHECK(to_relative(42, now) == RelativeWhen{0, 21, 0});
    CHECK(to_relative(43, now) == RelativeWhen{0, 21, 30});
    CHECK(to_relative(0, now) == RelativeWhen{0, 0, 0});     // earlier today is still today
    CHECK(to_relative(48 + 24, now) == RelativeWhen{1, 12, 0});
    CHECK_FALSE(to_relative(2 * 48, now).has_value());       // the day after tomorrow
    CHECK_FALSE(to_relative(-1, now).has_value());

    const Tick next_day = kTicksPerDay + 9 * 60;  // day 1, 09:00
    CHECK(to_relative(48 + 24, next_day) == RelativeWhen{0, 12, 0});
    CHECK_FALSE(to_relative(42, next_day).has_value());      // yesterday

    CHECK(from_relative({0, 21, 0}, now) == 42);
    CHECK(from_relative({1, 12, 0}, now) == 48 + 24);
    CHECK(from_relative({0, 21, 30}, next_day) == 48 + 43);
    CHECK_FALSE(from_relative({2, 12, 0}, now).has_value());
    CHECK_FALSE(from_relative({0, 24, 0}, now).has_value());
    CHECK_FALSE(from_relative({0, 12, 15}, now).has_value());

    // Round trip over every slot of today and tomorrow, from several moments.
    for (Tick at : {0, 480, 1439, 1440, 2000}) {
        const TimeSlot first = day_of(at) * kSlotsPerDay;
        for (TimeSlot s = first; s < first + 2 * kSlotsPerDay; ++s) {
            const auto rel = to_relative(s, at);
            REQUIRE(rel.has_value());
            CHECK(from_relative(*rel, at) == s);
        }
    }

    CHECK(clock_text(21, 0) == "21:00");
    CHECK(clock_text(9, 30) == "09:30");
}

TEST_CASE("catalog: places") {
    CHECK(kPlaceCount == 16);
    std::set<std::string_view> keys;
    for (std::size_t i = 0; i < kPlaceCount; ++i) {
        const PlaceId p = PlaceId::from_index(i);
        keys.insert(place_info(p).key);
        CHECK(place_from_key(place_info(p).key) == p);
        // Public places come first.
        CHECK(is_public(p) == (i < kPublicPlaceCount));
    }
    CHECK(keys.size() == kPlaceCount);
    CHECK(place_from_key("square") == PlaceId(1));
    CHECK_FALSE(place_from_key("plaza").has_value());
    CHECK_FALSE(is_place(PlaceId()));
    CHECK_FALSE(is_place(PlaceId(17)));
    CHECK_FALSE(is_public(PlaceId(13)));
}

TEST_CASE("catalog: enum keys go both ways") {
    CHECK(key(Job::baker) == "baker");
    CHECK(from_key<Job>("seamstress") == Job::seamstress);
    CHECK_FALSE(from_key<Job>("panadera").has_value());
    CHECK(key(Relation::friend_) == "friend");
    CHECK(from_key<Relation>("rival") == Relation::rival);
    CHECK(key(Lang::en) == "en");
    CHECK(key(Slot::amount) == "amount");
    CHECK(key(SlotState::forgotten) == "forgotten");
    CHECK(key(SlotVerdict::declared_guess) == "declared_guess");
    CHECK(key(RejectReason::unknown_fact) == "unknown_fact");
    CHECK(key(MemoryCause::doubt_dropped) == "doubt_dropped");
    CHECK(key(ConvEndReason::max_turns) == "max_turns");
    CHECK(kJobCount == 12);
    CHECK(kTraitCount == 6);
    CHECK(kRelationCount == 5);
    for (std::size_t i = 0; i < kJobCount; ++i) {
        const Job job = static_cast<Job>(i);
        CHECK(from_key<Job>(key(job)) == job);
    }
}

TEST_CASE("rng: the generator is SplitMix64") {
    // Reference outputs of SplitMix64 for the seed 1234567.
    Rng rng(1234567);
    CHECK(rng.next() == 6457827717110365317ULL);
    CHECK(rng.next() == 3203168211198807973ULL);
    CHECK(rng.next() == 9817491932198370423ULL);
    CHECK(rng.next() == 4593380528125082431ULL);
    CHECK(rng.next() == 16408922859458223821ULL);
}

TEST_CASE("rng: same seed, same sequence; values stay in range") {
    Rng a(42), b(42), c(43);
    bool differs = false;
    for (int i = 0; i < 1000; ++i) {
        const std::uint32_t x = a.below(7);
        CHECK(x == b.below(7));
        CHECK(x < 7u);
        if (x != c.below(7)) differs = true;
    }
    CHECK(differs);

    Rng r(7);
    std::vector<int> seen(6, 0);
    for (int i = 0; i < 6000; ++i) {
        const int v = r.range(10, 15);
        REQUIRE(v >= 10);
        REQUIRE(v <= 15);
        ++seen[static_cast<std::size_t>(v - 10)];
    }
    for (int count : seen) CHECK(count > 800);  // about 1000 each
    CHECK(Rng(1).below(1) == 0u);
}

TEST_CASE("rng: probabilities in parts per million") {
    Rng r(99);
    int hits = 0;
    for (int i = 0; i < 100000; ++i) {
        CHECK_FALSE(r.chance_ppm(0));
        CHECK(r.chance_ppm(kPpm));
        if (r.chance_ppm(250000)) ++hits;
    }
    CHECK(hits > 24000);
    CHECK(hits < 26000);
}

TEST_CASE("rng: shuffle and pick are reproducible") {
    std::vector<int> a = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
    std::vector<int> b = a;
    Rng ra(5), rb(5);
    ra.shuffle(a);
    rb.shuffle(b);
    CHECK(a == b);
    std::vector<int> sorted = a;
    std::sort(sorted.begin(), sorted.end());
    CHECK(sorted == std::vector<int>{1, 2, 3, 4, 5, 6, 7, 8, 9, 10});
    CHECK(a != sorted);
    CHECK(ra.pick(a) == rb.pick(b));
}

TEST_CASE("rng: derived seeds") {
    const std::uint64_t base = derive_seed(1, 480, NeighborId(17), Stream::turn);
    CHECK(base == derive_seed(1, 480, NeighborId(17), Stream::turn));
    CHECK(base == derive_seed(1, 480, 17u, Stream::turn));
    CHECK(base != derive_seed(2, 480, NeighborId(17), Stream::turn));
    CHECK(base != derive_seed(1, 481, NeighborId(17), Stream::turn));
    CHECK(base != derive_seed(1, 480, NeighborId(18), Stream::turn));
    CHECK(base != derive_seed(1, 480, NeighborId(17), Stream::plan));

    // No collisions over a run-sized grid.
    std::set<std::uint64_t> seeds;
    for (Tick t = 0; t < 200; ++t) {
        for (std::uint32_t n = 1; n <= 100; ++n) {
            seeds.insert(derive_seed(7, t, NeighborId(n), Stream::turn));
            seeds.insert(derive_seed(7, t, NeighborId(n), Stream::forget));
        }
    }
    CHECK(seeds.size() == 200u * 100u * 2u);

    // Fixed values: a change here changes every log of every seed.
    CHECK(derive_seed(1, 480, NeighborId(17), Stream::turn) == 9018740851258954654ULL);
    CHECK(derive_seed(0, 0, 0u, Stream::scenario) == 6743660515428120985ULL);
}

TEST_CASE("sha256: standard vectors") {
    CHECK(sha256_hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    CHECK(sha256_hex("abc") ==
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    CHECK(sha256_hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ==
          "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    CHECK(sha256_hex(std::string(1000, 'a')) ==
          "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
}

TEST_CASE("sha256: in pieces, the same digest as in one go") {
    std::string data;
    for (int i = 0; i < 1000; ++i) data.push_back(static_cast<char>('a' + i % 26));
    for (const std::size_t size : {0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000}) {
        const std::string_view whole(data.data(), size);
        for (const std::size_t piece : {1, 7, 63, 64, 100}) {
            Sha256 sha;
            for (std::size_t at = 0; at < size; at += piece) {
                sha.update(whole.substr(at, piece));
            }
            CHECK_MESSAGE(sha.hex() == sha256_hex(whole), "size ", size, " piece ", piece);
        }
    }
    Sha256 million;
    for (int i = 0; i < 1000; ++i) million.update(std::string(1000, 'a'));
    CHECK(million.hex() == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
}

namespace {

DecisionRequest sample_request() {
    DecisionRequest req;
    req.kind = DecisionKind::turn;
    req.seed = 111;
    req.tick = 18 * 60 + 30;
    req.weekday = 1;
    req.self = NeighborId(2);
    req.job = Job::baker;
    req.trait = Trait::gossip;
    req.place = PlaceId(2);
    req.other = NeighborId(1);
    req.relation = Relation::friend_;
    req.neighbor_count = 25;

    Belief party;
    party.fact = FactId(1);
    party.what = "party";
    party.slots[idx(Slot::where)] = {SlotState::sure, 1, NeighborId(3)};
    party.slots[idx(Slot::when)] = {SlotState::forgotten, std::nullopt, NeighborId()};
    party.told_by = NeighborId(3);
    party.heard_at = 600;
    party.told_to = {NeighborId(4), NeighborId(9)};
    req.facts.push_back(party);

    req.conversation.push_back({NeighborId(1), Act::greet, FactId(), std::nullopt});
    return req;
}

}  // namespace

TEST_CASE("fingerprint: the same situation, whatever the seed") {
    const DecisionRequest a = sample_request();
    DecisionRequest b = a;
    b.seed = 222;
    CHECK(canonical(a) == canonical(b));
    CHECK(fingerprint(a) == fingerprint(b));
    CHECK(fingerprint(a).size() == 64);
}

TEST_CASE("fingerprint: any visible change gives another one") {
    const DecisionRequest base = sample_request();
    std::set<std::string> prints = {fingerprint(base)};

    std::vector<DecisionRequest> variants(12, base);
    variants[0].kind = DecisionKind::plan;
    variants[1].tick += 30;
    variants[2].trait = Trait::shy;
    variants[3].place = PlaceId(1);
    variants[4].other = NeighborId(5);
    variants[5].relation = Relation::rival;
    variants[6].facts[0].slots[idx(Slot::when)] = {SlotState::doubt, 44, NeighborId(3)};
    variants[7].facts[0].told_to.pop_back();
    variants[8].facts[0].what = "wedding";
    variants[9].conversation.push_back({NeighborId(2), Act::greet, FactId(), std::nullopt});
    Claim claim;
    claim.slots[idx(Slot::when)] = 44;
    claim.guess[idx(Slot::when)] = true;
    variants[10].conversation.push_back({NeighborId(1), Act::tell, FactId(1), claim});
    claim.guess[idx(Slot::when)] = false;
    variants[11].conversation.push_back({NeighborId(1), Act::tell, FactId(1), claim});

    for (const DecisionRequest& v : variants) prints.insert(fingerprint(v));
    CHECK(prints.size() == variants.size() + 1);
}

TEST_CASE("world and population: lookups on plain data") {
    World world;
    world.places = {{PlaceId(1), {0, 0}}, {PlaceId(2), {30, 40}}};
    world.routes.resize(4);
    world.routes[1] = {PlaceId(1), PlaceId(2), 5, {{0, 0}, {30, 40}}};
    world.routes[2] = {PlaceId(2), PlaceId(1), 5, {{30, 40}, {0, 0}}};
    world.timetable[static_cast<std::size_t>(Job::baker)][9] = PlaceId(2);
    CHECK(world.route(PlaceId(1), PlaceId(2)).ticks == 5);
    CHECK(world.route(PlaceId(2), PlaceId(1)).path.front() == Point{30, 40});
    CHECK(world.scheduled(Job::baker, 9, PlaceId(13)) == PlaceId(2));
    CHECK(world.scheduled(Job::baker, 3, PlaceId(13)) == PlaceId(13));

    Population people;
    people.neighbors = {{NeighborId(1), "Carmen", true, Job::baker, Trait::gossip, PlaceId(13)},
                        {NeighborId(2), "Luis", false, Job::retired, Trait::sociable, PlaceId(14)},
                        {NeighborId(3), "Ana", true, Job::teacher, Trait::prudent, PlaceId(13)}};
    people.relations = {{NeighborId(1), NeighborId(2), Relation::friend_}};
    CHECK(people.at(NeighborId(2)).name == "Luis");
    CHECK(people.relation(NeighborId(1), NeighborId(2)) == Relation::friend_);
    CHECK(people.relation(NeighborId(2), NeighborId(1)) == Relation::friend_);
    CHECK(people.relation(NeighborId(1), NeighborId(3)) == Relation::acquaintance);
}

TEST_CASE("events: the tick of any event") {
    TurnEvent turn;
    turn.tick = 512;
    CHECK(event_tick(Event(turn)) == 512);
    EndEvent end;
    end.tick = 1440;
    CHECK(event_tick(Event(end)) == 1440);
}

}  // TEST_SUITE("core")
