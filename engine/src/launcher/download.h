#pragma once
// The model of the game in the data folder: model.json says which file, its
// size, its SHA-256 and where it comes from; the curl of the system brings it
// to models/<file>.part, resumable, and it becomes models/<file> once its sum
// matches. Later starts only compare the size. The launcher runs it inside the
// game, in the background (ModelDownload, below).
//
//  models/<file> with size_bytes? ── yes ──► ready
//        │ no
//  url? ── no ──► no_model
//  free space for what is missing? ── no ──► no_space
//  curl -fL --retry N --retry-delay D -C - -o <file>.part <url>
//        ├── cannot start ──► no_curl
//        ├── fails or short ──► download_cut (the .part stays: next time resumes)
//  SHA-256 of the .part ── differs ──► delete it, download_bad
//        ▼ matches
//  rename to <file> ──► ready

#include <atomic>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

namespace rumor::launcher {

struct ModelInfo {
    std::string file;
    std::uint64_t size_bytes = 0;
    std::string sha256;  // lowercase hex
    std::string url;     // empty: not published, nothing to download
};

// Reads model.json (dist/model.json). Throws std::runtime_error.
ModelInfo read_model_info(const std::filesystem::path& path);

// True when models_dir/<file> exists with size_bytes.
bool model_ready(const std::filesystem::path& models_dir, const ModelInfo& info);

// SHA-256 of a file read in pieces; nullopt when it cannot be read or `stop`
// says so between pieces.
std::optional<std::string> file_sha256(const std::filesystem::path& path,
                                       const std::function<bool()>& stop = {});

struct DownloadOptions {
    std::string curl = "curl";  // the program (os::curl_program())
    int retries = 5;
    int retry_delay = 3;  // seconds
    bool quiet = false;   // -sS instead of the progress bar (tests)
    // Called before the sum is checked, which takes a while for 5 GB.
    std::function<void()> on_check;
    // Asked while curl runs and between pieces of the sum: true kills curl or
    // stops the sum (download_cut; the .part stays).
    std::function<bool()> stop;
};

// Brings the model to models_dir/<file> (see the drawing above). Returns ""
// when it is ready, or the reason it is not: "no_model", "no_space",
// "no_curl", "download_cut" or "download_bad". Throws std::runtime_error only
// when the folder cannot be made.
std::string ensure_model(const ModelInfo& info, const std::filesystem::path& models_dir,
                         const DownloadOptions& options);

// The download inside the game: the launcher opens the game Sin IA at once
// and ensure_model runs in a thread of its own, while GET /state shows it
// (ai.download, status()) and the player starts it again or activates the
// model (POST /ai/download, POST /ai/activate).
//
//  no url ──► unavailable
//  idle ──start()──► running ──► checking ──► ready ──activate()──► activating
//                       │            │
//                       ▼            ▼
//                     failed (reason) ──start()──► running
class ModelDownload {
  public:
    // Unavailable without info.url, else idle. `options.stop` is its own;
    // `options.on_check` is called once the state is "checking".
    ModelDownload(ModelInfo info, std::filesystem::path models_dir, DownloadOptions options);
    ~ModelDownload();  // cancel()
    ModelDownload(const ModelDownload&) = delete;
    ModelDownload& operator=(const ModelDownload&) = delete;

    // {"state", "bytes", "total", "reason", "folder", "file"}: bytes is the
    // size of the .part (or of the model once it is in place), total its
    // size_bytes, reason null or "no_space", "download_cut", "download_bad",
    // "no_curl", folder the absolute models folder.
    nlohmann::json status() const;
    std::string state() const;

    // From idle or failed: starts (or resumes) in the background. Running: does
    // nothing. Returns nullopt then, else why it cannot.
    std::optional<std::string> start();

    // From ready: activating (the launcher serves again with the model).
    // Returns nullopt then, else why it cannot.
    std::optional<std::string> activate();

    // Kills curl or stops the sum and waits for the thread (the .part stays:
    // the next start resumes it). Idempotent; nothing starts afterwards.
    void cancel();

    // models_dir/<file>.
    std::filesystem::path model_path() const;

  private:
    void run();

    const ModelInfo info_;
    const std::filesystem::path models_;
    DownloadOptions options_;
    std::atomic<bool> cancel_{false};
    mutable std::mutex mutex_;
    std::string state_;
    std::string reason_;  // failed only
    std::thread thread_;
};

}  // namespace rumor::launcher
