// The model policy with a simulated model (FakeBatch) and a renderer of its
// own: no llama.cpp, no GPU. The card of the test renderer is a JSON object
// with what the simulated model needs to answer, with names and not
// identifiers, so the answers go through the same reading as a real one.
#include <doctest/doctest.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/render.h"
#include "core/log_api.h"
#include "core/metrics_api.h"
#include "core/sim_api.h"
#include "core/validate_api.h"
#include "core/world_api.h"
#include "llm/fake_batch.h"
#include "policy/answer.h"
#include "policy/model.h"

using namespace rumor;
using llm::FakeBatch;
using json = nlohmann::ordered_json;

namespace {

const std::string kData = RUMOR_DATA_DIR;

// --- Renderer and simulated model ----------------------------------------------

class TestRenderer : public Renderer {
  public:
    TestRenderer(const Vocab& vocab, const Population& population)
        : vocab_(vocab), population_(population) {}

    std::string prefix(PromptMode mode) const override {
        return "test prefix " + std::string(key(mode));
    }

    std::string grammar(DecisionKind kind) const override {
        return "root ::= " + std::string(key(kind));
    }

    // {"kind","turns","trigger","facts":[{"who","where","when","amount","doubt"}]}
    std::string card(const DecisionRequest& q) const override {
        json c;
        c["kind"] = std::string(key(q.kind));
        c["turns"] = q.conversation.size();
        c["trigger"] = q.trigger_fact;
        c["facts"] = json::array();
        for (const Belief& b : q.facts) {
            json f;
            json doubt = json::array();
            for (Slot s : kSlots) {
                const SlotBelief& slot = b.slots[idx(s)];
                json value = nullptr;
                if (slot.value) value = name(s, *slot.value, q.tick);
                if (!value.is_null() && slot.state == SlotState::doubt) {
                    doubt.push_back(std::string(key(s)));
                }
                f[std::string(key(s))] = value;
            }
            f["doubt"] = doubt;
            c["facts"].push_back(f);
        }
        return c.dump();
    }

  private:
    json name(Slot s, SlotValue v, Tick now) const {
        switch (s) {
            case Slot::who:
                return population_.at(NeighborId(static_cast<std::uint32_t>(v))).name;
            case Slot::where:
                return vocab_.place(PlaceId(static_cast<std::uint32_t>(v)));
            case Slot::when: {
                const auto rel = to_relative(v, now);
                if (!rel) return nullptr;
                return (rel->day == 0 ? vocab_.today : vocab_.tomorrow) + " " +
                       clock_text(rel->hour, rel->minute);
            }
            case Slot::amount:
                return v;
        }
        return nullptr;
    }

    const Vocab& vocab_;
    const Population& population_;
};

// What a neighbor knows of fact `number`, said faithfully: doubts marked.
json faithful_claim(const json& fact) {
    json claim;
    for (Slot s : kSlots) claim[std::string(key(s))] = fact[std::string(key(s))];
    claim["guess"] = fact["doubt"];
    return claim;
}

// A simulated villager: greets, tells, asks and says goodbye in a turn, and
// goes in a plan. The fact told or asked depends on the seed of the request.
llm::Result villager(const std::string&, const llm::Request& r) {
    const json c = json::parse(r.card);
    const json& facts = c["facts"];
    const auto pick = [&](std::uint64_t salt) {
        return static_cast<int>((r.seed / salt) % facts.size()) + 1;
    };
    json a;
    if (c["kind"] == "plan") {
        const int trigger = c["trigger"].get<int>();
        if (trigger < 1) {
            a["action"] = "none";
        } else {
            a["action"] = "go";
            a["fact"] = trigger;
            a["claim"] = faithful_claim(facts[static_cast<std::size_t>(trigger - 1)]);
        }
    } else {
        const std::size_t turns = c["turns"].get<std::size_t>();
        a["action"] = "say";
        if (turns < 2) {
            a["act"] = "greet";
            a["text"] = "Hola.";
        } else if (turns < 4 && !facts.empty()) {
            const int n = pick(1);
            a["act"] = "tell";
            a["fact"] = n;
            a["claim"] = faithful_claim(facts[static_cast<std::size_t>(n - 1)]);
            a["text"] = "¿Te has enterado?";
        } else if (turns < 5 && !facts.empty()) {
            a["act"] = "ask";
            a["fact"] = pick(7);
            a["text"] = "¿Sabes algo más?";
        } else {
            a["act"] = "bye";
            a["text"] = "Adiós.";
        }
    }
    llm::Result out;
    out.json = a.dump();
    return out;
}

// --- Runs of party-25 ---------------------------------------------------------------

// A policy that remembers every batch it was asked to decide.
class Recording : public Policy {
  public:
    explicit Recording(Policy& inner) : inner_(inner) {}
    std::string name() const override { return inner_.name(); }
    std::optional<std::string> model() const override { return inner_.model(); }
    std::vector<Decision> decide(std::span<const DecisionRequest> batch) override {
        batches.emplace_back(batch.begin(), batch.end());
        return inner_.decide(batch);
    }
    std::vector<PerfSample> take_perf() override { return inner_.take_perf(); }
    void set_visible(std::span<const NeighborId> neighbors) override {
        inner_.set_visible(neighbors);
    }

    std::vector<std::vector<DecisionRequest>> batches;

  private:
    Policy& inner_;
};

struct PartyRun {
    Log log;
    std::vector<std::vector<DecisionRequest>> requests;  // what the policy was asked
    std::string trace;
};

PartyRun run_party(FakeBatch& fake, Lang lang, TextMode text, std::uint64_t seed = 3,
                   RunControl* control = nullptr) {
    const ScenarioParams params = load_scenario(kData, "party-25", lang);
    const World world = load_world(kData);
    const Population population = make_population(kData, params.neighbors, params.layout, seed);
    const Vocab vocab = load_vocab(kData, lang);
    const TestRenderer renderer(vocab, population);
    std::ostringstream trace;
    ModelPolicyOptions options;
    options.text = text;
    options.trace = &trace;
    const std::unique_ptr<Policy> policy =
        make_model_policy(fake, renderer, vocab, population, options);
    Recording recording(*policy);

    std::ostringstream out;
    RunSink sink;
    sink.header = [&](const LogHeader& h) { out << write_header(h) << '\n'; };
    sink.event = [&](const Event& e) { out << write_event(e) << '\n'; };
    run_simulation(params, world, population, vocab, recording, seed, sink, control);

    PartyRun run;
    std::istringstream in(out.str());
    run.log = read_log(in);
    run.requests = std::move(recording.batches);
    run.trace = trace.str();
    return run;
}

// The events without what text and timing change: bubbles, generation times
// and the speed of the model.
std::vector<Event> without_text(std::vector<Event> events) {
    for (Event& e : events) {
        if (auto* t = std::get_if<TurnEvent>(&e)) {
            t->text.reset();
            t->gen.reset();
        } else if (auto* p = std::get_if<PlanEvent>(&e)) {
            p->gen.reset();
        } else if (auto* f = std::get_if<PerfEvent>(&e)) {
            *f = PerfEvent{f->tick, f->batch, 0, 0, 0};
        }
    }
    return events;
}

// Puts a list of neighbors on screen before the first tick, as the live
// server does when the camera moves.
class OnScreen : public RunControl {
  public:
    explicit OnScreen(std::vector<NeighborId> screen) : screen_(std::move(screen)) {}
    TickOrders before_tick(Tick) override {
        TickOrders orders;
        if (!sent_) orders.visible = screen_;
        sent_ = true;
        return orders;
    }

  private:
    std::vector<NeighborId> screen_;
    bool sent_ = false;
};

template <class E>
std::vector<E> events_of(const Log& log) {
    std::vector<E> out;
    for (const Event& e : log.events) {
        if (const auto* x = std::get_if<E>(&e)) out.push_back(*x);
    }
    return out;
}

// --- Hand-made decisions ---------------------------------------------------------------

constexpr Tick kTick = 600;  // day 0, 10:00

// A neighbor who knows one fact: who n003 sure, where p01 sure, when 42 in
// doubt, amount forgotten.
DecisionRequest request(DecisionKind kind, std::uint64_t seed = 1) {
    DecisionRequest q;
    q.kind = kind;
    q.seed = seed;
    q.tick = kTick;
    q.self = NeighborId(1);
    q.other = kind == DecisionKind::turn ? NeighborId(2) : NeighborId();
    q.neighbor_count = 25;
    Belief b;
    b.fact = FactId(1);
    b.what = "party";
    b.slots[idx(Slot::who)] = SlotBelief{SlotState::sure, 3, NeighborId()};
    b.slots[idx(Slot::where)] = SlotBelief{SlotState::sure, 1, NeighborId()};
    b.slots[idx(Slot::when)] = SlotBelief{SlotState::doubt, 42, NeighborId(2)};
    b.slots[idx(Slot::amount)] = SlotBelief{SlotState::forgotten, std::nullopt, NeighborId()};
    q.facts.push_back(b);
    q.trigger_fact = kind == DecisionKind::plan ? 1 : 0;
    return q;
}

// A policy over a model that answers whatever `answer` holds, in one language.
struct Bench {
    explicit Bench(Lang lang, ModelPolicyOptions options = {})
        : vocab(load_vocab(kData, lang)),
          population(make_population(kData, 25, Layout::village, 1)),
          renderer(vocab, population),
          fake([this](const std::string&, const llm::Request&) {
              llm::Result r;
              r.json = answer;
              r.truncated = truncated;
              return r;
          }),
          policy(make_model_policy(fake, renderer, vocab, population, options)) {}

    Decision one(const std::string& json_text, DecisionKind kind = DecisionKind::turn) {
        answer = json_text;
        const std::vector<DecisionRequest> qs = {request(kind)};
        std::vector<Decision> out = policy->decide(qs);
        REQUIRE(out.size() == 1);
        return out[0];
    }

    // The action the answer reads as; fails the test if it is rejected.
    Action read(const std::string& json_text, DecisionKind kind = DecisionKind::turn) {
        const Decision d = one(json_text, kind);
        CHECK(d.reject == RejectReason::none);
        return d.action;
    }

    std::string when(int day, const std::string& clock) const {
        return (day == 0 ? vocab.today : vocab.tomorrow) + " " + clock;
    }

    Vocab vocab;
    Population population;
    TestRenderer renderer;
    std::string answer;
    bool truncated = false;
    FakeBatch fake;
    std::unique_ptr<Policy> policy;
};

std::string go_where(const std::string& place, const std::string& when) {
    json a;
    a["action"] = "go";
    a["fact"] = 1;
    a["claim"] = {{"who", nullptr}, {"where", place}, {"when", when}, {"amount", nullptr},
                  {"guess", json::array()}};
    return a.dump();
}

}  // namespace

TEST_SUITE("policy_model") {

TEST_CASE("party-25 runs from start to end with the model policy, in both languages") {
    for (const Lang lang : {Lang::es, Lang::en}) {
        CAPTURE(key(lang));
        FakeBatch fake(villager);
        const PartyRun run = run_party(fake, lang, TextMode::all);
        const Log& log = run.log;

        CHECK(log.header.policy == "model");
        CHECK(log.header.model == std::optional<std::string>("fake.gguf"));
        CHECK(fake.prefix_sets() == 1);
        CHECK(fake.prefix() == "test prefix full");

        const auto ends = events_of<EndEvent>(log);
        REQUIRE(ends.size() == 1);
        CHECK(std::holds_alternative<EndEvent>(log.events.back()));
        CHECK(ends[0].rejected == 0);
        CHECK(ends[0].decisions > 100);
        CHECK(ends[0].informed > 5);

        // Every act and the plan, all accepted, all faithful: the names the
        // model wrote were read back as the identifiers of the memory.
        std::map<Act, int> acts;
        for (const TurnEvent& t : events_of<TurnEvent>(log)) {
            CHECK(t.verdict.reject == RejectReason::none);
            REQUIRE(t.gen);
            CHECK(t.gen->tokens_in > 0);
            CHECK(t.gen->tokens_out > 0);
            if (t.act) ++acts[*t.act];
            if (t.verdict.slots) {
                for (SlotVerdict v : *t.verdict.slots) CHECK_FALSE(is_failure(v));
            }
        }
        for (Act a : {Act::greet, Act::tell, Act::ask, Act::bye}) CHECK(acts[a] > 0);

        int goes = 0;
        for (const PlanEvent& p : events_of<PlanEvent>(log)) {
            CHECK(p.verdict.reject == RejectReason::none);
            REQUIRE(p.gen);
            if (p.action == ActionType::go) ++goes;
            if (p.verdict.slots) {
                for (SlotVerdict v : *p.verdict.slots) CHECK_FALSE(is_failure(v));
            }
        }
        CHECK(goes > 0);
        CHECK_FALSE(events_of<ArriveEvent>(log).empty());
        CHECK_FALSE(events_of<PerfEvent>(log).empty());

        // One trace line per decision.
        CHECK(std::count(run.trace.begin(), run.trace.end(), '\n') == ends[0].decisions);
    }
}

TEST_CASE("shuffling a batch changes neither the seeds nor the answers") {
    // A real batch of party-25: the largest one.
    FakeBatch recorder(villager);
    const PartyRun run = run_party(recorder, Lang::es, TextMode::all);
    std::vector<DecisionRequest> batch;
    for (const auto& b : run.requests) {
        if (b.size() > batch.size()) batch = b;
    }
    REQUIRE(batch.size() >= 3);

    const Vocab vocab = load_vocab(kData, Lang::es);
    const ScenarioParams params = load_scenario(kData, "party-25", Lang::es);
    const Population population = make_population(kData, params.neighbors, params.layout, 3);
    const TestRenderer renderer(vocab, population);
    FakeBatch fake(villager, 2);
    const auto policy = make_model_policy(fake, renderer, vocab, population, {});

    std::vector<std::size_t> order(batch.size());
    for (std::size_t i = 0; i < order.size(); ++i) order[i] = i;
    const std::vector<Decision> first = policy->decide(batch);

    // Reversed, then rotated by one.
    for (int round = 0; round < 2; ++round) {
        if (round == 0) {
            std::reverse(order.begin(), order.end());
        } else {
            std::rotate(order.begin(), order.begin() + 1, order.end());
        }
        std::vector<DecisionRequest> shuffled;
        for (std::size_t i : order) shuffled.push_back(batch[i]);
        fake.take_perf();
        const std::size_t before = fake.batches().size();
        const std::vector<Decision> again = policy->decide(shuffled);
        REQUIRE(again.size() == batch.size());

        // The seeds that reached the model are those of the requests.
        std::vector<llm::Request> sent;
        for (std::size_t b = before; b < fake.batches().size(); ++b) {
            for (const llm::Request& r : fake.batches()[b]) sent.push_back(r);
        }
        REQUIRE(sent.size() == shuffled.size());
        for (std::size_t k = 0; k < shuffled.size(); ++k) {
            CHECK(sent[k].seed == shuffled[k].seed);
            CHECK(sent[k].card == renderer.card(shuffled[k]));
            const std::size_t i = order[k];
            CHECK(again[k].action == first[i].action);
            CHECK(again[k].reject == first[i].reject);
        }
    }
}

TEST_CASE("a malformed answer ends in none and a cut one in truncated") {
    Bench bench(Lang::es);
    const std::vector<std::string> malformed = {
        "",
        "not json",
        "[1,2]",
        "{}",
        "{\"act\":\"greet\"}",
        "{\"action\":null}",
        "{\"action\":\"shout\"}",
        "{\"action\":\"say\",\"act\":\"whisper\"}",
        "{\"action\":\"say\",\"act\":\"greet\"} trailing",
        "{\"action\":\"say\",\"act\":\"greet\",\"mood\":\"happy\"}",
        "{\"action\":\"say\",\"act\":\"ask\",\"fact\":1.5}",
        "{\"action\":\"say\",\"act\":\"ask\",\"fact\":\"1\"}",
        "{\"action\":\"say\",\"act\":\"ask\",\"fact\":99999999999}",
        "{\"action\":\"say\",\"act\":\"greet\",\"text\":7}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":\"plaza\"}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"what\":\"fiesta\"}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"who\":\"Nadie\"}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"where\":\"luna\"}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"where\":1}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"when\":\"hoy 25:00\"}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"when\":\"hoy 21:15\"}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"when\":\"hoy 9:30\"}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"when\":\"ayer 21:00\"}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"when\":42}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"amount\":\"50\"}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"amount\":2.5}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"guess\":\"when\"}}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"guess\":[\"what\"]}}",
    };
    for (const std::string& answer : malformed) {
        CAPTURE(answer);
        const Decision d = bench.one(answer);
        CHECK(d.reject == RejectReason::malformed);
        CHECK(d.action == Action{});
        CHECK(d.gen.has_value());
        const Validated v = validate(request(DecisionKind::turn), d);
        CHECK(v.verdict.reject == RejectReason::malformed);
        CHECK(v.action.type == ActionType::none);
    }

    bench.truncated = true;
    const Decision cut = bench.one("{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"wh");
    CHECK(cut.reject == RejectReason::truncated);
    CHECK(cut.action == Action{});
    CHECK(cut.gen.has_value());
    CHECK(validate(request(DecisionKind::turn), cut).verdict.reject == RejectReason::truncated);
    // Truncated wins even over an answer that would read.
    CHECK(bench.one("{\"action\":\"none\"}").reject == RejectReason::truncated);
}

TEST_CASE("what validation rejects is read, not rejected by the policy") {
    Bench bench(Lang::es);
    const auto check = [&](const std::string& answer, DecisionKind kind, RejectReason expected) {
        CAPTURE(answer);
        const Decision d = bench.one(answer, kind);
        CHECK(d.reject == RejectReason::none);
        CHECK(validate(request(kind), d).verdict.reject == expected);
    };
    check(go_where("plaza", "hoy 21:00"), DecisionKind::turn, RejectReason::action_not_allowed);
    check("{\"action\":\"say\",\"act\":\"greet\"}", DecisionKind::plan,
          RejectReason::action_not_allowed);
    check("{\"action\":\"say\",\"act\":\"tell\",\"fact\":1}", DecisionKind::turn,
          RejectReason::bad_fields);
    check("{\"action\":\"none\",\"text\":\"...\"}", DecisionKind::turn, RejectReason::bad_fields);
    check(go_where("barrio alto", "hoy 21:00"), DecisionKind::plan, RejectReason::bad_fields);
    check("{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"amount\":-3}}",
          DecisionKind::turn, RejectReason::bad_fields);
    check("{\"action\":\"say\",\"act\":\"ask\",\"fact\":2}", DecisionKind::turn,
          RejectReason::unknown_fact);
    check("{\"action\":\"say\",\"act\":\"ask\",\"fact\":0}", DecisionKind::turn,
          RejectReason::unknown_fact);
}

TEST_CASE("malformed and truncated answers are counted in a run") {
    // One in five answers malformed, one in five cut, by the seed.
    FakeBatch fake([](const std::string& system, const llm::Request& r) {
        llm::Result out = villager(system, r);
        if (r.seed % 5 == 0) out.json = "{\"action\":\"shout\"}";
        if (r.seed % 5 == 1) {
            out.json = "{\"action\":\"say\",\"act\":";
            out.truncated = true;
        }
        return out;
    });
    const PartyRun run = run_party(fake, Lang::en, TextMode::all);

    int sent_malformed = 0, sent_truncated = 0;
    for (const auto& b : fake.batches()) {
        for (const llm::Request& r : b) {
            sent_malformed += r.seed % 5 == 0;
            sent_truncated += r.seed % 5 == 1;
        }
    }
    REQUIRE(sent_malformed > 0);
    REQUIRE(sent_truncated > 0);

    int malformed = 0, truncated = 0;
    const auto count = [&](RejectReason reason, ActionType action, const auto& gen) {
        if (reason == RejectReason::none) return;
        CHECK(action == ActionType::none);
        CHECK(gen.has_value());
        malformed += reason == RejectReason::malformed;
        truncated += reason == RejectReason::truncated;
    };
    for (const TurnEvent& t : events_of<TurnEvent>(run.log)) {
        count(t.verdict.reject, t.action, t.gen);
        if (t.verdict.reject != RejectReason::none) CHECK_FALSE(t.claim.has_value());
    }
    for (const PlanEvent& p : events_of<PlanEvent>(run.log)) count(p.verdict.reject, p.action, p.gen);
    CHECK(malformed == sent_malformed);
    CHECK(truncated == sent_truncated);

    const auto ends = events_of<EndEvent>(run.log);
    REQUIRE(ends.size() == 1);
    CHECK(ends[0].rejected == malformed + truncated);
    const json card = compute_metrics(run.log.header, run.log.events);
    CHECK(card["rejected"]["by_reason"]["malformed"] == malformed);
    CHECK(card["rejected"]["by_reason"]["truncated"] == truncated);
}

TEST_CASE("text is asked for only in turns, and never with --text none") {
    FakeBatch with_text(villager);
    const PartyRun all = run_party(with_text, Lang::es, TextMode::all);
    FakeBatch without(villager);
    const PartyRun none = run_party(without, Lang::es, TextMode::none);

    int turns = 0, plans = 0;
    for (const auto& b : with_text.batches()) {
        for (const llm::Request& r : b) {
            const bool turn = r.grammar == "root ::= turn";
            CHECK((turn || r.grammar == "root ::= plan"));
            CHECK(r.want_text == turn);
            CHECK(r.max_tokens == (turn ? kMaxTokensWithText : kMaxTokensWithoutText));
            turns += turn;
            plans += !turn;
        }
    }
    CHECK(turns > 0);
    CHECK(plans > 0);
    for (const auto& b : without.batches()) {
        for (const llm::Request& r : b) {
            CHECK_FALSE(r.want_text);
            CHECK(r.max_tokens == kMaxTokensWithoutText);
        }
    }

    // Bubbles in one, none in the other; otherwise the same run.
    int said = 0;
    for (const TurnEvent& t : events_of<TurnEvent>(all.log)) {
        if (t.action == ActionType::say) {
            CHECK(t.text.has_value());
            ++said;
        }
    }
    CHECK(said > 0);
    for (const TurnEvent& t : events_of<TurnEvent>(none.log)) CHECK_FALSE(t.text.has_value());

    CHECK(without_text(all.log.events) == without_text(none.log.events));
}

TEST_CASE("with --text camera, text only for the pairs on screen; the decisions do not change") {
    const std::vector<NeighborId> screen = {NeighborId(11), NeighborId(2), NeighborId(5)};
    const auto on_screen = [&](NeighborId n) {
        return std::find(screen.begin(), screen.end(), n) != screen.end();
    };
    FakeBatch with_text(villager);
    const PartyRun all = run_party(with_text, Lang::es, TextMode::all);
    FakeBatch watched(villager);
    OnScreen control(screen);
    const PartyRun camera = run_party(watched, Lang::es, TextMode::camera, 3, &control);
    FakeBatch unwatched(villager);
    const PartyRun blind = run_party(unwatched, Lang::es, TextMode::camera);

    int shown = 0, hidden = 0;
    for (const TurnEvent& t : events_of<TurnEvent>(camera.log)) {
        if (t.action != ActionType::say) continue;
        const bool visible = on_screen(t.who) || on_screen(t.to);
        CHECK(t.text.has_value() == visible);
        shown += visible;
        hidden += !visible;
    }
    CHECK(shown > 0);
    CHECK(hidden > 0);
    // Before the server says who is on screen, nobody is.
    for (const TurnEvent& t : events_of<TurnEvent>(blind.log)) CHECK_FALSE(t.text.has_value());
    for (const auto& b : unwatched.batches()) {
        for (const llm::Request& r : b) CHECK_FALSE(r.want_text);
    }
    // Same actions, facts and claims as with every bubble.
    CHECK(without_text(camera.log.events) == without_text(all.log.events));
    CHECK(without_text(blind.log.events) == without_text(all.log.events));
}

TEST_CASE("with --text camera, a turn asks for text when its speaker or listener is on screen") {
    ModelPolicyOptions options;
    options.text = TextMode::camera;
    Bench bench(Lang::es, options);
    const std::string greet = "{\"action\":\"say\",\"act\":\"greet\",\"text\":\"Hola.\"}";
    // The request of the bench: n001 speaks to n002.
    const auto asked = [&](std::vector<NeighborId> screen, DecisionKind kind = DecisionKind::turn) {
        bench.policy->set_visible(screen);
        const Decision d = bench.one(kind == DecisionKind::turn ? greet : "{\"action\":\"none\"}", kind);
        const llm::Request& r = bench.fake.batches().back().back();
        CHECK(r.max_tokens == (r.want_text ? kMaxTokensWithText : kMaxTokensWithoutText));
        CHECK(d.action.text.has_value() == r.want_text);
        return r.want_text;
    };

    // No list yet.
    CHECK_FALSE(bench.one(greet).action.text.has_value());
    CHECK_FALSE(bench.fake.batches().back().back().want_text);

    CHECK(asked({NeighborId(2)}));
    CHECK(asked({NeighborId(9), NeighborId(1)}));
    CHECK_FALSE(asked({NeighborId(3), NeighborId(4)}));
    CHECK_FALSE(asked({}));
    CHECK_FALSE(asked({NeighborId(1)}, DecisionKind::plan));  // plans never have text
}

TEST_CASE("every form of action is read, in both languages") {
    for (const Lang lang : {Lang::es, Lang::en}) {
        CAPTURE(key(lang));
        Bench bench(lang);
        const Vocab& vocab = bench.vocab;

        CHECK(bench.read("{\"action\":\"none\"}") == Action{});
        CHECK(bench.read("{\"action\":\"none\",\"act\":null,\"fact\":null,\"claim\":null}") ==
              Action{});

        Action greet = bench.read("{\"action\":\"say\",\"act\":\"greet\",\"text\":\"¡Hola!\"}");
        CHECK(greet.type == ActionType::say);
        CHECK(greet.act == std::optional<Act>(Act::greet));
        CHECK(greet.text == std::optional<std::string>("¡Hola!"));
        CHECK_FALSE(greet.fact);
        CHECK_FALSE(greet.claim);

        CHECK(bench.read("{\"action\":\"say\",\"act\":\"bye\"}").act == std::optional<Act>(Act::bye));

        const Action ask = bench.read("{\"action\":\"say\",\"act\":\"ask\",\"fact\":1}");
        CHECK(ask.act == std::optional<Act>(Act::ask));
        CHECK(ask.fact == std::optional<int>(1));

        // tell: every slot, names of the run read as identifiers.
        const Neighbor& who = bench.population.neighbors[2];
        json tell;
        tell["action"] = "say";
        tell["act"] = "tell";
        tell["fact"] = 1;
        tell["claim"] = {{"who", who.name},
                         {"where", vocab.places[0]},
                         {"when", bench.when(1, "09:30")},
                         {"amount", 50},
                         {"guess", {"who", "when"}}};
        tell["text"] = "...";
        const Action told = bench.read(tell.dump());
        REQUIRE(told.claim);
        CHECK(told.claim->slots[idx(Slot::who)] == std::optional<SlotValue>(3));
        CHECK(told.claim->slots[idx(Slot::where)] == std::optional<SlotValue>(1));
        CHECK(told.claim->slots[idx(Slot::when)] ==
              from_relative(RelativeWhen{1, 9, 30}, kTick));
        CHECK(told.claim->slots[idx(Slot::amount)] == std::optional<SlotValue>(50));
        CHECK(told.claim->guess == PerSlot<bool>{true, false, true, false});
        CHECK(told.text == std::optional<std::string>("..."));
        // Faithful to the memory of request(): the doubt is marked, who is sure.
        const Validated v = validate(request(DecisionKind::turn), Decision{told, {}, {}});
        CHECK(v.verdict.reject == RejectReason::none);
        REQUIRE(v.verdict.slots);
        CHECK((*v.verdict.slots)[idx(Slot::who)] == SlotVerdict::faithful);
        CHECK((*v.verdict.slots)[idx(Slot::where)] == SlotVerdict::faithful);
        CHECK((*v.verdict.slots)[idx(Slot::when)] == SlotVerdict::declared_guess);
        CHECK((*v.verdict.slots)[idx(Slot::amount)] == SlotVerdict::invented);

        // Nulls and a missing claim key are omissions; an empty guess too.
        const Action partial = bench.read(
            "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,"
            "\"claim\":{\"who\":null,\"where\":null,\"guess\":null}}");
        REQUIRE(partial.claim);
        CHECK(*partial.claim == Claim{});

        // go, to every public place, today and tomorrow.
        for (std::size_t i = 0; i < kPublicPlaceCount; ++i) {
            CAPTURE(vocab.places[i]);
            const Action go = bench.read(go_where(vocab.places[i], bench.when(0, "21:00")),
                                         DecisionKind::plan);
            CHECK(go.type == ActionType::go);
            CHECK(go.fact == std::optional<int>(1));
            REQUIRE(go.claim);
            CHECK(go.claim->slots[idx(Slot::where)] ==
                  std::optional<SlotValue>(static_cast<SlotValue>(i + 1)));
            CHECK(go.claim->slots[idx(Slot::when)] == std::optional<SlotValue>(42));
        }
        const Action late =
            bench.read(go_where(vocab.places[0], bench.when(1, "00:00")), DecisionKind::plan);
        REQUIRE(late.claim);
        CHECK(late.claim->slots[idx(Slot::when)] == std::optional<SlotValue>(48));
        const Action edge =
            bench.read(go_where(vocab.places[0], bench.when(0, "23:30")), DecisionKind::plan);
        REQUIRE(edge.claim);
        CHECK(edge.claim->slots[idx(Slot::when)] == std::optional<SlotValue>(47));

        // The words of the other language are not this run's vocabulary.
        const Vocab other = load_vocab(kData, lang == Lang::es ? Lang::en : Lang::es);
        CHECK(bench.one(go_where(other.places[0], bench.when(0, "21:00")), DecisionKind::plan)
                  .reject == RejectReason::malformed);
        CHECK(bench.one(go_where(vocab.places[0], other.today + " 21:00"), DecisionKind::plan)
                  .reject == RejectReason::malformed);
    }
}

TEST_CASE("read_answer: the policy reads every answer with it") {
    Bench bench(Lang::es);
    const DecisionRequest turn = request(DecisionKind::turn);
    const std::vector<std::string> answers = {
        "{\"action\":\"none\"}",
        "{\"action\":\"say\",\"act\":\"greet\",\"text\":\"¡Hola!\"}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"who\":null,\"where\":\"plaza\","
        "\"when\":\"hoy 22:00\",\"amount\":50,\"guess\":[\"when\"]},\"text\":\"Creo que a las diez.\"}",
        "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"where\":\"luna\"}}",
        "{\"action\":\"shout\"}",
        "not json",
    };
    for (const std::string& answer : answers) {
        CAPTURE(answer);
        const Decision direct = read_answer(answer, turn, bench.vocab, bench.population);
        CHECK_FALSE(direct.gen);
        const Decision policy = bench.one(answer);
        CHECK(policy.action == direct.action);
        CHECK(policy.reject == direct.reject);
    }
}

TEST_CASE("read_answer: any valid JSON object with the contract keys, without the grammar") {
    for (const Lang lang : {Lang::es, Lang::en}) {
        CAPTURE(key(lang));
        Bench bench(lang);
        const Vocab& vocab = bench.vocab;
        const DecisionRequest turn = request(DecisionKind::turn);
        const auto read = [&](const std::string& text) {
            CAPTURE(text);
            const Decision d = read_answer(text, turn, vocab, bench.population);
            CHECK(d.reject == RejectReason::none);
            CHECK_FALSE(d.gen);
            return d.action;
        };
        const std::string who = bench.population.neighbors[2].name;
        const std::string place = vocab.places[0];
        const std::string when = bench.when(0, "22:00");

        // The order of the contract and the grammar, compact.
        const Action expected = read(
            "{\"action\":\"say\",\"act\":\"tell\",\"fact\":1,\"claim\":{\"who\":\"" + who +
            "\",\"where\":\"" + place + "\",\"when\":\"" + when +
            "\",\"amount\":50,\"guess\":[\"who\",\"when\"]},\"text\":\"Eso dicen.\"}");
        REQUIRE(expected.claim);
        CHECK(expected.claim->slots[idx(Slot::who)] == std::optional<SlotValue>(3));
        CHECK(expected.claim->slots[idx(Slot::when)] == std::optional<SlotValue>(44));
        CHECK(expected.claim->guess == PerSlot<bool>{true, false, true, false});

        // Another key order, whitespace and new lines, guess unsorted and
        // repeated: the same action.
        CHECK(read("\n  { \"text\" : \"Eso dicen.\" ,\n \"claim\" : { \"guess\" : [ \"when\" , \"who\" , \"when\" ],"
                   " \"amount\" : 50 , \"when\" : \"" + when + "\" , \"where\" : \"" + place +
                   "\" , \"who\" : \"" + who + "\" } ,\t\"fact\" : 1 , \"act\" : \"tell\" , "
                   "\"action\" : \"say\" }\r\n") == expected);

        // Slots left out and keys with null: omissions, as in the grammar.
        const Action sparse =
            read("{\"claim\":{\"where\":\"" + place + "\"},\"action\":\"go\",\"fact\":1,\"text\":null}");
        CHECK(sparse.type == ActionType::go);
        REQUIRE(sparse.claim);
        CHECK(sparse.claim->slots[idx(Slot::where)] == std::optional<SlotValue>(1));
        CHECK_FALSE(sparse.claim->slots[idx(Slot::when)]);
        CHECK_FALSE(sparse.text);

        // A key twice: the last one is read.
        CHECK(read("{\"action\":\"say\",\"act\":\"bye\",\"act\":\"greet\"}").act ==
              std::optional<Act>(Act::greet));

        // `when` is relative to the tick of the request.
        DecisionRequest later = turn;
        later.tick = kTick + kTicksPerDay;
        const Decision next_day =
            read_answer(go_where(place, when), later, vocab, bench.population);
        REQUIRE(next_day.action.claim);
        CHECK(next_day.action.claim->slots[idx(Slot::when)] ==
              std::optional<SlotValue>(44 + kSlotsPerDay));

        // What the grammar would never let through but is still JSON of the
        // wrong shape: malformed.
        for (const std::string& bad : {
                 std::string("{\"action\":\"say\",\"act\":\"greet\"}{\"action\":\"none\"}"),
                 std::string("/* note */ {\"action\":\"none\"}"),
                 std::string("{\"action\":\"Say\",\"act\":\"greet\"}"),
                 std::string("{\"action\":\"none\",}"),
                 std::string("{\"action\":\"none\",\"reason\":null}"),
                 std::string("{\"action\":\"go\",\"fact\":1,\"claim\":{\"where\":\"" + place +
                             "\",\"confidence\":1}}"),
                 std::string("{\"action\":\"go\",\"fact\":1,\"claim\":{\"guess\":[\"when\",null]}}"),
                 std::string("{\"action\":\"go\",\"fact\":1,\"claim\":{\"amount\":50.0}}"),
                 std::string("{\"action\":\"go\",\"fact\":1,\"claim\":{\"when\":\"" + when + " \"}}"),
                 std::string("{\"action\":\"go\",\"fact\":1,\"claim\":{\"where\":\"" + place + " \"}}"),
                 std::string("{\"action\":\"go\",\"fact\":true}"),
                 std::string("\"{\\\"action\\\":\\\"none\\\"}\""),
             }) {
            CAPTURE(bad);
            const Decision d = read_answer(bad, turn, vocab, bench.population);
            CHECK(d.reject == RejectReason::malformed);
            CHECK(d.action == Action{});
            CHECK_FALSE(d.gen);
        }
    }
}

TEST_CASE("gen, perf, name, model and the prefix come from the batch") {
    ModelPolicyOptions options;
    options.prompt = PromptMode::card;
    const Vocab vocab = load_vocab(kData, Lang::es);
    const Population population = make_population(kData, 25, Layout::village, 1);
    const TestRenderer renderer(vocab, population);
    FakeBatch fake(
        [](const std::string&, const llm::Request& r) {
            llm::Result out;
            out.json = "{\"action\":\"none\"}";
            out.prompt_tokens = 100 + static_cast<int>(r.seed);
            out.output_tokens = 10 + static_cast<int>(r.seed);
            return out;
        },
        2);
    const auto policy = make_model_policy(fake, renderer, vocab, population, options);
    CHECK(policy->name() == "model");
    CHECK(policy->model() == std::optional<std::string>("fake.gguf"));
    CHECK(fake.prefix_sets() == 1);
    CHECK(fake.prefix() == "test prefix card");
    CHECK(policy->take_perf().empty());

    std::vector<DecisionRequest> qs;
    for (std::uint64_t s = 1; s <= 5; ++s) {
        qs.push_back(request(s % 2 ? DecisionKind::turn : DecisionKind::plan, s));
    }
    const std::vector<Decision> out = policy->decide(qs);
    REQUIRE(out.size() == 5);
    CHECK(fake.batches().size() == 3);
    std::int64_t clock = 0;
    for (std::size_t i = 0; i < out.size(); ++i) {
        REQUIRE(out[i].gen);
        const int s = static_cast<int>(qs[i].seed);
        CHECK(out[i].gen->tokens_in == 100 + s);
        CHECK(out[i].gen->tokens_out == 10 + s);
        CHECK(out[i].gen->t_end_ms - out[i].gen->t_start_ms == 10 + s);
        CHECK(out[i].gen->t_start_ms >= clock);
        clock = out[i].gen->t_start_ms;
    }
    const std::vector<PerfSample> perf = policy->take_perf();
    REQUIRE(perf.size() == 3);
    CHECK(perf[0].batch == 2);
    CHECK(perf[1].batch == 2);
    CHECK(perf[2].batch == 1);
    CHECK(policy->take_perf().empty());

    // Still one prefix, and an empty tick goes nowhere.
    CHECK(policy->decide({}).empty());
    CHECK(fake.batches().size() == 3);
    CHECK(fake.prefix_sets() == 1);
}

TEST_CASE("the trace has one line per decision with the card and the raw output") {
    std::ostringstream trace;
    ModelPolicyOptions options;
    options.trace = &trace;
    const Vocab vocab = load_vocab(kData, Lang::es);
    const Population population = make_population(kData, 25, Layout::village, 1);
    const TestRenderer renderer(vocab, population);
    FakeBatch fake([](const std::string&, const llm::Request& r) {
        llm::Result out;
        if (r.seed == 3) {
            out.json = "{\"action\":\"say\",\"act\":\"greet\",\"text\":\"Hola, qu\xc3";
            out.truncated = true;
        } else if (r.grammar == "root ::= turn") {
            out.json = "{\"action\":\"say\",\"act\":\"greet\",\"text\":\"Hola.\"}";
        } else {
            out.json = "{\"action\":\"none\"}";
        }
        return out;
    });
    const auto policy = make_model_policy(fake, renderer, vocab, population, options);

    // A turn with text, a plan, and a turn cut in the middle of a character.
    std::vector<DecisionRequest> qs = {request(DecisionKind::turn, 1),
                                       request(DecisionKind::plan, 2),
                                       request(DecisionKind::turn, 3)};
    qs[1].self = NeighborId(17);
    policy->decide(qs);

    std::istringstream in(trace.str());
    std::vector<json> lines;
    for (std::string line; std::getline(in, line);) lines.push_back(json::parse(line));
    REQUIRE(lines.size() == 3);
    const std::vector<std::string> keys = {"tick", "who", "kind", "card", "output", "cut",
                                           "truncated"};
    for (std::size_t i = 0; i < lines.size(); ++i) {
        std::vector<std::string> got;
        for (const auto& [k, v] : lines[i].items()) got.push_back(k);
        CHECK(got == keys);
        CHECK(lines[i]["tick"] == kTick);
        CHECK(lines[i]["card"] == renderer.card(qs[i]));
    }
    CHECK(lines[0]["who"] == "n001");
    CHECK(lines[0]["kind"] == "turn");
    CHECK(lines[0]["output"] == "{\"action\":\"say\",\"act\":\"greet\",\"text\":\"Hola.\"}");
    CHECK(lines[0]["cut"] == false);
    CHECK(lines[0]["truncated"] == false);
    CHECK(lines[1]["who"] == "n017");
    CHECK(lines[1]["kind"] == "plan");
    CHECK(lines[1]["output"] == "{\"action\":\"none\"}");
    CHECK(lines[2]["truncated"] == true);

    // Without text, the output in the trace is the cut one.
    std::ostringstream cut_trace;
    options.text = TextMode::none;
    options.trace = &cut_trace;
    FakeBatch cut_fake([](const std::string&, const llm::Request&) {
        llm::Result out;
        out.json = "{\"action\":\"say\",\"act\":\"greet\",\"text\":\"Hola.\"}";
        return out;
    });
    const auto quiet = make_model_policy(cut_fake, renderer, vocab, population, options);
    const std::vector<DecisionRequest> one = {request(DecisionKind::turn)};
    const std::vector<Decision> d = quiet->decide(one);
    CHECK(d[0].action.text == std::nullopt);
    CHECK(d[0].action.act == std::optional<Act>(Act::greet));
    const json line = json::parse(cut_trace.str());
    CHECK(line["output"] == "{\"action\":\"say\",\"act\":\"greet\"}");
    CHECK(line["cut"] == true);
}

}  // TEST_SUITE
