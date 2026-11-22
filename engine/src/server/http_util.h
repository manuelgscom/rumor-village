#pragma once
// Helpers shared by the live server (live_server, live_run) and the game
// server (play_server): JSON answers, run ids, the body shapes of /inject and
// the HTTP listener. Internal to src/server. The parsing of a fact and of a
// "to" lives in draft_parse.h, which does not need httplib.

#include <optional>
#include <string>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/ids.h"
#include "core/population_api.h"
#include "extract/extract.h"
#include "server/draft_parse.h"

namespace httplib {
class Server;
struct Request;
struct Response;
}  // namespace httplib

namespace rumor::http {

using Json = nlohmann::json;

void reply(httplib::Response& res, int status, const Json& body);
void error(httplib::Response& res, int status, const std::string& message);

// 16 hex digits, different for each call: not part of a run, never logged.
std::string new_run_id();

// The body as a JSON object, whatever the Content-Type (curl -d sends a form
// type).
std::optional<Json> object_body(const httplib::Request& req);

// What /extract answers for one extraction: {"fact","understood","empty","unknown"}.
Json extract_answer(const Extracted& fact, const Vocab& vocab, const Population& population);

// The slots of a fact without a value: ["who", ...].
Json empty_slots(const Extracted& fact);

// Mounts `viewer_dir` at "/" (if not empty), binds `bind`:`port` (0: any free
// port) and serves on `listener`. Returns the port. Throws
// std::runtime_error when the folder or the address is not usable; `who`
// prefixes the message.
int listen_in_background(httplib::Server& server, const std::string& bind, int port,
                         const std::string& viewer_dir, std::thread& listener,
                         const std::string& who);

}  // namespace rumor::http
