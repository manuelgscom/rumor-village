#pragma once
// `rumor play` (play.cpp), and the part of it the launcher of phase 10 reuses:
// the game server with its model, until «Salir» or the stop.

#include <functional>
#include <memory>

#include "llm/batch.h"
#include "server/play_server.h"

namespace rumor {

// Called once the server listens, with its port (the launcher writes
// instance.json and opens the browser).
using OnPlayListen = std::function<void(int port)>;

// Loads the model of its options (the tests of the launcher give a fake
// model); empty: llm::make_llama_batch.
using MakeBatch = std::function<std::unique_ptr<llm::Batch>(const llm::BatchOptions&)>;

// What serve_play returns when the game asked for the model it downloaded
// (POST /ai/activate, PlayOptions::download): the launcher serves again with
// it. Never an exit code.
inline constexpr int kPlayActivate = -1;

// Loads the model of `batch_options` (none when its model_path is empty),
// runs the hardware check, serves the game until POST /quit, POST
// /ai/activate or the stop (stop_signal.h) and shuts down. Returns the exit
// code, or kPlayActivate. Throws std::runtime_error.
int serve_play(PlayOptions options, const llm::BatchOptions& batch_options,
               const OnPlayListen& on_listen = {}, const MakeBatch& make_batch = {});

}  // namespace rumor
