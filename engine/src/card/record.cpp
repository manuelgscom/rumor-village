// The card record of cards.jsonl (card/record.h).
//
// Writing builds an ordered_json, so the key order is the insertion order.
// Reading is strict, as the log (src/log): every object must have exactly its
// keys, in the order they are written, so that reading and writing again gives
// the same bytes.

#include "card/record.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/sha256.h"

namespace rumor {
namespace {

using J = nlohmann::ordered_json;

constexpr std::size_t kIdHexDigits = 16;
constexpr std::size_t kPrefixHexDigits = 12;
constexpr std::size_t kFingerprintHexDigits = 64;

bool is_lower_hex(std::string_view text, std::size_t size) {
    return text.size() == size && std::all_of(text.begin(), text.end(), [](char c) {
               return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
           });
}

// The rules of a record that read_card checks (card/record.h). Empty when the
// record keeps them all.
std::string broken_rule(const CardRecord& r) {
    if (r.task == CardTask::decide) {
        if (!r.kind) return "a decide card needs a kind";
        if (!r.state.request) return "a decide card needs state.request";
        if (*r.kind != r.state.request->kind) return "kind does not match state.request.kind";
        if (r.state.tick != 0 || r.state.fact) {
            return "a decide card has no state.tick or state.fact";
        }
    } else {
        if (r.kind) return "an extract card has kind null";
        if (r.state.request) return "an extract card has no state.request";
    }
    if (r.source.variant == CardVariant::rival &&
        (r.task != CardTask::decide || r.kind != DecisionKind::turn ||
         r.state.request->relation != Relation::rival)) {
        return "a rival twin is a decide turn with the relation rival";
    }
    if (r.strata.empty()) return "strata is empty";
    for (std::size_t i = 0; i < r.strata.size(); ++i) {
        for (std::size_t k = 0; k < i; ++k) {
            if (r.strata[k] == r.strata[i]) {
                return "repeated stratum '" + std::string(key(r.strata[i])) + "'";
            }
        }
    }
    const bool extract_stratum =
        std::find(r.strata.begin(), r.strata.end(), Stratum::extract) != r.strata.end();
    if (r.task == CardTask::extract && (!extract_stratum || r.strata.size() != 1)) {
        return "the strata of an extract card are [\"extract\"]";
    }
    if (r.task == CardTask::decide && extract_stratum) {
        return "stratum 'extract' in a decide card";
    }
    const auto opening = std::find(r.strata.begin(), r.strata.end(), Stratum::opening);
    if (opening != r.strata.end()) {
        if (r.task != CardTask::decide || r.kind != DecisionKind::turn ||
            !r.state.request->conversation.empty()) {
            return "stratum 'opening' outside a turn with an empty conversation";
        }
        if (opening + 1 != r.strata.end()) return "stratum 'opening' is not the last";
    }
    const auto untold = std::find(r.strata.begin(), r.strata.end(), Stratum::untold);
    if (untold != r.strata.end()) {
        if (r.task != CardTask::decide || r.kind != DecisionKind::turn ||
            !r.state.request->other.valid()) {
            return "stratum 'untold' outside a turn with someone in front";
        }
        if (untold + 1 != r.strata.end() && untold + 1 != opening) {
            return "stratum 'untold' is not after the others and before 'opening'";
        }
    }
    if (r.strata.front() == Stratum::opening || r.strata.front() == Stratum::untold) {
        return "a tag without a stratum";
    }
    if (!is_lower_hex(r.prefix, kPrefixHexDigits)) {
        return "prefix '" + r.prefix + "' is not 12 lowercase hex digits";
    }
    const std::string fingerprint = r.task == CardTask::decide ? card_fingerprint(*r.state.request)
                                                               : extract_fingerprint(r.card);
    if (r.fingerprint != fingerprint) {
        return "fingerprint '" + r.fingerprint + "' does not match the " +
               (r.task == CardTask::decide ? "request" : "card") + " (expected '" + fingerprint +
               "')";
    }
    const std::string id = card_id(r.task, r.lang, fingerprint);
    if (r.id != id) return "id '" + r.id + "' does not match (expected '" + id + "')";
    return "";
}

// --- Writing -----------------------------------------------------------------

template <char P, int W>
J id_json(Id<P, W> id) {
    if (!id.valid()) throw std::invalid_argument("card: null identifier where one is required");
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

J slot_value_json(Slot slot, const std::optional<SlotValue>& value) {
    if (!value) return nullptr;
    switch (slot) {
        case Slot::who:
            if (*value <= 0) throw std::invalid_argument("card: bad neighbor in a who slot");
            return NeighborId(static_cast<std::uint32_t>(*value)).str();
        case Slot::where:
            if (*value <= 0) throw std::invalid_argument("card: bad place in a where slot");
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

J belief_json(const Belief& b) {
    J j = J::object();
    j["fact"] = id_json(b.fact);
    j["what"] = b.what;
    J slots = J::object();
    for (Slot s : kSlots) {
        const SlotBelief& sb = b.slots[idx(s)];
        J o = J::object();
        o["state"] = enum_json(sb.state);
        o["value"] = slot_value_json(s, sb.value);
        o["source"] = opt_id_json(sb.source);
        slots[std::string(key(s))] = std::move(o);
    }
    j["slots"] = std::move(slots);
    j["told_by"] = opt_id_json(b.told_by);
    j["heard_at"] = b.heard_at;
    J told_to = J::array();
    for (NeighborId n : b.told_to) told_to.push_back(id_json(n));
    j["told_to"] = std::move(told_to);
    return j;
}

J request_json(const DecisionRequest& q) {
    J j = J::object();
    j["kind"] = enum_json(q.kind);
    j["seed"] = q.seed;
    j["tick"] = q.tick;
    j["weekday"] = q.weekday;
    j["self"] = id_json(q.self);
    j["job"] = enum_json(q.job);
    j["trait"] = enum_json(q.trait);
    j["place"] = opt_id_json(q.place);
    j["other"] = opt_id_json(q.other);
    j["relation"] = enum_json(q.relation);
    J facts = J::array();
    for (const Belief& b : q.facts) facts.push_back(belief_json(b));
    j["facts"] = std::move(facts);
    J conversation = J::array();
    for (const ConvEntry& e : q.conversation) {
        J o = J::object();
        o["speaker"] = id_json(e.speaker);
        o["act"] = enum_json(e.act);
        o["fact"] = opt_id_json(e.fact);
        o["claim"] = claim_json(e.claim);
        conversation.push_back(std::move(o));
    }
    j["conversation"] = std::move(conversation);
    j["trigger_fact"] = q.trigger_fact;
    j["neighbor_count"] = q.neighbor_count;
    return j;
}

J state_json(const CardRecord& r) {
    J j = J::object();
    J village = J::object();
    village["scenario"] = r.state.village.scenario;
    village["seed"] = r.state.village.seed;
    village["neighbors"] = r.state.village.neighbors;
    village["layout"] = enum_json(r.state.village.layout);
    j["village"] = std::move(village);
    if (r.task == CardTask::decide) {
        j["request"] = request_json(*r.state.request);
        return j;
    }
    j["tick"] = r.state.tick;
    if (!r.state.fact) {
        j["fact"] = nullptr;
    } else {
        J fact = J::object();
        fact["fact"] = id_json(r.state.fact->id);
        fact["what"] = r.state.fact->what;
        fact["slots"] = slots_json(r.state.fact->slots);
        j["fact"] = std::move(fact);
    }
    return j;
}

// --- Reading -----------------------------------------------------------------

[[noreturn]] void fail(const std::string& message) {
    throw std::runtime_error("card: " + message);
}

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

std::uint64_t get_u64(const J& v, const std::string& name) {
    if (!v.is_number_unsigned()) fail_key(name, "expected an unsigned integer");
    return v.get<std::uint64_t>();
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
        auto expected = keys.begin();
        for (const auto& item : j.items()) {
            if (std::find(keys.begin(), keys.end(), item.key()) == keys.end()) {
                fail("unknown key '" + this->name(item.key()) + "'");
            }
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

std::optional<Claim> read_claim(const J& v, const std::string& name) {
    if (v.is_null()) return std::nullopt;
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

Belief read_belief(const J& v, const std::string& name) {
    const Obj o(v, name, {"fact", "what", "slots", "told_by", "heard_at", "told_to"});
    Belief b;
    b.fact = o.id<FactId>("fact");
    b.what = o.str("what");
    const Obj slots(o.at("slots"), o.name("slots"), {"who", "where", "when", "amount"});
    for (Slot s : kSlots) {
        const Obj sb(slots.at(key(s)), slots.name(key(s)), {"state", "value", "source"});
        SlotBelief& out = b.slots[idx(s)];
        out.state = sb.enumv<SlotState>("state");
        out.value = get_slot_value(s, sb.at("value"), sb.name("value"));
        out.source = sb.opt_id<NeighborId>("source");
    }
    b.told_by = o.opt_id<NeighborId>("told_by");
    b.heard_at = o.integer<Tick>("heard_at");
    const J& told_to = o.list("told_to");
    for (std::size_t i = 0; i < told_to.size(); ++i) {
        b.told_to.push_back(get_id<NeighborId>(told_to[i], item_name(o.name("told_to"), i)));
    }
    return b;
}

DecisionRequest read_request(const J& v, const std::string& name) {
    const Obj o(v, name, {"kind", "seed", "tick", "weekday", "self", "job", "trait", "place",
                          "other", "relation", "facts", "conversation", "trigger_fact",
                          "neighbor_count"});
    DecisionRequest q;
    q.kind = o.enumv<DecisionKind>("kind");
    q.seed = get_u64(o.at("seed"), o.name("seed"));
    q.tick = o.integer<Tick>("tick");
    q.weekday = o.integer<int>("weekday");
    q.self = o.id<NeighborId>("self");
    q.job = o.enumv<Job>("job");
    q.trait = o.enumv<Trait>("trait");
    q.place = o.opt_id<PlaceId>("place");
    q.other = o.opt_id<NeighborId>("other");
    q.relation = o.enumv<Relation>("relation");
    const J& facts = o.list("facts");
    for (std::size_t i = 0; i < facts.size(); ++i) {
        q.facts.push_back(read_belief(facts[i], item_name(o.name("facts"), i)));
    }
    const J& conversation = o.list("conversation");
    for (std::size_t i = 0; i < conversation.size(); ++i) {
        const Obj e(conversation[i], item_name(o.name("conversation"), i),
                    {"speaker", "act", "fact", "claim"});
        ConvEntry entry;
        entry.speaker = e.id<NeighborId>("speaker");
        entry.act = e.enumv<Act>("act");
        entry.fact = e.opt_id<FactId>("fact");
        entry.claim = read_claim(e.at("claim"), e.name("claim"));
        q.conversation.push_back(std::move(entry));
    }
    q.trigger_fact = o.integer<int>("trigger_fact");
    q.neighbor_count = o.integer<int>("neighbor_count");
    return q;
}

CardVillage read_village(const J& v, const std::string& name) {
    const Obj o(v, name, {"scenario", "seed", "neighbors", "layout"});
    CardVillage village;
    village.scenario = o.str("scenario");
    village.seed = get_u64(o.at("seed"), o.name("seed"));
    village.neighbors = o.integer<int>("neighbors");
    village.layout = o.enumv<Layout>("layout");
    return village;
}

CardState read_state(const J& v, CardTask task) {
    CardState state;
    if (task == CardTask::decide) {
        const Obj o(v, "state", {"village", "request"});
        state.village = read_village(o.at("village"), o.name("village"));
        state.request = read_request(o.at("request"), o.name("request"));
        return state;
    }
    const Obj o(v, "state", {"village", "tick", "fact"});
    state.village = read_village(o.at("village"), o.name("village"));
    state.tick = o.integer<Tick>("tick");
    if (!o.at("fact").is_null()) {
        const Obj f(o.at("fact"), o.name("fact"), {"fact", "what", "slots"});
        Fact fact;
        fact.id = f.id<FactId>("fact");
        fact.what = f.str("what");
        fact.slots = read_slots(f.at("slots"), f.name("slots"));
        state.fact = std::move(fact);
    }
    return state;
}

CardSource read_source(const J& v) {
    const Obj o(v, "source", {"log", "policy", "model", "scenario", "seed", "tick", "neighbor",
                              "event", "variant"});
    CardSource s;
    s.log = o.str("log");
    s.policy = o.str("policy");
    s.model = o.opt_str("model");
    s.scenario = o.str("scenario");
    s.seed = get_u64(o.at("seed"), o.name("seed"));
    s.tick = o.integer<Tick>("tick");
    s.neighbor = o.opt_id<NeighborId>("neighbor");
    if (!o.at("event").is_null()) s.event = o.integer<int>("event");
    if (!o.at("variant").is_null()) s.variant = o.enumv<CardVariant>("variant");
    return s;
}

// Parses one line. Duplicate keys are an error: the parser would silently keep
// only one of them.
J parse_line(std::string_view text) {
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

CardRecord read_record(std::string_view line) {
    const J j = parse_line(line);
    const Obj o(j, "", {"id", "fingerprint", "contract_version", "task", "lang", "kind", "strata",
                        "prefix", "source", "card", "state"});
    CardRecord r;
    r.id = o.str("id");
    r.fingerprint = o.str("fingerprint");
    if (!is_lower_hex(r.fingerprint, kFingerprintHexDigits)) {
        fail_key("fingerprint", "expected 64 lowercase hex digits");
    }
    r.contract_version = o.integer<int>("contract_version");
    r.task = o.enumv<CardTask>("task");
    r.lang = o.enumv<Lang>("lang");
    if (!o.at("kind").is_null()) r.kind = o.enumv<DecisionKind>("kind");
    const J& strata = o.list("strata");
    for (std::size_t i = 0; i < strata.size(); ++i) {
        r.strata.push_back(get_enum<Stratum>(strata[i], item_name("strata", i)));
    }
    r.prefix = o.str("prefix");
    r.source = read_source(o.at("source"));
    r.card = o.str("card");
    r.state = read_state(o.at("state"), r.task);
    return r;
}

}  // namespace

std::string card_fingerprint(const DecisionRequest& request) {
    return sha256_hex("decide\n" + canonical(request));
}

std::string extract_fingerprint(std::string_view text) {
    std::string data = "extract\n";
    data += text;
    return sha256_hex(data);
}

std::string card_id(CardTask task, Lang lang, std::string_view fingerprint) {
    if (fingerprint.size() < kIdHexDigits) {
        throw std::invalid_argument("card: fingerprint shorter than " +
                                    std::to_string(kIdHexDigits));
    }
    std::string id(key(task));
    id += '-';
    id += key(lang);
    id += '-';
    id += fingerprint.substr(0, kIdHexDigits);
    return id;
}

std::string prefix_id(std::string_view text) {
    return sha256_hex(text).substr(0, kPrefixHexDigits);
}

void set_identity(CardRecord& record) {
    if (record.task == CardTask::decide) {
        if (!record.state.request) {
            throw std::invalid_argument("card: a decide card needs state.request");
        }
        record.fingerprint = card_fingerprint(*record.state.request);
    } else {
        record.fingerprint = extract_fingerprint(record.card);
    }
    record.id = card_id(record.task, record.lang, record.fingerprint);
}

std::string write_card(const CardRecord& r) {
    if (const std::string rule = broken_rule(r); !rule.empty()) {
        throw std::invalid_argument("card: " + rule);
    }
    J j = J::object();
    j["id"] = r.id;
    j["fingerprint"] = r.fingerprint;
    j["contract_version"] = r.contract_version;
    j["task"] = enum_json(r.task);
    j["lang"] = enum_json(r.lang);
    j["kind"] = r.kind ? enum_json(*r.kind) : J(nullptr);
    J strata = J::array();
    for (Stratum s : r.strata) strata.push_back(enum_json(s));
    j["strata"] = std::move(strata);
    j["prefix"] = r.prefix;
    J source = J::object();
    source["log"] = r.source.log;
    source["policy"] = r.source.policy;
    source["model"] = r.source.model ? J(*r.source.model) : J(nullptr);
    source["scenario"] = r.source.scenario;
    source["seed"] = r.source.seed;
    source["tick"] = r.source.tick;
    source["neighbor"] = opt_id_json(r.source.neighbor);
    source["event"] = r.source.event ? J(*r.source.event) : J(nullptr);
    source["variant"] = r.source.variant ? J(std::string(key(*r.source.variant))) : J(nullptr);
    j["source"] = std::move(source);
    j["card"] = r.card;
    j["state"] = state_json(r);
    try {
        // Compact, UTF-8 as it is.
        return j.dump(-1, ' ', false, J::error_handler_t::strict);
    } catch (const nlohmann::json::exception& e) {
        throw std::invalid_argument(std::string("card: ") + e.what());
    }
}

CardRecord read_card(std::string_view line) {
    CardRecord r;
    try {
        r = read_record(line);
    } catch (const nlohmann::json::exception& e) {
        fail(std::string("bad value: ") + e.what());
    }
    if (const std::string rule = broken_rule(r); !rule.empty()) fail(rule);
    return r;
}

}  // namespace rumor
