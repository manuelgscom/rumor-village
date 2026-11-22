// The policy that decides with the model (policy/model.h). Per call: one card
// and one grammar per request, one call to the batch, and each answer read back
// as an action with read_answer (policy/answer.h), the same reading that
// `rumor validate` applies to the answers of other models.

#include "policy/model.h"

#include <algorithm>
#include <cstddef>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/catalog.h"
#include "policy/answer.h"

namespace rumor {
namespace {

using json = nlohmann::json;

// --- The policy ------------------------------------------------------------------

class ModelPolicy : public Policy {
  public:
    ModelPolicy(llm::Batch& batch, const Renderer& renderer, const Vocab& vocab,
                const Population& population, const ModelPolicyOptions& options)
        : batch_(batch),
          renderer_(renderer),
          vocab_(vocab),
          population_(population),
          options_(options),
          turn_grammar_(renderer.grammar(DecisionKind::turn)),
          plan_grammar_(renderer.grammar(DecisionKind::plan)) {
        batch_.set_prefix(renderer_.prefix(options_.prompt));
    }

    std::string name() const override { return "model"; }
    std::optional<std::string> model() const override { return batch_.info().file; }

    std::vector<Decision> decide(std::span<const DecisionRequest> batch) override {
        if (batch.empty()) return {};
        std::vector<llm::Request> requests;
        requests.reserve(batch.size());
        for (const DecisionRequest& q : batch) {
            llm::Request r;
            r.seed = q.seed;
            r.card = renderer_.card(q);
            r.grammar = q.kind == DecisionKind::turn ? turn_grammar_ : plan_grammar_;
            r.want_text = wants_text(q);
            r.max_tokens = r.want_text ? kMaxTokensWithText : kMaxTokensWithoutText;
            requests.push_back(std::move(r));
        }

        const std::vector<llm::Result> results = batch_.run(requests);
        if (results.size() != requests.size()) {
            throw std::runtime_error("model policy: the batch returned " +
                                     std::to_string(results.size()) + " results for " +
                                     std::to_string(requests.size()) + " requests");
        }

        std::vector<Decision> out;
        out.reserve(batch.size());
        for (std::size_t i = 0; i < batch.size(); ++i) {
            const DecisionRequest& q = batch[i];
            const llm::Result& r = results[i];
            Decision d;
            if (r.truncated) {
                d.reject = RejectReason::truncated;
            } else {
                d = read_answer(r.json, q, vocab_, population_);
            }
            d.gen = Generation{r.t_start_ms, r.t_end_ms, r.prompt_tokens, r.output_tokens};
            if (options_.trace) trace(q, requests[i].card, r);
            out.push_back(std::move(d));
        }
        return out;
    }

    std::vector<PerfSample> take_perf() override { return batch_.take_perf(); }

    void set_visible(std::span<const NeighborId> neighbors) override {
        visible_.assign(neighbors.begin(), neighbors.end());
        std::sort(visible_.begin(), visible_.end());
    }

  private:
    // Only turns have a bubble. With the camera, only those of a pair with
    // somebody on screen: the request is otherwise the same, so the decision
    // does not depend on where the camera looks.
    bool wants_text(const DecisionRequest& q) const {
        if (q.kind != DecisionKind::turn) return false;
        switch (options_.text) {
            case TextMode::all: return true;
            case TextMode::none: return false;
            case TextMode::camera: return on_screen(q.self) || on_screen(q.other);
        }
        return false;
    }

    bool on_screen(NeighborId n) const {
        return std::binary_search(visible_.begin(), visible_.end(), n);
    }

    void trace(const DecisionRequest& q, const std::string& card, const llm::Result& r) const {
        nlohmann::ordered_json line;
        line["tick"] = q.tick;
        line["who"] = q.self.str();
        line["kind"] = std::string(key(q.kind));
        line["card"] = card;
        line["output"] = r.json;
        line["cut"] = r.cut_before_text;
        line["truncated"] = r.truncated;
        // A cut output may end inside a UTF-8 character: replaced, not thrown.
        *options_.trace << line.dump(-1, ' ', false, json::error_handler_t::replace) << '\n';
    }

    llm::Batch& batch_;
    const Renderer& renderer_;
    const Vocab& vocab_;
    const Population& population_;
    const ModelPolicyOptions options_;
    const std::string turn_grammar_;
    const std::string plan_grammar_;
    std::vector<NeighborId> visible_;  // sorted; empty until the first set_visible
};

}  // namespace

std::unique_ptr<Policy> make_model_policy(llm::Batch& batch, const Renderer& renderer,
                                          const Vocab& vocab, const Population& population,
                                          const ModelPolicyOptions& options) {
    return std::make_unique<ModelPolicy>(batch, renderer, vocab, population, options);
}

}  // namespace rumor
