#pragma once
// The card record of the dataset (training/README.md, "Ficha: cards.jsonl"):
// one line of cards.jsonl. `rumor cards` (src/cli/cards*) writes it and
// `rumor validate` (src/cli/validate*) reads it. Implemented in
// src/card/record*.
//
// One compact JSON object per line, keys in this order:
//
//   {"id","fingerprint","contract_version","task","lang","kind","strata","prefix",
//    "source":{"log","policy","model","scenario","seed","tick","neighbor","event","variant"},
//    "card","state"}
//
// `state` is everything the engine needs to judge an answer without replaying
// the run. Only the engine reads it; Python copies it as it is. It follows the
// conventions of the log (core/event.h): identifiers as text ("n017", "p03",
// "f1"), slot values by their slot (who "n017", where "p03", when as an integer
// slot, amount as an integer), enums by their key, an absent value as null,
// keys in the order shown. (Here split over several lines to read it.)
//
// task "decide": the village and the decision request (core/decision.h), whole.
//
//   {"village":{"scenario":"party-25","seed":3,"neighbors":25,"layout":"village"},
//    "request":{"kind":"turn","seed":1234567890,"tick":612,"weekday":1,
//               "self":"n001","job":"baker","trait":"gossip","place":"p02",
//               "other":"n002","relation":"friend",
//               "facts":[{"fact":"f1","what":"party",
//                         "slots":{"who":{"state":"sure","value":"n003","source":null},
//                                  "where":{"state":"doubt","value":"p01","source":"n005"},
//                                  "when":{"state":"forgotten","value":null,"source":null},
//                                  "amount":{"state":"unknown","value":null,"source":null}},
//                         "told_by":"n005","heard_at":600,"told_to":["n002"]}],
//               "conversation":[{"speaker":"n002","act":"tell","fact":"f1",
//                                "claim":{"who":null,"where":"p01","when":44,"amount":null,
//                                         "guess":["when"]}}],
//               "trigger_fact":0,"neighbor_count":25}}
//
//   request.other, place, facts[].told_by, slots.*.source and conversation[].fact
//   are null when they are none; conversation[].claim is null without a claim.
//   request.seed is the seed of the decision (not part of the fingerprint).
//
// task "extract": the village, the tick at which the sentence entered (the day
// words of an answer are relative to it: from_relative(when, tick)) and the
// fact it states, when known: the original fact of an `inject`, or the claim
// (as delivered, without guess marks) and the `what` of the `tell` the text
// came from. Same keys as the `inject` event of the log.
//
//   {"village":{"scenario":"party-25","seed":3,"neighbors":25,"layout":"village"},
//    "tick":600,
//    "fact":{"fact":"f1","what":"party",
//            "slots":{"who":"n003","where":"p01","when":42,"amount":50}}}   or "fact":null
//
// The vocabulary and the population of the run are rebuilt as `rumor run`
// loads them (LoadedRun, cli/serve.h):
//
//   const Vocab vocab = load_vocab(data_dir, record.lang);
//   const CardVillage& v = record.state.village;
//   const Population population = make_population(data_dir, v.neighbors, v.layout, v.seed);
//
// which is what validate() (core/validate_api.h) and check_text()
// (card/textcheck.h; speaker request.self, listener request.other, now
// request.tick) need besides the request.

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core/action.h"
#include "core/build_info.h"
#include "core/catalog.h"
#include "core/decision.h"
#include "core/enum_keys.h"
#include "core/fact.h"
#include "core/ids.h"
#include "core/scenario.h"
#include "core/time.h"

namespace rumor {

// The frozen contract version of phase 4 (training/README.md): log format 1
// with `when` as an integer slot and the action keys of contract section 3.
// kContractVersion lives in core/build_info.h (one definition for both).

enum class CardTask : std::uint8_t { decide, extract };
RUMOR_ENUM_KEYS(CardTask, "decide", "extract");

// The sampling strata. `extract` only, and alone, in an extract card.
// Two tags follow the quota strata (`common` included), in this order:
//   untold   a turn with someone in front and a fact not yet told to them (nor
//            told by them): the card says "you have not told ... yet"
//   opening  a turn whose conversation is still empty
// Tags have no quota, never come alone and are never required: a card written
// before a tag existed stays valid.
enum class Stratum : std::uint8_t {
    forgotten, doubt, already_told, enemy, plan, common, extract, opening, untold
};
RUMOR_ENUM_KEYS(Stratum, "forgotten", "doubt", "already_told", "enemy", "plan", "common",
                "extract", "opening", "untold");

// A card that did not happen in the run but was made from one that did.
//   rival  a turn with someone in front, rebuilt with the relation set to rival
//          (`rumor cards --rival-twins`), to fill the `enemy` stratum
enum class CardVariant : std::uint8_t { rival };
RUMOR_ENUM_KEYS(CardVariant, "rival");

// Where the card comes from.
struct CardSource {
    std::string log;                   // path of the run log
    std::string policy;                // "baseline" or "model", as in the log header
    std::optional<std::string> model;  // null with the baseline
    std::string scenario;
    std::uint64_t seed = 0;
    Tick tick = 0;
    NeighborId neighbor;     // who decides, or who said the text; none (null) in an inject
    std::optional<int> event;  // id of the `turn` or `plan` in the log; null in an inject
    std::optional<CardVariant> variant;  // null for a card that happened in the run

    friend bool operator==(const CardSource&, const CardSource&) = default;
};

// The run the card comes from, as make_population needs it.
struct CardVillage {
    std::string scenario;
    std::uint64_t seed = 0;  // of the run
    int neighbors = 0;
    Layout layout = Layout::village;

    friend bool operator==(const CardVillage&, const CardVillage&) = default;
};

struct CardState {
    CardVillage village;
    std::optional<DecisionRequest> request;  // decide only, always present there
    Tick tick = 0;                           // extract only; 0 in decide
    std::optional<Fact> fact;                // extract only, when known

    friend bool operator==(const CardState&, const CardState&) = default;
};

struct CardRecord {
    std::string id;           // card_id(task, lang, fingerprint)
    std::string fingerprint;  // card_fingerprint(request) or extract_fingerprint(card)
    int contract_version = kContractVersion;
    CardTask task = CardTask::decide;
    Lang lang = Lang::es;
    std::optional<DecisionKind> kind;  // decide only, equal to request.kind
    std::vector<Stratum> strata;       // non-empty, no repeats, in the order given
    std::string prefix;                // prefix_id() of its prefix: 12 lowercase hex digits
    CardSource source;
    std::string card;  // the card in decide, the sentence in extract
    CardState state;

    friend bool operator==(const CardRecord&, const CardRecord&) = default;
};

// SHA-256 hex of "decide\n" + canonical(request): without the seed and the
// language, so a situation and its twin in the other language share it.
std::string card_fingerprint(const DecisionRequest& request);

// SHA-256 hex of "extract\n" + text.
std::string extract_fingerprint(std::string_view text);

// "<task>-<lang>-<first 16 hex digits of the fingerprint>". Throws
// std::invalid_argument when the fingerprint is shorter than 16.
std::string card_id(CardTask task, Lang lang, std::string_view fingerprint);

// The identifier of a prefix in prefixes.jsonl: the first 12 hex digits of the
// SHA-256 of its text.
std::string prefix_id(std::string_view text);

// Sets fingerprint and id from task, lang, state.request (decide) or card
// (extract). Throws std::invalid_argument for a decide record without request.
void set_identity(CardRecord& record);

// One compact JSON line, without the final newline. The same record always
// gives the same bytes, and read_card gives it back. Throws
// std::invalid_argument when the record breaks a rule that read_card checks.
std::string write_card(const CardRecord& record);

// Reads one line written by write_card. Strict, as the log: exactly the keys
// above, in their order, no repeated keys, right types. Also checks that
//   - decide has kind and request, with kind == request.kind, tick 0, no fact;
//     extract has kind null and no request
//   - strata is non-empty, without repeats, and is ["extract"] exactly in an
//     extract card (no "extract" in a decide one)
//   - fingerprint and id match the state and the card (set_identity)
//   - prefix is 12 lowercase hex digits
//   - source.variant "rival" only in a decide turn whose request has the
//     relation rival
//   - "opening" only in a decide turn with an empty request.conversation,
//     and last in strata; "untold" only in a decide turn with request.other,
//     after the quota strata and before "opening"; neither alone
// contract_version may be any integer: comparing it with kContractVersion is
// for the caller (`rumor validate` gives the reason `contract_version`).
// Throws std::runtime_error: "card: key 'state.request.self': unknown
// identifier 'x1'".
CardRecord read_card(std::string_view line);

}  // namespace rumor
