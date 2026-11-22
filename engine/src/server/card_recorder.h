#pragma once
// «¿Qué pensó?» (phase 9): a policy that wraps the policy of a game and, after
// each batch of decisions, writes one line per request to <id>.cards.jsonl:
//
//   {"tick":612,"who":"n001","kind":"turn","card":"<the card the model read>","rule":null}
//   {"tick":612,"who":"n001","kind":"turn","card":null,
//    "rule":{"rule":"tell_chance","rolls":[{"name","chance_ppm","roll_ppm","hit"}]}}
//
// With the model the line carries the card (renderer.card); with the baseline,
// the rule and the dice (explain_baseline). It never changes a decision: it
// hands back exactly what the inner policy answered, and the header still
// names the inner policy. GET /card reads the lines back (find_card).

#include <cstdint>
#include <optional>
#include <ostream>
#include <span>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "card/render.h"
#include "core/policy.h"
#include "core/time.h"

namespace rumor {

class CardRecorder final : public Policy {
  public:
    // `renderer` is the one of the model policy; null with the baseline. All
    // must outlive the recorder.
    CardRecorder(Policy& inner, std::ostream& out, const Renderer* renderer);

    std::string name() const override { return inner_.name(); }
    std::optional<std::string> model() const override { return inner_.model(); }
    std::vector<Decision> decide(std::span<const DecisionRequest> batch) override;
    std::vector<PerfSample> take_perf() override { return inner_.take_perf(); }
    void set_visible(std::span<const NeighborId> visible) override { inner_.set_visible(visible); }

  private:
    Policy& inner_;
    std::ostream& out_;
    const Renderer* renderer_;
};

// The line of one decision in a cards file, by tick and neighbor (and kind,
// when given: a neighbor may have a turn and a plan in one tick; without it,
// the first one). Empty when there is none. Reads the file as it is, also
// while a game is still writing it.
std::optional<nlohmann::json> find_card(const std::string& path, Tick tick, const std::string& who,
                                        const std::optional<std::string>& kind);

}  // namespace rumor
