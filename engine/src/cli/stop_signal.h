#pragma once
// The stop of the long-running commands (`rumor run --serve`, `rumor play` and
// the launcher of phase 10): Ctrl-C, SIGTERM, or on Windows closing the
// console window, taken by one thread that waits for it.
//
// POSIX: the signals are blocked in every thread and taken with sigtimedwait,
// never by a handler, so what runs after the stop is ordinary code.
// Windows: a console control handler raises a flag that wait_for_stop sees.

#include <atomic>

namespace rumor {

// Blocks SIGINT and SIGTERM in the calling thread and in every thread it
// creates afterwards (POSIX), or installs the console handler (Windows). Call
// it before any thread exists (before the model is loaded). Throws
// std::runtime_error.
void block_stop_signals();

// Returns when the stop arrives or `asked` turns true (looked at every 100 ms).
void wait_for_stop(const std::atomic<bool>& asked);

}  // namespace rumor
