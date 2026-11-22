#pragma once
// What can be asked of a model file without running the model: its tokenizer,
// its chat template, its metadata and the llama.cpp grammar parser. The file
// is loaded with the vocabulary only (no weights), so this works without a
// GPU and never computes a single token: it is not "running a model".
//
// Used by the tests that measure prompt sizes and check grammars, and by the
// llama.cpp batch for the chat template. Implemented in src/llm/vocab.

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

struct llama_model;
struct llama_vocab;

namespace rumor::llm {

// The chat template of a model around a system message and a user message,
// with the reasoning mode off:
//
//   pre + <system> + mid + <user> + post      then the model answers
//
// The texts carry the special tokens of the template as text ("<|turn>"); they
// are tokenized with parse_special. `pre` does not include the BOS token: the
// tokenizer adds it.
struct ChatWrap {
    std::string pre;
    std::string mid;
    std::string post;

    friend bool operator==(const ChatWrap&, const ChatWrap&) = default;
};

// The template stored in the GGUF, applied by llama.cpp (Jinja). Throws
// std::runtime_error when the model has no template or it does not have the
// shape above.
ChatWrap chat_wrap_of(const llama_model* model);

// Tokens of `text`. add_special adds the BOS token when the model wants one;
// special tokens written as text are always parsed.
std::vector<std::int32_t> tokenize(const llama_vocab* vocab, std::string_view text,
                                   bool add_special);

// A string value of the GGUF metadata ("general.sampling.temp"), if present.
std::optional<std::string> meta_value(const llama_model* model, const std::string& key);

class ModelVocab {
  public:
    // Loads the vocabulary of a GGUF. Throws std::runtime_error.
    explicit ModelVocab(const std::string& model_path);
    ~ModelVocab();
    ModelVocab(const ModelVocab&) = delete;
    ModelVocab& operator=(const ModelVocab&) = delete;

    std::vector<std::int32_t> tokenize(std::string_view text, bool add_special) const;
    // Tokens of `text` alone, without BOS.
    int count(std::string_view text) const;

    ChatWrap chat_wrap() const;
    std::optional<std::string> meta(const std::string& key) const;

    // True when `text` is one complete sentence of the grammar (start rule
    // "root"), as the llama.cpp grammar sampler sees it: every token of the
    // text is accepted in turn and the grammar accepts the end after the last.
    // Throws std::runtime_error when the grammar does not parse.
    bool grammar_accepts(const std::string& grammar, std::string_view text) const;

  private:
    llama_model* model_ = nullptr;
    const llama_vocab* vocab_ = nullptr;
};

}  // namespace rumor::llm
