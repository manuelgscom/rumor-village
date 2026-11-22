// One engine at a time per data folder (instance.h).

#include "launcher/instance.h"

#include <fstream>
#include <stdexcept>

#include <cpp-httplib/httplib.h>
#include <nlohmann/json.hpp>

#include "launcher/os.h"

namespace rumor::launcher {

namespace fs = std::filesystem;

void write_instance(const fs::path& path, const Instance& instance) {
    const nlohmann::json json = {{"port", instance.port}, {"pid", instance.pid}, {"version", instance.version}};
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << json.dump() << '\n';
    out.flush();
    if (!out) throw std::runtime_error("cannot write '" + path.string() + "'");
}

std::optional<Instance> read_instance(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    const nlohmann::json json = nlohmann::json::parse(in, nullptr, false);
    if (!json.is_object()) return std::nullopt;
    const auto port = json.find("port");
    if (port == json.end() || !port->is_number_integer()) return std::nullopt;
    Instance instance;
    instance.port = port->get<int>();
    if (instance.port <= 0 || instance.port > 65535) return std::nullopt;
    if (const auto pid = json.find("pid"); pid != json.end() && pid->is_number_integer()) {
        instance.pid = pid->get<long long>();
    }
    if (const auto version = json.find("version"); version != json.end() && version->is_string()) {
        instance.version = version->get<std::string>();
    }
    return instance;
}

bool instance_alive(int port, std::chrono::milliseconds timeout) {
    httplib::Client client("127.0.0.1", port);
    client.set_connection_timeout(timeout);
    client.set_read_timeout(timeout);
    client.set_write_timeout(timeout);
    const httplib::Result res = client.Get("/state");
    if (!res || res->status != 200) return false;
    const nlohmann::json json = nlohmann::json::parse(res->body, nullptr, false);
    return json.is_object() && json.contains("version");
}

bool port_listening(int port, std::chrono::milliseconds timeout) {
    httplib::Client client("127.0.0.1", port);
    client.set_connection_timeout(timeout);
    client.set_read_timeout(timeout);
    client.set_write_timeout(timeout);
    const httplib::Result res = client.Get("/");
    return res || res.error() != httplib::Error::Connection;
}

int choose_port(int preferred) { return preferred > 0 && os::port_free(preferred) ? preferred : 0; }

std::string game_url(int port) { return "http://127.0.0.1:" + std::to_string(port) + "/?play=1"; }

}  // namespace rumor::launcher
