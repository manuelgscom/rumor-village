// The files of `rumor play` (game_files.h).

#include "server/game_files.h"

#include <algorithm>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <iterator>
#include <sstream>
#include <stdexcept>
#include <system_error>
#include <vector>

namespace rumor {
namespace {

namespace fs = std::filesystem;

std::tm utc(WallClock::time_point when) {
    const std::time_t t = WallClock::to_time_t(when);
    std::tm out{};
#ifdef _WIN32
    gmtime_s(&out, &t);
#else
    gmtime_r(&t, &out);
#endif
    return out;
}

bool digits(const std::string& s, std::size_t from, std::size_t count) {
    if (from + count > s.size()) return false;
    for (std::size_t i = from; i < from + count; ++i) {
        if (s[i] < '0' || s[i] > '9') return false;
    }
    return true;
}

}  // namespace

std::string iso_utc(WallClock::time_point when) {
    const std::tm t = utc(when);
    char buffer[32];
    std::strftime(buffer, sizeof buffer, "%Y-%m-%dT%H:%M:%SZ", &t);
    return buffer;
}

std::string new_game_id(const fs::path& dir, WallClock::time_point when, bool ai,
                        std::uint64_t town) {
    const std::tm t = utc(when);
    char stamp[32];
    std::strftime(stamp, sizeof stamp, "%Y%m%d-%H%M%S", &t);
    const std::string base =
        std::string(stamp) + (ai ? "-ai" : "-rules") + "-t" + std::to_string(town);
    for (int n = 1;; ++n) {
        const std::string id = n == 1 ? base : base + "-" + std::to_string(n);
        std::error_code ec;
        if (!fs::exists(dir / (id + ".game.json"), ec) && !fs::exists(dir / (id + ".jsonl"), ec) &&
            !fs::exists(dir / (id + ".cards.jsonl"), ec)) {
            return id;
        }
    }
}

bool valid_game_id(const std::string& id) {
    // YYYYMMDD-HHMMSS-<ai|rules>-t<town>[-<n>]
    if (id.size() > 64 || !digits(id, 0, 8) || id.size() < 16 || id[8] != '-' ||
        !digits(id, 9, 6) || id[15] != '-') {
        return false;
    }
    std::size_t pos = 16;
    if (id.compare(pos, 3, "ai-") == 0) pos += 3;
    else if (id.compare(pos, 6, "rules-") == 0) pos += 6;
    else return false;
    if (pos >= id.size() || id[pos] != 't') return false;
    ++pos;
    const auto number = [&] {
        const std::size_t start = pos;
        while (pos < id.size() && id[pos] >= '0' && id[pos] <= '9') ++pos;
        return pos > start && pos - start <= 20;
    };
    if (!number()) return false;
    if (pos == id.size()) return true;
    if (id[pos] != '-') return false;
    ++pos;
    return number() && pos == id.size();
}

std::optional<std::string> read_file(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    std::ostringstream out;
    out << in.rdbuf();
    if (in.bad()) return std::nullopt;
    return out.str();
}

void write_atomic(const fs::path& path, const std::string& content) {
    fs::path tmp = path;
    tmp += ".tmp";
    {
        std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
        out << content;
        out.flush();
        if (!out) throw std::runtime_error("cannot write '" + tmp.string() + "'");
    }
    std::error_code ec;
    fs::rename(tmp, path, ec);
    if (ec) {
        fs::remove(tmp, ec);
        throw std::runtime_error("cannot write '" + path.string() + "'");
    }
}

nlohmann::json list_games(const fs::path& dir) {
    std::vector<nlohmann::json> games;
    std::error_code ec;
    for (fs::directory_iterator it(dir, ec), end; !ec && it != end; it.increment(ec)) {
        const std::string name = it->path().filename().string();
        const std::string suffix = ".game.json";
        if (name.size() <= suffix.size() || !name.ends_with(suffix)) continue;
        if (!valid_game_id(name.substr(0, name.size() - suffix.size()))) continue;
        const std::optional<std::string> text = read_file(it->path());
        if (!text) continue;
        nlohmann::json game = nlohmann::json::parse(*text, nullptr, false);
        if (game.is_discarded() || !game.is_object()) continue;
        games.push_back(std::move(game));
    }
    // Newest first: by start, then by id (the id starts with the start too).
    std::sort(games.begin(), games.end(), [](const nlohmann::json& a, const nlohmann::json& b) {
        const auto field = [](const nlohmann::json& g, const char* k) {
            const auto it = g.find(k);
            return it != g.end() && it->is_string() ? it->get<std::string>() : std::string();
        };
        const std::string sa = field(a, "started"), sb = field(b, "started");
        if (sa != sb) return sa > sb;
        const std::string ia = field(a, "id"), ib = field(b, "id");
        // "-2" after the plain id of the same second.
        if (ia.size() != ib.size()) return ia.size() > ib.size();
        return ia > ib;
    });
    nlohmann::json list = nlohmann::json::array();
    for (nlohmann::json& g : games) list.push_back(std::move(g));
    return list;
}

}  // namespace rumor
