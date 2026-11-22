#include <doctest/doctest.h>

#include <sstream>
#include <string>
#include <vector>

#include "core/log_api.h"

using namespace rumor;

namespace {

LogHeader sample_header() {
    LogHeader h;
    h.seed = 18446744073709551615ull;
    h.scenario = "party-25";
    h.lang = Lang::es;
    h.policy = "baseline";
    h.params = {{"neighbors", 25}, {"max_turns", 8}, {"forget_ppm", 2500}, {"neg", -3}};
    h.tick_seconds = 60;
    h.start_tick = 480;
    h.start_weekday = 1;
    h.places = {{PlaceId(1), "square", "plaza", PlaceKind::public_place, 500, 350},
                {PlaceId(13), "upper_quarter", "barrio de arriba", PlaceKind::home, 120, 80}};
    h.routes = {{PlaceId(1), PlaceId(13), 3, {{500, 350}, {420, 300}, {120, 80}}}};
    h.neighbors = {{NeighborId(1), "Carmen", true, Job::baker, Trait::gossip, PlaceId(13)},
                   {NeighborId(2), "Ramón", false, Job::priest, Trait::shy, PlaceId(13)}};
    h.relations = {{NeighborId(1), NeighborId(2), Relation::friend_}};
    return h;
}

const char* const kHeaderLine =
    R"({"type":"header","format":1,"seed":18446744073709551615,"scenario":"party-25","lang":"es",)"
    R"("policy":"baseline","model":null,)"
    R"("params":{"neighbors":25,"max_turns":8,"forget_ppm":2500,"neg":-3},)"
    R"("tick_seconds":60,"start_tick":480,"start_weekday":1,)"
    R"("places":[{"id":"p01","key":"square","name":"plaza","kind":"public","x":500,"y":350},)"
    R"({"id":"p13","key":"upper_quarter","name":"barrio de arriba","kind":"home","x":120,"y":80}],)"
    R"("routes":[{"from":"p01","to":"p13","ticks":3,"path":[[500,350],[420,300],[120,80]]}],)"
    R"("neighbors":[{"id":"n001","name":"Carmen","gender":"f","job":"baker","trait":"gossip","home":"p13"},)"
    R"({"id":"n002","name":"Ramón","gender":"m","job":"priest","trait":"shy","home":"p13"}],)"
    R"("relations":[{"a":"n001","b":"n002","type":"friend"}]})";

Claim claim_when_guess() {
    Claim c;
    c.slots = {std::nullopt, 1, 44, std::nullopt};
    c.guess[idx(Slot::when)] = true;
    return c;
}

TurnEvent told_turn() {
    TurnEvent e;
    e.tick = 612;
    e.id = 3;
    e.conv = ConvId(1);
    e.n = 3;
    e.who = NeighborId(1);
    e.to = NeighborId(2);
    e.card = "9f2c";
    e.action = ActionType::say;
    e.act = Act::tell;
    e.fact = FactId(1);
    e.claim = claim_when_guess();
    e.verdict.slots = PerSlot<SlotVerdict>{SlotVerdict::omitted, SlotVerdict::faithful,
                                           SlotVerdict::declared_guess, SlotVerdict::omitted};
    return e;
}

TurnEvent full_turn() {
    TurnEvent e = told_turn();
    e.claim->slots = {17, 3, 44, 50};
    e.claim->guess = {true, false, true, true};
    e.verdict.slots = PerSlot<SlotVerdict>{SlotVerdict::invented, SlotVerdict::contradiction,
                                           SlotVerdict::hardened_doubt, SlotVerdict::faithful};
    e.conflicts = {Slot::where, Slot::amount};
    e.text = "¿Sabes lo de la fiesta? \"Dicen\" que es en la plaza.\n";
    e.gen = Generation{1234567890123, 1234567890456, 812, 37};
    return e;
}

TurnEvent rejected_turn() {
    TurnEvent e;
    e.tick = 615;
    e.id = 5;
    e.conv = ConvId(12);
    e.n = 4;
    e.who = NeighborId(2);
    e.to = NeighborId(1);
    e.card = "abcd";
    e.action = ActionType::none;
    e.verdict.reject = RejectReason::malformed;
    e.gen = Generation{10, 20, 300, 4};
    return e;
}

PlanEvent go_plan() {
    PlanEvent e;
    e.tick = 613;
    e.id = 4;
    e.who = NeighborId(2);
    e.card = "51ab";
    e.action = ActionType::go;
    e.fact = FactId(1);
    e.claim = claim_when_guess();
    e.verdict.slots = PerSlot<SlotVerdict>{SlotVerdict::omitted, SlotVerdict::faithful,
                                           SlotVerdict::faithful, SlotVerdict::omitted};
    return e;
}

// One event of each type plus the optional variants, with its expected line.
struct Sample {
    Event event;
    std::string line;
};

std::vector<Sample> samples() {
    InjectEvent inject{600, FactId(1), std::nullopt, "party", {3, 1, 42, 50}, {NeighborId(1)}};
    InjectEvent inject_text{600,         FactId(2), "Dicen que Ramón ganó la lotería", "lottery",
                            {2, std::nullopt, std::nullopt, 1000}, {NeighborId(1), NeighborId(2)}};
    InjectEvent inject_nobody{601, FactId(3), std::nullopt, "fine", {}, {}};
    PlanEvent none_plan{700, 6, NeighborId(1), "ffff", ActionType::none, FactId(), std::nullopt,
                        Verdict{}, std::nullopt};
    PlanEvent rejected_plan = none_plan;
    rejected_plan.verdict.reject = RejectReason::action_not_allowed;
    PlanEvent gen_plan = go_plan();
    gen_plan.gen = Generation{0, 0, 0, 0};
    TurnEvent greet{611, 2, ConvId(1), 1, NeighborId(1), NeighborId(2), "c0de", ActionType::say,
                    Act::greet, FactId(), std::nullopt, Verdict{}, {}, std::nullopt, std::nullopt};
    return {
        {MoveEvent{540, NeighborId(1), PlaceId(13), PlaceId(5), 546, FactId()},
         R"({"type":"move","tick":540,"who":"n001","from":"p13","to":"p05","arrive":546,"fact":null})"},
        {MoveEvent{1300, NeighborId(2), PlaceId(13), PlaceId(1), 1303, FactId(1)},
         R"({"type":"move","tick":1300,"who":"n002","from":"p13","to":"p01","arrive":1303,"fact":"f1"})"},
        {inject,
         R"({"type":"inject","tick":600,"fact":"f1","text":null,"what":"party",)"
         R"("slots":{"who":"n003","where":"p01","when":42,"amount":50},"to":["n001"]})"},
        {inject_text,
         R"({"type":"inject","tick":600,"fact":"f2","text":"Dicen que Ramón ganó la lotería",)"
         R"("what":"lottery","slots":{"who":"n002","where":null,"when":null,"amount":1000},)"
         R"("to":["n001","n002"]})"},
        {inject_nobody,
         R"({"type":"inject","tick":601,"fact":"f3","text":null,"what":"fine",)"
         R"("slots":{"who":null,"where":null,"when":null,"amount":null},"to":[]})"},
        {ConvStartEvent{610, ConvId(1), NeighborId(1), NeighborId(2), PlaceId(2)},
         R"({"type":"conv_start","tick":610,"conv":"c1","a":"n001","b":"n002","place":"p02"})"},
        {greet,
         R"({"type":"turn","tick":611,"id":2,"conv":"c1","n":1,"who":"n001","to":"n002","card":"c0de",)"
         R"("action":"say","act":"greet","fact":null,"claim":null,"reject":null,"verdict":null,)"
         R"("conflicts":[],"text":null,"gen":null})"},
        {told_turn(),
         R"({"type":"turn","tick":612,"id":3,"conv":"c1","n":3,"who":"n001","to":"n002","card":"9f2c",)"
         R"("action":"say","act":"tell","fact":"f1",)"
         R"("claim":{"who":null,"where":"p01","when":44,"amount":null,"guess":["when"]},"reject":null,)"
         R"("verdict":{"who":"omitted","where":"faithful","when":"declared_guess","amount":"omitted"},)"
         R"("conflicts":[],"text":null,"gen":null})"},
        {full_turn(),
         R"({"type":"turn","tick":612,"id":3,"conv":"c1","n":3,"who":"n001","to":"n002","card":"9f2c",)"
         R"("action":"say","act":"tell","fact":"f1",)"
         R"("claim":{"who":"n017","where":"p03","when":44,"amount":50,"guess":["who","when","amount"]},)"
         R"("reject":null,)"
         R"("verdict":{"who":"invented","where":"contradiction","when":"hardened_doubt","amount":"faithful"},)"
         R"("conflicts":["where","amount"],)"
         R"("text":"¿Sabes lo de la fiesta? \"Dicen\" que es en la plaza.\n",)"
         R"("gen":{"t0":1234567890123,"t1":1234567890456,"in":812,"out":37}})"},
        {rejected_turn(),
         R"({"type":"turn","tick":615,"id":5,"conv":"c12","n":4,"who":"n002","to":"n001","card":"abcd",)"
         R"("action":"none","act":null,"fact":null,"claim":null,"reject":"malformed","verdict":null,)"
         R"("conflicts":[],"text":null,"gen":{"t0":10,"t1":20,"in":300,"out":4}})"},
        {MemoryEvent{612, NeighborId(2), FactId(1), Slot::when, SlotState::doubt, 44,
                     MemoryCause::told, 3},
         R"({"type":"memory","tick":612,"who":"n002","fact":"f1","slot":"when","state":"doubt",)"
         R"("value":44,"cause":"told","turn":3})"},
        {MemoryEvent{900, NeighborId(2), FactId(1), Slot::who, SlotState::forgotten, std::nullopt,
                     MemoryCause::forgot, 0},
         R"({"type":"memory","tick":900,"who":"n002","fact":"f1","slot":"who","state":"forgotten",)"
         R"("value":null,"cause":"forgot","turn":null})"},
        {MemoryEvent{600, NeighborId(1), FactId(1), Slot::who, SlotState::sure, 3,
                     MemoryCause::inject, 0},
         R"({"type":"memory","tick":600,"who":"n001","fact":"f1","slot":"who","state":"sure",)"
         R"("value":"n003","cause":"inject","turn":null})"},
        {MemoryEvent{620, NeighborId(1), FactId(1), Slot::where, SlotState::sure, 12,
                     MemoryCause::doubt_dropped, 7},
         R"({"type":"memory","tick":620,"who":"n001","fact":"f1","slot":"where","state":"sure",)"
         R"("value":"p12","cause":"doubt_dropped","turn":7})"},
        {ConvEndEvent{614, ConvId(1), ConvEndReason::bye},
         R"({"type":"conv_end","tick":614,"conv":"c1","reason":"bye"})"},
        {ConvEndEvent{640, ConvId(12), ConvEndReason::max_turns},
         R"({"type":"conv_end","tick":640,"conv":"c12","reason":"max_turns"})"},
        {go_plan(),
         R"({"type":"plan","tick":613,"id":4,"who":"n002","card":"51ab","action":"go","fact":"f1",)"
         R"("claim":{"who":null,"where":"p01","when":44,"amount":null,"guess":["when"]},"reject":null,)"
         R"("verdict":{"who":"omitted","where":"faithful","when":"faithful","amount":"omitted"},"gen":null})"},
        {gen_plan,
         R"({"type":"plan","tick":613,"id":4,"who":"n002","card":"51ab","action":"go","fact":"f1",)"
         R"("claim":{"who":null,"where":"p01","when":44,"amount":null,"guess":["when"]},"reject":null,)"
         R"("verdict":{"who":"omitted","where":"faithful","when":"faithful","amount":"omitted"},)"
         R"("gen":{"t0":0,"t1":0,"in":0,"out":0}})"},
        {none_plan,
         R"({"type":"plan","tick":700,"id":6,"who":"n001","card":"ffff","action":"none","fact":null,)"
         R"("claim":null,"reject":null,"verdict":null,"gen":null})"},
        {rejected_plan,
         R"({"type":"plan","tick":700,"id":6,"who":"n001","card":"ffff","action":"none","fact":null,)"
         R"("claim":null,"reject":"action_not_allowed","verdict":null,"gen":null})"},
        {ArriveEvent{1320, NeighborId(2), PlaceId(1), FactId(1), 44},
         R"({"type":"arrive","tick":1320,"who":"n002","place":"p01","fact":"f1","slot":44})"},
        {PerfEvent{612, 32, 1900, 15600, 4500},
         R"({"type":"perf","tick":612,"batch":32,"tokens_per_s":1900,"decisions_per_s_milli":15600,"vram_mb":4500})"},
        {EndEvent{1440, 812, 790, 22, 1, 201, 19},
         R"({"type":"end","tick":1440,"decisions":812,"turns":790,"plans":22,"rejected":1,"conversations":201,"informed":19})"},
    };
}

std::string log_text(const LogHeader& header, const std::vector<Event>& events) {
    std::string out = write_header(header) + "\n";
    for (const Event& e : events) out += write_event(e) + "\n";
    return out;
}

Log read_text(const std::string& text) {
    std::istringstream in(text);
    return read_log(in);
}

// Reads a log that must fail; returns the error.
LogError read_error(const std::string& text) {
    try {
        read_text(text);
    } catch (const LogError& e) {
        return e;
    }
    FAIL("the log was read without error");
    return LogError(0, "");
}

// A valid log whose line `line` (from 1) is replaced by `replacement`.
std::string with_line(int line, const std::string& replacement) {
    std::vector<std::string> lines = {kHeaderLine};
    for (const Sample& s : samples()) lines.push_back(s.line);
    lines[static_cast<std::size_t>(line - 1)] = replacement;
    std::string out;
    for (const std::string& l : lines) out += l + "\n";
    return out;
}

void check_error(int line, const std::string& replacement, const std::string& expected) {
    const LogError e = read_error(with_line(line, replacement));
    CHECK(e.line() == line);
    CHECK(std::string(e.what()) == "line " + std::to_string(line) + ": " + expected);
}

}  // namespace

TEST_SUITE("log") {

TEST_CASE("the header is written with its keys in order and read back") {
    const LogHeader h = sample_header();
    CHECK(write_header(h) == kHeaderLine);
    const Log log = read_text(write_header(h) + "\n");
    CHECK(log.header == h);
    CHECK(log.events.empty());
    CHECK(write_header(log.header) == kHeaderLine);

    LogHeader model = h;
    model.model = "qwen3-4b";
    model.seed = 1;
    model.lang = Lang::en;
    model.params.clear();
    model.places.clear();
    model.routes.clear();
    model.neighbors.clear();
    model.relations.clear();
    const std::string line = write_header(model);
    CHECK(line ==
          R"({"type":"header","format":1,"seed":1,"scenario":"party-25","lang":"en","policy":"baseline",)"
          R"("model":"qwen3-4b","params":{},"tick_seconds":60,"start_tick":480,"start_weekday":1,)"
          R"("places":[],"routes":[],"neighbors":[],"relations":[]})");
    CHECK(read_text(line).header == model);
}

TEST_CASE("each event type is written as its exact line and read back without loss") {
    const LogHeader h = sample_header();
    for (const Sample& s : samples()) {
        CAPTURE(s.line);
        const std::string line = write_event(s.event);
        CHECK(line == s.line);
        const Log log = read_text(kHeaderLine + std::string("\n") + line);
        REQUIRE(log.events.size() == 1);
        CHECK(log.events[0] == s.event);
        CHECK(write_event(log.events[0]) == line);
    }
}

TEST_CASE("all ten event types are covered") {
    std::vector<bool> seen(std::variant_size_v<Event>, false);
    for (const Sample& s : samples()) seen[s.event.index()] = true;
    for (std::size_t i = 0; i < seen.size(); ++i) CHECK(seen[i]);
}

TEST_CASE("the same events give the same bytes, and a whole log round-trips") {
    const LogHeader h = sample_header();
    std::vector<Event> events;
    for (const Sample& s : samples()) events.push_back(s.event);
    const std::string first = log_text(h, events);
    const std::string second = log_text(h, events);
    CHECK(first == second);
    CHECK(first.find('\r') == std::string::npos);

    const Log log = read_text(first);
    CHECK(log.header == h);
    CHECK(log.events == events);
    CHECK(log_text(log.header, log.events) == first);

    // Without the final newline it reads the same.
    CHECK(read_text(first.substr(0, first.size() - 1)).events == events);
}

TEST_CASE("names keep their accents as UTF-8") {
    const std::string line = write_header(sample_header());
    CHECK(line.find("Ramón") != std::string::npos);
    CHECK(line.find("\\u") == std::string::npos);
}

TEST_CASE("an unreadable log says the line and the reason") {
    // Each case replaces one line of a valid log (header plus the samples).
    check_error(3, R"({"type":"move","tick":540,)", "malformed JSON at byte 27");
    check_error(1, R"({"type":"move","tick":540,"who":"n001","from":"p13","to":"p05","arrive":546,"fact":null})",
                "the first line must be the header, found type 'move'");
    check_error(4, kHeaderLine, "the header can only be on line 1");
    check_error(5, R"({"type":"jump","tick":1})", "unknown event type 'jump'");
    check_error(5, R"({"tick":1})", "missing key 'type'");
    check_error(5, R"({"type":7})", "key 'type': expected a string");
    check_error(5, R"([1,2])", "expected a JSON object");
    check_error(2, R"({"type":"move","tick":540,"who":"n001","from":"p13","to":"p05","arrive":546})",
                "missing key 'fact'");
    check_error(2, R"({"type":"move","tick":540,"who":"n001","from":"p13","to":"p05","arrive":546,"fact":null,"x":1})",
                "unknown key 'x'");
    check_error(2, R"({"type":"move","tick":540,"from":"p13","who":"n001","to":"p05","arrive":546,"fact":null})",
                "key 'from' out of order (expected 'who')");
    check_error(2, R"({"type":"move","tick":540,"who":"n001","who":"n002","from":"p13","to":"p05","arrive":546,"fact":null})",
                "repeated key 'who'");
    check_error(2, R"({"type":"move","tick":"540","who":"n001","from":"p13","to":"p05","arrive":546,"fact":null})",
                "key 'tick': expected an integer");
    check_error(2, R"({"type":"move","tick":540.5,"who":"n001","from":"p13","to":"p05","arrive":546,"fact":null})",
                "key 'tick': expected an integer");
    check_error(2, R"({"type":"move","tick":4294967296,"who":"n001","from":"p13","to":"p05","arrive":546,"fact":null})",
                "key 'tick': integer out of range");
    check_error(2, R"({"type":"move","tick":540,"who":"n17","from":"p13","to":"p05","arrive":546,"fact":null})",
                "key 'who': unknown identifier 'n17'");
    check_error(2, R"({"type":"move","tick":540,"who":"n001","from":"p13","to":"p05","arrive":546,"fact":"n001"})",
                "key 'fact': unknown identifier 'n001'");
    check_error(16, R"({"type":"conv_end","tick":614,"conv":"c1","reason":"hello"})",
                "key 'reason': unknown value 'hello'");
    check_error(7,
                R"({"type":"turn","tick":612,"id":3,"conv":"c1","n":3,"who":"n001","to":"n002","card":"9f2c",)"
                R"("action":"say","act":"tell","fact":"f1",)"
                R"("claim":{"who":null,"where":"p01","when":44,"amount":null,"guess":["when","who"]},"reject":null,)"
                R"("verdict":{"who":"omitted","where":"faithful","when":"declared_guess","amount":"omitted"},)"
                R"("conflicts":[],"text":null,"gen":null})",
                "key 'claim.guess': slots must be in slot order, without repeats");
    check_error(7,
                R"({"type":"turn","tick":612,"id":3,"conv":"c1","n":3,"who":"n001","to":"n002","card":"9f2c",)"
                R"("action":"say","act":"tell","fact":"f1",)"
                R"("claim":{"who":null,"where":"square","when":44,"amount":null,"guess":[]},"reject":null,)"
                R"("verdict":null,"conflicts":[],"text":null,"gen":null})",
                "key 'claim.where': unknown identifier 'square'");
    check_error(7,
                R"({"type":"turn","tick":612,"id":3,"conv":"c1","n":3,"who":"n001","to":"n002","card":"9f2c",)"
                R"("action":"say","act":"tell","fact":"f1","claim":null,"reject":"none",)"
                R"("verdict":null,"conflicts":[],"text":null,"gen":null})",
                "key 'reject': null when not rejected, not 'none'");
    check_error(7,
                R"({"type":"turn","tick":612,"id":3,"conv":"c1","n":3,"who":"n001","to":"n002","card":"9f2c",)"
                R"("action":"say","act":"tell","fact":"f1","claim":null,"reject":null,)"
                R"("verdict":{"who":"omitted","where":"faithful","when":"faithful"},)"
                R"("conflicts":[],"text":null,"gen":null})",
                "missing key 'verdict.amount'");
    check_error(7,
                R"({"type":"turn","tick":612,"id":3,"conv":"c1","n":3,"who":"n001","to":"n002","card":"9f2c",)"
                R"("action":"say","act":"tell","fact":"f1","claim":null,"reject":null,"verdict":null,)"
                R"("conflicts":["where",3],"text":null,"gen":null})",
                "key 'conflicts[1]': expected a string");
    check_error(7,
                R"({"type":"turn","tick":612,"id":3,"conv":"c1","n":3,"who":"n001","to":"n002","card":"9f2c",)"
                R"("action":"say","act":"tell","fact":"f1","claim":null,"reject":null,"verdict":null,)"
                R"("conflicts":[],"text":null,"gen":{"t0":1,"t1":2,"in":3}})",
                "missing key 'gen.out'");
    check_error(11,
                R"({"type":"memory","tick":612,"who":"n002","fact":"f1","slot":"when","state":"doubt",)"
                R"("value":44,"cause":"told","turn":0})",
                "key 'turn': null when no turn caused it, not 0");
    check_error(11,
                R"({"type":"memory","tick":612,"who":"n002","fact":"f1","slot":"who","state":"doubt",)"
                R"("value":44,"cause":"told","turn":3})",
                "key 'value': expected a string");
    check_error(3,
                R"({"type":"inject","tick":600,"fact":"f1","text":null,"what":"party",)"
                R"("slots":{"who":"n003","where":"p01","when":42},"to":["n001"]})",
                "missing key 'slots.amount'");
    check_error(3,
                R"({"type":"inject","tick":600,"fact":"f1","text":null,"what":"party",)"
                R"("slots":{"who":"n003","where":"p01","when":42,"amount":50},"to":"n001"})",
                "key 'to': expected a list");
}

TEST_CASE("an unreadable header says the key") {
    std::string bad = kHeaderLine;
    bad.replace(bad.find(R"("format":1)"), 10, R"("format":2)");
    check_error(1, bad, "key 'format': format 2 is not supported (expected 1)");

    bad = kHeaderLine;
    bad.replace(bad.find(R"("gender":"m")"), 12, R"("gender":"x")");
    check_error(1, bad, "key 'neighbors[1].gender': unknown value 'x'");

    bad = kHeaderLine;
    bad.replace(bad.find("[420,300]"), 9, "[420]");
    check_error(1, bad, "key 'routes[0].path[1]': expected [x,y]");

    bad = kHeaderLine;
    bad.replace(bad.find(R"("seed":18446744073709551615)"), 27, R"("seed":-1)");
    check_error(1, bad, "key 'seed': expected an unsigned integer");

    bad = kHeaderLine;
    bad.replace(bad.find(R"("max_turns":8)"), 13, R"("max_turns":"8")");
    check_error(1, bad, "key 'params.max_turns': expected an integer");

    bad = kHeaderLine;
    bad.replace(bad.find(R"("kind":"home")"), 13, R"("kind":"house")");
    check_error(1, bad, "key 'places[1].kind': unknown value 'house'");
}

TEST_CASE("empty lines and empty logs are errors") {
    const std::string valid = with_line(1, kHeaderLine);
    const std::size_t third = valid.find('\n', valid.find('\n') + 1) + 1;
    std::string blank = valid;
    blank.insert(third, "\n");
    const LogError e = read_error(blank);
    CHECK(e.line() == 3);
    CHECK(std::string(e.what()) == "line 3: empty line");

    const LogError none = read_error("");
    CHECK(none.line() == 1);
    CHECK(std::string(none.what()) == "line 1: empty log: the header is missing");
}

}  // TEST_SUITE("log")
