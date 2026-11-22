#pragma once
// `rumor cards`: rebuilds from a run log every decision that was asked (`turn`
// and `plan`) and every text fit for `extract`, as card records of
// cards.jsonl (card/record.h), plus the prefixes they use in prefixes.jsonl
// (training/README.md). Package A of phase 4. Implemented in src/cli/cards*.
//
//   rumor cards --log <run.jsonl> --out <cards.jsonl> --prefixes <prefixes.jsonl>
//               [--data <dir>] [--rival-twins]
//
// The log does not store the cards, so the run is replayed: the same
// simulation, with the scenario, seed and language of the header, and a policy
// that answers each request with the decision the log recorded. Every request
// is then built by the same code that built it live. The replay must give the
// log back event by event and every request must have the fingerprint of its
// `turn` or `plan`; otherwise nothing is written and the command fails naming
// the event. No model is loaded, also for a log made with one.
//
// With --rival-twins, every turn with someone in front who is not a rival also
// gives a twin right after it: the same request with the relation set to rival,
// its own card and strata, the same source with variant "rival". Real rival
// turns are rare, and the `enemy` stratum is filled from these when they run
// out (training/sample). Twins never come from plans or extract cards.
//
//   run.jsonl ──► read_log ──► run_simulation(ReplayPolicy) ──► requests
//                                   │ events == log events?        │
//                                   ▼                              ▼
//                                 fail                 Renderer::card, strata
//                                                                  │
//   inject texts, coherent tell texts ──► extract records          ▼
//                                              └──────────► cards.jsonl + prefixes.jsonl

#include <string>
#include <vector>

#include "card/record.h"
#include "core/decision.h"
#include "core/log_api.h"

namespace rumor {

// Returns the exit code; throws UsageError (cli/usage.h) on a bad command line.
int cards_command(int argc, char** argv);

// One line of prefixes.jsonl: {"prefix","task","lang","text"}.
struct CardPrefix {
    std::string prefix;  // prefix_id(text)
    CardTask task = CardTask::decide;
    Lang lang = Lang::es;
    std::string text;

    friend bool operator==(const CardPrefix&, const CardPrefix&) = default;
};

struct CardSet {
    std::vector<CardRecord> cards;    // in the order of the log
    std::vector<CardPrefix> prefixes;  // those the cards use: decide first, then extract
};

// The strata of a decide card: the rare ones in the order of the Stratum enum
// or ["common"] when none applies, then the tags `untold` and `opening`
// (["common","untold"], ["forgotten","untold","opening"]).
//   forgotten     some slot of some fact is forgotten
//   doubt         some slot of some fact is in doubt
//   already_told  a turn, and some fact was already told to `other`
//   enemy         `other` is a rival
//   plan          kind plan
//   untold        a turn with someone in front and a fact not yet told to them
//                 nor told by them: the "you have not told ... yet" line (tag)
//   opening       a turn with an empty conversation (tag, last)
std::vector<Stratum> decide_strata(const DecisionRequest& request);

// The cards of one log (see above), with the rival twins if asked. `log_path`
// goes to source.log as given. Throws std::runtime_error when the replay does
// not give the log back.
CardSet build_cards(const Log& log, const std::string& log_path, const std::string& data_dir,
                    bool rival_twins = false);

// The extract prefix of a language, as `rumor extract` builds it: the system
// message of data_dir/prompts/extract/ for a village of 100 neighbors.
std::string extract_prefix(const std::string& data_dir, Lang lang);

// One compact JSON line of prefixes.jsonl, without the final newline.
std::string write_prefix(const CardPrefix& prefix);

}  // namespace rumor
