#include "llm/fake_batch.h"

#include <algorithm>
#include <cstddef>
#include <stdexcept>
#include <utility>

namespace rumor::llm {
namespace {

// A rough token count for a text: enough for tests that only need a number.
int estimate_tokens(std::size_t bytes) { return static_cast<int>(bytes / 4) + 1; }

}  // namespace

FakeBatch::FakeBatch(Answer answer, int n_parallel)
    : answer_(std::move(answer)), n_parallel_(n_parallel) {
    if (n_parallel_ < 1) throw std::runtime_error("fake batch: n_parallel must be positive");
}

void FakeBatch::set_prefix(const std::string& prefix) {
    prefix_ = prefix;
    ++prefix_sets_;
    clock_ms_ = 0;
}

Result FakeBatch::answer_one(const std::string& system, const Request& request) {
    Result r = answer_(system, request);
    if (!r.truncated && !request.want_text) r.cut_before_text = cut_before_text(r.json);
    if (r.prompt_tokens == 0) r.prompt_tokens = estimate_tokens(system.size() + request.card.size());
    if (r.output_tokens == 0) r.output_tokens = estimate_tokens(r.json.size());
    // One simulated millisecond per output token.
    r.t_start_ms = clock_ms_;
    r.t_end_ms = clock_ms_ + r.output_tokens;
    return r;
}

std::vector<Result> FakeBatch::run(const std::vector<Request>& requests) {
    std::vector<Result> out;
    out.reserve(requests.size());
    const std::size_t n = static_cast<std::size_t>(n_parallel_);
    for (std::size_t first = 0; first < requests.size(); first += n) {
        const std::size_t last = std::min(requests.size(), first + n);
        std::int64_t end = clock_ms_;
        int tokens = 0;
        for (std::size_t i = first; i < last; ++i) {
            out.push_back(answer_one(prefix_, requests[i]));
            end = std::max(end, out.back().t_end_ms);
            tokens += out.back().output_tokens;
        }
        batches_.emplace_back(requests.begin() + static_cast<std::ptrdiff_t>(first),
                              requests.begin() + static_cast<std::ptrdiff_t>(last));
        const std::int64_t ms = std::max<std::int64_t>(1, end - clock_ms_);
        const int size = static_cast<int>(last - first);
        PerfSample sample;
        sample.batch = size;
        sample.tokens_per_s = static_cast<int>(tokens * 1000 / ms);
        sample.decisions_per_s_milli = static_cast<int>(size * 1'000'000LL / ms);
        perf_.push_back(sample);
        clock_ms_ = end;
    }
    return out;
}

Result FakeBatch::run_single(const std::string& system, const Request& request) {
    Result r = answer_one(system, request);
    clock_ms_ = r.t_end_ms;
    return r;
}

std::vector<PerfSample> FakeBatch::take_perf() { return std::exchange(perf_, {}); }

ModelInfo FakeBatch::info() const {
    ModelInfo info;
    info.file = "fake.gguf";
    info.description = "fake model";
    info.device = "none";
    info.n_parallel = n_parallel_;
    return info;
}

}  // namespace rumor::llm
