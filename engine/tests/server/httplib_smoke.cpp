// The HTTP library of the live server (cpp-httplib, vendored by llama.cpp) is
// included, linked and works in the engine image: a server on an ephemeral
// port of 127.0.0.1 answers a GET from a client of the same library.
#include <doctest/doctest.h>

#include <thread>

#include <cpp-httplib/httplib.h>

TEST_SUITE("server") {

TEST_CASE("cpp-httplib serves a GET on 127.0.0.1") {
    httplib::Server server;
    server.Get("/ping", [](const httplib::Request&, httplib::Response& res) {
        res.set_content("pong", "text/plain");
    });
    const int port = server.bind_to_any_port("127.0.0.1");
    REQUIRE(port > 0);
    std::thread listener([&] { server.listen_after_bind(); });
    server.wait_until_ready();

    httplib::Client client("127.0.0.1", port);
    const httplib::Result res = client.Get("/ping");
    const httplib::Result missing = client.Get("/nothing");
    server.stop();
    listener.join();

    REQUIRE(res);
    CHECK(res->status == 200);
    CHECK(res->body == "pong");
    REQUIRE(missing);
    CHECK(missing->status == 404);
}

}  // TEST_SUITE
