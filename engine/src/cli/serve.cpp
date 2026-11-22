// `rumor run --serve` (serve.h).

#include "cli/serve.h"

#include <atomic>
#include <iostream>
#include <stdexcept>
#include <thread>

#include "cli/stop_signal.h"
#include "extract/extract.h"
#include "server/live_server.h"

namespace rumor {

void serve_to_stream(const RunOptions& options, const LiveOptions& live, std::ostream& out,
                     llm::Batch* batch, std::ostream* trace, const OnListen& on_listen) {
    const LoadedRun run(options, batch, trace);
    std::unique_ptr<Extractor> extractor;
    if (batch) extractor = make_extractor(*batch, options.data_dir, run.vocab, run.population);

    LiveServer server(live, run.vocab, run.population, extractor.get());
    const int port = server.start();
    std::cerr << "rumor: live at http://" << live.bind << ':' << port << "/?live=1" << std::endl;

    std::atomic<bool> asked{false};
    std::thread stopper([&] {
        wait_for_stop(asked);
        server.stop();
    });
    try {
        if (on_listen) on_listen(port, [&asked] { asked = true; });
        run_simulation(run.params, run.world, run.population, run.vocab, *run.policy,
                       options.seed, publishing_sink(server, &out), &server);
        server.finish();
        if (!out) throw std::runtime_error("cannot write the log");
        if (trace) {
            trace->flush();
            if (!*trace) throw std::runtime_error("cannot write the trace");
        }
    } catch (...) {
        asked = true;
        stopper.join();
        throw;
    }
    stopper.join();
}

}  // namespace rumor
