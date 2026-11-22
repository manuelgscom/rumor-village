#pragma once
// The files of `rumor play` in its out folder (runs/play by default):
//
//   <id>.jsonl         the log, Format 1
//   <id>.game.json     {"format":1,"id","game_version","started","ended","settings",
//                       "rumors","challenge","bets","race","stopped","end_tick"}
//   <id>.cards.jsonl   one line per decision (card_recorder.h)
//   profile.json       the player's progress, written whole by the viewer
//
// id = YYYYMMDD-HHMMSS-<ai|rules>-t<town>, in UTC, plus "-2", "-3"... when a
// game of the same second already took it. Timestamps are ISO 8601 in UTC.

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

namespace rumor {

inline constexpr int kGameFormat = 1;
inline constexpr int kGameVersion = 1;
inline constexpr std::size_t kProfileMaxBytes = 1 << 20;  // 1 MB

using WallClock = std::chrono::system_clock;

// "2026-11-17T10:04:05Z".
std::string iso_utc(WallClock::time_point when);

// A free id in `dir` for a game started at `when` (no <id>.game.json, .jsonl
// or .cards.jsonl yet).
std::string new_game_id(const std::filesystem::path& dir, WallClock::time_point when, bool ai,
                        std::uint64_t town);

// Whether `id` has exactly the form of a game id: nothing else reaches a path.
bool valid_game_id(const std::string& id);

// The whole file; empty when it cannot be read.
std::optional<std::string> read_file(const std::filesystem::path& path);

// Writes `content` to a temporary file next to `path` and renames it over
// `path`. Throws std::runtime_error.
void write_atomic(const std::filesystem::path& path, const std::string& content);

// GET /games: every readable <id>.game.json of `dir`, newest first.
nlohmann::json list_games(const std::filesystem::path& dir);

}  // namespace rumor
