// Tests of the card record of cards.jsonl (card/record.h): exact round trip of
// decide and extract records, fingerprint and id, and the strict reading.

#include <doctest/doctest.h>

#include <optional>
#include <stdexcept>
#include <string>

#include "card/record.h"
#include "core/sha256.h"

namespace rumor {
namespace {

SlotBelief belief_slot(SlotState state, std::optional<SlotValue> value = std::nullopt,
                       NeighborId source = {}) {
    SlotBelief b;
    b.state = state;
    b.value = value;
    b.source = source;
    return b;
}

// A turn with every kind of value: a sure, a doubt with its source, a forgotten
// and an unknown slot; a conversation with a greet and a tell with a guess.
DecisionRequest turn_request() {
    DecisionRequest r;
    r.kind = DecisionKind::turn;
    r.seed = 18446744073709551000ULL;  // above the range of a signed integer
    r.tick = 612;
    r.weekday = 1;
    r.self = NeighborId(1);
    r.job = Job::baker;
    r.trait = Trait::gossip;
    r.place = PlaceId(2);
    r.other = NeighborId(2);
    r.relation = Relation::friend_;
    Belief b;
    b.fact = FactId(1);
    b.what = "party";
    b.slots = {belief_slot(SlotState::sure, 3), belief_slot(SlotState::doubt, 1, NeighborId(5)),
               belief_slot(SlotState::forgotten), belief_slot(SlotState::unknown)};
    b.told_by = NeighborId(5);
    b.heard_at = 600;
    b.told_to = {NeighborId(2), NeighborId(17)};
    r.facts = {b};
    ConvEntry greet;
    greet.speaker = NeighborId(2);
    greet.act = Act::greet;
    ConvEntry tell;
    tell.speaker = NeighborId(2);
    tell.act = Act::tell;
    tell.fact = FactId(1);
    Claim c;
    c.slots = {std::nullopt, 1, 44, std::nullopt};
    c.guess[idx(Slot::when)] = true;
    tell.claim = c;
    r.conversation = {greet, tell};
    r.neighbor_count = 25;
    return r;
}

CardSource source(std::optional<int> event) {
    CardSource s;
    s.log = "runs/phase2/gemma4-e4b/party-25-es/seed-3.jsonl";
    s.policy = "model";
    s.model = "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf";
    s.scenario = "party-25";
    s.seed = 3;
    s.tick = 612;
    s.neighbor = event ? NeighborId(1) : NeighborId();
    s.event = event;
    return s;
}

CardVillage village() { return {"party-25", 3, 25, Layout::village}; }

CardRecord decide_record(Lang lang = Lang::es) {
    CardRecord r;
    r.task = CardTask::decide;
    r.lang = lang;
    r.kind = DecisionKind::turn;
    r.strata = {Stratum::forgotten, Stratum::doubt};
    r.prefix = prefix_id("Vives en un pueblo...");
    r.source = source(3);
    r.card = "Eres Carmen, panadera. Te gusta enterarte de todo.\n\nDecisión: turno.";
    r.state.village = village();
    r.state.request = turn_request();
    set_identity(r);
    return r;
}

CardRecord extract_record(bool with_fact) {
    CardRecord r;
    r.task = CardTask::extract;
    r.lang = Lang::es;
    r.strata = {Stratum::extract};
    r.prefix = prefix_id("Convierte la frase...");
    r.source = source(std::nullopt);
    r.source.tick = 600;
    r.card = "Esta noche hay fiesta en la plaza a las nueve, \"dicen\".";
    r.state.village = village();
    r.state.tick = 600;
    if (with_fact) {
        Fact f;
        f.id = FactId(1);
        f.what = "party";
        f.slots = {3, 1, 42, 50};
        r.state.fact = f;
    }
    set_identity(r);
    return r;
}

// The line of a record with `from` replaced by `to` (once).
std::string edited(const CardRecord& r, const std::string& from, const std::string& to) {
    std::string line = write_card(r);
    const auto at = line.find(from);
    REQUIRE(at != std::string::npos);
    return line.replace(at, from.size(), to);
}

}  // namespace

TEST_SUITE("record") {
    TEST_CASE("a decide record goes through a line and back") {
        const CardRecord r = decide_record();
        const std::string line = write_card(r);
        CHECK(line.find('\n') == std::string::npos);
        CHECK(line.rfind("{\"id\":\"decide-es-", 0) == 0);
        const CardRecord back = read_card(line);
        CHECK(back == r);
        CHECK(write_card(back) == line);
    }

    TEST_CASE("the keys follow the documented order") {
        const std::string line = write_card(decide_record());
        CHECK(line.find("\"contract_version\":1,\"task\":\"decide\",\"lang\":\"es\",\"kind\":"
                        "\"turn\",\"strata\":[\"forgotten\",\"doubt\"],\"prefix\":") !=
              std::string::npos);
        CHECK(line.find("\"state\":{\"village\":{\"scenario\":\"party-25\",\"seed\":3,"
                        "\"neighbors\":25,\"layout\":\"village\"},\"request\":{\"kind\":\"turn\","
                        "\"seed\":18446744073709551000,\"tick\":612,") != std::string::npos);
        CHECK(line.find("\"slots\":{\"who\":{\"state\":\"sure\",\"value\":\"n003\",\"source\":"
                        "null},\"where\":{\"state\":\"doubt\",\"value\":\"p01\",\"source\":"
                        "\"n005\"}") != std::string::npos);
        CHECK(line.find("{\"speaker\":\"n002\",\"act\":\"greet\",\"fact\":null,\"claim\":null}") !=
              std::string::npos);
        CHECK(line.find("\"claim\":{\"who\":null,\"where\":\"p01\",\"when\":44,\"amount\":null,"
                        "\"guess\":[\"when\"]}") != std::string::npos);
    }

    TEST_CASE("a plan with its neighbor alone goes through") {
        CardRecord r = decide_record();
        r.kind = DecisionKind::plan;
        r.state.request->kind = DecisionKind::plan;
        r.state.request->other = NeighborId();
        r.state.request->conversation.clear();
        r.state.request->trigger_fact = 1;
        r.strata = {Stratum::plan};
        r.source.model = std::nullopt;
        r.source.policy = "baseline";
        set_identity(r);
        const CardRecord back = read_card(write_card(r));
        CHECK(back == r);
        CHECK_FALSE(back.state.request->other.valid());
    }

    TEST_CASE("an extract record goes through, with and without its fact") {
        for (const bool with_fact : {true, false}) {
            CAPTURE(with_fact);
            const CardRecord r = extract_record(with_fact);
            const std::string line = write_card(r);
            const CardRecord back = read_card(line);
            CHECK(back == r);
            CHECK(write_card(back) == line);
            CHECK(line.find("\"kind\":null") != std::string::npos);
            CHECK(line.find("\"neighbor\":null,\"event\":null") != std::string::npos);
            if (with_fact) {
                CHECK(line.find("\"fact\":{\"fact\":\"f1\",\"what\":\"party\",\"slots\":{\"who\":"
                                "\"n003\",\"where\":\"p01\",\"when\":42,\"amount\":50}}") !=
                      std::string::npos);
            } else {
                CHECK(line.find("\"tick\":600,\"fact\":null}") != std::string::npos);
            }
        }
    }

    TEST_CASE("fingerprint: the situation as data, without seed or language") {
        const DecisionRequest a = turn_request();
        DecisionRequest b = a;
        b.seed = 7;
        CHECK(card_fingerprint(a) == card_fingerprint(b));
        CHECK(card_fingerprint(a) == sha256_hex("decide\n" + canonical(a)));
        CHECK(card_fingerprint(a).size() == 64);
        // Not the fingerprint the log keeps in turn.card: the task is in it.
        CHECK(card_fingerprint(a) != fingerprint(a));
        b.tick += 1;
        CHECK(card_fingerprint(a) != card_fingerprint(b));

        const CardRecord es = decide_record(Lang::es);
        const CardRecord en = decide_record(Lang::en);
        CHECK(es.fingerprint == en.fingerprint);
        CHECK(es.id != en.id);
        CHECK(es.id.substr(10) == en.id.substr(10));

        CHECK(extract_fingerprint("hola") == sha256_hex("extract\nhola"));
        CHECK(extract_fingerprint("hola") != extract_fingerprint("hola "));
    }

    TEST_CASE("id and prefix formats") {
        const std::string fp = card_fingerprint(turn_request());
        CHECK(card_id(CardTask::decide, Lang::es, fp) == "decide-es-" + fp.substr(0, 16));
        CHECK(card_id(CardTask::extract, Lang::en, fp) == "extract-en-" + fp.substr(0, 16));
        CHECK_THROWS_AS(card_id(CardTask::decide, Lang::es, "abc"), std::invalid_argument);
        CHECK(prefix_id("text") == sha256_hex("text").substr(0, 12));
        const CardRecord r = decide_record();
        CHECK(r.id.size() == std::string("decide-es-").size() + 16);
    }

    TEST_CASE("another contract version is read: the caller decides") {
        CardRecord r = decide_record();
        r.contract_version = 2;
        CHECK(read_card(write_card(r)).contract_version == 2);
    }

    TEST_CASE("broken records are not written") {
        CardRecord r = decide_record();
        r.fingerprint[0] = r.fingerprint[0] == '0' ? '1' : '0';
        CHECK_THROWS_AS(write_card(r), std::invalid_argument);

        r = decide_record();
        r.kind = DecisionKind::plan;  // not the kind of the request
        CHECK_THROWS_AS(write_card(r), std::invalid_argument);

        r = decide_record();
        r.state.request.reset();
        CHECK_THROWS_AS(write_card(r), std::invalid_argument);

        r = decide_record();
        r.strata = {Stratum::doubt, Stratum::doubt};
        CHECK_THROWS_AS(write_card(r), std::invalid_argument);

        r = decide_record();
        r.strata = {Stratum::extract};
        CHECK_THROWS_AS(write_card(r), std::invalid_argument);

        r = decide_record();
        r.strata.clear();
        CHECK_THROWS_AS(write_card(r), std::invalid_argument);

        r = extract_record(true);
        r.strata = {Stratum::extract, Stratum::common};
        CHECK_THROWS_AS(write_card(r), std::invalid_argument);

        r = extract_record(true);
        r.kind = DecisionKind::turn;
        CHECK_THROWS_AS(write_card(r), std::invalid_argument);

        r = decide_record();
        r.prefix = "ABC";
        CHECK_THROWS_AS(write_card(r), std::invalid_argument);
    }

    TEST_CASE("reading is strict and says why") {
        const CardRecord r = decide_record();
        const auto message = [](const std::string& line) {
            try {
                (void)read_card(line);
            } catch (const std::runtime_error& e) {
                return std::string(e.what());
            }
            return std::string("no error");
        };
        CHECK(message("{") == "card: malformed JSON at byte 2");
        CHECK(message("[]") == "card: expected a JSON object");
        CHECK(message(edited(r, "\"self\":\"n001\"", "\"self\":\"x1\"")) ==
              "card: key 'state.request.self': unknown identifier 'x1'");
        CHECK(message(edited(r, "\"task\":\"decide\"", "\"task\":\"decides\"")) ==
              "card: key 'task': unknown value 'decides'");
        CHECK(message(edited(r, ",\"prefix\"", ",\"extra\":1,\"prefix\"")) ==
              "card: unknown key 'extra'");
        CHECK(message(edited(r, "\"lang\":\"es\",", "")) == "card: missing key 'lang'");
        CHECK(message(edited(r, "\"lang\":\"es\"", "\"lang\":\"es\",\"lang\":\"en\"")) ==
              "card: repeated key 'lang'");
        CHECK(message(edited(r, "\"guess\":[\"when\"]", "\"guess\":[\"when\",\"who\"]")) ==
              "card: key 'state.request.conversation[1].claim.guess': slots must be in slot "
              "order, without repeats");
        // A request changed after the fingerprint was taken.
        CHECK(message(edited(r, "\"heard_at\":600", "\"heard_at\":601"))
                  .starts_with("card: fingerprint '"));
        // The language changed but not the id.
        CHECK(message(edited(r, "\"lang\":\"es\"", "\"lang\":\"en\"")).starts_with("card: id '"));
        // The seed of the run must be unsigned.
        CHECK(message(edited(r, "\"seed\":3,\"tick\"", "\"seed\":-3,\"tick\"")) ==
              "card: key 'source.seed': expected an unsigned integer");
        // The variant is a required key, with a known value.
        CHECK(message(edited(r, ",\"variant\":null", "")) == "card: missing key 'source.variant'");
        CHECK(message(edited(r, "\"variant\":null", "\"variant\":\"twin\"")) ==
              "card: key 'source.variant': unknown value 'twin'");
        // A rival twin needs the relation rival (this request has friend).
        CHECK(message(edited(r, "\"variant\":null", "\"variant\":\"rival\"")) ==
              "card: a rival twin is a decide turn with the relation rival");
    }
    TEST_CASE("the opening tag: a turn with an empty conversation, last in strata") {
        CardRecord r = decide_record();
        r.state.request->conversation.clear();
        r.strata = {Stratum::common, Stratum::opening};
        set_identity(r);
        const std::string line = write_card(r);
        CHECK(line.find("\"strata\":[\"common\",\"opening\"]") != std::string::npos);
        CHECK(read_card(line) == r);
        r.strata = {Stratum::forgotten, Stratum::doubt, Stratum::opening};
        CHECK(read_card(write_card(r)) == r);

        CardRecord bad = r;
        bad.strata = {Stratum::opening, Stratum::forgotten};
        CHECK_THROWS_WITH_AS((void)write_card(bad), "card: stratum 'opening' is not the last",
                             std::invalid_argument);
        bad = decide_record();  // its conversation is not empty
        bad.strata = {Stratum::forgotten, Stratum::opening};
        CHECK_THROWS_WITH_AS((void)write_card(bad),
                             "card: stratum 'opening' outside a turn with an empty conversation",
                             std::invalid_argument);
        // Read back as strictly.
        const std::string tagged = write_card(r);
        std::string edited_line = tagged;
        const std::string from = "\"strata\":[\"forgotten\",\"doubt\",\"opening\"]";
        const auto at = edited_line.find(from);
        REQUIRE(at != std::string::npos);
        edited_line.replace(at, from.size(), "\"strata\":[\"opening\",\"forgotten\",\"doubt\"]");
        CHECK_THROWS_WITH_AS((void)read_card(edited_line), "card: stratum 'opening' is not the last",
                             std::runtime_error);
        CardRecord extract = extract_record(true);
        extract.strata = {Stratum::extract, Stratum::opening};
        CHECK_THROWS_AS((void)write_card(extract), std::invalid_argument);
    }
    TEST_CASE("the untold tag: a turn with someone in front, before opening") {
        CardRecord r = decide_record();  // a turn with n002 in front
        r.strata = {Stratum::forgotten, Stratum::doubt, Stratum::untold};
        const std::string line = write_card(r);
        CHECK(line.find("\"strata\":[\"forgotten\",\"doubt\",\"untold\"]") != std::string::npos);
        CHECK(read_card(line) == r);
        r.state.request->conversation.clear();
        r.strata = {Stratum::common, Stratum::untold, Stratum::opening};
        set_identity(r);
        CHECK(read_card(write_card(r)) == r);
        // Never required: the same card without tags is still valid.
        r.strata = {Stratum::common};
        CHECK(read_card(write_card(r)) == r);

        CardRecord bad = r;
        bad.strata = {Stratum::common, Stratum::opening, Stratum::untold};
        CHECK_THROWS_WITH_AS((void)write_card(bad), "card: stratum 'opening' is not the last",
                             std::invalid_argument);
        bad.strata = {Stratum::untold, Stratum::common};
        CHECK_THROWS_WITH_AS((void)write_card(bad),
                             "card: stratum 'untold' is not after the others and before 'opening'",
                             std::invalid_argument);
        bad.strata = {Stratum::untold};
        CHECK_THROWS_WITH_AS((void)write_card(bad), "card: a tag without a stratum",
                             std::invalid_argument);
        bad.strata = {Stratum::opening};
        CHECK_THROWS_WITH_AS((void)write_card(bad), "card: a tag without a stratum",
                             std::invalid_argument);
        bad = r;
        bad.state.request->other = NeighborId();
        bad.strata = {Stratum::common, Stratum::untold};
        set_identity(bad);
        CHECK_THROWS_WITH_AS((void)write_card(bad),
                             "card: stratum 'untold' outside a turn with someone in front",
                             std::invalid_argument);
    }
    TEST_CASE("a rival twin goes through a line and back") {
        CardRecord r = decide_record();
        CHECK(write_card(r).find("\"event\":3,\"variant\":null},\"card\"") != std::string::npos);
        r.source.variant = CardVariant::rival;
        r.state.request->relation = Relation::rival;
        set_identity(r);
        CHECK(r.fingerprint != decide_record().fingerprint);
        const std::string line = write_card(r);
        CHECK(line.find("\"event\":3,\"variant\":\"rival\"}") != std::string::npos);
        const CardRecord back = read_card(line);
        CHECK(back == r);
        CHECK(write_card(back) == line);
        // Only in a decide turn with the relation rival.
        CardRecord bad = r;
        bad.state.request->relation = Relation::friend_;
        set_identity(bad);
        CHECK_THROWS_AS((void)write_card(bad), std::invalid_argument);
        CardRecord extract = extract_record(true);
        extract.source.variant = CardVariant::rival;
        CHECK_THROWS_AS((void)write_card(extract), std::invalid_argument);
    }
}

}  // namespace rumor
