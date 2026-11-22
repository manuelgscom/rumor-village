// The event log as JSONL, format 1 (contract, section 6; core/event.h).
//
// Writing builds an ordered_json per line, so the key order is the insertion
// order. Reading is strict: every object must have exactly its keys, in the
// order they are written, so that reading and writing again gives the same
// bytes.

#include <algorithm>
#include <cstdint>
#include <initializer_list>
#include <istream>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/log_api.h"

namespace rumor {
namespace {

using J = nlohmann::ordered_json;

// --- Writing -----------------------------------------------------------------

template <char P, int W>
J id_json(Id<P, W> id) {
    if (!id.valid()) throw std::logic_error("log: null identifier where one is required");
    return id.str();
}

template <char P, int W>
J opt_id_json(Id<P, W> id) {
    return id.valid() ? J(id.str()) : J(nullptr);
}

template <class E>
J enum_json(E value) {
    return std::string(key(value));
}

template <class T>
J opt_json(const std::optional<T>& value) {
    return value ? J(*value) : J(nullptr);
}

J slot_value_json(Slot slot, const std::optional<SlotValue>& value) {
    if (!value) return nullptr;
    switch (slot) {
        case Slot::who:
            if (*value <= 0) throw std::logic_error("log: bad neighbor in a who slot");
            return NeighborId(static_cast<std::uint32_t>(*value)).str();
        case Slot::where:
            if (*value <= 0) throw std::logic_error("log: bad place in a where slot");
            return PlaceId(static_cast<std::uint32_t>(*value)).str();
        case Slot::when:
        case Slot::amount:
            break;
    }
    return *value;
}

J slots_json(const PerSlot<std::optional<SlotValue>>& slots) {
    J j = J::object();
    for (Slot s : kSlots) j[std::string(key(s))] = slot_value_json(s, slots[idx(s)]);
    return j;
}

J claim_json(const std::optional<Claim>& claim) {
    if (!claim) return nullptr;
    J j = slots_json(claim->slots);
    J guess = J::array();
    for (Slot s : kSlots) {
        if (claim->guess[idx(s)]) guess.push_back(enum_json(s));
    }
    j["guess"] = std::move(guess);
    return j;
}

void put_verdict(J& j, const Verdict& verdict) {
    j["reject"] = verdict.reject == RejectReason::none ? J(nullptr) : enum_json(verdict.reject);
    if (!verdict.slots) {
        j["verdict"] = nullptr;
        return;
    }
    J v = J::object();
    for (Slot s : kSlots) v[std::string(key(s))] = enum_json((*verdict.slots)[idx(s)]);
    j["verdict"] = std::move(v);
}

J gen_json(const std::optional<Generation>& gen) {
    if (!gen) return nullptr;
    J j = J::object();
    j["t0"] = gen->t_start_ms;
    j["t1"] = gen->t_end_ms;
    j["in"] = gen->tokens_in;
    j["out"] = gen->tokens_out;
    return j;
}

J start(std::string_view type, Tick tick) {
    J j = J::object();
    j["type"] = std::string(type);
    j["tick"] = tick;
    return j;
}

J event_json(const MoveEvent& e) {
    J j = start("move", e.tick);
    j["who"] = id_json(e.who);
    j["from"] = id_json(e.from);
    j["to"] = id_json(e.to);
    j["arrive"] = e.arrive;
    j["fact"] = opt_id_json(e.fact);
    return j;
}

J event_json(const InjectEvent& e) {
    J j = start("inject", e.tick);
    j["fact"] = id_json(e.fact);
    j["text"] = opt_json(e.text);
    j["what"] = e.what;
    j["slots"] = slots_json(e.slots);
    J to = J::array();
    for (NeighborId n : e.to) to.push_back(id_json(n));
    j["to"] = std::move(to);
    return j;
}

J event_json(const ConvStartEvent& e) {
    J j = start("conv_start", e.tick);
    j["conv"] = id_json(e.conv);
    j["a"] = id_json(e.a);
    j["b"] = id_json(e.b);
    j["place"] = id_json(e.place);
    return j;
}

J event_json(const TurnEvent& e) {
    J j = start("turn", e.tick);
    j["id"] = e.id;
    j["conv"] = id_json(e.conv);
    j["n"] = e.n;
    j["who"] = id_json(e.who);
    j["to"] = id_json(e.to);
    j["card"] = e.card;
    j["action"] = enum_json(e.action);
    j["act"] = e.act ? enum_json(*e.act) : J(nullptr);
    j["fact"] = opt_id_json(e.fact);
    j["claim"] = claim_json(e.claim);
    put_verdict(j, e.verdict);
    J conflicts = J::array();
    for (Slot s : e.conflicts) conflicts.push_back(enum_json(s));
    j["conflicts"] = std::move(conflicts);
    j["text"] = opt_json(e.text);
    j["gen"] = gen_json(e.gen);
    return j;
}

J event_json(const ConvEndEvent& e) {
    J j = start("conv_end", e.tick);
    j["conv"] = id_json(e.conv);
    j["reason"] = enum_json(e.reason);
    return j;
}

J event_json(const MemoryEvent& e) {
    J j = start("memory", e.tick);
    j["who"] = id_json(e.who);
    j["fact"] = id_json(e.fact);
    j["slot"] = enum_json(e.slot);
    j["state"] = enum_json(e.state);
    j["value"] = slot_value_json(e.slot, e.value);
    j["cause"] = enum_json(e.cause);
    j["turn"] = e.turn == 0 ? J(nullptr) : J(e.turn);
    return j;
}

J event_json(const PlanEvent& e) {
    J j = start("plan", e.tick);
    j["id"] = e.id;
    j["who"] = id_json(e.who);
    j["card"] = e.card;
    j["action"] = enum_json(e.action);
    j["fact"] = opt_id_json(e.fact);
    j["claim"] = claim_json(e.claim);
    put_verdict(j, e.verdict);
    j["gen"] = gen_json(e.gen);
    return j;
}

J event_json(const ArriveEvent& e) {
    J j = start("arrive", e.tick);
    j["who"] = id_json(e.who);
    j["place"] = id_json(e.place);
    j["fact"] = id_json(e.fact);
    j["slot"] = e.slot;
    return j;
}

J event_json(const PerfEvent& e) {
    J j = start("perf", e.tick);
    j["batch"] = e.batch;
    j["tokens_per_s"] = e.tokens_per_s;
    j["decisions_per_s_milli"] = e.decisions_per_s_milli;
    j["vram_mb"] = e.vram_mb;
    return j;
}

J event_json(const EndEvent& e) {
    J j = start("end", e.tick);
    j["decisions"] = e.decisions;
    j["turns"] = e.turns;
    j["plans"] = e.plans;
    j["rejected"] = e.rejected;
    j["conversations"] = e.conversations;
    j["informed"] = e.informed;
    return j;
}

std::string dump(const J& j) {
    // Compact, UTF-8 as it is; invalid UTF-8 throws.
    return j.dump(-1, ' ', false, J::error_handler_t::strict);
}

// --- Reading -----------------------------------------------------------------

// A line that cannot be read; read_log adds the line number.
struct ReadError : std::runtime_error {
    using std::runtime_error::runtime_error;
};

[[noreturn]] void fail(const std::string& message) { throw ReadError(message); }

[[noreturn]] void fail_key(const std::string& name, const std::string& message) {
    fail("key '" + name + "': " + message);
}

template <class T>
T get_int(const J& v, const std::string& name) {
    if (!v.is_number_integer()) fail_key(name, "expected an integer");
    if (v.is_number_unsigned()) {
        const auto u = v.get<std::uint64_t>();
        if (!std::in_range<T>(u)) fail_key(name, "integer out of range");
        return static_cast<T>(u);
    }
    const auto s = v.get<std::int64_t>();
    if (!std::in_range<T>(s)) fail_key(name, "integer out of range");
    return static_cast<T>(s);
}

std::string get_string(const J& v, const std::string& name) {
    if (!v.is_string()) fail_key(name, "expected a string");
    return v.get<std::string>();
}

template <class IdT>
IdT get_id(const J& v, const std::string& name) {
    const std::string text = get_string(v, name);
    const std::optional<IdT> id = IdT::parse(text);
    if (!id) fail_key(name, "unknown identifier '" + text + "'");
    return *id;
}

template <class E>
E get_enum(const J& v, const std::string& name) {
    const std::string text = get_string(v, name);
    const std::optional<E> value = from_key<E>(text);
    if (!value) fail_key(name, "unknown value '" + text + "'");
    return *value;
}

const J& get_list(const J& v, const std::string& name) {
    if (!v.is_array()) fail_key(name, "expected a list");
    return v;
}

std::string item_name(const std::string& list, std::size_t i) {
    return list + "[" + std::to_string(i) + "]";
}

std::optional<SlotValue> get_slot_value(Slot slot, const J& v, const std::string& name) {
    if (v.is_null()) return std::nullopt;
    switch (slot) {
        case Slot::who:
            return static_cast<SlotValue>(get_id<NeighborId>(v, name).v);
        case Slot::where:
            return static_cast<SlotValue>(get_id<PlaceId>(v, name).v);
        case Slot::when:
        case Slot::amount:
            break;
    }
    return get_int<SlotValue>(v, name);
}

// An object with exactly these keys, in this order. `name` is its key path
// ("" for the line itself).
class Obj {
  public:
    Obj(const J& j, const std::string& name, std::initializer_list<std::string_view> keys)
        : j_(j), prefix_(name.empty() ? "" : name + ".") {
        if (!j.is_object()) {
            if (name.empty()) fail("expected a JSON object");
            fail_key(name, "expected an object");
        }
        for (std::string_view k : keys) {
            if (!j.contains(std::string(k))) fail("missing key '" + this->name(k) + "'");
        }
        for (const auto& item : j.items()) {
            if (std::find(keys.begin(), keys.end(), item.key()) == keys.end()) {
                fail("unknown key '" + this->name(item.key()) + "'");
            }
        }
        auto expected = keys.begin();
        for (const auto& item : j.items()) {
            if (item.key() != *expected) {
                fail("key '" + this->name(item.key()) + "' out of order (expected '" +
                     this->name(*expected) + "')");
            }
            ++expected;
        }
    }

    std::string name(std::string_view k) const { return prefix_ + std::string(k); }
    const J& at(std::string_view k) const { return j_.at(std::string(k)); }

    template <class T>
    T integer(std::string_view k) const { return get_int<T>(at(k), name(k)); }
    std::string str(std::string_view k) const { return get_string(at(k), name(k)); }
    std::optional<std::string> opt_str(std::string_view k) const {
        if (at(k).is_null()) return std::nullopt;
        return str(k);
    }
    template <class IdT>
    IdT id(std::string_view k) const { return get_id<IdT>(at(k), name(k)); }
    template <class IdT>
    IdT opt_id(std::string_view k) const {
        return at(k).is_null() ? IdT{} : id<IdT>(k);
    }
    template <class E>
    E enumv(std::string_view k) const { return get_enum<E>(at(k), name(k)); }
    const J& list(std::string_view k) const { return get_list(at(k), name(k)); }

  private:
    const J& j_;
    std::string prefix_;
};

PerSlot<std::optional<SlotValue>> read_slots(const J& v, const std::string& name) {
    const Obj o(v, name, {"who", "where", "when", "amount"});
    PerSlot<std::optional<SlotValue>> slots;
    for (Slot s : kSlots) slots[idx(s)] = get_slot_value(s, o.at(key(s)), o.name(key(s)));
    return slots;
}

std::optional<Claim> read_claim(const Obj& parent) {
    const J& v = parent.at("claim");
    if (v.is_null()) return std::nullopt;
    const std::string name = parent.name("claim");
    const Obj o(v, name, {"who", "where", "when", "amount", "guess"});
    Claim claim;
    for (Slot s : kSlots) claim.slots[idx(s)] = get_slot_value(s, o.at(key(s)), o.name(key(s)));
    const J& guess = o.list("guess");
    int last = -1;
    for (std::size_t i = 0; i < guess.size(); ++i) {
        const Slot s = get_enum<Slot>(guess[i], item_name(o.name("guess"), i));
        if (static_cast<int>(s) <= last) {
            fail_key(o.name("guess"), "slots must be in slot order, without repeats");
        }
        last = static_cast<int>(s);
        claim.guess[idx(s)] = true;
    }
    return claim;
}

Verdict read_verdict(const Obj& parent) {
    Verdict verdict;
    const J& reject = parent.at("reject");
    if (!reject.is_null()) {
        verdict.reject = parent.enumv<RejectReason>("reject");
        if (verdict.reject == RejectReason::none) {
            fail_key(parent.name("reject"), "null when not rejected, not 'none'");
        }
    }
    const J& v = parent.at("verdict");
    if (!v.is_null()) {
        const Obj o(v, parent.name("verdict"), {"who", "where", "when", "amount"});
        PerSlot<SlotVerdict> slots{};
        for (Slot s : kSlots) slots[idx(s)] = o.enumv<SlotVerdict>(key(s));
        verdict.slots = slots;
    }
    return verdict;
}

std::optional<Generation> read_gen(const Obj& parent) {
    const J& v = parent.at("gen");
    if (v.is_null()) return std::nullopt;
    const Obj o(v, parent.name("gen"), {"t0", "t1", "in", "out"});
    return Generation{o.integer<std::int64_t>("t0"), o.integer<std::int64_t>("t1"),
                      o.integer<int>("in"), o.integer<int>("out")};
}

LogHeader read_header(const J& j) {
    const Obj o(j, "", {"type", "format", "seed", "scenario", "lang", "policy", "model", "params",
                        "tick_seconds", "start_tick", "start_weekday", "places", "routes",
                        "neighbors", "relations"});
    LogHeader h;
    h.format = o.integer<int>("format");
    if (h.format != kLogFormat) {
        fail_key("format", "format " + std::to_string(h.format) + " is not supported (expected " +
                               std::to_string(kLogFormat) + ")");
    }
    if (!o.at("seed").is_number_unsigned()) fail_key("seed", "expected an unsigned integer");
    h.seed = o.at("seed").get<std::uint64_t>();
    h.scenario = o.str("scenario");
    h.lang = o.enumv<Lang>("lang");
    h.policy = o.str("policy");
    h.model = o.opt_str("model");

    const J& params = o.at("params");
    if (!params.is_object()) fail_key("params", "expected an object");
    for (const auto& item : params.items()) {
        h.params.emplace_back(item.key(),
                              get_int<std::int64_t>(item.value(), "params." + item.key()));
    }

    h.tick_seconds = o.integer<int>("tick_seconds");
    h.start_tick = o.integer<Tick>("start_tick");
    h.start_weekday = o.integer<int>("start_weekday");

    const J& places = o.list("places");
    for (std::size_t i = 0; i < places.size(); ++i) {
        const Obj p(places[i], item_name("places", i), {"id", "key", "name", "kind", "x", "y"});
        h.places.push_back({p.id<PlaceId>("id"), p.str("key"), p.str("name"),
                            p.enumv<PlaceKind>("kind"), p.integer<int>("x"), p.integer<int>("y")});
    }

    const J& routes = o.list("routes");
    for (std::size_t i = 0; i < routes.size(); ++i) {
        const Obj r(routes[i], item_name("routes", i), {"from", "to", "ticks", "path"});
        Route route{r.id<PlaceId>("from"), r.id<PlaceId>("to"), r.integer<Tick>("ticks"), {}};
        const J& path = r.list("path");
        for (std::size_t k = 0; k < path.size(); ++k) {
            const std::string name = item_name(r.name("path"), k);
            if (!path[k].is_array() || path[k].size() != 2) fail_key(name, "expected [x,y]");
            route.path.push_back(
                {get_int<int>(path[k][0], name + "[0]"), get_int<int>(path[k][1], name + "[1]")});
        }
        h.routes.push_back(std::move(route));
    }

    const J& neighbors = o.list("neighbors");
    for (std::size_t i = 0; i < neighbors.size(); ++i) {
        const Obj n(neighbors[i], item_name("neighbors", i),
                    {"id", "name", "gender", "job", "trait", "home"});
        Neighbor neighbor;
        neighbor.id = n.id<NeighborId>("id");
        neighbor.name = n.str("name");
        const std::string gender = n.str("gender");
        if (gender != "f" && gender != "m") {
            fail_key(n.name("gender"), "unknown value '" + gender + "'");
        }
        neighbor.female = gender == "f";
        neighbor.job = n.enumv<Job>("job");
        neighbor.trait = n.enumv<Trait>("trait");
        neighbor.home = n.id<PlaceId>("home");
        h.neighbors.push_back(std::move(neighbor));
    }

    const J& relations = o.list("relations");
    for (std::size_t i = 0; i < relations.size(); ++i) {
        const Obj r(relations[i], item_name("relations", i), {"a", "b", "type"});
        h.relations.push_back(
            {r.id<NeighborId>("a"), r.id<NeighborId>("b"), r.enumv<Relation>("type")});
    }
    return h;
}

Event read_event(const J& j, const std::string& type) {
    if (type == "move") {
        const Obj o(j, "", {"type", "tick", "who", "from", "to", "arrive", "fact"});
        return MoveEvent{o.integer<Tick>("tick"), o.id<NeighborId>("who"), o.id<PlaceId>("from"),
                         o.id<PlaceId>("to"), o.integer<Tick>("arrive"), o.opt_id<FactId>("fact")};
    }
    if (type == "inject") {
        const Obj o(j, "", {"type", "tick", "fact", "text", "what", "slots", "to"});
        InjectEvent e;
        e.tick = o.integer<Tick>("tick");
        e.fact = o.id<FactId>("fact");
        e.text = o.opt_str("text");
        e.what = o.str("what");
        e.slots = read_slots(o.at("slots"), "slots");
        const J& to = o.list("to");
        for (std::size_t i = 0; i < to.size(); ++i) {
            e.to.push_back(get_id<NeighborId>(to[i], item_name("to", i)));
        }
        return e;
    }
    if (type == "conv_start") {
        const Obj o(j, "", {"type", "tick", "conv", "a", "b", "place"});
        return ConvStartEvent{o.integer<Tick>("tick"), o.id<ConvId>("conv"),
                              o.id<NeighborId>("a"), o.id<NeighborId>("b"),
                              o.id<PlaceId>("place")};
    }
    if (type == "turn") {
        const Obj o(j, "", {"type", "tick", "id", "conv", "n", "who", "to", "card", "action", "act",
                            "fact", "claim", "reject", "verdict", "conflicts", "text", "gen"});
        TurnEvent e;
        e.tick = o.integer<Tick>("tick");
        e.id = o.integer<int>("id");
        e.conv = o.id<ConvId>("conv");
        e.n = o.integer<int>("n");
        e.who = o.id<NeighborId>("who");
        e.to = o.id<NeighborId>("to");
        e.card = o.str("card");
        e.action = o.enumv<ActionType>("action");
        if (!o.at("act").is_null()) e.act = o.enumv<Act>("act");
        e.fact = o.opt_id<FactId>("fact");
        e.claim = read_claim(o);
        e.verdict = read_verdict(o);
        const J& conflicts = o.list("conflicts");
        for (std::size_t i = 0; i < conflicts.size(); ++i) {
            e.conflicts.push_back(get_enum<Slot>(conflicts[i], item_name("conflicts", i)));
        }
        e.text = o.opt_str("text");
        e.gen = read_gen(o);
        return e;
    }
    if (type == "conv_end") {
        const Obj o(j, "", {"type", "tick", "conv", "reason"});
        return ConvEndEvent{o.integer<Tick>("tick"), o.id<ConvId>("conv"),
                            o.enumv<ConvEndReason>("reason")};
    }
    if (type == "memory") {
        const Obj o(j, "", {"type", "tick", "who", "fact", "slot", "state", "value", "cause",
                            "turn"});
        MemoryEvent e;
        e.tick = o.integer<Tick>("tick");
        e.who = o.id<NeighborId>("who");
        e.fact = o.id<FactId>("fact");
        e.slot = o.enumv<Slot>("slot");
        e.state = o.enumv<SlotState>("state");
        e.value = get_slot_value(e.slot, o.at("value"), "value");
        e.cause = o.enumv<MemoryCause>("cause");
        if (!o.at("turn").is_null()) {
            e.turn = o.integer<int>("turn");
            if (e.turn == 0) fail_key("turn", "null when no turn caused it, not 0");
        }
        return e;
    }
    if (type == "plan") {
        const Obj o(j, "", {"type", "tick", "id", "who", "card", "action", "fact", "claim",
                            "reject", "verdict", "gen"});
        PlanEvent e;
        e.tick = o.integer<Tick>("tick");
        e.id = o.integer<int>("id");
        e.who = o.id<NeighborId>("who");
        e.card = o.str("card");
        e.action = o.enumv<ActionType>("action");
        e.fact = o.opt_id<FactId>("fact");
        e.claim = read_claim(o);
        e.verdict = read_verdict(o);
        e.gen = read_gen(o);
        return e;
    }
    if (type == "arrive") {
        const Obj o(j, "", {"type", "tick", "who", "place", "fact", "slot"});
        return ArriveEvent{o.integer<Tick>("tick"), o.id<NeighborId>("who"),
                           o.id<PlaceId>("place"), o.id<FactId>("fact"),
                           o.integer<TimeSlot>("slot")};
    }
    if (type == "perf") {
        const Obj o(j, "", {"type", "tick", "batch", "tokens_per_s", "decisions_per_s_milli",
                            "vram_mb"});
        return PerfEvent{o.integer<Tick>("tick"), o.integer<int>("batch"),
                         o.integer<int>("tokens_per_s"), o.integer<int>("decisions_per_s_milli"),
                         o.integer<int>("vram_mb")};
    }
    if (type == "end") {
        const Obj o(j, "", {"type", "tick", "decisions", "turns", "plans", "rejected",
                            "conversations", "informed"});
        return EndEvent{o.integer<Tick>("tick"),          o.integer<int>("decisions"),
                        o.integer<int>("turns"),          o.integer<int>("plans"),
                        o.integer<int>("rejected"),       o.integer<int>("conversations"),
                        o.integer<int>("informed")};
    }
    if (type == "header") fail("the header can only be on line 1");
    fail("unknown event type '" + type + "'");
}

// Parses one line. Duplicate keys are an error: the parser would silently keep
// only one of them.
J parse_line(const std::string& text) {
    std::vector<std::set<std::string>> open;
    std::optional<std::string> duplicate;
    const J::parser_callback_t track = [&](int, J::parse_event_t event, J& parsed) {
        if (event == J::parse_event_t::object_start) {
            open.emplace_back();
        } else if (event == J::parse_event_t::object_end) {
            open.pop_back();
        } else if (event == J::parse_event_t::key && !duplicate) {
            const std::string& k = parsed.get_ref<const std::string&>();
            if (!open.back().insert(k).second) duplicate = k;
        }
        return true;
    };
    J j;
    try {
        j = J::parse(text, track);
    } catch (const J::parse_error& e) {
        fail("malformed JSON at byte " + std::to_string(e.byte));
    }
    if (duplicate) fail("repeated key '" + *duplicate + "'");
    return j;
}

// The "type" of a line, before reading the rest of it.
std::string line_type(const J& j) {
    if (!j.is_object()) fail("expected a JSON object");
    if (!j.contains("type")) fail("missing key 'type'");
    return get_string(j.at("type"), "type");
}

}  // namespace

std::string write_header(const LogHeader& h) {
    J j = J::object();
    j["type"] = "header";
    j["format"] = h.format;
    j["seed"] = h.seed;
    j["scenario"] = h.scenario;
    j["lang"] = enum_json(h.lang);
    j["policy"] = h.policy;
    j["model"] = opt_json(h.model);
    J params = J::object();
    for (const auto& [name, value] : h.params) params[name] = value;
    j["params"] = std::move(params);
    j["tick_seconds"] = h.tick_seconds;
    j["start_tick"] = h.start_tick;
    j["start_weekday"] = h.start_weekday;

    J places = J::array();
    for (const HeaderPlace& p : h.places) {
        J o = J::object();
        o["id"] = id_json(p.id);
        o["key"] = p.key;
        o["name"] = p.name;
        o["kind"] = enum_json(p.kind);
        o["x"] = p.x;
        o["y"] = p.y;
        places.push_back(std::move(o));
    }
    j["places"] = std::move(places);

    J routes = J::array();
    for (const Route& r : h.routes) {
        J o = J::object();
        o["from"] = id_json(r.from);
        o["to"] = id_json(r.to);
        o["ticks"] = r.ticks;
        J path = J::array();
        for (const Point& pt : r.path) path.push_back(J::array({pt.x, pt.y}));
        o["path"] = std::move(path);
        routes.push_back(std::move(o));
    }
    j["routes"] = std::move(routes);

    J neighbors = J::array();
    for (const Neighbor& n : h.neighbors) {
        J o = J::object();
        o["id"] = id_json(n.id);
        o["name"] = n.name;
        o["gender"] = n.female ? "f" : "m";
        o["job"] = enum_json(n.job);
        o["trait"] = enum_json(n.trait);
        o["home"] = id_json(n.home);
        neighbors.push_back(std::move(o));
    }
    j["neighbors"] = std::move(neighbors);

    J relations = J::array();
    for (const RelationEdge& r : h.relations) {
        J o = J::object();
        o["a"] = id_json(r.a);
        o["b"] = id_json(r.b);
        o["type"] = enum_json(r.type);
        relations.push_back(std::move(o));
    }
    j["relations"] = std::move(relations);
    return dump(j);
}

std::string write_event(const Event& event) {
    return dump(std::visit([](const auto& e) { return event_json(e); }, event));
}

Log read_log(std::istream& in) {
    Log log;
    std::string text;
    int line = 0;
    while (std::getline(in, text)) {
        ++line;
        try {
            if (text.empty()) fail("empty line");
            const J j = parse_line(text);
            const std::string type = line_type(j);
            if (line == 1) {
                if (type != "header") fail("the first line must be the header, found type '" + type + "'");
                log.header = read_header(j);
            } else {
                log.events.push_back(read_event(j, type));
            }
        } catch (const ReadError& e) {
            throw LogError(line, e.what());
        } catch (const nlohmann::json::exception& e) {
            throw LogError(line, std::string("bad value: ") + e.what());
        }
    }
    if (line == 0) throw LogError(1, "empty log: the header is missing");
    return log;
}

}  // namespace rumor
