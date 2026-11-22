// `rumor bench` with the baseline: the card, resuming after a crash, the
// bootstrap and the command line. The model path needs the GPU and is covered
// by the integration.
#include <doctest/doctest.h>

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <iterator>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "cli/bench.h"
#include "cli/bench_card.h"
#include "cli/usage.h"
#include "core/build_info.h"
#include "core/log_api.h"
#include "core/metrics_api.h"
#include "core/sim_api.h"

using namespace rumor;
namespace fs = std::filesystem;
using Json = nlohmann::ordered_json;

namespace {

const std::string kData = RUMOR_DATA_DIR;

// A fresh folder under build/ for one case.
fs::path scratch(const std::string& name) {
    const fs::path dir =
        (fs::path(kData).parent_path() / "build" / "tests-bench" / name).lexically_normal();
    fs::remove_all(dir);
    fs::create_directories(dir);
    return dir;
}

// Calls bench_command with "rumor bench" in front of `args`.
int bench(std::vector<std::string> args) {
    args.insert(args.begin(), {"rumor", "bench"});
    std::vector<char*> argv;
    for (std::string& s : args) argv.push_back(s.data());
    return bench_command(static_cast<int>(argv.size()), argv.data());
}

int cli(std::vector<std::string> args) {
    args.insert(args.begin(), "rumor");
    std::vector<char*> argv;
    for (std::string& s : args) argv.push_back(s.data());
    return cli_main(static_cast<int>(argv.size()), argv.data());
}

std::vector<std::string> baseline(const fs::path& out, const std::string& runs,
                                  const std::string& scenario = "telephone-20") {
    return {"--policy", "baseline", "--scenario", scenario, "--lang", "es",
            "--runs",   runs,       "--out",      out.string(), "--data", kData};
}

std::string slurp(const fs::path& p) {
    std::ifstream in(p, std::ios::binary);
    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

Json metrics_of(const fs::path& log) {
    std::ifstream in(log, std::ios::binary);
    const Log l = read_log(in);
    return compute_metrics(l.header, l.events);
}

}  // namespace

TEST_SUITE("bench") {
    TEST_CASE("three runs give a valid card in JSON and Markdown") {
        const fs::path out = scratch("three");
        REQUIRE(bench(baseline(out, "3", "party-25")) == 0);
        for (int s = 1; s <= 3; ++s) {
            CHECK(fs::exists(out / ("seed-" + std::to_string(s) + ".jsonl")));
            CHECK_FALSE(fs::exists(out / ("seed-" + std::to_string(s) + ".jsonl.part")));
        }
        const Json card = Json::parse(slurp(out / "card.json"));
        CHECK(card["card"] == kBenchCardFormat);
        CHECK(card["contract_version"] == kContractVersion);
        CHECK(card["engine_commit"].is_string());
        CHECK(card["llama_commit"].is_string());
        CHECK(card["scenario"] == "party-25");
        CHECK(card["lang"] == "es");
        CHECK(card["policy"] == "baseline");
        CHECK(card["model"].is_null());
        CHECK(card["text"].is_null());
        CHECK(card["runs"] == 3);
        CHECK(card["seeds"] == Json::array({1, 2, 3}));
        CHECK(card["interval"]["resamples"] == kBootstrapResamples);

        const Json& m = card["metrics"];
        CHECK_FALSE(m.contains("seed"));
        CHECK_FALSE(m.contains("scenario"));
        const Json& total = m["decisions"]["total"];
        CHECK(total["runs"] == 3);
        double expected = 0;
        for (int s = 1; s <= 3; ++s) {
            expected += metrics_of(out / ("seed-" + std::to_string(s) + ".jsonl"))["decisions"]
                                     ["total"]
                                         .get<double>();
        }
        CHECK(total["mean"].get<double>() == doctest::Approx(expected / 3));
        CHECK(total["lo"].get<double>() <= total["mean"].get<double>());
        CHECK(total["hi"].get<double>() >= total["mean"].get<double>());
        CHECK(m["rejected"]["by_reason"].is_object());
        CHECK(m["reach"]["fact"].is_string());
        CHECK(m["reach"]["timeline"].is_array());
        // The baseline does not generate: no run brings these numbers.
        CHECK(m["incoherent_text"]["runs"] == 0);
        CHECK(m["incoherent_text"]["mean"].is_null());
        CHECK(m["performance"]["runs"] == 0);

        const std::string md = slurp(out / "card.md");
        CHECK(md.find("# Ficha de resultados: party-25 · es") != std::string::npos);
        CHECK(md.find("semillas 1–3") != std::string::npos);
        CHECK(md.find("Rechazadas") != std::string::npos);
        CHECK(md.find("Deformación por salto") != std::string::npos);
        CHECK(md.find("Decisiones por tick (p95)") != std::string::npos);
        CHECK(md == card_markdown(card));
    }

    TEST_CASE("a second launch completes only what is missing") {
        const fs::path out = scratch("resume");
        REQUIRE(bench(baseline(out, "3")) == 0);
        const std::string one = slurp(out / "seed-1.jsonl");
        const std::string two = slurp(out / "seed-2.jsonl");
        const std::string three = slurp(out / "seed-3.jsonl");
        const std::string card = slurp(out / "card.json");
        const auto one_time = fs::last_write_time(out / "seed-1.jsonl");

        // The process dies: one log cut halfway, one missing, a leftover part.
        {
            std::ofstream cut(out / "seed-2.jsonl", std::ios::binary | std::ios::trunc);
            cut << two.substr(0, two.size() / 2);
        }
        fs::remove(out / "seed-3.jsonl");
        {
            std::ofstream left(out / "seed-3.jsonl.part", std::ios::binary);
            left << "{\"type\":\"header\"";
        }
        fs::remove(out / "card.json");

        REQUIRE(bench(baseline(out, "3")) == 0);
        CHECK(slurp(out / "seed-1.jsonl") == one);
        CHECK(fs::last_write_time(out / "seed-1.jsonl") == one_time);
        CHECK(slurp(out / "seed-2.jsonl") == two);
        CHECK(slurp(out / "seed-3.jsonl") == three);
        CHECK_FALSE(fs::exists(out / "seed-3.jsonl.part"));
        CHECK(slurp(out / "card.json") == card);

        // A log cut exactly before its `end` line is not a run either.
        const std::size_t last = three.rfind('\n', three.size() - 2);
        {
            std::ofstream cut(out / "seed-3.jsonl", std::ios::binary | std::ios::trunc);
            cut << three.substr(0, last + 1);
        }
        const auto two_time = fs::last_write_time(out / "seed-2.jsonl");
        REQUIRE(bench(baseline(out, "3")) == 0);
        CHECK(slurp(out / "seed-3.jsonl") == three);
        CHECK(fs::last_write_time(out / "seed-2.jsonl") == two_time);

        // More runs later: only the new seeds are run.
        REQUIRE(bench(baseline(out, "4")) == 0);
        CHECK(fs::last_write_time(out / "seed-1.jsonl") == one_time);
        CHECK(fs::exists(out / "seed-4.jsonl"));
        CHECK(Json::parse(slurp(out / "card.json"))["runs"] == 4);
    }

    TEST_CASE("a whole log of another bench is not mixed in") {
        const fs::path out = scratch("mixed");
        REQUIRE(bench(baseline(out, "1", "party-25")) == 0);
        CHECK_THROWS_WITH_AS(bench(baseline(out, "1", "telephone-20")),
                             doctest::Contains("use another --out"), std::runtime_error);
    }

    TEST_CASE("the bootstrap is fixed, and one run gives the value itself") {
        const std::vector<double> values = {0.12, 0.30, 0.18, 0.25, 0.07, 0.40};
        const Interval a = bootstrap(values);
        const Interval b = bootstrap(values);
        CHECK(a.runs == 6);
        CHECK(a.mean == b.mean);
        CHECK(a.lo == b.lo);
        CHECK(a.hi == b.hi);
        CHECK(a.mean == doctest::Approx(1.32 / 6));
        CHECK(a.lo < a.mean);
        CHECK(a.hi > a.mean);
        CHECK(a.lo >= 0.07);
        CHECK(a.hi <= 0.40);

        const Interval one = bootstrap({0.25});
        CHECK(one.runs == 1);
        CHECK(one.mean == 0.25);
        CHECK(one.lo == 0.25);
        CHECK(one.hi == 0.25);

        CHECK(bootstrap({}).runs == 0);

        const Interval same = bootstrap({3, 3, 3});
        CHECK(same.lo == 3);
        CHECK(same.hi == 3);
    }

    TEST_CASE("merging counts the runs that bring each number") {
        const Json a = Json::parse(R"({"seed":1,"x":{"rate":0.5},"p":null,"s":"f1","t":[{"v":1}]})");
        const Json b = Json::parse(R"({"seed":2,"x":{"rate":null},"p":{"d":4},"s":"f1","t":[{"v":3}]})");
        const Json m = aggregate_metrics({a, b});
        CHECK_FALSE(m.contains("seed"));
        CHECK(m["x"]["rate"]["runs"] == 1);
        CHECK(m["x"]["rate"]["mean"] == 0.5);
        CHECK(m["x"]["rate"]["lo"] == 0.5);
        CHECK(m["p"]["d"]["runs"] == 1);
        CHECK(m["s"] == "f1");
        CHECK(m["t"][0]["v"]["runs"] == 2);
        CHECK(m["t"][0]["v"]["mean"] == 2.0);
        CHECK(aggregate_metrics({a, b}) == m);
    }

    TEST_CASE("default output folder") {
        RunOptions run;
        run.scenario = "party-100";
        run.lang = Lang::en;
        llm::BatchOptions batch;
        CHECK(bench_default_out(run, batch) == fs::path("runs/bench/baseline/party-100-en"));
        run.policy = "model";
        batch.model_path = "/models/gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf";
        CHECK(bench_default_out(run, batch) ==
              fs::path("runs/bench/gemma-4-E4B-it-qat-UD-Q4_K_XL/party-100-en"));
        run.text = TextMode::none;
        CHECK(bench_default_out(run, batch) ==
              fs::path("runs/bench/gemma-4-E4B-it-qat-UD-Q4_K_XL/party-100-en-notext"));
    }

    TEST_CASE("usage errors") {
        const fs::path out = scratch("usage");
        const std::string o = out.string();
        const auto bad = [](std::vector<std::string> args) {
            CHECK_THROWS_AS(bench(std::move(args)), UsageError);
        };
        bad({"--policy", "baseline", "--scenario", "party-25", "--lang", "es"});  // no --runs
        bad({"--policy", "baseline", "--lang", "es", "--runs", "2"});            // no --scenario
        bad({"--scenario", "party-25", "--lang", "es", "--runs", "2"});          // no policy
        bad({"--policy", "baseline", "--scenario", "party-25", "--lang", "es", "--runs", "0"});
        bad({"--policy", "baseline", "--scenario", "party-25", "--lang", "es", "--runs", "x"});
        bad({"--policy", "baseline", "--scenario", "party-25", "--lang", "fr", "--runs", "2"});
        bad({"--policy", "baseline", "--scenario", "party-25", "--lang", "es", "--runs", "2",
             "--seed-base", "-1"});
        bad({"--policy", "baseline", "--scenario", "party-25", "--lang", "es", "--runs", "2",
             "--frobnicate", "1"});
        bad({"--policy", "baseline", "--scenario", "party-25", "--lang", "es", "--runs", "2",
             "--trace"});
        bad({"--policy", "baseline", "--scenario", "party-25", "--lang", "es", "--runs", "2",
             "--text", "none"});
        bad({"--policy", "baseline", "--scenario", "party-25", "--lang", "es", "--runs", "2",
             "--batch", "8"});
        bad({"--policy", "model", "--scenario", "party-25", "--lang", "es", "--runs", "2"});
        bad({"--policy", "random", "--scenario", "party-25", "--lang", "es", "--runs", "2"});
        bad({"--model", "/models/x.gguf", "--policy", "baseline", "--scenario", "party-25",
             "--lang", "es", "--runs", "2"});
        bad({"--model", "/models/x.gguf", "--text", "some", "--scenario", "party-25", "--lang",
             "es", "--runs", "2"});
        bad({"--policy", "baseline", "--scenario", "party-25", "--lang", "es", "--runs"});

        // Through the command line: usage errors exit with 2, the rest with 1.
        CHECK(cli({"bench", "--policy", "baseline", "--lang", "es", "--runs", "2"}) == 2);
        CHECK(cli({"bench", "--policy", "baseline", "--scenario", "nowhere", "--lang", "es",
                   "--runs", "1", "--out", o, "--data", kData}) == 1);
        CHECK_FALSE(fs::exists(out / "seed-1.jsonl"));
        CHECK_FALSE(fs::exists(out / "seed-1.jsonl.part"));
        CHECK_FALSE(fs::exists(out / "card.json"));
    }
}
