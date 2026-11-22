#pragma once
// Shared by the subcommands of `rumor` (cli.cpp, bench*, extract*).

#include <cstdint>
#include <stdexcept>
#include <string>
#include <string_view>

#include "core/sim_api.h"
#include "llm/batch.h"

namespace rumor {

// A command line that cannot be understood: cli_main prints the usage and
// exits with code 2. Any other exception exits with code 1.
struct UsageError : std::runtime_error {
    using std::runtime_error::runtime_error;
};

// The options of a run with a model, common to `run` and `bench`:
//   --model <gguf>  --text <all|none>  --prompt <full|card>  --batch <N>
//   --device <name>  --sample-threads <N>  --prefix-mode <copy|reprocess>
// Returns false when `flag` is not one of them. --model also sets
// options.policy to "model". Throws UsageError on a bad value.
bool parse_model_flag(std::string_view flag, const std::string& value, RunOptions& options,
                      llm::BatchOptions& batch);

// A non-negative integer option. Throws UsageError naming the flag.
std::uint64_t parse_uint(std::string_view flag, const std::string& value);

}  // namespace rumor
