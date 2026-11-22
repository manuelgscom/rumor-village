// The launcher in a terminal (terminal.h).

#include "launcher/terminal.h"

#include <optional>

namespace rumor::launcher {

namespace {

std::string get(const EnvFn& env, const std::string& name) {
    const std::optional<std::string> value = env(name);
    return value ? *value : std::string();
}

struct Terminal {
    const char* program;
    const char* flag;  // before the command; empty: none
};

// The order to try them: the Debian alternative first, then the terminals of
// the common desktops, then the lone ones.
constexpr Terminal kTerminals[] = {
    {"x-terminal-emulator", "-e"}, {"gnome-terminal", "--"}, {"konsole", "-e"},
    {"xfce4-terminal", "-x"},      {"mate-terminal", "-x"},  {"lxterminal", "-e"},
    {"kitty", ""},                 {"alacritty", "-e"},      {"xterm", "-e"},
};

}  // namespace

bool in_own_terminal(const EnvFn& env) { return get(env, kInTerminalVar) == "1"; }

bool wants_terminal(const EnvFn& env, bool stderr_is_terminal) {
    if (stderr_is_terminal || in_own_terminal(env)) return false;
    return !get(env, "DISPLAY").empty() || !get(env, "WAYLAND_DISPLAY").empty();
}

std::vector<std::string> relaunch_command(const EnvFn& env, const std::string& self_exe,
                                          const std::vector<std::string>& args) {
    const std::string appimage = get(env, "APPIMAGE");
    std::vector<std::string> command{appimage.empty() ? self_exe : appimage};
    command.insert(command.end(), args.begin(), args.end());
    return command;
}

std::vector<std::vector<std::string>> terminal_commands(const std::vector<std::string>& command,
                                                        const OnPathFn& on_path) {
    std::vector<std::vector<std::string>> lines;
    for (const Terminal& terminal : kTerminals) {
        if (!on_path(terminal.program)) continue;
        std::vector<std::string> line{terminal.program};
        if (*terminal.flag) line.emplace_back(terminal.flag);
        line.insert(line.end(), command.begin(), command.end());
        lines.push_back(std::move(line));
    }
    return lines;
}

}  // namespace rumor::launcher
