// The live server of `rumor run --serve`: one run (live_run.h) behind a port.

#include "server/live_server.h"

#include <cpp-httplib/httplib.h>

#include "server/http_util.h"

namespace rumor {

LiveServer::LiveServer(const LiveOptions& options, const Vocab& vocab,
                       const Population& population, Extractor* extractor)
    : options_(options),
      run_(options, vocab, population, extractor),
      http_(std::make_unique<httplib::Server>()) {}

LiveServer::~LiveServer() { stop(); }

int LiveServer::start() {
    using Req = const httplib::Request&;
    using Res = httplib::Response&;
    http_->Get("/events", [this](Req req, Res res) { run_.get_events(req, res); });
    http_->Get("/control", [this](Req, Res res) { run_.get_control(res); });
    http_->Post("/control", [this](Req req, Res res) { run_.post_control(req, res); });
    http_->Post("/viewport", [this](Req req, Res res) { run_.post_viewport(req, res); });
    http_->Post("/inject", [this](Req req, Res res) { run_.post_inject(req, res); });
    http_->Post("/extract", [this](Req req, Res res) { run_.post_extract(req, res); });
    return http::listen_in_background(*http_, options_.bind, options_.port, options_.viewer_dir,
                                      listener_, "live server");
}

void LiveServer::stop() {
    std::call_once(stop_once_, [this] {
        run_.close();
        http_->stop();
        if (listener_.joinable()) listener_.join();
    });
}

}  // namespace rumor
