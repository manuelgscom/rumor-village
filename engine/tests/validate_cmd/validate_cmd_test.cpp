// Tests of `rumor validate` (cli/validate.h), through the subcommand itself:
// hand-made card records (card/record.h) and answers written as other models
// write them, in files, with the real vocabulary and population of data/. One
// case per row of the validation table of the contract (section 3), each
// reason of a discard, the extract task, train.jsonl as input, --strict and
// the errors that stop the command.

#include <doctest/doctest.h>

#ifdef _WIN32
#include <process.h>  // _getpid
#define getpid _getpid
#else
#include <unistd.h>
#endif

#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/record.h"
#include "cli/usage.h"
#include "cli/validate.h"

namespace rumor {
namespace {

namespace fs = std::filesystem;
using json = nlohmann::json;
using ordered_json = nlohmann::ordered_json;

const std::string kData = RUMOR_DATA_DIR;

// Day 0, 18:30: "hoy 22:00" is slot 44.
constexpr Tick kNow = 18 * kTicksPerHour + 30;

SlotBelief belief(SlotState state, std::optional<SlotValue> value = std::nullopt,
                  NeighborId source = {}) {
    SlotBelief b;
    b.state = state;
    b.value = value;
    b.source = source;
    return b;
}

// Carmen (n001), at the bar, talks to Luis (n002). She knows two facts:
//   [1] party:   who sure Pedro, where doubt plaza (Ana's guess), when
//                forgotten, amount unknown
//   [2] wedding: who sure Pedro, where sure iglesia, when sure hoy 22:00,
//                amount doubt 50 (Ana's guess)
DecisionRequest turn_request(Tick tick = kNow) {
    DecisionRequest r;
    r.kind = DecisionKind::turn;
    r.seed = 99;
    r.tick = tick;
    r.weekday = 1;
    r.self = NeighborId(1);
    r.job = Job::baker;
    r.trait = Trait::gossip;
    r.place = PlaceId(2);
    r.other = NeighborId(2);
    r.relation = Relation::friend_;
    Belief party;
    party.fact = FactId(1);
    party.what = "party";
    party.slots = {belief(SlotState::sure, 4), belief(SlotState::doubt, 1, NeighborId(3)),
                   belief(SlotState::forgotten), belief(SlotState::unknown)};
    party.told_by = NeighborId(3);
    party.heard_at = kNow - 60;
    Belief wedding;
    wedding.fact = FactId(2);
    wedding.what = "wedding";
    wedding.slots = {belief(SlotState::sure, 4), belief(SlotState::sure, 3),
                     belief(SlotState::sure, 44), belief(SlotState::doubt, 50, NeighborId(3))};
    wedding.told_by = NeighborId(5);
    wedding.heard_at = kNow - 30;
    r.facts = {party, wedding};
    r.neighbor_count = 25;
    return r;
}

// Carmen alone, deciding whether to go to the wedding.
DecisionRequest plan_request() {
    DecisionRequest r = turn_request();
    r.kind = DecisionKind::plan;
    r.other = NeighborId();
    r.relation = Relation::acquaintance;
    r.trigger_fact = 2;
    return r;
}

CardSource source(std::optional<int> event) {
    CardSource s;
    s.log = "runs/phase2/gemma4-e4b/party-25-es/seed-3.jsonl";
    s.policy = "model";
    s.model = "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf";
    s.scenario = "party-25";
    s.seed = 3;
    s.tick = kNow;
    s.neighbor = event ? NeighborId(1) : NeighborId();
    s.event = event;
    return s;
}

CardRecord decide_card(const DecisionRequest& request, Lang lang = Lang::es) {
    CardRecord r;
    r.task = CardTask::decide;
    r.lang = lang;
    r.kind = request.kind;
    r.strata = {request.kind == DecisionKind::plan ? Stratum::plan : Stratum::doubt};
    r.prefix = prefix_id("prefix");
    r.source = source(3);
    r.card = "Eres Carmen, panadera.\n\nDecisión: turno.";
    r.state.village = {"party-25", 3, 25, Layout::village};
    r.state.request = request;
    set_identity(r);
    return r;
}

// A sentence whose fact is known: a party at the plaza, hoy 21:00, for 50.
CardRecord extract_card(Lang lang = Lang::es, bool with_fact = true, Tick tick = kNow) {
    CardRecord r;
    r.task = CardTask::extract;
    r.lang = lang;
    r.strata = {Stratum::extract};
    r.prefix = prefix_id("extract prefix");
    r.source = source(std::nullopt);
    r.card = lang == Lang::es ? "Esta noche hay fiesta en la plaza a las nueve, vendrán 50."
                              : "There is a party in the square tonight at nine, 50 people.";
    r.state.village = {"party-25", 3, 25, Layout::village};
    r.state.tick = tick;
    if (with_fact) {
        Fact f;
        f.id = FactId(1);
        f.what = "party";
        f.slots = {std::nullopt, 1, from_relative({0, 21, 0}, tick).value(), 50};
        r.state.fact = f;
    }
    set_identity(r);
    return r;
}

std::string label_line(const std::string& id, const json& raw) {
    ordered_json line;
    line["id"] = id;
    line["provider"] = "sonnet";
    line["model"] = "claude-sonnet-5-5";
    line["effort"] = "medium";
    line["chunk"] = "sonnet-0001";
    line["raw"] = raw;
    return line.dump();
}

struct Result {
    int code = 0;
    std::vector<std::string> lines;  // verdicts.jsonl
    std::string err;                 // what the command said on stderr
    bool wrote = false;              // whether verdicts.jsonl exists
    std::optional<std::string> error;  // what it threw: cli_main exits with 1
};

// Runs `rumor validate` on files in a fresh folder.
Result run_validate(const std::vector<CardRecord>& cards, const std::vector<std::string>& inputs,
                    std::vector<std::string> extra = {}) {
    static int runs = 0;
    const fs::path dir = fs::temp_directory_path() /
                         ("rumor-validate-" + std::to_string(getpid()) + "-" + std::to_string(++runs));
    fs::create_directories(dir);
    struct Cleanup {
        fs::path dir;
        std::streambuf* cerr;
        ~Cleanup() {
            std::cerr.rdbuf(cerr);
            fs::remove_all(dir);
        }
    };
    std::ostringstream err;
    const Cleanup cleanup{dir, std::cerr.rdbuf(err.rdbuf())};
    {
        std::ofstream c(dir / "cards.jsonl");
        for (const CardRecord& r : cards) c << write_card(r) << '\n';
        std::ofstream in(dir / "in.jsonl");
        for (const std::string& l : inputs) in << l << '\n';
    }
    std::vector<std::string> args = {"rumor",   "validate", "--in",   (dir / "in.jsonl").string(),
                                      "--cards", (dir / "cards.jsonl").string(),
                                      "--out",   (dir / "out.jsonl").string(),
                                      "--data",  kData};
    args.insert(args.end(), extra.begin(), extra.end());
    std::vector<char*> argv;
    for (std::string& a : args) argv.push_back(a.data());

    Result result;
    try {
        result.code = validate_command(static_cast<int>(argv.size()), argv.data());
    } catch (const std::runtime_error& e) {
        result.code = 1;
        result.error = e.what();
    }
    result.err = err.str();
    result.wrote = fs::exists(dir / "out.jsonl");
    std::ifstream out(dir / "out.jsonl");
    for (std::string line; std::getline(out, line);) result.lines.push_back(line);
    return result;
}

// The verdict of one answer to one card.
json judge(const CardRecord& card, const json& raw) {
    const Result r = run_validate({card}, {label_line(card.id, raw)});
    REQUIRE_FALSE(r.error);
    REQUIRE(r.code == 0);
    REQUIRE(r.lines.size() == 1);
    const json v = json::parse(r.lines[0]);
    CHECK(v.at("id") == card.id);
    CHECK(v.at("ok") == v.at("reasons").empty());
    return v;
}

std::vector<std::string> reasons(const json& v) { return v.at("reasons"); }

using Reasons = std::vector<std::string>;

// A tell of the turn card, with a neutral text that names nothing.
std::string tell(int fact, const std::string& claim,
                 const std::string& text = "¿Te has enterado de lo último?") {
    return R"({"action":"say","act":"tell","fact":)" + std::to_string(fact) + R"(,"claim":)" +
           claim + R"(,"text":")" + text + R"("})";
}

}  // namespace

TEST_SUITE("validate_cmd") {
    // --- The validation table of the contract, row by row (a tell in a turn) ---

    TEST_CASE("sure X, says X marked or not: faithful") {
        const CardRecord card = decide_card(turn_request());
        json v = judge(card, tell(2, R"({"who":null,"where":"iglesia","when":null,"amount":null,"guess":[]})"));
        CHECK(reasons(v).empty());
        CHECK(v["slots"]["where"] == "faithful");
        v = judge(card, tell(2, R"({"who":null,"where":"iglesia","when":null,"amount":null,"guess":["where"]})"));
        CHECK(reasons(v).empty());
        CHECK(v["slots"]["where"] == "faithful");
    }

    TEST_CASE("sure X, says another value, marked or not: contradiction") {
        const CardRecord card = decide_card(turn_request());
        for (const char* guess : {"[]", R"(["where"])"}) {
            const json v = judge(card, tell(2, std::string(R"({"who":null,"where":"ermita","when":null,"amount":null,"guess":)") + guess + "}"));
            CHECK(reasons(v) == Reasons{"contradiction"});
            CHECK(v["slots"]["where"] == "contradiction");
        }
    }

    TEST_CASE("doubt X, says X marked: faithful") {
        const json v = judge(decide_card(turn_request()),
                             tell(1, R"({"who":null,"where":"plaza","when":null,"amount":null,"guess":["where"]})"));
        CHECK(reasons(v).empty());
        CHECK(v["slots"]["where"] == "faithful");
    }

    TEST_CASE("doubt X, says X not marked: hardened doubt, discarded") {
        const json v = judge(decide_card(turn_request()),
                             tell(1, R"({"who":null,"where":"plaza","when":null,"amount":null,"guess":[]})"));
        CHECK(reasons(v) == Reasons{"hardened_doubt"});
        CHECK(v["ok"] == false);
        CHECK(v["slots"]["where"] == "hardened_doubt");
    }

    TEST_CASE("doubt X, says another value marked: declared guess") {
        const json v = judge(decide_card(turn_request()),
                             tell(1, R"({"who":null,"where":"bar","when":null,"amount":null,"guess":["where"]})"));
        CHECK(reasons(v).empty());
        CHECK(v["slots"]["where"] == "declared_guess");
    }

    TEST_CASE("doubt X, says another value not marked: invented") {
        const json v = judge(decide_card(turn_request()),
                             tell(1, R"({"who":null,"where":"bar","when":null,"amount":null,"guess":[]})"));
        CHECK(reasons(v) == Reasons{"invented"});
        CHECK(v["slots"]["where"] == "invented");
    }

    TEST_CASE("forgotten or unknown, a value marked: declared guess") {
        const json v = judge(decide_card(turn_request()),
                             tell(1, R"({"who":null,"where":null,"when":"hoy 22:00","amount":30,"guess":["when","amount"]})"));
        CHECK(reasons(v).empty());
        CHECK(v["slots"]["when"] == "declared_guess");     // forgotten
        CHECK(v["slots"]["amount"] == "declared_guess");   // unknown
    }

    TEST_CASE("forgotten or unknown, a value not marked: invented") {
        json v = judge(decide_card(turn_request()),
                       tell(1, R"({"who":null,"where":null,"when":"hoy 22:00","amount":null,"guess":[]})"));
        CHECK(reasons(v) == Reasons{"invented"});
        CHECK(v["slots"]["when"] == "invented");
        v = judge(decide_card(turn_request()),
                  tell(1, R"({"who":null,"where":null,"when":null,"amount":30,"guess":[]})"));
        CHECK(reasons(v) == Reasons{"invented"});
        CHECK(v["slots"]["amount"] == "invented");
    }

    TEST_CASE("any memory, null: omitted; a guess mark on a null slot is ignored") {
        const json v = judge(decide_card(turn_request()),
                             tell(2, R"({"who":"Pedro","where":null,"when":null,"amount":null,"guess":["when"]})"));
        CHECK(reasons(v).empty());
        CHECK(v["slots"] == json::parse(R"({"who":"faithful","where":"omitted","when":"omitted","amount":"omitted"})"));
    }

    TEST_CASE("the exact verdict line") {
        const CardRecord card = decide_card(turn_request());
        const Result r = run_validate(
            {card}, {label_line(card.id, tell(2, R"({"who":"Pedro","where":"iglesia","when":"hoy 22:00","amount":50,"guess":["amount"]})"))});
        REQUIRE(r.lines.size() == 1);
        const std::string canonical =
            R"({"action":"say","act":"tell","fact":2,"claim":{"who":"Pedro","where":"iglesia","when":"hoy 22:00","amount":50,"guess":["amount"]},"text":"¿Te has enterado de lo último?"})";
        CHECK(r.lines[0] == "{\"id\":\"" + card.id +
                                "\",\"ok\":true,\"reasons\":[],\"slots\":{\"who\":\"faithful\","
                                "\"where\":\"faithful\",\"when\":\"faithful\",\"amount\":\"faithful\"},"
                                "\"canonical\":" + json(canonical).dump() + "}");
        const Result none = run_validate({card}, {label_line(card.id, R"({"action":"none"})")});
        REQUIRE(none.lines.size() == 1);
        CHECK(none.lines[0] == "{\"id\":\"" + card.id +
                                   "\",\"ok\":true,\"reasons\":[],\"slots\":null,"
                                   "\"canonical\":\"{\\\"action\\\":\\\"none\\\"}\"}");
        const Result bad = run_validate({card}, {label_line(card.id, "roto")});
        REQUIRE(bad.lines.size() == 1);
        CHECK(bad.lines[0] == "{\"id\":\"" + card.id +
                                  "\",\"ok\":false,\"reasons\":[\"unreadable\"],\"slots\":null,"
                                  "\"canonical\":null}");
    }

    // --- Answers as other models write them ---

    TEST_CASE("keys of the claim and the middle keys in another order, with spaces") {
        const CardRecord card = decide_card(turn_request());
        const json v = judge(card,
                             "  {\n  \"action\" : \"say\",\n  \"fact\" : 2 , \"act\": \"tell\",\n"
                             "  \"claim\": { \"guess\" : [ ] , \"amount\": null, \"where\" : \"iglesia\","
                             " \"who\": \"Pedro\" },\n  \"text\" : \"¿Sabes que Pedro se casa en la iglesia?\" }\n");
        CHECK(reasons(v).empty());
        CHECK(v["slots"]["when"] == "omitted");  // a missing slot is an omission
        CHECK(v["slots"]["where"] == "faithful");
        // greet, ask, bye and none, with null keys the action does not use
        CHECK(reasons(judge(card, R"({"action":"say","act":"greet","fact":null,"claim":null,"text":"¡Hola, Luis!"})")).empty());
        CHECK(reasons(judge(card, R"({"action":"say","act":"ask","fact":1,"text":"¿Sabes algo de la fiesta?"})")).empty());
        CHECK(reasons(judge(card, R"({"action":"say","act":"bye","text":"Me voy, hasta luego."})")).empty());
        CHECK(reasons(judge(card, R"({ "action" : "none" })")).empty());
    }

    // --- go ---

    TEST_CASE("a go with place and time is kept") {
        const json v = judge(decide_card(plan_request()),
                             R"({"action":"go","fact":2,"claim":{"who":null,"where":"iglesia","when":"hoy 22:00","amount":null,"guess":[]}})");
        CHECK(reasons(v).empty());
        CHECK(v["slots"]["when"] == "faithful");
    }

    TEST_CASE("a go without place or time after validation") {
        const CardRecord card = decide_card(plan_request());
        json v = judge(card, R"({"action":"go","fact":2,"claim":{"who":null,"where":"iglesia","when":null,"amount":null,"guess":[]}})");
        CHECK(reasons(v) == Reasons{"go_without_place_or_time"});
        // the contradicted when is removed by validation
        v = judge(card, R"({"action":"go","fact":2,"claim":{"who":null,"where":"iglesia","when":"hoy 21:00","amount":null,"guess":[]}})");
        CHECK(reasons(v) == Reasons{"contradiction", "go_without_place_or_time"});
        v = judge(card, R"({"action":"go","fact":2,"claim":{"who":null,"where":null,"when":"hoy 22:00","amount":null,"guess":[]}})");
        CHECK(reasons(v) == Reasons{"go_without_place_or_time"});
        CHECK(reasons(judge(card, R"({"action":"none"})")).empty());
    }

    // --- Rejected actions ---

    TEST_CASE("each reject reason") {
        const CardRecord turn = decide_card(turn_request());
        const CardRecord plan = decide_card(plan_request());
        json v = judge(turn, R"({"action":"go","fact":2,"claim":{"who":null,"where":"iglesia","when":"hoy 22:00","amount":null,"guess":[]}})");
        CHECK(reasons(v) == Reasons{"rejected:action_not_allowed"});
        CHECK(v["slots"].is_null());
        CHECK(reasons(judge(plan, tell(2, R"({"who":"Pedro","where":null,"when":null,"amount":null,"guess":[]})"))) ==
              Reasons{"rejected:action_not_allowed"});
        // tell without claim; a home as where; a go with text
        CHECK(reasons(judge(turn, R"({"action":"say","act":"tell","fact":2,"text":"Hola."})")) ==
              Reasons{"rejected:bad_fields"});
        CHECK(reasons(judge(turn, tell(2, R"({"who":null,"where":"barrio alto","when":null,"amount":null,"guess":[]})"))) ==
              Reasons{"rejected:bad_fields"});
        CHECK(reasons(judge(plan, R"({"action":"go","fact":2,"claim":{"who":null,"where":"iglesia","when":"hoy 22:00","amount":null,"guess":[]},"text":"Voy."})")) ==
              Reasons{"rejected:bad_fields"});
        CHECK(reasons(judge(turn, tell(3, R"({"who":"Pedro","where":null,"when":null,"amount":null,"guess":[]})"))) ==
              Reasons{"rejected:unknown_fact"});
    }

    // --- Unreadable ---

    TEST_CASE("unreadable answers") {
        const CardRecord card = decide_card(turn_request());
        for (const json& raw : {json("no es JSON"), json(""), json("   "), json(nullptr),
                               json(R"({"action":"none"} y nada más)"),
                               json(R"({"action":"none","to":"Luis"})"),
                               json(R"(["action","none"])"),
                               json(tell(2, R"({"who":"Zacarías","where":null,"when":null,"amount":null,"guess":[]})")),
                               json(tell(2, R"({"who":null,"where":null,"when":"hoy 22:15","amount":null,"guess":[]})")),
                               json(R"({"action":"say","act":"tell","fact":2,"claim":{"who":null)")}) {
            CAPTURE(raw.dump());
            const json v = judge(card, raw);
            CHECK(reasons(v) == Reasons{"unreadable"});
            CHECK(v["slots"].is_null());
        }
    }

    // --- Form: what the contract and the grammar forbid and validate() lets pass ---

    TEST_CASE("bad shape: say without text, text or amount outside the grammar, repeated key") {
        const CardRecord card = decide_card(turn_request());
        const std::string claim = R"({"who":"Pedro","where":"iglesia","when":null,"amount":null,"guess":[]})";
        const std::vector<std::string> bad = {
            R"({"action":"say","act":"tell","fact":2,"claim":)" + claim + "}",
            R"({"action":"say","act":"greet","text":null})",
            R"({"action":"say","act":"greet","text":""})",
            R"({"action":"say","act":"greet","text":"Dice \"hola\"."})",
            R"({"action":"say","act":"greet","text":"Hola\nLuis."})",
            R"({"action":"say","act":"greet","text":")" + std::string(121, 'a') + R"("})",
            R"({"action":"say","act":"tell","fact":1,"fact":2,"claim":)" + claim + R"(,"text":"Hola."})",
            R"({"action":"say","act":"tell","fact":2,"claim":{"who":"Pedro","who":"Pedro"},"text":"Hola."})",
            R"({"action":"say","act":"tell","fact":1,"claim":{"amount":10000000,"guess":["amount"]},"text":"Hola."})",
        };
        for (const std::string& raw : bad) {
            CAPTURE(raw);
            const json v = judge(card, raw);
            CHECK(reasons(v) == Reasons{"bad_shape"});
            CHECK(v["canonical"].is_string());  // read and not rejected: written all the same
        }
        // 120 characters, accents counted once, and the largest amount are fine
        std::string longest;
        for (int i = 0; i < 60; ++i) longest += "ñ.";
        CHECK(reasons(judge(card, R"({"action":"say","act":"greet","text":")" + longest + R"("})")).empty());
        CHECK(reasons(judge(card, R"({"action":"say","act":"tell","fact":1,"claim":{"amount":9999999,"guess":["amount"]},"text":"Hola."})")).empty());
        // the form and the rest are both reported
        CHECK(reasons(judge(card, R"({"action":"say","act":"tell","fact":1,"claim":{"where":"bar"},"text":"Dice \"x\"."})")) ==
              Reasons{"bad_shape", "invented"});
    }

    // --- canonical: the answer as the grammar writes it ---

    TEST_CASE("canonical: key order, spaces and null keys of the answer do not reach it") {
        const CardRecord card = decide_card(turn_request());
        const auto canonical = [&](const std::string& raw) {
            const json v = judge(card, raw);
            CHECK(reasons(v).empty());
            return v["canonical"].get<std::string>();
        };
        const std::string tell2 =
            R"({"action":"say","act":"tell","fact":2,"claim":{"who":"Pedro","where":"iglesia","when":"hoy 22:00","amount":null,"guess":["who","when"]},"text":"Pedro se casa hoy en la iglesia."})";
        CHECK(canonical(tell2) == tell2);
        CHECK(canonical(" {\n \"text\" : \"Pedro se casa hoy en la iglesia.\", \"claim\": {\"guess\": "
                        "[\"when\", \"who\", \"when\"], \"when\": \"hoy 22:00\", \"where\": \"iglesia\", "
                        "\"who\": \"Pedro\"}, \"act\": \"tell\", \"fact\": 2, \"action\": \"say\" }\n") == tell2);
        CHECK(canonical(R"({"action":"none","act":null,"fact":null,"claim":null,"text":null})") ==
              R"({"action":"none"})");
        CHECK(canonical(R"({"text":"¡Hola, Luis!","act":"greet","action":"say","claim":null})") ==
              R"({"action":"say","act":"greet","text":"¡Hola, Luis!"})");
        CHECK(canonical(R"({"action":"say","act":"ask","fact":1,"claim":null,"text":"¿Y la fiesta?"})") ==
              R"({"action":"say","act":"ask","fact":1,"text":"¿Y la fiesta?"})");
        // a claim with only some slots gets all five keys; marks on null slots stay
        CHECK(canonical(tell(1, R"({"amount":30,"guess":["amount","who"]})")) ==
              R"({"action":"say","act":"tell","fact":1,"claim":{"who":null,"where":null,"when":null,"amount":30,"guess":["who","amount"]},"text":"¿Te has enterado de lo último?"})");
    }

    TEST_CASE("canonical: the action as proposed, failed slots included") {
        const json v = judge(decide_card(turn_request()),
                             tell(2, R"({"where":"ermita","who":"Pedro","when":"mañana 21:30"})"));
        CHECK(reasons(v) == Reasons{"contradiction"});
        CHECK(v["canonical"] ==
              R"({"action":"say","act":"tell","fact":2,"claim":{"who":"Pedro","where":"ermita","when":"mañana 21:30","amount":null,"guess":[]},"text":"¿Te has enterado de lo último?"})");
    }

    TEST_CASE("canonical: go, in English, when relative to the tick of the request") {
        // Day 1 at 18:30: "today 22:00" is slot 48 + 44.
        DecisionRequest r = plan_request();
        r.tick += kTicksPerDay;
        r.facts[1].slots[idx(Slot::when)].value = kSlotsPerDay + 44;
        const json v = judge(decide_card(r, Lang::en),
                             R"({"fact":2,"action":"go","claim":{"when":"today 22:00","where":"church"}})");
        CHECK(reasons(v).empty());
        CHECK(v["canonical"] ==
              R"({"action":"go","fact":2,"claim":{"who":null,"where":"church","when":"today 22:00","amount":null,"guess":[]}})");
    }

    TEST_CASE("canonical: null when unreadable or rejected") {
        const CardRecord card = decide_card(turn_request());
        CHECK(judge(card, "roto")["canonical"].is_null());
        CHECK(judge(card, R"({"action":"say","act":"tell","fact":2,"text":"Hola."})")["canonical"].is_null());
        CHECK(judge(card, tell(3, R"({"who":"Pedro"})"))["canonical"].is_null());
    }

    // --- Incoherent text ---

    TEST_CASE("es: a text that contradicts the claim") {
        const CardRecord card = decide_card(turn_request());
        const std::string claim = R"({"who":"Pedro","where":"iglesia","when":"hoy 22:00","amount":null,"guess":[]})";
        CHECK(reasons(judge(card, tell(2, claim, "Pedro se casa hoy a las diez en la iglesia."))).empty());
        const json v = judge(card, tell(2, claim, "Pedro se casa en la ermita."));
        CHECK(reasons(v) == Reasons{"incoherent_text"});
        CHECK(v["slots"]["where"] == "faithful");
        CHECK(reasons(judge(card, tell(2, claim, "Pedro se casa a las nueve."))) == Reasons{"incoherent_text"});
        // the listener named in the text is not a statement about who
        CHECK(reasons(judge(card, tell(2, claim, "Luis, ¿sabes que Pedro se casa?"))).empty());
    }

    TEST_CASE("en: a text that contradicts the claim") {
        const CardRecord card = decide_card(turn_request(), Lang::en);
        const std::string claim = R"({"who":"Pedro","where":"church","when":"today 22:00","amount":null,"guess":[]})";
        CHECK(reasons(judge(card, tell(2, claim, "Pedro is getting married at the church at ten tonight."))).empty());
        CHECK(reasons(judge(card, tell(2, claim, "Pedro is getting married at the chapel."))) ==
              Reasons{"incoherent_text"});
        // the Spanish names are not English ones
        CHECK(reasons(judge(card, tell(2, R"({"who":null,"where":"iglesia","when":null,"amount":null,"guess":[]})"))) ==
              Reasons{"unreadable"});
    }

    // --- Contract version ---

    TEST_CASE("a card with another contract version") {
        CardRecord card = decide_card(turn_request());
        card.contract_version = 2;
        const json v = judge(card, tell(2, R"({"who":"Pedro","where":null,"when":null,"amount":null,"guess":[]})"));
        CHECK(reasons(v) == Reasons{"contract_version"});
        CHECK(v["ok"] == false);
        CHECK(reasons(judge(card, "nada")) == Reasons{"unreadable", "contract_version"});
    }

    // --- extract ---

    TEST_CASE("extract: a fact that matches the sentence") {
        json v = judge(extract_card(), R"({"what":"fiesta","who":null,"where":"plaza","when":"hoy 21:00","amount":50})");
        CHECK(reasons(v).empty());
        CHECK(v["slots"] == json::parse(R"({"who":"omitted","where":"faithful","when":"faithful","amount":"faithful"})"));
        // keys in another order, spaces, an omitted slot, the article kept
        v = judge(extract_card(), R"( { "when" : "hoy 21:00", "amount": null, "who": null, "where": "la plaza", "what": "fiesta" } )");
        CHECK(reasons(v).empty());
        CHECK(v["slots"]["amount"] == "omitted");
        CHECK(v["canonical"] == R"({"what":"fiesta","who":null,"where":"plaza","when":"hoy 21:00","amount":null})");
        v = judge(extract_card(Lang::en), R"({"what":"party","who":null,"where":"square","when":"today 21:00","amount":50})");
        CHECK(reasons(v).empty());
        CHECK(v["canonical"] == R"({"what":"party","who":null,"where":"square","when":"today 21:00","amount":50})");
    }

    TEST_CASE("extract: canonical names and labels; unknown names kept as written") {
        // a label of the vocabulary in its case, a name in its case, no article
        json v = judge(extract_card(Lang::es, false),
                       R"({"what":" Fiesta ","who":"pedro","where":"La Plaza","when":"mañana 09:30","amount":0})");
        CHECK(reasons(v).empty());
        CHECK(v["canonical"] == R"({"what":"fiesta","who":"Pedro","where":"plaza","when":"mañana 09:30","amount":0})");
        // free text stays as written (trimmed); unknown names too
        v = judge(extract_card(Lang::es, false),
                  R"({"what":"obras del puente","who":"Zacarías","where":"playa","when":null,"amount":null})");
        CHECK(reasons(v) == Reasons{"bad_vocab"});
        CHECK(v["canonical"] == R"({"what":"obras del puente","who":"Zacarías","where":"playa","when":null,"amount":null})");
        CHECK(judge(extract_card(), "{}")["canonical"].is_null());
    }

    TEST_CASE("extract: when is relative to the tick of the card") {
        const Tick tomorrow = kTicksPerDay + kNow;
        const json v = judge(extract_card(Lang::es, true, tomorrow),
                             R"({"what":"fiesta","who":null,"where":"plaza","when":"hoy 21:00","amount":50})");
        CHECK(reasons(v).empty());
        const json w = judge(extract_card(Lang::es, true, tomorrow),
                             R"({"what":"fiesta","who":null,"where":"plaza","when":"mañana 21:00","amount":50})");
        CHECK(reasons(w) == Reasons{"contradiction"});
        CHECK(w["slots"]["when"] == "contradiction");
    }

    TEST_CASE("extract: outside the vocabulary") {
        const json v = judge(extract_card(), R"({"what":"fiesta","who":null,"where":"playa","when":"hoy 21:00","amount":50})");
        CHECK(reasons(v) == Reasons{"bad_vocab"});
        CHECK(reasons(judge(extract_card(), R"({"what":"fiesta","who":"Zacarías","where":"plaza","when":"hoy 21:00","amount":50})")) ==
              Reasons{"bad_vocab"});
        // a home is not a place of `where`
        CHECK(reasons(judge(extract_card(), R"({"what":"fiesta","who":null,"where":"barrio alto","when":null,"amount":null})")) ==
              Reasons{"bad_vocab"});
    }

    TEST_CASE("extract: against the expected fact") {
        json v = judge(extract_card(), R"({"what":"fiesta","who":null,"where":"bar","when":"hoy 21:00","amount":50})");
        CHECK(reasons(v) == Reasons{"contradiction"});
        CHECK(v["slots"]["where"] == "contradiction");
        v = judge(extract_card(), R"({"what":"fiesta","who":"Pedro","where":"plaza","when":"hoy 21:00","amount":50})");
        CHECK(reasons(v) == Reasons{"invented"});
        CHECK(v["slots"]["who"] == "invented");
        // without an expected fact only the vocabulary counts
        v = judge(extract_card(Lang::es, false), R"({"what":"fiesta","who":"Pedro","where":"bar","when":null,"amount":null})");
        CHECK(reasons(v).empty());
        CHECK(v["slots"].is_null());
    }

    TEST_CASE("extract: unreadable and bad shape") {
        for (const char* raw : {"", "fiesta en la plaza", R"({"what":"fiesta","where":"plaza"})",
                                      R"({"what":"","who":null,"where":null,"when":null,"amount":null})",
                                      R"({"what":"fiesta","who":null,"where":null,"when":"esta noche","amount":null})",
                                      R"({"what":"fiesta","who":null,"where":null,"when":null,"amount":-3})"}) {
            CAPTURE(raw);
            CHECK(reasons(judge(extract_card(), raw)) == Reasons{"unreadable"});
        }
        CHECK(reasons(judge(extract_card(), R"({"what":"fiesta","who":null,"where":"bar","where":"plaza","when":"hoy 21:00","amount":50})")) ==
              Reasons{"bad_shape"});
        // a what or an amount the grammar of extract would not write
        const std::string what41(41, 'a');
        CHECK(reasons(judge(extract_card(Lang::es, false), R"({"what":")" + what41 + R"(","who":null,"where":null,"when":null,"amount":null})")) ==
              Reasons{"bad_shape"});
        CHECK(reasons(judge(extract_card(Lang::es, false), R"({"what":"la \"fiesta\"","who":null,"where":null,"when":null,"amount":null})")) ==
              Reasons{"bad_shape"});
        CHECK(reasons(judge(extract_card(Lang::es, false), R"({"what":"fiesta","who":null,"where":null,"when":null,"amount":10000000})")) ==
              Reasons{"bad_shape"});
    }

    // --- Files, order, --strict and errors ---

    TEST_CASE("train.jsonl as input: output where there is no raw, and it must be canonical") {
        const CardRecord card = decide_card(turn_request());
        const auto train_row = [&](const std::string& output) {
            ordered_json line;
            line["id"] = card.id;
            line["task"] = "decide";
            line["lang"] = "es";
            line["input"] = card.card;
            line["output"] = output;
            line["provider"] = "codex";
            line["model"] = "gpt-6.1-sol";
            line["fingerprint"] = card.fingerprint;
            return line.dump();
        };
        const Result r = run_validate({card}, {train_row(R"({"action":"none"})")}, {"--strict"});
        CHECK(r.code == 0);
        REQUIRE(r.lines.size() == 1);
        CHECK(json::parse(r.lines[0])["ok"] == true);
        // ok, but not in the form of the grammar
        const Result spaced = run_validate({card}, {train_row(R"({ "action": "none" })")}, {"--strict"});
        CHECK(spaced.code == 1);
        CHECK(json::parse(spaced.lines.at(0))["ok"] == true);
        CHECK(spaced.err.find("1 outputs differ from their canonical") != std::string::npos);
        CHECK(run_validate({card}, {train_row(R"({ "action": "none" })")}).code == 0);
        // a label with the same raw is not held to it
        CHECK(run_validate({card}, {label_line(card.id, R"({ "action": "none" })")}, {"--strict"}).code == 0);
    }

    TEST_CASE("one verdict per answer, in the order of the input, the same every time") {
        const CardRecord a = decide_card(turn_request(kNow));
        const CardRecord b = decide_card(turn_request(kNow + 1));
        const CardRecord c = extract_card(Lang::en);
        const CardRecord d = decide_card(turn_request(kNow), Lang::en);  // the twin of a
        REQUIRE(a.fingerprint == d.fingerprint);
        REQUIRE(a.id != d.id);
        const std::vector<std::string> in = {
            label_line(c.id, R"({"what":"party","who":null,"where":"square","when":"today 21:00","amount":50})"),
            label_line(b.id, "roto"),
            label_line(d.id, R"({"action":"none"})"),
            label_line(a.id, tell(1, R"({"who":null,"where":"bar","when":null,"amount":null,"guess":[]})")),
        };
        const Result r = run_validate({a, b, c, d}, in);
        CHECK(r.code == 0);
        REQUIRE(r.lines.size() == 4);
        CHECK(json::parse(r.lines[0])["id"] == c.id);
        CHECK(json::parse(r.lines[1])["id"] == b.id);
        CHECK(json::parse(r.lines[2])["id"] == d.id);
        CHECK(json::parse(r.lines[3])["id"] == a.id);
        CHECK(r.err == "validate: 4 answers, 2 ok, 2 discarded (invented 1, unreadable 1)\n");
        CHECK(run_validate({d, c, b, a}, in).lines == r.lines);
    }

    TEST_CASE("--strict: exit 1 when an answer is not ok") {
        const CardRecord a = decide_card(turn_request(kNow));
        const CardRecord b = decide_card(turn_request(kNow + 1));
        const std::vector<std::string> good = {label_line(a.id, R"({"action":"none"})")};
        CHECK(run_validate({a, b}, good, {"--strict"}).code == 0);
        const std::vector<std::string> mixed = {label_line(a.id, R"({"action":"none"})"),
                                                label_line(b.id, "roto")};
        const Result strict = run_validate({a, b}, mixed, {"--strict"});
        CHECK(strict.code == 1);
        CHECK(strict.lines.size() == 2);  // the verdicts are written all the same
        CHECK(strict.err.find("--strict: 1 answers are not ok") != std::string::npos);
        CHECK(run_validate({a, b}, mixed).code == 0);
    }

    TEST_CASE("errors stop the command and write nothing") {
        const CardRecord a = decide_card(turn_request(kNow));
        const CardRecord b = decide_card(turn_request(kNow + 1));
        const auto fails = [](const Result& r, const std::string& message) {
            CAPTURE(r.error.value_or("(no error)"));
            CHECK(r.code == 1);
            CHECK(r.error.value_or("").find(message) != std::string::npos);
            CHECK_FALSE(r.wrote);
        };
        const std::string none = R"({"action":"none"})";
        fails(run_validate({a}, {label_line(b.id, none)}), "no card for id");
        fails(run_validate({a}, {label_line(a.id, none), label_line(a.id, none)}), "repeated id");
        fails(run_validate({a}, {"{\"id\":"}), "in.jsonl:1: not a JSON object");
        fails(run_validate({a}, {R"({"raw":"{}"})"}), "no 'id'");
        fails(run_validate({a}, {R"({"id":")" + a.id + R"(","provider":"sonnet"})"}),
              "neither 'raw' nor 'output'");
        fails(run_validate({a}, {R"({"id":")" + a.id + R"(","raw":{"action":"none"}})"}),
              "'raw' is not a string");
        fails(run_validate({a}, {label_line(a.id, "x"), ""}), "in.jsonl:2: empty line");
        fails(run_validate({a, a}, {label_line(a.id, "x")}), "repeated card id");
        fails(run_validate({}, {label_line(a.id, "x")}), "no card for id");
    }

    TEST_CASE("a bad command line is a usage error") {
        std::vector<std::string> args = {"rumor", "validate", "--in", "a.jsonl", "--cards", "b.jsonl"};
        std::vector<char*> argv;
        for (std::string& s : args) argv.push_back(s.data());
        CHECK_THROWS_AS(validate_command(static_cast<int>(argv.size()), argv.data()), UsageError);
        args.push_back("--bogus");
        args.push_back("x");
        argv.clear();
        for (std::string& s : args) argv.push_back(s.data());
        CHECK_THROWS_AS(validate_command(static_cast<int>(argv.size()), argv.data()), UsageError);
    }
}

}  // namespace rumor
