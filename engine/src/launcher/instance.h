#pragma once
// One engine at a time per data folder: instance.json says where the running
// one listens. A second launch that finds it answering only opens the
// browser; a file whose engine does not answer is old and is replaced.

#include <chrono>
#include <filesystem>
#include <optional>
#include <string>

namespace rumor::launcher {

struct Instance {
    int port = 0;
    long long pid = 0;
    std::string version;
};

// Writes {"port","pid","version"}. Throws std::runtime_error.
void write_instance(const std::filesystem::path& path, const Instance& instance);

// The instance of the file, or nullopt when it is missing or not one.
std::optional<Instance> read_instance(const std::filesystem::path& path);

// True when GET http://127.0.0.1:<port>/state answers, within `timeout`, a
// JSON object with "version": a Rumor Village engine.
bool instance_alive(int port, std::chrono::milliseconds timeout = std::chrono::seconds(2));

// The port to listen on: `preferred` when it is free on 127.0.0.1, else 0
// (any free port, which the server then tells).
int choose_port(int preferred);

// True when something accepts a connection on 127.0.0.1:`port` within
// `timeout`.
bool port_listening(int port, std::chrono::milliseconds timeout = std::chrono::milliseconds(500));

// The address of the game at `port`.
std::string game_url(int port);

}  // namespace rumor::launcher
