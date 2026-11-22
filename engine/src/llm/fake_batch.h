#pragma once
// A simulated model for the tests: a callback answers each request. It keeps
// the rules of the real batch that a caller can see: results in request order,
// at most N requests per batch, the cut before "text", and one performance
// sample per batch. No llama.cpp behind it.

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "llm/batch.h"

namespace rumor::llm {

class FakeBatch : public Batch {
  public:
    // Answers one request. `system` is the prefix of set_prefix, or the system
    // message of run_single. The callback fills `json` (as if text had been
    // asked for) and, to simulate a cut by the token limit, `truncated`; it may
    // set the token counts, otherwise they are estimated from the lengths.
    using Answer = std::function<Result(const std::string& system,
                                                const Request& request)>;

    explicit FakeBatch(Answer answer, int n_parallel = 8);

    void set_prefix(const std::string& prefix) override;
    std::vector<Result> run(const std::vector<Request>& requests) override;
    Result run_single(const std::string& system, const Request& request) override;
    std::vector<PerfSample> take_perf() override;
    ModelInfo info() const override;

    // What a test can look at.
    const std::string& prefix() const { return prefix_; }
    int prefix_sets() const { return prefix_sets_; }
    // Every batch generated, in order: at most n_parallel requests each.
    const std::vector<std::vector<Request>>& batches() const { return batches_; }

  private:
    Result answer_one(const std::string& system, const Request& request);

    Answer answer_;
    int n_parallel_;
    std::string prefix_;
    int prefix_sets_ = 0;
    std::int64_t clock_ms_ = 0;  // simulated: no wall clock in the tests
    std::vector<std::vector<Request>> batches_;
    std::vector<PerfSample> perf_;
};

}  // namespace rumor::llm
