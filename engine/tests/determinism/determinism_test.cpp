// Same seed, same log byte for byte: the property the whole engine is built
// around. Runs the real scenarios with the baseline, from the data of the repo.
#include <doctest/doctest.h>

#include <cstdint>
#include <sstream>
#include <string>

#include "core/sim_api.h"

using namespace rumor;

namespace {

std::string run(const std::string& scenario, Lang lang, std::uint64_t seed) {
    RunOptions options;
    options.data_dir = RUMOR_DATA_DIR;
    options.scenario = scenario;
    options.lang = lang;
    options.seed = seed;
    std::ostringstream out;
    run_to_stream(options, out);
    return out.str();
}

// Everything after the header line.
std::string events_of(const std::string& log) {
    const std::size_t end_of_header = log.find('\n');
    REQUIRE(end_of_header != std::string::npos);
    return log.substr(end_of_header + 1);
}

}  // namespace

TEST_SUITE("determinism") {

TEST_CASE("party-25: the same seed gives the same bytes") {
    const std::string a = run("party-25", Lang::es, 1);
    const std::string b = run("party-25", Lang::es, 1);
    CHECK_FALSE(a.empty());
    CHECK(a == b);
}

TEST_CASE("party-25: another seed gives another log") {
    const std::string a = run("party-25", Lang::es, 1);
    const std::string b = run("party-25", Lang::es, 2);
    CHECK(a != b);
    CHECK(events_of(a) != events_of(b));
}

TEST_CASE("telephone-20 and party-100: the same seed gives the same bytes") {
    CHECK(run("telephone-20", Lang::en, 5) == run("telephone-20", Lang::en, 5));
    CHECK(run("party-100", Lang::es, 3) == run("party-100", Lang::es, 3));
}

TEST_CASE("the language changes the header and nothing else") {
    // The baseline decides on identifiers, so both languages tell the same story.
    const std::string es = run("party-25", Lang::es, 4);
    const std::string en = run("party-25", Lang::en, 4);
    CHECK(es != en);
    CHECK(events_of(es) == events_of(en));
}

}  // TEST_SUITE("determinism")
