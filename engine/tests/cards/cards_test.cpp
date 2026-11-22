// Tests of `rumor cards` (cli/cards.h): the replay of a baseline run and of a
// run with texts, the records it writes, the strata, a tampered log and the
// twin runs in both languages.

#include <doctest/doctest.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <span>
#include <sstream>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/record.h"
#include "cli/cards.h"
#include "cli/usage.h"
#include "core/log_api.h"
#include "core/policy.h"
#include "core/population_api.h"
#include "core/sim_api.h"
#include "core/world_api.h"

namespace rumor {
namespace {

namespace fs = std::filesystem;

// The baseline, with a text on every `say` and a generation on every answer,
// and one perf sample per batch: what a model log carries. Every other tell
// with a place says another place (an incoherent text, "..., seguro"); the
// rest say their own place or no value.
class TextPolicy final : public Policy {
  public:
    explicit TextPolicy(const Vocab& vocab) : vocab_(vocab), base_(make_baseline_policy()) {}
    std::string name() const override { return "model"; }
    std::optional<std::string> model() const override { return "fake.gguf"; }
    std::vector<Decision> decide(std::span<const DecisionRequest> batch) override {
        std::vector<Decision> out = base_->decide(batch);
        for (Decision& d : out) {
            d.gen = Generation{clock_, clock_ + 7, 300, 20};
            clock_ += 10;
            if (d.action.type != ActionType::say) continue;
            d.action.text = "Ya sabes cómo es esto.";
            const auto& claim = d.action.claim;
            if (claim && claim->slots[idx(Slot::where)]) {
                const std::size_t where = static_cast<std::size_t>(*claim->slots[idx(Slot::where)]);
                const std::size_t next = where % kPublicPlaceCount;  // index of the next public place
                d.action.text = ++tells_ % 2 ? "Es en la " + vocab_.places[next] + ", seguro."
                                             : "Es en la " + vocab_.places[where - 1] + ", de verdad.";
            }
        }
        perf_.push_back(PerfSample{static_cast<int>(batch.size()), 100, 2500, 4000});
        return out;
    }
    std::vector<PerfSample> take_perf() override { return std::move(perf_); }

  private:
    const Vocab& vocab_;
    std::unique_ptr<Policy> base_;
    std::int64_t clock_ = 0;
    int tells_ = 0;
    std::vector<PerfSample> perf_;
};

// A whole run log, as `rumor run` writes it.
std::string run_log(const std::string& scenario, Lang lang, std::uint64_t seed, bool texts = false,
                    const std::string& data = RUMOR_DATA_DIR) {
    const ScenarioParams params = load_scenario(data, scenario, lang);
    const World world = load_world(data);
    const Population population = make_population(data, params.neighbors, params.layout, seed);
    const Vocab vocab = load_vocab(data, lang);
    std::unique_ptr<Policy> policy =
        texts ? std::unique_ptr<Policy>(new TextPolicy(vocab)) : make_baseline_policy();
    std::ostringstream out;
    RunSink sink;
    sink.header = [&](const LogHeader& h) { out << write_header(h) << '\n'; };
    sink.event = [&](const Event& e) { out << write_event(e) << '\n'; };
    run_simulation(params, world, population, vocab, *policy, seed, sink);
    return out.str();
}

fs::path scratch(const std::string& name) {
    const fs::path dir = fs::temp_directory_path() / "rumor-cards-test";
    fs::create_directories(dir);
    return dir / name;
}

void write_file(const fs::path& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
    REQUIRE(out.good());
}

std::string read_file(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

std::vector<std::string> lines_of(const std::string& text) {
    std::vector<std::string> lines;
    std::istringstream in(text);
    for (std::string line; std::getline(in, line);) lines.push_back(line);
    return lines;
}

Log parse_log(const std::string& text) {
    std::istringstream in(text);
    return read_log(in);
}

// Runs `rumor cards` on a log text; returns the outputs' paths.
struct Outputs {
    fs::path log, cards, prefixes;
};

Outputs cards_of(const std::string& log_text, const std::string& name,
                 std::string data = RUMOR_DATA_DIR, bool twins = false) {
    Outputs o{scratch(name + ".jsonl"), scratch(name + ".cards.jsonl"),
              scratch(name + ".prefixes.jsonl")};
    write_file(o.log, log_text);
    fs::remove(o.cards);
    fs::remove(o.prefixes);
    std::vector<std::string> args = {"rumor",       "cards",          "--log",
                                     o.log.string(), "--out",          o.cards.string(),
                                     "--prefixes",   o.prefixes.string(), "--data",
                                     data};
    if (twins) args.push_back("--rival-twins");
    std::vector<char*> argv;
    for (std::string& a : args) argv.push_back(a.data());
    REQUIRE(cards_command(static_cast<int>(argv.size()), argv.data()) == 0);
    return o;
}

// Every record read back, and checked line by line: read_card and write_card
// give the same bytes.
std::vector<CardRecord> read_cards(const fs::path& path) {
    std::vector<CardRecord> cards;
    for (const std::string& line : lines_of(read_file(path))) {
        const CardRecord r = read_card(line);
        CHECK(write_card(r) == line);
        cards.push_back(r);
    }
    return cards;
}

// The card fingerprint of every turn and plan of a log, by decision id.
std::map<int, std::string> logged_cards(const Log& log) {
    std::map<int, std::string> out;
    for (const Event& e : log.events) {
        if (const auto* t = std::get_if<TurnEvent>(&e)) out[t->id] = t->card;
        if (const auto* p = std::get_if<PlanEvent>(&e)) out[p->id] = p->card;
    }
    return out;
}

// Checks every record of a log's cards against the log.
void check_against_log(const Log& log, const std::vector<CardRecord>& cards,
                       const std::vector<std::string>& prefix_lines) {
    std::set<std::string> prefixes;
    for (const std::string& line : prefix_lines) {
        const auto p = nlohmann::json::parse(line);
        CHECK(p["prefix"] == prefix_id(p["text"].get<std::string>()));
        CHECK(p["lang"] == std::string(key(log.header.lang)));
        prefixes.insert(p["prefix"].get<std::string>());
    }
    const std::map<int, std::string> logged = logged_cards(log);
    std::size_t decide = 0;
    for (const CardRecord& r : cards) {
        CHECK(prefixes.count(r.prefix) == 1);
        CHECK(r.lang == log.header.lang);
        CHECK(r.source.seed == log.header.seed);
        CHECK(r.source.policy == log.header.policy);
        if (r.task != CardTask::decide || r.source.variant) continue;  // twins: not in the log
        ++decide;
        REQUIRE(r.source.event);
        CHECK(fingerprint(*r.state.request) == logged.at(*r.source.event));
        CHECK(r.strata == decide_strata(*r.state.request));
        CHECK(!r.card.empty());
    }
    CHECK(decide == logged.size());
}

// A copy of the data of the repo whose party-25 injects carry a sentence.
std::string data_with_inject_texts() {
    const fs::path dir = scratch("data");
    fs::remove_all(dir);
    fs::copy(RUMOR_DATA_DIR, dir, fs::copy_options::recursive);
    const fs::path file = dir / "scenarios" / "party-25.json";
    auto scenario = nlohmann::ordered_json::parse(read_file(file));
    for (auto& inj : scenario["injections"]) inj["text"] = "Esta noche hay fiesta en la plaza.";
    write_file(file, scenario.dump(2));
    return dir.string();
}

DecisionRequest request(DecisionKind kind) {
    DecisionRequest r;
    r.kind = kind;
    r.tick = 600;
    r.self = NeighborId(1);
    r.place = PlaceId(1);
    if (kind == DecisionKind::turn) r.other = NeighborId(2);
    Belief b;
    b.fact = FactId(1);
    b.what = "party";
    b.slots[idx(Slot::where)] = SlotBelief{SlotState::sure, 1, NeighborId()};
    r.facts = {b};
    r.trigger_fact = kind == DecisionKind::plan ? 1 : 0;
    r.neighbor_count = 25;
    return r;
}

TEST_SUITE("cards") {
    TEST_CASE("a baseline run gives back every decision and every inject text") {
        const std::string data = data_with_inject_texts();
        const std::string text = run_log("party-25", Lang::es, 3, false, data);
        const Log log = parse_log(text);
        const Outputs o = cards_of(text, "baseline-es", data);
        const std::vector<CardRecord> cards = read_cards(o.cards);
        check_against_log(log, cards, lines_of(read_file(o.prefixes)));

        std::size_t injects = 0, extract = 0;
        for (const Event& e : log.events) {
            const auto* inj = std::get_if<InjectEvent>(&e);
            if (inj && inj->text) ++injects;
        }
        std::set<Stratum> seen;
        for (const CardRecord& r : cards) {
            if (r.task == CardTask::extract) {
                ++extract;
                CHECK(r.strata == std::vector<Stratum>{Stratum::extract});
                CHECK(!r.source.event);
                REQUIRE(r.state.fact);
                CHECK(r.state.tick == r.source.tick);
            }
            for (Stratum s : r.strata) seen.insert(s);
            if (r.task == CardTask::decide) {
                const bool opening = r.kind == DecisionKind::turn && r.state.request->conversation.empty();
                CHECK((std::find(r.strata.begin(), r.strata.end(), Stratum::opening) != r.strata.end()) ==
                      opening);
                if (opening) CHECK(r.strata.back() == Stratum::opening);
                const DecisionRequest& q = *r.state.request;
                bool untold = false;
                for (const Belief& b : q.facts) {
                    untold = untold || (b.told_by != q.other &&
                                        std::find(b.told_to.begin(), b.told_to.end(), q.other) ==
                                            b.told_to.end());
                }
                untold = untold && q.kind == DecisionKind::turn && q.other.valid();
                CHECK((std::find(r.strata.begin(), r.strata.end(), Stratum::untold) != r.strata.end()) ==
                      untold);
                // The same condition as the line of the card (data/prompts/es/card.json).
                if (q.kind == DecisionKind::turn) {
                    CHECK((r.card.find("aún no se lo has contado") != std::string::npos) == untold);
                }
            }
        }
        CHECK(injects > 0);
        CHECK(extract == injects);  // the baseline writes no text
        CHECK(seen.count(Stratum::plan) == 1);
        CHECK(seen.count(Stratum::common) == 1);
        CHECK(seen.count(Stratum::opening) == 1);
        CHECK(seen.count(Stratum::untold) == 1);
        CHECK(lines_of(read_file(o.prefixes)).size() == 2);

        // Same log, same bytes.
        const std::string first = read_file(o.cards);
        const std::string first_prefixes = read_file(o.prefixes);
        const Outputs again = cards_of(text, "baseline-es", data);
        CHECK(read_file(again.cards) == first);
        CHECK(read_file(again.prefixes) == first_prefixes);
    }

    TEST_CASE("a run with texts: generations and perf replayed, incoherent texts left out") {
        const std::string text = run_log("party-25", Lang::es, 5, true);
        const Log log = parse_log(text);
        CHECK(log.header.model == std::optional<std::string>("fake.gguf"));
        const Outputs o = cards_of(text, "texts-es");
        const std::vector<CardRecord> cards = read_cards(o.cards);
        check_against_log(log, cards, lines_of(read_file(o.prefixes)));

        // The tells whose text names another place than their claim are not
        // fit for extract; the others are.
        std::map<int, const TurnEvent*> coherent;
        std::size_t incoherent = 0, injects = 0;
        for (const Event& e : log.events) {
            if (const auto* inj = std::get_if<InjectEvent>(&e); inj && inj->text) ++injects;
            const auto* t = std::get_if<TurnEvent>(&e);
            if (!t || t->act != Act::tell || t->verdict.reject != RejectReason::none) continue;
            if (t->text->ends_with("seguro.")) ++incoherent;
            else coherent[t->id] = t;
        }
        CHECK(incoherent > 0);
        CHECK(!coherent.empty());
        std::size_t from_tells = 0;
        for (const CardRecord& r : cards) {
            if (r.task != CardTask::extract || !r.source.event) continue;
            ++from_tells;
            REQUIRE(coherent.count(*r.source.event) == 1);
            const TurnEvent& t = *coherent.at(*r.source.event);
            CHECK(r.card == *t.text);
            CHECK(r.source.neighbor == t.who);
            REQUIRE(r.state.fact);
            CHECK(r.state.fact->id == t.fact);
            for (Slot s : kSlots) {
                const bool failed = is_failure((*t.verdict.slots)[idx(s)]);
                CHECK(r.state.fact->slots[idx(s)] ==
                      (failed ? std::nullopt : t.claim->slots[idx(s)]));
            }
        }
        CHECK(from_tells == coherent.size());
        std::size_t extract = 0;
        for (const CardRecord& r : cards) extract += r.task == CardTask::extract;
        CHECK(extract == injects + from_tells);
    }

    TEST_CASE("strata of hand-made requests") {
        using V = std::vector<Stratum>;
        // request(turn): n002 in front, one fact nobody told n002, nothing said yet.
        CHECK(decide_strata(request(DecisionKind::turn)) ==
              V{Stratum::common, Stratum::untold, Stratum::opening});
        CHECK(decide_strata(request(DecisionKind::plan)) == V{Stratum::plan});

        DecisionRequest r = request(DecisionKind::turn);
        r.conversation = {ConvEntry{NeighborId(2), Act::greet, FactId(), std::nullopt}};
        CHECK(decide_strata(r) == V{Stratum::common, Stratum::untold});
        r.facts[0].slots[idx(Slot::when)].state = SlotState::forgotten;
        CHECK(decide_strata(r) == V{Stratum::forgotten, Stratum::untold});
        r.facts[0].slots[idx(Slot::who)] = SlotBelief{SlotState::doubt, 3, NeighborId(4)};
        CHECK(decide_strata(r) == V{Stratum::forgotten, Stratum::doubt, Stratum::untold});
        r.conversation.clear();
        CHECK(decide_strata(r) ==
              V{Stratum::forgotten, Stratum::doubt, Stratum::untold, Stratum::opening});

        // Untold: not told to the neighbor in front, nor told by them.
        r = request(DecisionKind::turn);
        r.conversation = {ConvEntry{NeighborId(2), Act::greet, FactId(), std::nullopt}};
        r.facts[0].told_to = {NeighborId(5)};
        CHECK(decide_strata(r) == V{Stratum::common, Stratum::untold});  // told to someone else
        r.facts[0].told_by = NeighborId(2);
        CHECK(decide_strata(r) == V{Stratum::common});  // n002 told it: nothing to tell back
        r.facts[0].told_by = NeighborId(5);
        r.facts[0].told_to = {NeighborId(2), NeighborId(5)};
        CHECK(decide_strata(r) == V{Stratum::already_told});
        Belief second = r.facts[0];
        second.fact = FactId(2);
        second.told_to = {};
        r.facts.push_back(second);  // a second fact, still untold
        CHECK(decide_strata(r) == V{Stratum::already_told, Stratum::untold});
        r.relation = Relation::rival;
        CHECK(decide_strata(r) == V{Stratum::already_told, Stratum::enemy, Stratum::untold});
        r.facts.clear();
        CHECK(decide_strata(r) == V{Stratum::enemy});  // knows nothing: nothing to tell

        // Plans never carry a tag, inside a conversation or not.
        r = request(DecisionKind::plan);
        r.relation = Relation::rival;
        r.facts[0].told_to = {NeighborId(2)};
        CHECK(decide_strata(r) == V{Stratum::plan});
        r.other = NeighborId(2);
        r.facts[0].told_to = {};
        CHECK(decide_strata(r) == V{Stratum::enemy, Stratum::plan});
    }

    TEST_CASE("a tampered log fails and writes nothing") {
        const std::vector<std::string> lines = lines_of(run_log("party-25", Lang::es, 3));
        // The first greeting becomes a goodbye, or the first turn's card changes.
        const auto tampered = [&](bool card) {
            std::string out;
            bool done = false;
            for (const std::string& line : lines) {
                auto j = nlohmann::ordered_json::parse(line);
                if (!done && j["type"] == "turn" && j["act"] == "greet") {
                    if (card) j["card"] = std::string(64, '0');
                    else j["act"] = "bye";
                    done = true;
                }
                out += j.dump() + "\n";
            }
            REQUIRE(done);
            return out;
        };
        for (const bool card : {false, true}) {
            CAPTURE(card);
            const std::string text = tampered(card);
            const Outputs o{scratch("tampered.jsonl"), scratch("tampered.cards.jsonl"),
                            scratch("tampered.prefixes.jsonl")};
            write_file(o.log, text);
            fs::remove(o.cards);
            fs::remove(o.prefixes);
            std::string log = o.log.string(), cards = o.cards.string(),
                        prefixes = o.prefixes.string(), data = RUMOR_DATA_DIR;
            std::string a0 = "rumor", a1 = "cards", f1 = "--log", f2 = "--out", f3 = "--prefixes",
                        f4 = "--data";
            char* argv[] = {a0.data(), a1.data(),       f1.data(),       log.data(), f2.data(),
                            cards.data(), f3.data(), prefixes.data(), f4.data(),  data.data()};
            try {
                cards_command(10, argv);
                FAIL("a tampered log was accepted");
            } catch (const std::runtime_error& e) {
                const std::string what = e.what();
                CHECK(what.find(o.log.string()) == 0);
                // A changed card is caught at its own turn; a changed action
                // where the replay first parts from the log.
                if (card) CHECK(what.find("fingerprint") != std::string::npos);
                if (card) CHECK(what.find("turn ") != std::string::npos);
                if (!card) CHECK(what.find("the replay gives") != std::string::npos);
            }
            CHECK(!fs::exists(o.cards));
            CHECK(!fs::exists(o.prefixes));
        }
    }

    TEST_CASE("twin runs in es and en: same fingerprints, different text") {
        const Outputs es = cards_of(run_log("party-25", Lang::es, 7), "twin-es");
        const Outputs en = cards_of(run_log("party-25", Lang::en, 7), "twin-en");
        std::vector<CardRecord> a, b;
        for (const CardRecord& r : read_cards(es.cards)) {
            if (r.task == CardTask::decide) a.push_back(r);
        }
        for (const CardRecord& r : read_cards(en.cards)) {
            if (r.task == CardTask::decide) b.push_back(r);
        }
        REQUIRE(a.size() == b.size());
        REQUIRE(!a.empty());
        for (std::size_t i = 0; i < a.size(); ++i) {
            CHECK(a[i].fingerprint == b[i].fingerprint);
            CHECK(a[i].strata == b[i].strata);
            CHECK(a[i].card != b[i].card);
            CHECK(a[i].id.substr(10) == b[i].id.substr(10));  // "decide-es-" / "decide-en-"
        }
        CHECK(read_file(es.prefixes) != read_file(en.prefixes));
    }

    TEST_CASE("rival twins: one per turn with a non-rival in front, real cards unchanged") {
        const std::string text = run_log("party-25", Lang::es, 3);
        const Log log = parse_log(text);
        // Same log path, so that source.log is the same in both.
        const std::string plain = read_file(cards_of(text, "twins-es").cards);
        const Outputs o = cards_of(text, "twins-es", RUMOR_DATA_DIR, true);
        const std::vector<CardRecord> cards = read_cards(o.cards);  // round trip of every line
        check_against_log(log, cards, lines_of(read_file(o.prefixes)));

        // Without the twins, the same bytes as without the flag.
        std::string real;
        for (const std::string& line : lines_of(read_file(o.cards))) {
            if (line.find("\"variant\":\"rival\"") == std::string::npos) real += line + "\n";
        }
        CHECK(real == plain);

        std::size_t want = 0, twins = 0;
        for (std::size_t i = 0; i < cards.size(); ++i) {
            const CardRecord& r = cards[i];
            if (!r.source.variant) {
                const DecisionRequest* q = r.state.request ? &*r.state.request : nullptr;
                if (q && q->kind == DecisionKind::turn && q->other.valid() &&
                    q->relation != Relation::rival) {
                    ++want;
                }
                continue;
            }
            ++twins;
            CHECK(r.source.variant == CardVariant::rival);
            REQUIRE(i > 0);
            const CardRecord& original = cards[i - 1];  // right after its original
            REQUIRE(!original.source.variant);
            REQUIRE(original.state.request);
            CHECK(original.state.request->relation != Relation::rival);
            // Only the relation differs in the request; the rest follows from it.
            DecisionRequest back = *r.state.request;
            CHECK(back.relation == Relation::rival);
            back.relation = original.state.request->relation;
            CHECK(back == *original.state.request);
            CardSource source = r.source;
            source.variant.reset();
            CHECK(source == original.source);
            CHECK(r.kind == DecisionKind::turn);
            CHECK(r.prefix == original.prefix);
            CHECK(r.lang == original.lang);
            CHECK(r.card != original.card);
            CHECK(r.fingerprint != original.fingerprint);
            CHECK(r.id != original.id);
            CHECK(r.strata == decide_strata(*r.state.request));
            const auto tagged = [](const CardRecord& c) {
                return std::find(c.strata.begin(), c.strata.end(), Stratum::opening) != c.strata.end();
            };
            CHECK(tagged(r) == tagged(original));
            const auto untold = [](const CardRecord& c) {
                return std::find(c.strata.begin(), c.strata.end(), Stratum::untold) != c.strata.end();
            };
            CHECK(untold(r) == untold(original));
            CHECK(std::find(r.strata.begin(), r.strata.end(), Stratum::enemy) != r.strata.end());
            CHECK(std::find(original.strata.begin(), original.strata.end(), Stratum::enemy) ==
                  original.strata.end());
        }
        CHECK(twins > 0);
        CHECK(twins == want);
    }

    TEST_CASE("rival twins in es and en share their fingerprints") {
        const auto twins_of = [](Lang lang, const std::string& name) {
            std::vector<CardRecord> out;
            for (const CardRecord& r :
                 read_cards(cards_of(run_log("party-25", lang, 7), name, RUMOR_DATA_DIR, true).cards)) {
                if (r.source.variant) out.push_back(r);
            }
            return out;
        };
        const std::vector<CardRecord> es = twins_of(Lang::es, "twins-twin-es");
        const std::vector<CardRecord> en = twins_of(Lang::en, "twins-twin-en");
        REQUIRE(es.size() == en.size());
        REQUIRE(!es.empty());
        for (std::size_t i = 0; i < es.size(); ++i) {
            CHECK(es[i].fingerprint == en[i].fingerprint);
            CHECK(es[i].card != en[i].card);
        }
    }

    TEST_CASE("bad command lines") {
        std::string a0 = "rumor", a1 = "cards", f1 = "--log", v1 = "x.jsonl";
        char* argv[] = {a0.data(), a1.data(), f1.data(), v1.data()};
        CHECK_THROWS_AS(cards_command(4, argv), UsageError);
        CHECK_THROWS_AS(cards_command(3, argv), UsageError);
    }
}

}  // namespace
}  // namespace rumor
