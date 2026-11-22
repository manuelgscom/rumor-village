// The tokenizer, chat template, metadata and grammar parser of a model file,
// through llama.cpp. Nothing here decodes a token.

#include "llm/model_vocab.h"

#include <cmath>
#include <cstddef>
#include <cstdio>
#include <stdexcept>

#include <chat.h>
#include <llama.h>

namespace rumor::llm {
namespace {

// Only errors: loading a vocabulary prints hundreds of lines otherwise.
void quiet_log(enum ggml_log_level level, const char* text, void*) {
    if (level == GGML_LOG_LEVEL_ERROR) std::fputs(text, stderr);
}

// Stand-ins for the two messages. No spaces around them: templates trim.
constexpr std::string_view kSystemMark = "@@RUMOR-SYSTEM@@";
constexpr std::string_view kUserMark = "@@RUMOR-USER@@";

std::string piece_of(const llama_vocab* vocab, llama_token token) {
    char buf[256];
    const int n = llama_token_to_piece(vocab, token, buf, sizeof buf, 0, true);
    return n > 0 ? std::string(buf, static_cast<std::size_t>(n)) : std::string();
}

std::vector<std::int32_t> tokenize_as(const llama_vocab* vocab, std::string_view text,
                                      bool add_special, bool parse_special) {
    const auto size = static_cast<std::int32_t>(text.size());
    const int n = -llama_tokenize(vocab, text.data(), size, nullptr, 0, add_special, parse_special);
    if (n <= 0) return {};
    std::vector<std::int32_t> tokens(static_cast<std::size_t>(n));
    const int written =
        llama_tokenize(vocab, text.data(), size, tokens.data(), n, add_special, parse_special);
    if (written != n) throw std::runtime_error("tokenizer returned an inconsistent count");
    return tokens;
}

// True when the grammar sampler accepts `token` as the next one.
bool accepts(llama_sampler* grammar, llama_token token) {
    llama_token_data one = {token, 0.0f, 0.0f};
    llama_token_data_array candidates = {&one, 1, -1, false};
    llama_sampler_apply(grammar, &candidates);
    return !std::isinf(one.logit);
}

}  // namespace

ChatWrap chat_wrap_of(const llama_model* model) {
    const common_chat_templates_ptr templates = common_chat_templates_init(model, "");
    if (!templates || !common_chat_templates_was_explicit(templates.get())) {
        throw std::runtime_error("the model file has no chat template");
    }
    common_chat_templates_inputs inputs;
    common_chat_msg system;
    system.role = "system";
    system.content = std::string(kSystemMark);
    common_chat_msg user;
    user.role = "user";
    user.content = std::string(kUserMark);
    inputs.messages = {system, user};
    inputs.add_generation_prompt = true;
    inputs.use_jinja = true;
    inputs.enable_thinking = false;
    const std::string text = common_chat_templates_apply(templates.get(), inputs).prompt.str();

    const std::size_t at_system = text.find(kSystemMark);
    const std::size_t at_user = text.find(kUserMark);
    if (at_system == std::string::npos || at_user == std::string::npos || at_user < at_system) {
        throw std::runtime_error("the chat template does not put a system message before the user message");
    }
    ChatWrap wrap;
    wrap.pre = text.substr(0, at_system);
    wrap.mid = text.substr(at_system + kSystemMark.size(), at_user - at_system - kSystemMark.size());
    wrap.post = text.substr(at_user + kUserMark.size());

    // The tokenizer adds the BOS token; the template must not add a second one.
    const llama_vocab* vocab = llama_model_get_vocab(model);
    const llama_token bos = llama_vocab_bos(vocab);
    if (bos != LLAMA_TOKEN_NULL) {
        const std::string bos_text = piece_of(vocab, bos);
        if (!bos_text.empty() && wrap.pre.starts_with(bos_text)) wrap.pre.erase(0, bos_text.size());
    }
    return wrap;
}

std::vector<std::int32_t> tokenize(const llama_vocab* vocab, std::string_view text,
                                   bool add_special) {
    return tokenize_as(vocab, text, add_special, true);
}

std::optional<std::string> meta_value(const llama_model* model, const std::string& key) {
    char buf[512];
    const int n = llama_model_meta_val_str(model, key.c_str(), buf, sizeof buf);
    if (n < 0) return std::nullopt;
    return std::string(buf);
}

ModelVocab::ModelVocab(const std::string& model_path) {
    llama_log_set(quiet_log, nullptr);
    llama_backend_init();
    llama_model_params params = llama_model_default_params();
    params.vocab_only = true;
    model_ = llama_model_load_from_file(model_path.c_str(), params);
    if (!model_) throw std::runtime_error("cannot load the vocabulary of '" + model_path + "'");
    vocab_ = llama_model_get_vocab(model_);
}

ModelVocab::~ModelVocab() {
    if (model_) llama_model_free(model_);
}

std::vector<std::int32_t> ModelVocab::tokenize(std::string_view text, bool add_special) const {
    return llm::tokenize(vocab_, text, add_special);
}

int ModelVocab::count(std::string_view text) const {
    return static_cast<int>(tokenize(text, false).size());
}

ChatWrap ModelVocab::chat_wrap() const { return chat_wrap_of(model_); }

std::optional<std::string> ModelVocab::meta(const std::string& key) const {
    return meta_value(model_, key);
}

bool ModelVocab::grammar_accepts(const std::string& grammar, std::string_view text) const {
    llama_sampler* sampler = llama_sampler_init_grammar(vocab_, grammar.c_str(), "root");
    if (!sampler) throw std::runtime_error("the grammar does not parse");
    bool ok = true;
    // The text is the model output: plain text, no special tokens in it.
    for (const std::int32_t token : tokenize_as(vocab_, text, false, false)) {
        if (!accepts(sampler, token)) {
            ok = false;
            break;
        }
        llama_sampler_accept(sampler, token);
    }
    if (ok) {
        // Complete when the grammar lets the generation end here.
        const llama_token eot = llama_vocab_eot(vocab_);
        const llama_token eos = llama_vocab_eos(vocab_);
        ok = (eot != LLAMA_TOKEN_NULL && accepts(sampler, eot)) ||
             (eos != LLAMA_TOKEN_NULL && accepts(sampler, eos));
    }
    llama_sampler_free(sampler);
    return ok;
}

}  // namespace rumor::llm
