// `rumor extract --model <gguf> --lang <es|en> --text "<sentence>"
//               [--prompt full|card] [--data <dir>] [--device <name>]`
// Turns one sentence into a fact and prints what the engine understood.

#include <cstdint>
#include <iostream>
#include <memory>
#include <string>
#include <string_view>

#include "cli/usage.h"
#include "core/catalog.h"
#include "core/population_api.h"
#include "core/scenario.h"
#include "extract/extract.h"
#include "llm/batch.h"

namespace rumor {
namespace {

// The village of the user: the names do not depend on the seed.
constexpr int kNeighbors = 100;
constexpr std::uint64_t kSeed = 1;

}  // namespace

int extract_command(int argc, char** argv) {
    llm::BatchOptions batch_options;
    batch_options.n_parallel = 1;
    std::string data_dir = "data";
    std::string text;
    Lang lang = Lang::es;
    PromptMode mode = PromptMode::full;
    bool has_lang = false, has_text = false;
    for (int i = 2; i < argc; i += 2) {
        const std::string_view flag = argv[i];
        if (i + 1 >= argc) throw UsageError("missing value for " + std::string(flag));
        const std::string value = argv[i + 1];
        if (flag == "--model") {
            batch_options.model_path = value;
        } else if (flag == "--lang") {
            const auto parsed = from_key<Lang>(value);
            if (!parsed) throw UsageError("unknown language '" + value + "'");
            lang = *parsed;
            has_lang = true;
        } else if (flag == "--text") {
            text = value;
            has_text = true;
        } else if (flag == "--prompt") {
            const auto parsed = from_key<PromptMode>(value);
            if (!parsed) throw UsageError("unknown prompt mode '" + value + "'");
            mode = *parsed;
        } else if (flag == "--data") {
            data_dir = value;
        } else if (flag == "--device") {
            batch_options.device = value;
        } else {
            throw UsageError("unknown option '" + std::string(flag) + "'");
        }
    }
    if (batch_options.model_path.empty() || !has_lang || !has_text) {
        throw UsageError("extract needs --model, --lang and --text");
    }
    if (text.find_first_not_of(" \t\r\n") == std::string::npos) {
        throw UsageError("--text is empty");
    }

    const Vocab vocab = load_vocab(data_dir, lang);
    const Population population = make_population(data_dir, kNeighbors, Layout::village, kSeed);
    const std::unique_ptr<llm::Batch> batch = llm::make_llama_batch(batch_options);
    const std::unique_ptr<Extractor> extractor =
        make_extractor(*batch, data_dir, vocab, population, mode);
    const Extracted fact = extractor->extract(text);
    std::cout << understood_message(fact, vocab, population) << '\n';
    if (!fact.ok) {
        std::cerr << "extract: the model answered '" << fact.raw << "'\n";
        return 1;
    }
    return 0;
}

}  // namespace rumor
