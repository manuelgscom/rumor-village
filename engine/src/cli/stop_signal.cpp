// The stop of the long-running commands (stop_signal.h).

#include "cli/stop_signal.h"

#include <stdexcept>

#ifdef _WIN32
#include <chrono>
#include <thread>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <csignal>
#include <ctime>

#include <pthread.h>
#endif

namespace rumor {

#ifdef _WIN32

namespace {

std::atomic<bool> g_stop{false};

BOOL WINAPI on_console_event(DWORD event) {
    switch (event) {
        case CTRL_C_EVENT:
        case CTRL_BREAK_EVENT:
        case CTRL_CLOSE_EVENT:
        case CTRL_LOGOFF_EVENT:
        case CTRL_SHUTDOWN_EVENT:
            g_stop = true;
            // On CTRL_CLOSE_EVENT Windows ends the process when this returns
            // (or after ~5 s): give the stop thread a moment to close the game.
            if (event == CTRL_CLOSE_EVENT) Sleep(2000);
            return TRUE;
        default:
            return FALSE;
    }
}

}  // namespace

void block_stop_signals() {
    if (!SetConsoleCtrlHandler(on_console_event, TRUE)) {
        throw std::runtime_error("cannot install the console control handler");
    }
}

void wait_for_stop(const std::atomic<bool>& asked) {
    while (!asked && !g_stop) std::this_thread::sleep_for(std::chrono::milliseconds(100));
}

#else

namespace {

sigset_t stop_signals() {
    sigset_t set;
    sigemptyset(&set);
    sigaddset(&set, SIGINT);
    sigaddset(&set, SIGTERM);
    return set;
}

}  // namespace

void block_stop_signals() {
    const sigset_t set = stop_signals();
    if (pthread_sigmask(SIG_BLOCK, &set, nullptr) != 0) {
        throw std::runtime_error("cannot block SIGINT and SIGTERM");
    }
}

void wait_for_stop(const std::atomic<bool>& asked) {
    const sigset_t set = stop_signals();
    const timespec step{0, 100'000'000};  // how often `asked` is looked at
    while (!asked) {
        if (sigtimedwait(&set, nullptr, &step) >= 0) return;
    }
}

#endif

}  // namespace rumor
