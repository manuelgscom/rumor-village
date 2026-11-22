#pragma once
// Linux: the launcher opened without a terminal (a double click on the
// AppImage) opens itself again inside one, so that the console (the GPU
// found, the download bar, the warnings) can be seen. Pure: the environment,
// isatty and the PATH lookup come from outside, and os.h starts the result.
//
//  stderr a terminal? ── yes ──► run here
//        │ no
//  DISPLAY or WAYLAND_DISPLAY? ── no ──► run here
//        │ yes
//  RUMOR_IN_TERMINAL=1? ── yes ──► run here
//        │ no
//  first terminal on PATH ──► <terminal> <flag> <exe> <args...>, RUMOR_IN_TERMINAL=1
//        │ none starts                                   │ started
//        ▼                                               ▼
//      run here                                        exit 0

#include <functional>
#include <string>
#include <vector>

#include "launcher/detect.h"

namespace rumor::launcher {

// Set in the copy started inside the terminal.
inline constexpr const char* kInTerminalVar = "RUMOR_IN_TERMINAL";

// True when this process is the copy started inside the terminal.
bool in_own_terminal(const EnvFn& env);

// True when the launcher should open itself again in a terminal: stderr is
// not a terminal, there is a graphical session and it is not that copy.
bool wants_terminal(const EnvFn& env, bool stderr_is_terminal);

// What to run again: $APPIMAGE (the .AppImage file, when set) or `self_exe`,
// then `args` (argv[1..]).
std::vector<std::string> relaunch_command(const EnvFn& env, const std::string& self_exe,
                                          const std::vector<std::string>& args);

// Whether a program is on PATH.
using OnPathFn = std::function<bool(const std::string& program)>;

// The command lines that run `command` in each terminal on PATH, in the order
// to try them: x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal,
// mate-terminal, lxterminal, kitty, alacritty, xterm. Empty when none.
std::vector<std::vector<std::string>> terminal_commands(const std::vector<std::string>& command,
                                                        const OnPathFn& on_path);

}  // namespace rumor::launcher
