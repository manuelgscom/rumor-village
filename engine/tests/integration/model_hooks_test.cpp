// The hooks a model policy uses, without a model: the name of the model in the
// log header, the generation of every decision and the `perf` samples, from
// the simulation through the log to the metrics.
#include <doctest/doctest.h>

#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <sstream>
#include <string>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/log_api.h"
#include "core/metrics_api.h"
#include "core/policy.h"
#include "core/population_api.h"
#include "core/sim_api.h"
#include "core/world_api.h"

using namespace rumor;

namespace {

// Decides as the baseline, and reports like a model: every batch takes 100 ms
// of a clock of its own and leaves one sample.
class TimedPolicy : public Policy {
  public:
    std::string name() const override { return "model"; }
    std::optional<std::string> model() const override { return "fake.gguf"; }

    std::vector<Decision> decide(std::span<const DecisionRequest> batch) override {
        std::vector<Decision> out = inner_->decide(batch);
        for (Decision& d : out) d.gen = Generation{clock_, clock_ + 100, 900, 30};
        clock_ += 100;
        PerfSample sample;
        sample.batch = static_cast<int>(batch.size());
        sample.tokens_per_s = 300 * sample.batch;
        sample.decisions_per_s_milli = 10'000 * sample.batch;
        sample.vram_mb = 4000 + sample.batch;
        perf_.push_back(sample);
        return out;
    }

    std::vector<PerfSample> take_perf() override {
        std::vector<PerfSample> out;
        out.swap(perf_);
        return out;
    }

  private:
    std::unique_ptr<Policy> inner_ = make_baseline_policy();
    std::int64_t clock_ = 0;
    std::vector<PerfSample> perf_;
};

Log run_timed(std::string* text = nullptr) {
    const std::string data = RUMOR_DATA_DIR;
    const std::uint64_t seed = 3;
    const ScenarioParams params = load_scenario(data, "party-25", Lang::es);
    const World world = load_world(data);
    const Population population = make_population(data, params.neighbors, params.layout, seed);
    const Vocab vocab = load_vocab(data, Lang::es);
    TimedPolicy policy;
    std::ostringstream out;
    RunSink sink;
    sink.header = [&](const LogHeader& header) { out << write_header(header) << '\n'; };
    sink.event = [&](const Event& event) { out << write_event(event) << '\n'; };
    run_simulation(params, world, population, vocab, policy, seed, sink);
    if (text) *text = out.str();
    std::istringstream in(out.str());
    return read_log(in);
}

}  // namespace

TEST_SUITE("integration") {

TEST_CASE("a model policy leaves its name, its timings and its samples in the log") {
    std::string text;
    const Log log = run_timed(&text);
    CHECK(log.header.policy == "model");
    CHECK(log.header.model == std::optional<std::string>("fake.gguf"));
    CHECK(text.find("\"policy\":\"model\",\"model\":\"fake.gguf\"") != std::string::npos);

    // One sample per tick with decisions, after the decisions of that tick.
    int decisions = 0, samples = 0, in_tick = 0;
    Tick tick = -1;
    bool sampled = false;
    for (const Event& e : log.events) {
        if (event_tick(e) != tick) {
            if (tick >= 0) CHECK(sampled == (in_tick > 0));
            tick = event_tick(e);
            in_tick = 0;
            sampled = false;
        }
        if (const auto* turn = std::get_if<TurnEvent>(&e)) {
            REQUIRE(turn->gen);
            CHECK(turn->gen->t_end_ms - turn->gen->t_start_ms == 100);
            CHECK_FALSE(sampled);
            ++decisions;
            ++in_tick;
        } else if (const auto* plan = std::get_if<PlanEvent>(&e)) {
            REQUIRE(plan->gen);
            CHECK_FALSE(sampled);
            ++decisions;
            ++in_tick;
        } else if (const auto* perf = std::get_if<PerfEvent>(&e)) {
            CHECK(perf->batch == in_tick);
            CHECK(perf->vram_mb == 4000 + in_tick);
            sampled = true;
            ++samples;
        }
    }
    CHECK(decisions > 100);
    CHECK(samples > 50);

    const nlohmann::ordered_json card = compute_metrics(log.header, log.events);
    const auto& p = card["performance"];
    REQUIRE(p.is_object());
    CHECK(p["decisions"] == decisions);
    CHECK(p["busy_ticks"] == samples);
    CHECK(p["generation_ms"] == 100 * samples);
    CHECK(p["tokens_in"] == 900 * decisions);
    CHECK(p["tokens_out"] == 30 * decisions);
    CHECK(p["decisions_per_s"].get<double>() == doctest::Approx(decisions * 10.0 / samples));
    CHECK(p["tokens_per_s"].get<double>() == doctest::Approx(decisions * 300.0 / samples));
    CHECK(p["ms_per_tick"]["mean"].get<double>() == doctest::Approx(100.0));
    CHECK(p["ms_per_tick"]["p95"] == 100);
    CHECK(p["ms_per_decision"]["max"] == 100);
    CHECK(p["decisions_per_tick"]["mean"].get<double>() ==
          doctest::Approx(static_cast<double>(decisions) / samples));
    CHECK(p["decisions_per_tick"]["max"].get<int>() >= p["decisions_per_tick"]["p95"].get<int>());
    CHECK(p["batch"]["samples"] == samples);
    CHECK(p["batch"]["max"] == p["decisions_per_tick"]["max"]);
    CHECK(p["vram_mb"] == 4000 + p["batch"]["max"].get<int>());
    CHECK(card["model"] == "fake.gguf");
}

TEST_CASE("the baseline has no performance section and no reject reasons to count") {
    RunOptions options;
    options.data_dir = RUMOR_DATA_DIR;
    options.scenario = "party-25";
    options.lang = Lang::es;
    options.seed = 3;
    std::ostringstream out;
    run_to_stream(options, out);
    CHECK(out.str().find("\"type\":\"perf\"") == std::string::npos);
    std::istringstream in(out.str());
    const Log log = read_log(in);
    const nlohmann::ordered_json card = compute_metrics(log.header, log.events);
    CHECK(card["performance"].is_null());
    CHECK(card["rejected"]["by_reason"]["malformed"] == 0);
    CHECK(card["rejected"]["by_reason"]["truncated"] == 0);
    CHECK(card["decisions"]["go_incomplete"].is_number());
}

TEST_CASE("an unknown policy and a model policy without a model are refused") {
    RunOptions options;
    options.data_dir = RUMOR_DATA_DIR;
    options.scenario = "party-25";
    options.seed = 1;
    std::ostringstream out;
    options.policy = "oracle";
    CHECK_THROWS_WITH(run_to_stream(options, out), "unknown policy 'oracle'");
    options.policy = "model";
    CHECK_THROWS_WITH(run_to_stream(options, out), "the model policy needs a model");
}

}  // TEST_SUITE
