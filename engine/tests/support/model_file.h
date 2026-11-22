#pragma once
// The model file of the tests, from the environment variable RUMOR_MODEL (the
// shortcuts in scripts/ set it when models/ has the file).
//
// Two kinds of cases use it:
//   - without GPU: the tokenizer, the chat template and the grammar parser of
//     the model (llm::ModelVocab). They never run the model. If the variable
//     is not set they return at once: use RUMOR_SKIP_WITHOUT_MODEL.
//   - with GPU, in TEST_SUITE("<suite>_gpu"): the model itself. They run only
//     with scripts/engine-test.sh --gpu, which requires the file.

#include <cstddef>
#include <cstdlib>
#include <optional>
#include <string>

#include <doctest/doctest.h>

#include "llm/model_vocab.h"

namespace rumor::testing {

inline std::optional<std::string> model_path() {
#ifdef _WIN32
    // MSVC deprecates std::getenv (C4996): _dupenv_s is its safe form.
    char* raw = nullptr;
    std::size_t size = 0;
    if (_dupenv_s(&raw, &size, "RUMOR_MODEL") != 0 || !raw) return std::nullopt;
    const std::string path(raw);
    std::free(raw);
#else
    const char* raw = std::getenv("RUMOR_MODEL");
    const std::string path = raw ? raw : "";
#endif
    if (path.empty()) return std::nullopt;
    return path;
}

// The vocabulary of the model, loaded once for the whole test run. Null
// without RUMOR_MODEL.
inline const llm::ModelVocab* model_vocab() {
    static const std::optional<std::string> path = model_path();
    if (!path) return nullptr;
    static const llm::ModelVocab vocab(*path);
    return &vocab;
}

}  // namespace rumor::testing

// First line of a case that needs the model file.
#define RUMOR_SKIP_WITHOUT_MODEL()                                        \
    do {                                                                  \
        if (!rumor::testing::model_path()) {                              \
            MESSAGE("SKIPPED: RUMOR_MODEL is not set (no model file)");   \
            return;                                                       \
        }                                                                 \
    } while (false)
