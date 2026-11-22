#pragma once
// What the launcher asks the operating system, Linux and Windows in one file
// (os.cpp, #ifdef _WIN32). Everything else in launcher/ is portable.
//
// Paths and texts are narrow strings, as in the rest of the engine: UTF-8 on
// Linux, and on Windows the active code page (UTF-8 when the executable
// declares it in its manifest).

#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "launcher/detect.h"

namespace rumor::launcher::os {

// The folder of the running executable (/proc/self/exe, GetModuleFileNameW).
// Throws std::runtime_error.
std::filesystem::path exe_dir();

// The value of an environment variable, or nullopt when unset.
std::optional<std::string> env(const std::string& name);

// The language of the system: LC_ALL / LC_MESSAGES / LANG on Linux, the UI
// language of the user on Windows.
UiLang system_lang();

// Windows: the console prints UTF-8. Elsewhere nothing.
void console_utf8();

// Runs a program with this console, with the stop signals unblocked in it,
// and waits. Returns its exit code, or -1 when it cannot be started (not
// found). args[0] is the program: a name looked up in PATH, or a path. With
// `stop`, it is asked every 100 ms while the program runs: true kills the
// program (SIGKILL, TerminateProcess), so that it is not left behind, and
// its code is that of a killed program (never 0).
int run_and_wait(const std::vector<std::string>& args, const std::function<bool()>& stop = {});

// The curl of the system: "curl" (PATH) on Linux, %SystemRoot%\System32\curl.exe
// on Windows (since Windows 10 1803).
std::string curl_program();

// Opens `url` in the default browser without waiting (xdg-open,
// ShellExecuteW). False when it cannot.
bool open_browser(const std::string& url);

// True when nothing listens on 127.0.0.1:`port` (a plain bind, without
// SO_REUSEPORT, so that a server that set it still counts).
bool port_free(int port);

// The id of this process.
long long process_id();

// Asks for Enter before the window closes, so that an error can be read:
// on Windows when this process has its console to itself (opened with a
// double click), on Linux when it is the copy opened in its own terminal
// (terminal.h).
void wait_if_own_console(UiLang lang);

#ifndef _WIN32
// The running executable, /proc/self/exe resolved. Throws std::runtime_error.
std::filesystem::path self_exe();

// True when stderr is a terminal.
bool stderr_is_terminal();

// True when `program` is an executable file in a folder of PATH.
bool on_path(const std::string& program);

// Starts a terminal command line (terminal.h) with RUMOR_IN_TERMINAL=1 and
// does not wait for it, beyond a short look for an early failure (no display,
// say). True when it started.
bool start_in_terminal(const std::vector<std::string>& args);
#endif

// The driver probes: never touch ggml or llama.cpp. They fill the matching
// fields of Probes.
void probe_cuda(Probes& probes);
void probe_vulkan(Probes& probes);

}  // namespace rumor::launcher::os
