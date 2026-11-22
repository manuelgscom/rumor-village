// The packages together: baseline against the real validation, real runs
// through the log reader and the metrics, and the catalog against the data.
#include <doctest/doctest.h>

#include <cstdint>
#include <set>
#include <sstream>
#include <string>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/log_api.h"
#include "core/metrics_api.h"
#include "core/policy.h"
#include "core/population_api.h"
#include "core/rng.h"
#include "core/sim_api.h"
#include "core/validate_api.h"
#include "core/world_api.h"

using namespace rumor;

namespace {

const int kNeighbors = 25;

SlotValue random_value(Rng& rng, Slot slot) {
    switch (slot) {
        case Slot::who: return rng.range(1, kNeighbors);
        case Slot::where: return rng.range(1, static_cast<int>(kPublicPlaceCount));
        case Slot::when: return rng.range(0, 2 * kSlotsPerDay - 1);
        case Slot::amount: return rng.range(0, 200);
    }
    return 0;
}

NeighborId random_neighbor(Rng& rng) {
    return NeighborId(static_cast<std::uint32_t>(rng.range(1, kNeighbors)));
}

Belief random_belief(Rng& rng, FactId fact) {
    Belief belief;
    belief.fact = fact;
    belief.what = "party";
    for (Slot slot : kSlots) {
        SlotBelief& b = belief.slots[idx(slot)];
        switch (rng.below(4)) {
            case 0: b = {SlotState::unknown, std::nullopt, NeighborId()}; break;
            case 1: b = {SlotState::sure, random_value(rng, slot), random_neighbor(rng)}; break;
            case 2: b = {SlotState::doubt, random_value(rng, slot), random_neighbor(rng)}; break;
            default: b = {SlotState::forgotten, std::nullopt, NeighborId()}; break;
        }
    }
    if (rng.below(2) == 0) belief.told_by = random_neighbor(rng);
    belief.heard_at = rng.range(0, 600);
    std::set<NeighborId> told;
    for (std::uint32_t i = rng.below(4); i > 0; --i) told.insert(random_neighbor(rng));
    belief.told_to.assign(told.begin(), told.end());
    return belief;
}

// Any situation the simulation could produce, and a few it could not.
DecisionRequest random_request(Rng& rng) {
    DecisionRequest req;
    req.kind = rng.below(4) == 0 ? DecisionKind::plan : DecisionKind::turn;
    req.seed = rng.next();
    req.tick = rng.range(480, 1439);
    req.weekday = 1;
    req.self = random_neighbor(rng);
    req.job = static_cast<Job>(rng.below(static_cast<std::uint32_t>(kJobCount)));
    req.trait = static_cast<Trait>(rng.below(static_cast<std::uint32_t>(kTraitCount)));
    req.place = PlaceId(static_cast<std::uint32_t>(rng.range(1, static_cast<int>(kPublicPlaceCount))));
    do {
        req.other = random_neighbor(rng);
    } while (req.other == req.self);
    req.relation = static_cast<Relation>(rng.below(static_cast<std::uint32_t>(kRelationCount)));
    req.neighbor_count = kNeighbors;

    const std::uint32_t facts = rng.below(4);
    for (std::uint32_t i = 0; i < facts; ++i) req.facts.push_back(random_belief(rng, FactId(i + 1)));

    const std::uint32_t turns = rng.below(6);
    for (std::uint32_t i = 0; i < turns; ++i) {
        ConvEntry entry;
        entry.speaker = rng.below(2) == 0 ? req.self : req.other;
        entry.act = static_cast<Act>(rng.below(4));
        if ((entry.act == Act::tell || entry.act == Act::ask) && !req.facts.empty()) {
            entry.fact = rng.pick(req.facts).fact;
            if (entry.act == Act::tell) {
                Claim claim;
                for (Slot slot : kSlots) {
                    if (rng.below(2) == 0) {
                        claim.slots[idx(slot)] = random_value(rng, slot);
                        claim.guess[idx(slot)] = rng.below(3) == 0;
                    }
                }
                entry.claim = claim;
            }
        } else if (entry.act == Act::tell || entry.act == Act::ask) {
            entry.act = Act::greet;
        }
        req.conversation.push_back(entry);
    }

    if (req.kind == DecisionKind::plan) {
        // Mostly a valid number; sometimes 0 or one past the end.
        req.trigger_fact = rng.range(0, static_cast<int>(req.facts.size()) + 1);
        if (rng.below(2) == 0) req.other = NeighborId();
    }
    return req;
}

Log run(const std::string& scenario, Lang lang, std::uint64_t seed, std::string* text = nullptr) {
    RunOptions options;
    options.data_dir = RUMOR_DATA_DIR;
    options.scenario = scenario;
    options.lang = lang;
    options.seed = seed;
    std::ostringstream out;
    run_to_stream(options, out);
    if (text) *text = out.str();
    std::istringstream in(out.str());
    return read_log(in);
}

}  // namespace

TEST_SUITE("integration") {

TEST_CASE("the baseline never proposes what validation rejects or strips") {
    const auto policy = make_baseline_policy();
    Rng rng(20261112);
    int claims = 0;
    for (int i = 0; i < 20000; ++i) {
        const DecisionRequest req = random_request(rng);
        const std::vector<Decision> answers = policy->decide(std::span<const DecisionRequest>(&req, 1));
        REQUIRE(answers.size() == 1);
        const Validated v = validate(req, answers[0]);
        CAPTURE(canonical(req));
        REQUIRE(v.verdict.reject == RejectReason::none);
        REQUIRE(v.action == answers[0].action);  // nothing removed from the claim
        if (v.verdict.slots) {
            ++claims;
            for (Slot slot : kSlots) {
                const SlotVerdict verdict = (*v.verdict.slots)[idx(slot)];
                REQUIRE_FALSE(is_failure(verdict));
                REQUIRE(verdict != SlotVerdict::hardened_doubt);
            }
        }
    }
    CHECK(claims > 1000);  // the generator does exercise tell and go
}

TEST_CASE("a real run goes through the reader and back to the same bytes") {
    for (const char* scenario : {"party-25", "telephone-20"}) {
        CAPTURE(scenario);
        std::string text;
        const Log log = run(scenario, Lang::es, 1, &text);

        std::string again = write_header(log.header) + "\n";
        for (const Event& event : log.events) again += write_event(event) + "\n";
        CHECK(again == text);

        // In tick order, closed by `end`.
        REQUIRE_FALSE(log.events.empty());
        Tick last = 0;
        for (const Event& event : log.events) {
            CHECK(event_tick(event) >= last);
            last = event_tick(event);
        }
        CHECK(std::holds_alternative<EndEvent>(log.events.back()));
        CHECK(log.header.policy == "baseline");
        CHECK_FALSE(log.header.model.has_value());
    }
}

TEST_CASE("a real run is coherent: ids, cards, conversations and memory causes") {
    const Log log = run("party-25", Lang::es, 1);
    std::set<int> decision_ids;
    std::set<ConvId> open;
    int next_id = 1;
    int turns = 0, plans = 0, conversations = 0;
    for (const Event& event : log.events) {
        if (const auto* turn = std::get_if<TurnEvent>(&event)) {
            CHECK(turn->id == next_id++);
            decision_ids.insert(turn->id);
            CHECK(turn->card.size() == 64);
            CHECK(open.count(turn->conv) == 1);
            CHECK_FALSE(turn->text.has_value());  // the baseline writes no text
            CHECK_FALSE(turn->gen.has_value());
            ++turns;
        } else if (const auto* plan = std::get_if<PlanEvent>(&event)) {
            CHECK(plan->id == next_id++);
            decision_ids.insert(plan->id);
            CHECK(plan->card.size() == 64);
            ++plans;
        } else if (const auto* start = std::get_if<ConvStartEvent>(&event)) {
            CHECK(open.insert(start->conv).second);
            CHECK(is_public(start->place));
            ++conversations;
        } else if (const auto* end = std::get_if<ConvEndEvent>(&event)) {
            CHECK(open.erase(end->conv) == 1);
        } else if (const auto* memory = std::get_if<MemoryEvent>(&event)) {
            if (memory->cause == MemoryCause::told) {
                CHECK(decision_ids.count(memory->turn) == 1);
            } else {
                CHECK(memory->turn == 0);
            }
            const bool has_value =
                memory->state == SlotState::sure || memory->state == SlotState::doubt;
            CHECK(memory->value.has_value() == has_value);
        } else if (std::holds_alternative<PerfEvent>(event)) {
            FAIL("the baseline must not emit perf events");
        }
    }
    CHECK(open.empty());  // every conversation ends by itself before the run does
    const EndEvent& end = std::get<EndEvent>(log.events.back());
    CHECK(end.turns == turns);
    CHECK(end.plans == plans);
    CHECK(end.decisions == turns + plans);
    CHECK(end.conversations == conversations);
    CHECK(end.rejected == 0);
    CHECK(turns > 0);
}

TEST_CASE("the metrics of a real run agree with its log") {
    for (const char* scenario : {"party-25", "telephone-20"}) {
        CAPTURE(scenario);
        const Log log = run(scenario, Lang::en, 2);
        const nlohmann::ordered_json card = compute_metrics(log.header, log.events);
        const EndEvent& end = std::get<EndEvent>(log.events.back());

        CHECK(card.at("scenario") == scenario);
        CHECK(card.at("decisions").at("total") == end.decisions);
        CHECK(card.at("decisions").at("turns") == end.turns);
        CHECK(card.at("decisions").at("plans") == end.plans);
        CHECK(card.at("reach").at("informed") == end.informed);
        CHECK(card.at("courtesy").at("conversations") == end.conversations);
        // The baseline has no model failures.
        CHECK(card.at("rejected").at("count") == 0);
        CHECK(card.at("invented").at("count") == 0);
        CHECK(card.at("contradictions").at("count") == 0);
        CHECK(card.at("hardened_doubts").at("count") == 0);
        CHECK(card.at("incoherent_text").is_null());
        CHECK(card.at("performance").is_null());
        CHECK(card.at("reach").at("informed").get<int>() >= 1);
        const int informed = card.at("reach").at("informed").get<int>();
        CHECK(card.at("reach").at("correct").get<int>() +
                  card.at("reach").at("incomplete").get<int>() +
                  card.at("reach").at("wrong").get<int>() == informed);
    }
}

TEST_CASE("the data of the repo covers the catalog") {
    const World world = load_world(RUMOR_DATA_DIR);
    CHECK(world.places.size() == kPlaceCount);
    for (Lang lang : {Lang::es, Lang::en}) {
        const Vocab vocab = load_vocab(RUMOR_DATA_DIR, lang);
        std::set<std::string> names;
        for (std::size_t i = 0; i < kPlaceCount; ++i) {
            CHECK_FALSE(vocab.places[i].empty());
            names.insert(vocab.places[i]);
        }
        CHECK(names.size() == kPlaceCount);  // the model tells places apart by name
        REQUIRE(vocab.what.size() == kWhatKeys.size());
        for (std::size_t i = 0; i < kWhatKeys.size(); ++i) {
            CHECK(vocab.what[i].first == kWhatKeys[i]);
            CHECK_FALSE(vocab.what[i].second.empty());
        }
        CHECK_FALSE(vocab.today.empty());
        CHECK_FALSE(vocab.tomorrow.empty());
    }
    for (int count : {100, 25, 20}) {
        const Population people = make_population(RUMOR_DATA_DIR, count, Layout::village, 1);
        CHECK(people.neighbors.size() == static_cast<std::size_t>(count));
    }
    for (const char* scenario : {"party-100", "party-25", "telephone-20"}) {
        const ScenarioParams params = load_scenario(RUMOR_DATA_DIR, scenario, Lang::es);
        CHECK(params.name == scenario);
        CHECK_FALSE(params.injections.empty());
    }
}

}  // TEST_SUITE("integration")
