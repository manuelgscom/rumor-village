// The batch of decisions on llama.cpp (docs/fases/fase-2.md, package A). The
// pattern is the one measured in phase 0 (bench/prefix/decision_bench.cpp):
//
//   set_prefix   seq 0 (master) <- pre + prefix + mid, decoded once
//   each round   seq_cp 0 -> 1..n, decode every card + post in one batch,
//                then one token per unfinished sequence per step; every worker
//                is removed whole when the round ends, the master stays
//
// Sampling, one chain per sequence: top_k -> top_p -> temp -> dist(seed), with
// the grammar applied the cheap way of common_sampler_sample (grammar_first =
// false): the token is sampled without the grammar and only checked against
// it; when the grammar rejects it, the grammar filters every candidate and the
// chain samples again.

#include "llm/llama_batch.h"

#include <algorithm>
#include <atomic>
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <exception>
#include <filesystem>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <ggml-backend.h>
#include <llama.h>

#include "llm/model_vocab.h"

namespace rumor::llm {
namespace {

using Tokens = std::vector<llama_token>;
using Clock = std::chrono::steady_clock;

// llama.cpp prints a lot while loading. Warnings and errors reach stderr (the
// performance warnings among them); information and debug lines do not.
void log_warnings(ggml_log_level level, const char* text, void*) {
    static std::atomic<ggml_log_level> last{GGML_LOG_LEVEL_INFO};
    if (level == GGML_LOG_LEVEL_CONT) {
        level = last.load();
    } else {
        last.store(level);
    }
    if (level == GGML_LOG_LEVEL_WARN || level == GGML_LOG_LEVEL_ERROR) std::fputs(text, stderr);
}

struct ModelFree {
    void operator()(llama_model* model) const { llama_model_free(model); }
};
struct ContextFree {
    void operator()(llama_context* ctx) const { llama_free(ctx); }
};
struct SamplerFree {
    void operator()(llama_sampler* sampler) const { llama_sampler_free(sampler); }
};
using SamplerPtr = std::unique_ptr<llama_sampler, SamplerFree>;

bool is_gpu(ggml_backend_dev_t dev) {
    const auto type = ggml_backend_dev_type(dev);
    return type == GGML_BACKEND_DEVICE_TYPE_GPU || type == GGML_BACKEND_DEVICE_TYPE_IGPU;
}

std::string device_names() {
    std::string names;
    for (std::size_t i = 0; i < ggml_backend_dev_count(); ++i) {
        if (!names.empty()) names += ", ";
        names += ggml_backend_dev_name(ggml_backend_dev_get(i));
    }
    return names.empty() ? "none" : names;
}

// The device of the model: by name, or CUDA0, or the first GPU. Never the CPU.
ggml_backend_dev_t pick_device(const std::string& name) {
    if (!name.empty()) {
        ggml_backend_dev_t dev = ggml_backend_dev_by_name(name.c_str());
        if (!dev) {
            throw std::runtime_error("no llama.cpp device named '" + name + "' (available: " +
                                     device_names() + ")");
        }
        if (!is_gpu(dev)) {
            throw std::runtime_error("device '" + name +
                                     "' is not a GPU: nothing that runs a model goes on the CPU");
        }
        return dev;
    }
    if (ggml_backend_dev_t dev = ggml_backend_dev_by_name("CUDA0"); dev && is_gpu(dev)) return dev;
    for (std::size_t i = 0; i < ggml_backend_dev_count(); ++i) {
        ggml_backend_dev_t dev = ggml_backend_dev_get(i);
        if (is_gpu(dev)) return dev;
    }
    throw std::runtime_error("no GPU device (available: " + device_names() +
                             "): nothing that runs a model goes on the CPU");
}

template <typename T>
T meta_number(const llama_model* model, const std::string& key, T fallback) {
    const std::optional<std::string> text = meta_value(model, key);
    if (!text) return fallback;
    T value{};
    const char* end = text->data() + text->size();
    const auto [at, ec] = std::from_chars(text->data(), end, value);
    return ec == std::errc() && at == end ? value : fallback;
}

std::int64_t ms_between(Clock::time_point from, Clock::time_point to) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(to - from).count();
}

// True when the grammar accepts `token` as the next one.
bool grammar_allows(llama_sampler* grammar, llama_token token) {
    llama_token_data one = {token, 0.0f, 0.0f};
    llama_token_data_array single = {&one, 1, -1, false};
    llama_sampler_apply(grammar, &single);
    return !std::isinf(one.logit);
}

class LlamaBatch final : public Batch {
  public:
    explicit LlamaBatch(const BatchOptions& options);
    ~LlamaBatch() override;
    LlamaBatch(const LlamaBatch&) = delete;
    LlamaBatch& operator=(const LlamaBatch&) = delete;

    void set_prefix(const std::string& prefix) override;
    std::vector<Result> run(const std::vector<Request>& requests) override;
    Result run_single(const std::string& system, const Request& request) override;
    std::vector<PerfSample> take_perf() override { return std::exchange(perf_, {}); }
    ModelInfo info() const override { return info_; }

    std::vector<std::pair<int, int>> positions() const;
    int shared_size() const { return static_cast<int>(shared_.size()); }

  private:
    // One request being generated in one worker sequence.
    struct Slot {
        const Request* request = nullptr;
        llama_seq_id seq = 0;
        llama_pos pos = 0;  // position of the next token to decode
        Tokens prompt;      // decoded in the worker before the first sample
        SamplerPtr grammar;
        SamplerPtr chain;
        llama_token last = 0;
        bool done = false;
        Result result;
    };

    // A token of a llama_batch; `slot` receives its logits, or -1.
    struct Tok {
        llama_token id;
        llama_pos pos;
        llama_seq_id seq;
        int slot;
    };

    Tokens tokenize_card(const Request& request) const;
    Tokens tokenize_shared(const std::string& system) const;
    SamplerPtr grammar_for(const std::string& gbnf);
    SamplerPtr chain_for(const Request& request) const;
    void generate(std::vector<Slot>& slots, bool from_master);
    void decode_and_sample(const std::vector<Tok>& toks, std::vector<Slot>& slots);
    void sample_all(const std::vector<std::pair<Slot*, const float*>>& pending);
    void sample_one(Slot& slot, const float* logits, std::vector<llama_token_data>& cand) const;
    void accept(Slot& slot, llama_token token) const;
    void remove_workers(const std::vector<Slot>& slots);
    void check_master() const;
    std::int64_t now_ms() const { return ms_between(clock_start_, Clock::now()); }
    int vram_mb() const;

    BatchOptions options_;
    ggml_backend_dev_t device_ = nullptr;
    std::size_t free_before_ = 0;  // device memory free before the model was loaded
    std::unique_ptr<llama_model, ModelFree> model_;
    std::unique_ptr<llama_context, ContextFree> ctx_;
    // Parsed grammars, cloned for each request: parsing one is not free.
    std::map<std::string, SamplerPtr> grammars_;
    const llama_vocab* vocab_ = nullptr;
    llama_memory_t mem_ = nullptr;
    int n_vocab_ = 0;
    int n_batch_ = 0;
    llama_batch batch_{};
    llama_token eog_ = LLAMA_TOKEN_NULL;
    ChatWrap wrap_;
    ModelInfo info_;
    int threads_ = 1;
    std::vector<std::vector<llama_token_data>> cand_;  // one candidate buffer per sampling thread

    bool prefix_set_ = false;
    Tokens shared_;  // pre + prefix + mid
    Clock::time_point clock_start_ = Clock::now();
    std::vector<PerfSample> perf_;
};

LlamaBatch::LlamaBatch(const BatchOptions& options) : options_(options) {
    if (options_.n_parallel < 1) throw std::runtime_error("llama batch: n_parallel must be positive");
    if (options_.max_card_tokens < 1) {
        throw std::runtime_error("llama batch: max_card_tokens must be positive");
    }
    if (options_.sample_threads < 0) {
        throw std::runtime_error("llama batch: sample_threads must not be negative");
    }
    llama_log_set(log_warnings, nullptr);
    llama_backend_init();
    device_ = pick_device(options_.device);
    std::size_t total = 0;
    ggml_backend_dev_memory(device_, &free_before_, &total);

    // Every layer on the chosen device; no multi-token prediction.
    ggml_backend_dev_t devices[] = {device_, nullptr};
    llama_model_params mp = llama_model_default_params();
    mp.devices = devices;
    mp.n_gpu_layers = -1;
    mp.load_mtp = false;
    model_.reset(llama_model_load_from_file(options_.model_path.c_str(), mp));
    if (!model_) throw std::runtime_error("cannot load the model '" + options_.model_path + "'");
    vocab_ = llama_model_get_vocab(model_.get());
    n_vocab_ = llama_vocab_n_tokens(vocab_);
    eog_ = llama_vocab_eos(vocab_);
    if (eog_ == LLAMA_TOKEN_NULL) eog_ = llama_vocab_eot(vocab_);
    wrap_ = chat_wrap_of(model_.get());

    // Context: the master, room for the system part of run_single, and every
    // worker with its card and its output (reprocess: and its prefix).
    const int n = options_.n_parallel;
    const std::size_t worker = static_cast<std::size_t>(options_.max_card_tokens + kMaxOutputTokens);
    std::size_t n_ctx = options_.prefix_mode == PrefixMode::copy
                            ? 2 * kMaxSharedTokens + n * worker
                            : n * (kMaxSharedTokens + worker);
    n_ctx = (n_ctx + 255) / 256 * 256;
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = static_cast<std::uint32_t>(n_ctx);
    cp.n_batch = 2048;
    cp.n_ubatch = 512;
    cp.n_seq_max = static_cast<std::uint32_t>(n + 1);
    cp.kv_unified = true;
    cp.no_perf = true;
    ctx_.reset(llama_init_from_model(model_.get(), cp));
    if (!ctx_) {
        throw std::runtime_error("cannot create the llama.cpp context (n_ctx " + std::to_string(n_ctx) +
                                 ", " + std::to_string(n + 1) + " sequences)");
    }
    mem_ = llama_get_memory(ctx_.get());
    n_batch_ = static_cast<int>(llama_n_batch(ctx_.get()));
    batch_ = llama_batch_init(n_batch_, 0, 1);

    const unsigned hw = std::max(1u, std::thread::hardware_concurrency());
    threads_ = options_.sample_threads == 0 ? static_cast<int>(hw) : options_.sample_threads;
    threads_ = std::clamp(threads_, 1, n);
    cand_.assign(static_cast<std::size_t>(threads_),
                 std::vector<llama_token_data>(static_cast<std::size_t>(n_vocab_)));

    info_.file = std::filesystem::path(options_.model_path).filename().string();
    char desc[256];
    if (llama_model_desc(model_.get(), desc, sizeof desc) > 0) info_.description = desc;
    info_.device = std::string(ggml_backend_dev_name(device_)) + ": " + ggml_backend_dev_description(device_);
    info_.n_parallel = n;
    info_.temperature = meta_number(model_.get(), "general.sampling.temp", kDefaultTemperature);
    info_.top_k = meta_number(model_.get(), "general.sampling.top_k", kDefaultTopK);
    info_.top_p = meta_number(model_.get(), "general.sampling.top_p", kDefaultTopP);
}

LlamaBatch::~LlamaBatch() { llama_batch_free(batch_); }

Tokens LlamaBatch::tokenize_shared(const std::string& system) const {
    Tokens tokens = tokenize(vocab_, wrap_.pre + system + wrap_.mid, true);
    if (static_cast<int>(tokens.size()) > kMaxSharedTokens) {
        throw std::runtime_error("the system part has " + std::to_string(tokens.size()) +
                                 " tokens, more than " + std::to_string(kMaxSharedTokens));
    }
    return tokens;
}

Tokens LlamaBatch::tokenize_card(const Request& request) const {
    if (request.max_tokens < 1 || request.max_tokens > kMaxOutputTokens) {
        throw std::runtime_error("max_tokens must be between 1 and " + std::to_string(kMaxOutputTokens) +
                                 ", not " + std::to_string(request.max_tokens));
    }
    Tokens tokens = tokenize(vocab_, request.card + wrap_.post, false);
    if (static_cast<int>(tokens.size()) > options_.max_card_tokens) {
        throw std::runtime_error("a card has " + std::to_string(tokens.size()) + " tokens, more than " +
                                 std::to_string(options_.max_card_tokens));
    }
    return tokens;
}

void LlamaBatch::set_prefix(const std::string& prefix) {
    shared_ = tokenize_shared(prefix);
    llama_memory_clear(mem_, true);
    prefix_set_ = false;
    if (options_.prefix_mode == PrefixMode::copy) {
        std::vector<Tok> toks;
        toks.reserve(shared_.size());
        for (std::size_t k = 0; k < shared_.size(); ++k) {
            toks.push_back({shared_[k], static_cast<llama_pos>(k), 0, -1});
        }
        std::vector<Slot> none;
        decode_and_sample(toks, none);
        check_master();
    }
    prefix_set_ = true;
    clock_start_ = Clock::now();
}

std::vector<Result> LlamaBatch::run(const std::vector<Request>& requests) {
    if (!prefix_set_) throw std::runtime_error("llama batch: run before set_prefix");
    // Every card is checked before anything is generated.
    std::vector<Tokens> cards;
    cards.reserve(requests.size());
    for (const Request& request : requests) cards.push_back(tokenize_card(request));

    const bool copy = options_.prefix_mode == PrefixMode::copy;
    std::vector<Result> out;
    out.reserve(requests.size());
    const std::size_t n = static_cast<std::size_t>(options_.n_parallel);
    for (std::size_t first = 0; first < requests.size(); first += n) {
        const std::size_t last = std::min(requests.size(), first + n);
        std::vector<Slot> slots(last - first);
        for (std::size_t i = first; i < last; ++i) {
            Slot& slot = slots[i - first];
            slot.request = &requests[i];
            slot.seq = static_cast<llama_seq_id>(i - first + 1);
            if (!copy) slot.prompt = shared_;
            slot.prompt.insert(slot.prompt.end(), cards[i].begin(), cards[i].end());
        }
        const std::int64_t start = now_ms();
        generate(slots, copy);

        std::int64_t end = start;
        long tokens = 0;
        for (std::size_t k = 0; k < slots.size(); ++k) {
            Slot& slot = slots[k];
            slot.result.prompt_tokens = static_cast<int>(shared_.size() + cards[first + k].size());
            end = std::max(end, slot.result.t_end_ms);
            tokens += slot.result.output_tokens;
            out.push_back(std::move(slot.result));
        }
        const std::int64_t ms = std::max<std::int64_t>(1, end - start);
        PerfSample sample;
        sample.batch = static_cast<int>(slots.size());
        sample.tokens_per_s = static_cast<int>(tokens * 1000 / ms);
        sample.decisions_per_s_milli = static_cast<int>(static_cast<std::int64_t>(slots.size()) * 1'000'000 / ms);
        sample.vram_mb = vram_mb();
        perf_.push_back(sample);
    }
    return out;
}

Result LlamaBatch::run_single(const std::string& system, const Request& request) {
    const Tokens head = tokenize_shared(system);
    const Tokens card = tokenize_card(request);
    std::vector<Slot> slots(1);
    slots[0].request = &request;
    slots[0].seq = 1;
    slots[0].prompt = head;
    slots[0].prompt.insert(slots[0].prompt.end(), card.begin(), card.end());
    generate(slots, false);
    slots[0].result.prompt_tokens = static_cast<int>(head.size() + card.size());
    return std::move(slots[0].result);
}

SamplerPtr LlamaBatch::grammar_for(const std::string& gbnf) {
    if (gbnf.empty()) return nullptr;
    auto it = grammars_.find(gbnf);
    if (it == grammars_.end()) {
        if (grammars_.size() >= 64) grammars_.clear();  // a bound, not expected to be reached
        SamplerPtr parsed(llama_sampler_init_grammar(vocab_, gbnf.c_str(), "root"));
        if (!parsed) throw std::runtime_error("the grammar of a request does not parse");
        it = grammars_.emplace(gbnf, std::move(parsed)).first;
    }
    return SamplerPtr(llama_sampler_clone(it->second.get()));
}

// greedy: the most likely token (the grammar, when it rejects that one, leaves
// the most likely of those it allows); the seed is not used.
SamplerPtr LlamaBatch::chain_for(const Request& request) const {
    llama_sampler_chain_params params = llama_sampler_chain_default_params();
    params.no_perf = true;
    SamplerPtr chain(llama_sampler_chain_init(params));
    if (request.greedy) {
        llama_sampler_chain_add(chain.get(), llama_sampler_init_greedy());
        return chain;
    }
    llama_sampler_chain_add(chain.get(), llama_sampler_init_top_k(info_.top_k));
    llama_sampler_chain_add(chain.get(), llama_sampler_init_top_p(info_.top_p, 1));
    llama_sampler_chain_add(chain.get(), llama_sampler_init_temp(info_.temperature));
    llama_sampler_chain_add(chain.get(), llama_sampler_init_dist(fold_seed(request.seed)));
    return chain;
}

// Generates every slot to its end and removes the workers. from_master: each
// worker starts as a copy of the master and continues after it.
void LlamaBatch::generate(std::vector<Slot>& slots, bool from_master) {
    const std::int64_t start = now_ms();
    try {
        std::vector<Tok> toks;
        for (std::size_t k = 0; k < slots.size(); ++k) {
            Slot& slot = slots[k];
            slot.grammar = grammar_for(slot.request->grammar);
            slot.chain = chain_for(*slot.request);
            slot.result.t_start_ms = start;
            slot.pos = 0;
            if (from_master) {
                llama_memory_seq_cp(mem_, 0, slot.seq, -1, -1);
                slot.pos = static_cast<llama_pos>(shared_.size());
            }
            for (std::size_t j = 0; j < slot.prompt.size(); ++j) {
                const bool out = j + 1 == slot.prompt.size();
                toks.push_back({slot.prompt[j], slot.pos++, slot.seq, out ? static_cast<int>(k) : -1});
            }
        }
        decode_and_sample(toks, slots);
        for (;;) {
            toks.clear();
            for (std::size_t k = 0; k < slots.size(); ++k) {
                Slot& slot = slots[k];
                if (!slot.done) toks.push_back({slot.last, slot.pos++, slot.seq, static_cast<int>(k)});
            }
            if (toks.empty()) break;
            decode_and_sample(toks, slots);
        }
    } catch (...) {
        remove_workers(slots);
        throw;
    }
    remove_workers(slots);
    for (Slot& slot : slots) {
        slot.grammar.reset();
        slot.chain.reset();
    }
    if (options_.prefix_mode == PrefixMode::copy && prefix_set_) check_master();
}

// Decodes the tokens in chunks of n_batch; after each chunk, samples the
// slots whose output it holds (the logits only live until the next decode).
void LlamaBatch::decode_and_sample(const std::vector<Tok>& toks, std::vector<Slot>& slots) {
    std::vector<std::pair<Slot*, const float*>> pending;
    for (std::size_t first = 0; first < toks.size(); first += static_cast<std::size_t>(n_batch_)) {
        const std::size_t n = std::min(toks.size() - first, static_cast<std::size_t>(n_batch_));
        batch_.n_tokens = static_cast<std::int32_t>(n);
        for (std::size_t k = 0; k < n; ++k) {
            const Tok& t = toks[first + k];
            batch_.token[k] = t.id;
            batch_.pos[k] = t.pos;
            batch_.n_seq_id[k] = 1;
            batch_.seq_id[k][0] = t.seq;
            batch_.logits[k] = t.slot >= 0;
        }
        const int rc = llama_decode(ctx_.get(), batch_);
        if (rc != 0) {
            throw std::runtime_error("llama_decode failed with " + std::to_string(rc) + " (" +
                                     std::to_string(n) + " tokens)");
        }
        llama_synchronize(ctx_.get());
        // The logits are looked up here, in this thread: llama_get_logits_ith
        // is not safe to call from several threads.
        pending.clear();
        for (std::size_t k = 0; k < n; ++k) {
            const int s = toks[first + k].slot;
            if (s < 0) continue;
            const float* logits = llama_get_logits_ith(ctx_.get(), static_cast<std::int32_t>(k));
            if (!logits) throw std::runtime_error("llama.cpp returned no logits");
            pending.emplace_back(&slots[static_cast<std::size_t>(s)], logits);
        }
        if (pending.empty()) continue;
        sample_all(pending);
        const std::int64_t now = now_ms();
        for (auto& [slot, logits] : pending) {
            if (slot->done) slot->result.t_end_ms = now;
        }
    }
}

// Samples the pending slots on up to threads_ threads. Each slot has its own
// samplers and each thread its own candidate buffer: nothing is shared.
void LlamaBatch::sample_all(const std::vector<std::pair<Slot*, const float*>>& pending) {
    const std::size_t n_threads = std::min(pending.size(), static_cast<std::size_t>(threads_));
    if (n_threads <= 1) {
        for (const auto& [slot, logits] : pending) sample_one(*slot, logits, cand_[0]);
        return;
    }
    std::atomic<std::size_t> next{0};
    std::vector<std::exception_ptr> errors(n_threads);
    auto work = [&](std::size_t t) {
        try {
            for (std::size_t i = next++; i < pending.size(); i = next++) {
                sample_one(*pending[i].first, pending[i].second, cand_[t]);
            }
        } catch (...) {
            errors[t] = std::current_exception();
        }
    };
    std::vector<std::thread> pool;
    pool.reserve(n_threads - 1);
    for (std::size_t t = 1; t < n_threads; ++t) pool.emplace_back(work, t);
    work(0);
    for (std::thread& thread : pool) thread.join();
    for (const std::exception_ptr& error : errors) {
        if (error) std::rethrow_exception(error);
    }
}

void LlamaBatch::sample_one(Slot& slot, const float* logits, std::vector<llama_token_data>& cand) const {
    auto fill = [&] {
        for (int i = 0; i < n_vocab_; ++i) cand[static_cast<std::size_t>(i)] = {i, logits[i], 0.0f};
        return llama_token_data_array{cand.data(), cand.size(), -1, false};
    };
    llama_token_data_array cur = fill();
    llama_sampler_apply(slot.chain.get(), &cur);
    if (cur.selected < 0) throw std::runtime_error("the sampler selected no token");
    llama_token token = cur.data[cur.selected].id;
    if (slot.grammar && !grammar_allows(slot.grammar.get(), token)) {
        cur = fill();
        llama_sampler_apply(slot.grammar.get(), &cur);
        const bool any = std::any_of(cur.data, cur.data + cur.size,
                                     [](const llama_token_data& d) { return !std::isinf(d.logit); });
        if (!any) throw std::runtime_error("the grammar rejects every token");
        llama_sampler_apply(slot.chain.get(), &cur);
        if (cur.selected < 0) throw std::runtime_error("the sampler selected no token");
        token = cur.data[cur.selected].id;
    }
    accept(slot, token);
}

void LlamaBatch::accept(Slot& slot, llama_token token) const {
    // An end token is only sampled where the grammar allows the end (or there
    // is no grammar): the output is complete.
    if (llama_vocab_is_eog(vocab_, token)) {
        slot.done = true;
        return;
    }
    if (slot.grammar) llama_sampler_accept(slot.grammar.get(), token);
    llama_sampler_accept(slot.chain.get(), token);
    slot.last = token;

    char buf[256];
    int n = llama_token_to_piece(vocab_, token, buf, sizeof buf, 0, false);
    if (n >= 0) {
        slot.result.json.append(buf, static_cast<std::size_t>(n));
    } else {
        std::string piece(static_cast<std::size_t>(-n), '\0');
        n = llama_token_to_piece(vocab_, token, piece.data(), -n, 0, false);
        if (n > 0) slot.result.json.append(piece.data(), static_cast<std::size_t>(n));
    }
    ++slot.result.output_tokens;

    Result& r = slot.result;
    if (!slot.request->want_text && cut_before_text(r.json)) {
        r.cut_before_text = true;
        slot.done = true;
    } else if (slot.grammar && eog_ != LLAMA_TOKEN_NULL && grammar_allows(slot.grammar.get(), eog_)) {
        slot.done = true;  // the grammar is complete: no need to wait for the model's end token
    } else if (r.output_tokens >= slot.request->max_tokens) {
        r.truncated = true;
        slot.done = true;
    }
}

void LlamaBatch::remove_workers(const std::vector<Slot>& slots) {
    bool ok = true;
    for (const Slot& slot : slots) ok = llama_memory_seq_rm(mem_, slot.seq, -1, -1) && ok;
    if (!ok) throw std::runtime_error("llama_memory_seq_rm failed for a worker sequence");
}

void LlamaBatch::check_master() const {
    const llama_pos last = static_cast<llama_pos>(shared_.size()) - 1;
    if (llama_memory_seq_pos_min(mem_, 0) != 0 || llama_memory_seq_pos_max(mem_, 0) != last) {
        throw std::runtime_error("the master sequence changed");
    }
}

int LlamaBatch::vram_mb() const {
    std::size_t free = 0;
    std::size_t total = 0;
    ggml_backend_dev_memory(device_, &free, &total);
    if (free >= free_before_) return 0;
    return static_cast<int>((free_before_ - free) / (1024 * 1024));
}

std::vector<std::pair<int, int>> LlamaBatch::positions() const {
    std::vector<std::pair<int, int>> out;
    for (llama_seq_id seq = 0; seq <= options_.n_parallel; ++seq) {
        out.emplace_back(llama_memory_seq_pos_min(mem_, seq), llama_memory_seq_pos_max(mem_, seq));
    }
    return out;
}

const LlamaBatch& as_llama(const Batch& batch) {
    const auto* llama = dynamic_cast<const LlamaBatch*>(&batch);
    if (!llama) throw std::runtime_error("not a llama.cpp batch");
    return *llama;
}

}  // namespace

std::uint32_t fold_seed(std::uint64_t seed) {
    const auto folded = static_cast<std::uint32_t>(seed ^ (seed >> 32));
    return folded == LLAMA_DEFAULT_SEED ? folded - 1 : folded;
}

std::vector<std::pair<int, int>> memory_positions(const Batch& batch) {
    return as_llama(batch).positions();
}

int shared_tokens(const Batch& batch) { return as_llama(batch).shared_size(); }

std::unique_ptr<Batch> make_llama_batch(const BatchOptions& options) {
    return std::make_unique<LlamaBatch>(options);
}

}  // namespace rumor::llm
