// One run served live (live_run.h): the queue of orders that before_tick hands
// to the simulation, the pace, and the SSE stream of the log lines.

#include "server/live_run.h"

#include <algorithm>
#include <cstdint>
#include <exception>
#include <limits>
#include <utility>

#include <cpp-httplib/httplib.h>
#include <nlohmann/json.hpp>

#include "core/fact.h"
#include "core/log_api.h"
#include "server/http_util.h"

namespace rumor {
namespace {

using Json = nlohmann::json;
using http::error;
using http::reply;

// A stream with nothing to send writes a comment this often, so proxies and
// the browser keep it open.
constexpr auto kKeepalive = std::chrono::seconds(15);
// How long one call of the SSE provider waits for lines: between calls the
// library checks that the peer is still there, which frees the thread of a
// closed tab within this time.
constexpr auto kStreamSlice = std::chrono::seconds(1);

}  // namespace

LiveRun::LiveRun(const LiveOptions& options, const Vocab& vocab, const Population& population,
                 Extractor* extractor)
    : vocab_(vocab),
      population_(population),
      extractor_(extractor),
      id_(http::new_run_id()),
      extract_timeout_(options.extract_timeout),
      paused_(options.paused),
      speed_(std::max(options.speed, 0)),
      quiet_speed_(std::max(options.quiet_speed, 0)) {}

LiveRun::~LiveRun() { close(); }

void LiveRun::publish(std::string line) {
    {
        const std::lock_guard lock(mutex_);
        lines_.push_back(std::move(line));
    }
    new_lines_.notify_all();
}

std::vector<std::string> LiveRun::lines() const {
    const std::lock_guard lock(mutex_);
    return lines_;
}

TickOrders LiveRun::before_tick(Tick t) {
    std::unique_lock lock(mutex_);
    tick_ = t;
    TickOrders orders;
    for (;;) {
        run_tasks(lock);
        if (stopping_) {
            orders.stop = true;
            return orders;
        }
        if (paused_) {
            wake_sim_.wait(lock);
            continue;
        }
        if (speed_ == 0) break;
        // After a quiet tick the next one may come sooner, never later.
        const int pace = quiet_ ? std::max(speed_, quiet_speed_) : speed_;
        // A reading pause asked by the viewer (POST /control hold_ms) holds the
        // next tick while a bubble on screen is read. Only pacing.
        const Clock::time_point due =
            std::max(released_ + std::chrono::microseconds(1000000 / pace), hold_until_);
        if (Clock::now() >= due) break;
        wake_sim_.wait_until(lock, due);
    }
    released_ = Clock::now();

    for (Order& order : orders_) {
        LiveInjection live;
        Injection& inj = live.fact;
        inj.tick = t;
        inj.what = std::move(order.fact.what);
        inj.text = std::move(order.text);
        const Extracted& f = order.fact;
        if (f.who) inj.slots[idx(Slot::who)] = static_cast<SlotValue>(f.who->v);
        if (f.where) inj.slots[idx(Slot::where)] = static_cast<SlotValue>(f.where->v);
        // "Today" is the day of the tick at which the fact enters.
        if (f.when) inj.slots[idx(Slot::when)] = from_relative(*f.when, t);
        if (f.amount) inj.slots[idx(Slot::amount)] = static_cast<SlotValue>(*f.amount);
        inj.to = std::move(order.to);
        live.place = order.place;
        orders.injections.push_back(std::move(live));
    }
    orders_.clear();
    if (visible_changed_) {
        orders.visible = visible_;
        visible_changed_ = false;
    }
    return orders;
}

void LiveRun::after_tick(Tick, bool quiet) {
    const std::lock_guard lock(mutex_);
    quiet_ = quiet;
}

void LiveRun::run_tasks(std::unique_lock<std::mutex>& lock) {
    while (!tasks_.empty()) {
        const std::shared_ptr<ExtractTask> task = tasks_.front();
        tasks_.pop_front();
        lock.unlock();
        Extracted result;
        bool failed = false;
        try {
            result = extractor_->extract(task->text);
        } catch (const std::exception&) {
            failed = true;
        }
        lock.lock();
        task->result = std::move(result);
        task->failed = failed;
        task->done = true;
        task_done_.notify_all();
    }
}

void LiveRun::finish() {
    {
        const std::lock_guard lock(mutex_);
        ended_ = true;
    }
    task_done_.notify_all();
    new_lines_.notify_all();
}

void LiveRun::request_stop() {
    {
        const std::lock_guard lock(mutex_);
        stopping_ = true;
    }
    wake_sim_.notify_all();
    task_done_.notify_all();
}

void LiveRun::close() {
    {
        const std::lock_guard lock(mutex_);
        stopping_ = true;
        closed_ = true;
    }
    wake_sim_.notify_all();
    new_lines_.notify_all();
    task_done_.notify_all();
}

// --- Routes ------------------------------------------------------------------

void LiveRun::get_events(const httplib::Request& req, httplib::Response& res,
                         std::shared_ptr<const void> keep) {
    // Event n is line n of the file (the header is 1): after a reconnection
    // the stream goes on from the line after the last one received.
    std::size_t next = 0;
    if (req.has_header("Last-Event-ID")) {
        const std::string last = req.get_header_value("Last-Event-ID");
        std::size_t value = 0;
        bool digits = !last.empty() && last.size() <= 9;
        for (char c : last) {
            if (c < '0' || c > '9') digits = false;
            else value = value * 10 + static_cast<std::size_t>(c - '0');
        }
        if (digits) next = value;
    }
    struct Stream {
        std::size_t next;
        Clock::time_point last_write;
    };
    auto stream = std::make_shared<Stream>(Stream{next, Clock::now()});
    res.set_header("Cache-Control", "no-cache");
    // The provider runs after this function returns: `keep` holds the run.
    res.set_chunked_content_provider(
        "text/event-stream", [this, stream, keep](std::size_t, httplib::DataSink& sink) {
            std::string out;
            {
                std::unique_lock lock(mutex_);
                new_lines_.wait_for(lock, kStreamSlice,
                                    [&] { return closed_ || lines_.size() > stream->next; });
                if (closed_) {
                    sink.done();
                    return true;
                }
                for (std::size_t i = stream->next; i < lines_.size(); ++i) {
                    out += "id: " + std::to_string(i + 1) + "\ndata: ";
                    out += lines_[i];
                    out += "\n\n";
                }
                stream->next = std::max(stream->next, lines_.size());
            }
            const Clock::time_point now = Clock::now();
            if (out.empty()) {
                if (now - stream->last_write < kKeepalive) return true;
                out = ": keepalive\n\n";
            }
            stream->last_write = now;
            return sink.write(out.data(), out.size());
        });
}

std::string LiveRun::control_json_locked() const {
    Json j;
    j["paused"] = paused_;
    j["speed"] = speed_ == 0 ? Json("max") : Json(speed_);
    j["tick"] = tick_ ? Json(*tick_) : Json(nullptr);
    j["ended"] = ended_;
    j["extract"] = extractor_ != nullptr;
    j["run"] = id_;
    return j.dump();
}

std::string LiveRun::control_json() const {
    const std::lock_guard lock(mutex_);
    return control_json_locked();
}

void LiveRun::get_control(httplib::Response& res) const {
    res.set_content(control_json(), "application/json");
}

void LiveRun::post_control(const httplib::Request& req, httplib::Response& res) {
    const std::optional<Json> body = http::object_body(req);
    if (!body) return error(res, 400, "the body is not a JSON object");
    std::optional<bool> pause;
    std::optional<int> speed;
    std::optional<int> hold_ms;
    for (const auto& [key, value] : body->items()) {
        if (key == "action") {
            if (value == "pause") pause = true;
            else if (value == "resume") pause = false;
            else return error(res, 400, "action is \"pause\" or \"resume\"");
        } else if (key == "speed") {
            if (value == "max") {
                speed = 0;
            } else if (value.is_number_integer() && value.get<std::int64_t>() >= 1 &&
                       value.get<std::int64_t>() <= std::numeric_limits<int>::max()) {
                speed = static_cast<int>(value.get<std::int64_t>());
            } else {
                return error(res, 400, "speed is an integer of at least 1 or \"max\"");
            }
        } else if (key == "hold_ms") {
            if (!value.is_number_integer() || value.get<std::int64_t>() < 0 ||
                value.get<std::int64_t>() > kMaxHoldMs) {
                return error(res, 400, "hold_ms is an integer from 0 to " + std::to_string(kMaxHoldMs));
            }
            hold_ms = static_cast<int>(value.get<std::int64_t>());
        } else {
            return error(res, 400, "unknown key '" + key + "'");
        }
    }
    if (!pause && !speed && !hold_ms) return error(res, 400, "nothing to do: give action, speed or hold_ms");
    std::string state;
    {
        const std::lock_guard lock(mutex_);
        if (pause) paused_ = *pause;
        if (speed) speed_ = *speed;
        state = control_json_locked();
    }
    if (hold_ms) hold(*hold_ms);
    wake_sim_.notify_all();
    res.set_content(state, "application/json");
}

void LiveRun::hold(int ms) {
    {
        const std::lock_guard lock(mutex_);
        hold_until_ = std::max(hold_until_, Clock::now() + std::chrono::milliseconds(ms));
    }
    wake_sim_.notify_all();
}

void LiveRun::post_viewport(const httplib::Request& req, httplib::Response& res) {
    const std::optional<Json> body = http::object_body(req);
    if (!body || body->size() != 1 || !body->contains("neighbors") ||
        !(*body)["neighbors"].is_array()) {
        return error(res, 400, "the body is {\"neighbors\":[...]}");
    }
    std::vector<NeighborId> visible;
    for (const Json& item : (*body)["neighbors"]) {
        const auto id = item.is_string() ? NeighborId::parse(item.get_ref<const std::string&>())
                                         : std::nullopt;
        if (!id || id->index() >= population_.neighbors.size()) {
            return error(res, 400, "unknown neighbor " + item.dump());
        }
        visible.push_back(*id);
    }
    std::sort(visible.begin(), visible.end());
    visible.erase(std::unique(visible.begin(), visible.end()), visible.end());
    {
        const std::lock_guard lock(mutex_);
        if (visible != visible_) {
            visible_ = std::move(visible);
            visible_changed_ = true;
        }
    }
    res.status = 204;
}

void LiveRun::post_inject(const httplib::Request& req, httplib::Response& res) {
    const std::optional<Json> body = http::object_body(req);
    if (!body) return error(res, 400, "the body is not a JSON object");
    for (const auto& [key, value] : body->items()) {
        if (key != "fact" && key != "text" && key != "to" && key != "dryRun") {
            return error(res, 400, "unknown key '" + key + "'");
        }
    }

    // The fact: the five keys of the extract task, missing ones as null.
    http::ParsedFact fact =
        http::parse_fact(body->contains("fact") ? (*body)["fact"] : Json(), vocab_, population_);
    if (fact.error) return error(res, 400, *fact.error);
    Order order;
    order.fact = std::move(fact.fact);

    if (body->contains("text")) {
        const Json& text = (*body)["text"];
        if (text.is_string()) {
            if (!text.get_ref<const std::string&>().empty()) order.text = text.get<std::string>();
        } else if (!text.is_null()) {
            return error(res, 400, "text is a string");
        }
    }

    // Who receives it: whoever is at a place, or a list of neighbors.
    http::ParsedTo to =
        http::parse_to(body->contains("to") ? (*body)["to"] : Json(), vocab_, population_);
    if (to.error) return error(res, 400, *to.error);
    order.place = to.place;
    order.to = std::move(to.neighbors);

    bool dry_run = false;
    if (body->contains("dryRun")) {
        if (!(*body)["dryRun"].is_boolean()) return error(res, 400, "dryRun is a boolean");
        dry_run = (*body)["dryRun"].get<bool>();
    }

    Json answer;
    answer["understood"] = understood_message(order.fact, vocab_, population_);
    answer["empty"] = http::empty_slots(order.fact);
    if (dry_run) return reply(res, 200, answer);
    {
        const std::lock_guard lock(mutex_);
        if (ended_ || stopping_) return error(res, 409, "the run has ended");
        orders_.push_back(std::move(order));
    }
    answer["queued"] = true;
    reply(res, 202, answer);
}

void LiveRun::post_extract(const httplib::Request& req, httplib::Response& res) {
    if (!extractor_) return error(res, 501, "this run has no extract task");
    const std::optional<Json> body = http::object_body(req);
    if (!body || body->size() != 1 || !body->contains("text") || !(*body)["text"].is_string()) {
        return error(res, 400, "the body is {\"text\":\"...\"}");
    }
    auto task = std::make_shared<ExtractTask>();
    task->text = (*body)["text"].get<std::string>();

    std::unique_lock lock(mutex_);
    if (ended_ || stopping_) return error(res, 409, "the run has ended");
    tasks_.push_back(task);
    wake_sim_.notify_all();
    const bool done = task_done_.wait_for(lock, extract_timeout_,
                                          [&] { return task->done || ended_ || stopping_; });
    if (!task->done) {
        // Not taken yet (taken ones always finish): withdraw it.
        tasks_.erase(std::remove(tasks_.begin(), tasks_.end(), task), tasks_.end());
        if (done && ended_) return error(res, 409, "the run has ended");
        return error(res, 503, "the simulation did not answer in time");
    }
    lock.unlock();

    if (task->failed) return error(res, 500, "the extraction failed");
    reply(res, 200, http::extract_answer(task->result, vocab_, population_));
}

RunSink publishing_sink(LiveRun& run, std::ostream* file) {
    const auto emit = [&run, file](std::string line) {
        if (file) {
            *file << line << '\n';
            file->flush();
        }
        run.publish(std::move(line));
    };
    RunSink sink;
    sink.header = [emit](const LogHeader& header) { emit(write_header(header)); };
    sink.event = [emit](const Event& event) { emit(write_event(event)); };
    return sink;
}

}  // namespace rumor
