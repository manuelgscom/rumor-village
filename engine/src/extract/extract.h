#pragma once
// The `extract` task (contract, section 4): the free text the user types
// becomes a fact. The model answers with a grammar, the engine validates the
// answer against the vocabulary and always shows what it understood before the
// fact enters the village. Implemented in src/extract from
// data/prompts/extract/.
//
//   "esta noche hay fiesta en la plaza a las 9"
//        -> {"what":"fiesta","who":null,"where":"plaza","when":"hoy 21:00","amount":null}
//        -> "Entendido: fiesta · plaza · hoy 21:00"

#include <memory>
#include <optional>
#include <string>

#include "core/ids.h"
#include "core/run_modes.h"
#include "core/population_api.h"
#include "core/time.h"
#include "llm/batch.h"

namespace rumor {

struct Extracted {
    // False when the model output could not be read as a fact at all.
    bool ok = false;
    std::string what;  // short free text: the only open field
    std::optional<NeighborId> who;
    std::optional<PlaceId> where;  // a public place
    // Relative to the day the user speaks: the caller turns it into a slot
    // with from_relative(when, now).
    std::optional<RelativeWhen> when;
    std::optional<int> amount;
    // A neighbor or a place the model wrote that does not exist: the slot stays
    // empty and this keeps the name, to tell the user.
    std::optional<std::string> unknown_who;
    std::optional<std::string> unknown_where;
    std::string raw;  // the model output
};

// Reads the JSON of the model and validates it against the vocabulary. Never
// throws on a bad output: `ok` is false.
Extracted validate_extracted(const std::string& json, const Vocab& vocab,
                             const Population& population);

// "Entendido: fiesta · plaza · hoy 21:00" ("Understood: ..." in English), with
// the slots that have a value. An unknown neighbor or place is named after it.
std::string understood_message(const Extracted& fact, const Vocab& vocab,
                               const Population& population);

class Extractor {
  public:
    virtual ~Extractor() = default;
    virtual Extracted extract(const std::string& text) = 0;
};

// Limit of output tokens of an answer: it takes about 30; a long `what` and two
// unknown names fit.
inline constexpr int kExtractMaxTokens = 128;

// Reads data_dir/prompts/extract/ (and, in card mode, the lists of
// data_dir/prompts/<lang>/prefix_card.txt as system message: see
// extraction::system_message). Uses Batch::run_single, so the prefix of a
// village running on the same batch is left alone. `batch`, `vocab` and
// `population` must outlive the extractor. Throws std::runtime_error when a
// file is missing or wrong.
std::unique_ptr<Extractor> make_extractor(llm::Batch& batch, const std::string& data_dir,
                                          const Vocab& vocab, const Population& population,
                                          PromptMode mode = PromptMode::full);

// `rumor extract --model <gguf> --lang <es|en> --text "<sentence>"
// [--prompt full|card]`: prints the understood message. Returns the exit
// code; throws UsageError (cli/usage.h) on a bad command line.
int extract_command(int argc, char** argv);

}  // namespace rumor
