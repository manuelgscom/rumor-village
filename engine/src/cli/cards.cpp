// The cards of one log (cli/cards.h): the replay that rebuilds every decision
// request, the strata, and the decide and extract records.

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/render.h"
#include "card/textcheck.h"
#include "cli/cards.h"
#include "core/policy.h"
#include "core/population_api.h"
#include "core/sim_api.h"
#include "core/verdict.h"
#include "core/world_api.h"
#include "extract/prompt.h"

namespace rumor {
namespace {

// The village of `rumor extract` (cli/extract_cmd.cpp): its prompt lists the
// neighbors of a village of this size, whose names do not depend on the seed.
constexpr int kExtractNeighbors = 100;
constexpr std::uint64_t kExtractSeed = 1;

// "turn 17 (line 345)", "memory event (line 346)": where a mismatch is.
std::string event_label(const Event& event, std::size_t index) {
    const std::string line = "line " + std::to_string(index + 2);
    if (const auto* t = std::get_if<TurnEvent>(&event)) {
        return "turn " + std::to_string(t->id) + " (" + line + ")";
    }
    if (const auto* p = std::get_if<PlanEvent>(&event)) {
        return "plan " + std::to_string(p->id) + " (" + line + ")";
    }
    return "event at " + line;
}

// The first field in which two headers differ, or "" when they are equal.
std::string header_difference(const LogHeader& a, const LogHeader& b) {
    if (a.format != b.format) return "format";
    if (a.seed != b.seed) return "seed";
    if (a.scenario != b.scenario) return "scenario";
    if (a.lang != b.lang) return "lang";
    if (a.policy != b.policy) return "policy";
    if (a.model != b.model) return "model";
    if (a.params != b.params) return "params";
    if (a.tick_seconds != b.tick_seconds) return "tick_seconds";
    if (a.start_tick != b.start_tick) return "start_tick";
    if (a.start_weekday != b.start_weekday) return "start_weekday";
    if (a.places != b.places) return "places";
    if (a.routes != b.routes) return "routes";
    if (a.neighbors != b.neighbors) return "neighbors";
    if (a.relations != b.relations) return "relations";
    return "";
}

// Number (from 1) of a fact in the request.
int fact_number(const DecisionRequest& q, FactId fact, const std::string& where) {
    for (std::size_t i = 0; i < q.facts.size(); ++i) {
        if (q.facts[i].fact == fact) return static_cast<int>(i) + 1;
    }
    throw std::runtime_error(where + ": fact " + fact.str() + " is not in the rebuilt request");
}

// A rebuilt request against the `turn` or `plan` that the log recorded for it.
void check_request(const DecisionRequest& q, DecisionKind kind, Tick tick, NeighborId who,
                   const std::string& card, const std::string& where) {
    if (q.kind != kind || q.tick != tick || q.self != who) {
        throw std::runtime_error(where + ": the replay asks a " + std::string(key(q.kind)) +
                                 " of " + q.self.str() + " at tick " + std::to_string(q.tick));
    }
    const std::string rebuilt = fingerprint(q);
    if (rebuilt != card) {
        throw std::runtime_error(where + ": the rebuilt card has fingerprint " + rebuilt +
                                 ", the log " + card);
    }
}

// The decision a `turn` recorded. A rejected one comes back with its reason
// (validation gives it back first); otherwise the action as proposed.
Decision turn_decision(const DecisionRequest& q, const TurnEvent& t, const std::string& where) {
    if (q.other != t.to) {
        throw std::runtime_error(where + ": the replay puts " + q.other.str() + " in front, the log " +
                                 t.to.str());
    }
    Decision d;
    d.gen = t.gen;
    if (t.verdict.reject != RejectReason::none) {
        d.reject = t.verdict.reject;
        return d;
    }
    d.action.type = t.action;
    d.action.act = t.act;
    if (t.fact.valid()) d.action.fact = fact_number(q, t.fact, where);
    d.action.claim = t.claim;
    d.action.text = t.text;
    return d;
}

// The decision a `plan` recorded. `fact` of a plan without `go` is the fact
// that prompted it, not part of the action.
Decision plan_decision(const DecisionRequest& q, const PlanEvent& p, const std::string& where) {
    Decision d;
    d.gen = p.gen;
    if (p.verdict.reject != RejectReason::none) {
        d.reject = p.verdict.reject;
        return d;
    }
    d.action.type = p.action;
    if (p.action == ActionType::go) {
        if (!p.fact.valid()) throw std::runtime_error(where + ": a go without fact");
        d.action.fact = fact_number(q, p.fact, where);
        d.action.claim = p.claim;
    }
    return d;
}

// One rebuilt request and the index of its event in the log.
struct Asked {
    DecisionRequest request;
    std::size_t event = 0;
};

// Answers each request with the next decision of the log, after checking that
// it is the same request; hands back the `perf` samples of the log; names the
// policy and the model of the header. Keeps every request it is asked.
class ReplayPolicy final : public Policy {
  public:
    explicit ReplayPolicy(const Log& log) : log_(log) {
        for (std::size_t i = 0; i < log.events.size(); ++i) {
            const Event& e = log.events[i];
            if (std::holds_alternative<TurnEvent>(e) || std::holds_alternative<PlanEvent>(e)) {
                decisions_.push_back(i);
            } else if (const auto* perf = std::get_if<PerfEvent>(&e)) {
                perf_[perf->tick].push_back(
                    PerfSample{perf->batch, perf->tokens_per_s, perf->decisions_per_s_milli, perf->vram_mb});
            }
        }
    }

    std::string name() const override { return log_.header.policy; }
    std::optional<std::string> model() const override { return log_.header.model; }

    std::vector<Decision> decide(std::span<const DecisionRequest> batch) override {
        std::vector<Decision> answers;
        for (const DecisionRequest& q : batch) {
            if (next_ >= decisions_.size()) {
                throw std::runtime_error("the replay asks a " + std::string(key(q.kind)) + " of " +
                                         q.self.str() + " at tick " + std::to_string(q.tick) +
                                         " after the last decision of the log");
            }
            const std::size_t index = decisions_[next_++];
            const Event& e = log_.events[index];
            const std::string where = event_label(e, index);
            if (const auto* t = std::get_if<TurnEvent>(&e)) {
                check_request(q, DecisionKind::turn, t->tick, t->who, t->card, where);
                answers.push_back(turn_decision(q, *t, where));
            } else {
                const auto& p = std::get<PlanEvent>(e);
                check_request(q, DecisionKind::plan, p.tick, p.who, p.card, where);
                answers.push_back(plan_decision(q, p, where));
            }
            asked_.push_back(Asked{q, index});
            tick_ = q.tick;
        }
        return answers;
    }

    std::vector<PerfSample> take_perf() override {
        const auto it = perf_.find(tick_);
        if (it == perf_.end()) return {};
        std::vector<PerfSample> samples = std::move(it->second);
        perf_.erase(it);
        return samples;
    }

    std::vector<Asked>& asked() { return asked_; }

  private:
    const Log& log_;
    std::vector<std::size_t> decisions_;  // indexes of the turns and plans, in order
    std::map<Tick, std::vector<PerfSample>> perf_;
    std::size_t next_ = 0;
    Tick tick_ = 0;
    std::vector<Asked> asked_;
};

// Replays the run and checks it against the log; returns every request, in
// the order of the log.
std::vector<Asked> replay(const Log& log, const ScenarioParams& params, const World& world,
                          const Population& population, const Vocab& vocab) {
    ReplayPolicy policy(log);
    std::size_t next = 0;
    RunSink sink;
    sink.header = [&](const LogHeader& header) {
        const std::string field = header_difference(header, log.header);
        if (!field.empty()) {
            throw std::runtime_error("header: the replay gives another '" + field + "'");
        }
    };
    sink.event = [&](const Event& event) {
        if (next >= log.events.size()) {
            throw std::runtime_error("the replay goes on after the end of the log: " +
                                     write_event(event));
        }
        const Event& want = log.events[next];
        if (event != want) {
            throw std::runtime_error(event_label(want, next) + ": the replay gives " +
                                     write_event(event) + " and the log has " + write_event(want));
        }
        ++next;
    };
    run_simulation(params, world, population, vocab, policy, log.header.seed, sink);
    if (next != log.events.size()) {
        throw std::runtime_error(event_label(log.events[next], next) +
                                 ": the log goes on after the end of the replay");
    }
    return std::move(policy.asked());
}

// The names the text detector looks for, from the header (as `rumor textcheck`).
TextCheckContext text_context(const LogHeader& header) {
    TextCheckContext context;
    context.lang = header.lang;
    context.places.resize(kPlaceCount);
    for (const HeaderPlace& p : header.places) {
        if (is_place(p.id)) context.places[p.id.index()] = p.name;
    }
    context.neighbors.resize(header.neighbors.size());
    for (const Neighbor& n : header.neighbors) {
        if (n.id.valid() && n.id.index() < context.neighbors.size()) {
            context.neighbors[n.id.index()] = n.name;
        }
    }
    return context;
}

bool blank(const std::string& text) { return text.find_first_not_of(" \t\r\n") == std::string::npos; }

// The fact a `tell` delivered: its claim without the failed slots and without
// guess marks, and the `what` of the fact.
Fact delivered_fact(const DecisionRequest& q, const TurnEvent& t) {
    const Belief& belief = q.facts[static_cast<std::size_t>(fact_number(q, t.fact, "")) - 1];
    Fact fact;
    fact.id = belief.fact;
    fact.what = belief.what;
    for (Slot s : kSlots) {
        const std::size_t i = idx(s);
        fact.slots[i] = t.claim->slots[i];
        if (t.verdict.slots && is_failure((*t.verdict.slots)[i])) fact.slots[i].reset();
    }
    return fact;
}

}  // namespace

std::vector<Stratum> decide_strata(const DecisionRequest& request) {
    bool forgotten = false, doubt = false, told = false;
    for (const Belief& b : request.facts) {
        for (const SlotBelief& s : b.slots) {
            forgotten = forgotten || s.state == SlotState::forgotten;
            doubt = doubt || s.state == SlotState::doubt;
        }
        for (NeighborId n : b.told_to) told = told || (request.other.valid() && n == request.other);
    }
    std::vector<Stratum> strata;
    if (forgotten) strata.push_back(Stratum::forgotten);
    if (doubt) strata.push_back(Stratum::doubt);
    if (told && request.kind == DecisionKind::turn) strata.push_back(Stratum::already_told);
    if (request.other.valid() && request.relation == Relation::rival) {
        strata.push_back(Stratum::enemy);
    }
    if (request.kind == DecisionKind::plan) strata.push_back(Stratum::plan);
    if (strata.empty()) strata.push_back(Stratum::common);
    // Tags, after the others. Something to tell: a fact the card marks as not
    // yet told to the neighbor in front (card/render.cpp prints that line when
    // the neighbor in front is not the one who told it).
    if (request.kind == DecisionKind::turn && request.other.valid()) {
        for (const Belief& b : request.facts) {
            const bool told_here = std::find(b.told_to.begin(), b.told_to.end(), request.other) !=
                                   b.told_to.end();
            if (b.told_by != request.other && !told_here) {
                strata.push_back(Stratum::untold);
                break;
            }
        }
    }
    // Nothing said yet in this conversation.
    if (request.kind == DecisionKind::turn && request.conversation.empty()) {
        strata.push_back(Stratum::opening);
    }
    return strata;
}

std::string extract_prefix(const std::string& data_dir, Lang lang) {
    const Vocab vocab = load_vocab(data_dir, lang);
    const Population population =
        make_population(data_dir, kExtractNeighbors, Layout::village, kExtractSeed);
    return extraction::system_message(data_dir, vocab, population);
}

std::string write_prefix(const CardPrefix& prefix) {
    nlohmann::ordered_json line;
    line["prefix"] = prefix.prefix;
    line["task"] = std::string(key(prefix.task));
    line["lang"] = std::string(key(prefix.lang));
    line["text"] = prefix.text;
    return line.dump();
}

CardSet build_cards(const Log& log, const std::string& log_path, const std::string& data_dir,
                    bool rival_twins) {
    const LogHeader& header = log.header;
    const ScenarioParams params = [&] {
        ScenarioParams p = load_scenario(data_dir, header.scenario, header.lang);
        // The character of the village (contract, section 7) only travels in
        // the header when it is not 0.
        for (const auto& [key, value] : header.params) {
            if (key == "trait_mix") p.trait_mix = static_cast<int>(value);
        }
        return p;
    }();
    const World world = load_world(data_dir);
    const Population population =
        make_population(data_dir, params.neighbors, params.layout, header.seed, params.trait_mix);
    const Vocab vocab = load_vocab(data_dir, header.lang);
    const std::vector<Asked> asked = replay(log, params, world, population, vocab);

    const std::unique_ptr<Renderer> renderer = make_renderer(data_dir, vocab, population);
    const CardPrefix decide_prefix = [&] {
        CardPrefix p{"", CardTask::decide, header.lang, renderer->prefix(PromptMode::full)};
        p.prefix = prefix_id(p.text);
        return p;
    }();
    const CardPrefix extract = [&] {
        CardPrefix p{"", CardTask::extract, header.lang, extract_prefix(data_dir, header.lang)};
        p.prefix = prefix_id(p.text);
        return p;
    }();

    const CardVillage village{header.scenario, header.seed, params.neighbors, params.layout};
    const auto base = [&](CardTask task, Tick tick, NeighborId neighbor, std::optional<int> event) {
        CardRecord r;
        r.task = task;
        r.lang = header.lang;
        r.prefix = task == CardTask::decide ? decide_prefix.prefix : extract.prefix;
        r.source = CardSource{log_path, header.policy, header.model, header.scenario, header.seed,
                              tick, neighbor, event, std::nullopt};
        r.state.village = village;
        return r;
    };
    const auto extract_card = [&](const std::string& text, Tick tick, NeighborId neighbor,
                                  std::optional<int> event, std::optional<Fact> fact) {
        CardRecord r = base(CardTask::extract, tick, neighbor, event);
        r.strata = {Stratum::extract};
        r.card = text;
        r.state.tick = tick;
        r.state.fact = std::move(fact);
        set_identity(r);
        return r;
    };

    TextCheckContext context = text_context(header);
    CardSet set;
    std::size_t next = 0;  // into asked, which follows the order of the log
    for (std::size_t i = 0; i < log.events.size(); ++i) {
        const Event& e = log.events[i];
        if (const auto* inj = std::get_if<InjectEvent>(&e)) {
            if (inj->text && !blank(*inj->text)) {
                set.cards.push_back(extract_card(*inj->text, inj->tick, NeighborId(), std::nullopt,
                                                 Fact{inj->fact, inj->what, inj->slots}));
            }
            continue;
        }
        if (!std::holds_alternative<TurnEvent>(e) && !std::holds_alternative<PlanEvent>(e)) continue;
        if (next >= asked.size() || asked[next].event != i) {
            throw std::runtime_error(event_label(e, i) + ": no rebuilt request");  // never: replay checked it
        }
        const DecisionRequest& q = asked[next++].request;
        const auto* t = std::get_if<TurnEvent>(&e);
        const auto decide_card = [&](const DecisionRequest& request,
                                     std::optional<CardVariant> variant) {
            CardRecord r =
                base(CardTask::decide, q.tick, q.self, t ? t->id : std::get<PlanEvent>(e).id);
            r.source.variant = variant;
            r.kind = request.kind;
            r.strata = decide_strata(request);
            r.card = renderer->card(request);
            r.state.request = request;
            set_identity(r);
            return r;
        };
        set.cards.push_back(decide_card(q, std::nullopt));

        // Its rival twin: the same turn with a rival in front. It did not
        // happen, so it has no fingerprint in the log to match.
        if (rival_twins && t && q.other.valid() && q.relation != Relation::rival) {
            DecisionRequest twin = q;
            twin.relation = Relation::rival;
            set.cards.push_back(decide_card(twin, CardVariant::rival));
        }

        // The text of a tell that was applied, unless it contradicts its claim.
        if (!t || t->act != Act::tell || t->verdict.reject != RejectReason::none || !t->claim ||
            !t->text || blank(*t->text)) {
            continue;
        }
        context.speaker = t->who;
        context.listener = t->to;
        if (check_text(context, *t->claim, t->tick, *t->text).any()) continue;
        set.cards.push_back(extract_card(*t->text, t->tick, t->who, t->id, delivered_fact(q, *t)));
    }

    bool any_decide = false, any_extract = false;
    for (const CardRecord& r : set.cards) {
        (r.task == CardTask::decide ? any_decide : any_extract) = true;
    }
    if (any_decide) set.prefixes.push_back(decide_prefix);
    if (any_extract) set.prefixes.push_back(extract);
    return set;
}

}  // namespace rumor
