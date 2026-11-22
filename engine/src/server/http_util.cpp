// Helpers shared by the live server and the game server (http_util.h).

#include "server/http_util.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <random>
#include <stdexcept>
#include <string_view>

#include <cpp-httplib/httplib.h>

#include "core/catalog.h"
#include "core/time.h"

namespace rumor::http {
namespace {

// A fact in the form /inject accepts and the extract task writes: names of
// the language of the run.
Json fact_json(const Extracted& fact, const Vocab& vocab, const Population& population) {
    Json out;
    out["what"] = vocab.what_label(fact.what);
    out["who"] = fact.who ? Json(population.at(*fact.who).name) : Json(nullptr);
    out["where"] = fact.where ? Json(vocab.place(*fact.where)) : Json(nullptr);
    out["when"] = fact.when ? Json((fact.when->day == 0 ? vocab.today : vocab.tomorrow) + " " +
                                   clock_text(fact.when->hour, fact.when->minute))
                            : Json(nullptr);
    out["amount"] = fact.amount ? Json(*fact.amount) : Json(nullptr);
    return out;
}

}  // namespace

void reply(httplib::Response& res, int status, const Json& body) {
    res.status = status;
    res.set_content(body.dump(), "application/json");
}

void error(httplib::Response& res, int status, const std::string& message) {
    reply(res, status, Json{{"error", message}});
}

std::string new_run_id() {
    static std::mutex mutex;
    static std::random_device device;
    static std::uint64_t counter = 0;
    const std::lock_guard lock(mutex);
    const std::uint64_t value =
        (static_cast<std::uint64_t>(device()) << 32) ^ device() ^ (++counter << 48) ^
        static_cast<std::uint64_t>(std::chrono::steady_clock::now().time_since_epoch().count());
    static constexpr char kHex[] = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 0; i < 16; ++i) out[i] = kHex[(value >> (60 - 4 * i)) & 0xF];
    return out;
}

std::optional<Json> object_body(const httplib::Request& req) {
    Json j = Json::parse(req.body, nullptr, false);
    if (j.is_discarded() || !j.is_object()) return std::nullopt;
    return j;
}

Json empty_slots(const Extracted& fact) {
    Json out = Json::array();
    if (!fact.who) out.push_back("who");
    if (!fact.where) out.push_back("where");
    if (!fact.when) out.push_back("when");
    if (!fact.amount) out.push_back("amount");
    return out;
}

Json extract_answer(const Extracted& fact, const Vocab& vocab, const Population& population) {
    Json answer;
    answer["fact"] = fact.ok ? fact_json(fact, vocab, population) : Json(nullptr);
    answer["understood"] = understood_message(fact, vocab, population);
    answer["empty"] = empty_slots(fact);
    Json unknown = Json::object();
    if (fact.unknown_who) unknown["who"] = *fact.unknown_who;
    if (fact.unknown_where) unknown["where"] = *fact.unknown_where;
    answer["unknown"] = unknown;
    return answer;
}

int listen_in_background(httplib::Server& server, const std::string& bind, int port,
                         const std::string& viewer_dir, std::thread& listener,
                         const std::string& who) {
    if (!viewer_dir.empty() && !server.set_mount_point("/", viewer_dir)) {
        throw std::runtime_error(who + ": '" + viewer_dir + "' is not a folder");
    }
    int bound = port;
    if (bound == 0) {
        bound = server.bind_to_any_port(bind);
        if (bound < 0) bound = 0;
    } else if (!server.bind_to_port(bind, port)) {
        bound = 0;
    }
    if (bound == 0) {
        throw std::runtime_error(who + ": cannot bind " + bind + ":" + std::to_string(port));
    }
    listener = std::thread([&server] { server.listen_after_bind(); });
    server.wait_until_ready();
    return bound;
}

}  // namespace rumor::http
