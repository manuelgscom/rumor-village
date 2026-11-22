#pragma once
// The model runtime as the engine sees it: one model, one common prefix per
// run, and batches of independent decisions (docs/arquitectura.md, "Decisiones
// sin contexto persistente").
//
//   seq 0, master    the common prefix, processed once by set_prefix
//   seq 1..N         each one a copy of the master plus one card; it samples
//                    with its own grammar and seed and is removed whole when
//                    it ends
//
// The prompt of a decision is  pre + prefix + mid + card + post , where pre,
// mid and post are the chat template of the model (ChatWrap in model_vocab.h).
// Callers pass plain text and never see the template.
//
// Implemented in src/llm (llama.cpp); FakeBatch in fake_batch.h simulates it.
// Nothing here runs a model on the CPU: the llama.cpp batch refuses a device
// that is not a GPU.

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "core/policy.h"

namespace rumor::llm {

// One decision as the runtime sees it: text in, text out. Not rumor::DecisionRequest,
// which is the situation as data; the policy turns one into the other.
struct Request {
    // Of the decision. The sampling of a request depends on its seed, its card
    // and its grammar, never on its position in the batch.
    std::uint64_t seed = 0;
    std::string card;     // the user message
    std::string grammar;  // GBNF with the start rule "root"; the output is one sentence of it
    // False: nobody watches this neighbor. The generation stops when the output
    // reaches the "text" field and the object is closed there.
    bool want_text = true;
    int max_tokens = 0;  // limit of output tokens
    // True: no sampling; the most likely token the grammar allows, and the seed
    // is not used. For the extraction task, which reads a sentence and must not
    // vary. Decisions of the village leave it false.
    bool greedy = false;
};

struct Result {
    // A complete JSON object, unless `truncated`.
    std::string json;
    bool cut_before_text = false;  // the generation was stopped at the "text" field
    bool truncated = false;        // max_tokens reached before the grammar was complete
    int prompt_tokens = 0;         // prefix plus card, as the model reads them
    int output_tokens = 0;
    // Start and end of the generation, in milliseconds since set_prefix.
    std::int64_t t_start_ms = 0;
    std::int64_t t_end_ms = 0;
};

using PerfSample = rumor::PerfSample;

// How the output marks the start of the bubble. `text` is always the last
// field of an action, preceded by a comma.
inline constexpr std::string_view kTextKey = ",\"text\":";

// If `json` has reached the "text" field, removes everything from there,
// closes the object and returns true. The fields before it are untouched, so
// the decision is the same with and without text.
inline bool cut_before_text(std::string& json) {
    const std::size_t at = json.find(kTextKey);
    if (at == std::string::npos) return false;
    json.resize(at);
    json += '}';
    return true;
}

// The sampling of every decision: the values the model recommends in its GGUF
// (general.sampling.temp, top_k, top_p). These are used when the file brings
// none.
inline constexpr float kDefaultTemperature = 1.0f;
inline constexpr int kDefaultTopK = 64;
inline constexpr float kDefaultTopP = 0.95f;

// What a results card says about the model and the device.
struct ModelInfo {
    std::string file;         // file name of the GGUF, without folders
    std::string description;  // as llama.cpp describes it: architecture, size, quantization
    std::string device;       // "CUDA0: NVIDIA GeForce RTX 5070 Ti"
    int n_parallel = 0;       // sequences per batch
    float temperature = kDefaultTemperature;
    int top_k = kDefaultTopK;
    float top_p = kDefaultTopP;
};

enum class PrefixMode : std::uint8_t {
    copy,       // master sequence copied to each worker
    reprocess,  // every sequence processes prefix and card; only for the tests
};

struct BatchOptions {
    std::string model_path;
    int n_parallel = 16;  // N: sequences generated together
    PrefixMode prefix_mode = PrefixMode::copy;
    // Name of a llama.cpp device ("CUDA0", "Vulkan0"). Empty: CUDA0 if it
    // exists, otherwise the first GPU. Never the CPU.
    std::string device;
    // Threads that sample the sequences of one step. 0: as many as the
    // machine has, up to n_parallel.
    int sample_threads = 0;
    // A card longer than this is an error: the context is sized with it.
    int max_card_tokens = 512;
};

class Batch {
  public:
    virtual ~Batch() = default;

    // Processes the common prefix in the master sequence and restarts the clock
    // of Result. Once per run.
    virtual void set_prefix(const std::string& prefix) = 0;

    // One result per request, in the same order. More requests than N are
    // generated in several batches, one after another.
    virtual std::vector<Result> run(const std::vector<Request>& requests) = 0;

    // One decision with its own system message, without touching the master
    // sequence: the extraction task, which does not share the prefix of the
    // village.
    virtual Result run_single(const std::string& system,
                                      const Request& request) = 0;

    // One sample per batch generated since the last call.
    virtual std::vector<PerfSample> take_perf() = 0;

    virtual ModelInfo info() const = 0;
};

// Loads the model on a GPU. Throws std::runtime_error when the file cannot be
// loaded or there is no GPU device.
std::unique_ptr<Batch> make_llama_batch(const BatchOptions& options);

}  // namespace rumor::llm
