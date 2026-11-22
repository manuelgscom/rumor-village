// The model in the data folder (download.h).

#include "launcher/download.h"

#include <exception>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

#include "core/sha256.h"
#include "launcher/os.h"

namespace rumor::launcher {

namespace fs = std::filesystem;

namespace {

std::uint64_t size_or_zero(const fs::path& path) {
    std::error_code ec;
    const auto size = fs::file_size(path, ec);
    return ec ? 0 : static_cast<std::uint64_t>(size);
}

void remove_quietly(const fs::path& path) {
    std::error_code ec;
    fs::remove(path, ec);
}

}  // namespace

ModelInfo read_model_info(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open '" + path.string() + "'");
    const nlohmann::json json = nlohmann::json::parse(in, nullptr, false);
    if (!json.is_object()) throw std::runtime_error(path.string() + ": not a JSON object");
    ModelInfo info;
    try {
        info.file = json.at("file").get<std::string>();
        info.size_bytes = json.at("size_bytes").get<std::uint64_t>();
        info.sha256 = json.at("sha256").get<std::string>();
        info.url = json.value("url", std::string());
    } catch (const nlohmann::json::exception& e) {
        throw std::runtime_error(path.string() + ": " + e.what());
    }
    // The name of a file in models/, never a path.
    if (info.file.empty() || info.file.find_first_of("/\\:") != std::string::npos || info.file == "." ||
        info.file == "..") {
        throw std::runtime_error(path.string() + ": bad file '" + info.file + "'");
    }
    return info;
}

bool model_ready(const fs::path& models_dir, const ModelInfo& info) {
    std::error_code ec;
    const fs::path target = models_dir / info.file;
    return fs::is_regular_file(target, ec) && size_or_zero(target) == info.size_bytes;
}

std::optional<std::string> file_sha256(const fs::path& path, const std::function<bool()>& stop) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    Sha256 sum;
    std::vector<char> piece(1 << 20);
    while (in) {
        if (stop && stop()) return std::nullopt;
        in.read(piece.data(), static_cast<std::streamsize>(piece.size()));
        const auto got = static_cast<std::size_t>(in.gcount());
        if (got > 0) sum.update(std::string_view(piece.data(), got));
    }
    if (in.bad()) return std::nullopt;
    return sum.hex();
}

std::string ensure_model(const ModelInfo& info, const fs::path& models_dir, const DownloadOptions& options) {
    fs::create_directories(models_dir);
    const fs::path target = models_dir / info.file;
    const fs::path part = models_dir / (info.file + ".part");
    if (model_ready(models_dir, info)) return "";
    // A file of another size (a copy cut short, an older model) is replaced by
    // the rename at the end; without a url it is left alone.
    if (info.url.empty()) return "no_model";

    std::uint64_t have = size_or_zero(part);
    if (have > info.size_bytes) {
        remove_quietly(part);
        have = 0;
    }
    if (have < info.size_bytes) {
        std::error_code ec;
        const fs::space_info space = fs::space(models_dir, ec);
        if (ec || space.available < info.size_bytes - have) return "no_space";
        std::vector<std::string> args = {options.curl, "-fL", "--retry", std::to_string(options.retries),
                                         "--retry-delay", std::to_string(options.retry_delay),
                                         "-C", "-", "-o", part.string()};
        args.push_back(options.quiet ? "-sS" : "-#");
        args.push_back(info.url);
        const int code = os::run_and_wait(args, options.stop);
        if (code < 0) return "no_curl";
        have = size_or_zero(part);
        if (code != 0 || have < info.size_bytes) return "download_cut";
    }
    if (have != info.size_bytes) {
        remove_quietly(part);
        return "download_bad";
    }

    if (options.on_check) options.on_check();
    const std::optional<std::string> sum = file_sha256(part, options.stop);
    if (!sum) return "download_cut";  // stopped or unreadable: checked again next time
    if (*sum != info.sha256) {
        remove_quietly(part);
        return "download_bad";
    }
    fs::rename(part, target);
    return "";
}

// --- The download inside the game ------------------------------------------------

ModelDownload::ModelDownload(ModelInfo info, fs::path models_dir, DownloadOptions options)
    : info_(std::move(info)), models_(fs::absolute(models_dir)), options_(std::move(options)) {
    state_ = info_.url.empty() ? "unavailable" : "idle";
    options_.stop = [this] { return cancel_.load(); };
    options_.on_check = [this, then = std::move(options_.on_check)] {
        {
            const std::lock_guard lock(mutex_);
            if (state_ == "running") state_ = "checking";
        }
        if (then) then();
    };
}

ModelDownload::~ModelDownload() { cancel(); }

fs::path ModelDownload::model_path() const { return models_ / info_.file; }

std::string ModelDownload::state() const {
    const std::lock_guard lock(mutex_);
    return state_;
}

nlohmann::json ModelDownload::status() const {
    std::string now;
    std::string why;
    {
        const std::lock_guard lock(mutex_);
        now = state_;
        why = reason_;
    }
    const bool placed = now == "ready" || now == "activating";
    const std::uint64_t bytes =
        placed ? size_or_zero(model_path()) : size_or_zero(models_ / (info_.file + ".part"));
    return {{"state", now},
            {"bytes", bytes},
            {"total", info_.size_bytes},
            {"reason", why.empty() ? nlohmann::json(nullptr) : nlohmann::json(why)},
            {"folder", models_.string()},
            {"file", info_.file}};
}

std::optional<std::string> ModelDownload::start() {
    const std::lock_guard lock(mutex_);
    if (cancel_) return "the game is closing";
    if (state_ == "running") return std::nullopt;
    if (state_ != "idle" && state_ != "failed") return "the download is " + state_;
    // A failed thread has set its state as its last step: it is ending.
    if (thread_.joinable()) thread_.join();
    state_ = "running";
    reason_.clear();
    thread_ = std::thread([this] { run(); });
    return std::nullopt;
}

std::optional<std::string> ModelDownload::activate() {
    const std::lock_guard lock(mutex_);
    if (state_ != "ready") return "the model is not ready: the download is " + state_;
    state_ = "activating";
    return std::nullopt;
}

void ModelDownload::cancel() {
    std::thread thread;
    {
        const std::lock_guard lock(mutex_);
        cancel_ = true;
        thread = std::move(thread_);
    }
    if (thread.joinable()) thread.join();
}

void ModelDownload::run() {
    std::string reason;
    try {
        reason = ensure_model(info_, models_, options_);
    } catch (const std::exception& e) {
        std::cerr << "rumor-village: the download of the model: " << e.what() << std::endl;
        reason = "download_cut";
    }
    const std::lock_guard lock(mutex_);
    if (reason.empty()) {
        state_ = "ready";
    } else {
        state_ = "failed";
        reason_ = reason;
    }
}

}  // namespace rumor::launcher
