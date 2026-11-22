// The launcher in a terminal (launcher/terminal.h): when it opens itself again
// in a terminal, which one, and the command line it gives it.
#include <doctest/doctest.h>

#include <map>
#include <set>
#include <string>
#include <vector>

#include "launcher/terminal.h"

using namespace rumor::launcher;

namespace {

using Lines = std::vector<std::vector<std::string>>;
using Line = std::vector<std::string>;

EnvFn env_of(std::map<std::string, std::string> vars) {
    return [vars](const std::string& name) -> std::optional<std::string> {
        const auto it = vars.find(name);
        if (it == vars.end()) return std::nullopt;
        return it->second;
    };
}

OnPathFn path_of(std::set<std::string> programs) {
    return [programs](const std::string& program) { return programs.count(program) > 0; };
}

const Line kCommand{"/opt/rumor-village/rumor-village", "--port", "9000"};

}  // namespace

TEST_SUITE("launcher") {
    TEST_CASE("terminal: a double click in a graphical session opens a terminal") {
        CHECK(wants_terminal(env_of({{"DISPLAY", ":0"}}), false));
        CHECK(wants_terminal(env_of({{"WAYLAND_DISPLAY", "wayland-0"}}), false));
        CHECK(wants_terminal(env_of({{"DISPLAY", ""}, {"WAYLAND_DISPLAY", "wayland-0"}}), false));
    }

    TEST_CASE("terminal: no graphical session, a terminal already, or the copy in it: runs here") {
        CHECK_FALSE(wants_terminal(env_of({}), false));
        CHECK_FALSE(wants_terminal(env_of({{"DISPLAY", ""}, {"WAYLAND_DISPLAY", ""}}), false));
        CHECK_FALSE(wants_terminal(env_of({{"DISPLAY", ":0"}}), true));
        CHECK_FALSE(wants_terminal(env_of({{"DISPLAY", ":0"}, {kInTerminalVar, "1"}}), false));
        // Only "1" marks the copy.
        CHECK(wants_terminal(env_of({{"DISPLAY", ":0"}, {kInTerminalVar, "0"}}), false));
    }

    TEST_CASE("terminal: in_own_terminal reads RUMOR_IN_TERMINAL=1") {
        CHECK(in_own_terminal(env_of({{kInTerminalVar, "1"}})));
        CHECK_FALSE(in_own_terminal(env_of({{kInTerminalVar, ""}})));
        CHECK_FALSE(in_own_terminal(env_of({})));
    }

    TEST_CASE("terminal: the AppImage file when there is one, else the executable, with the arguments") {
        const std::vector<std::string> args{"--data-dir", "/home/ana/rv", "--no-browser"};
        CHECK(relaunch_command(env_of({}), "/tmp/x/rumor-village", args) ==
              Line{"/tmp/x/rumor-village", "--data-dir", "/home/ana/rv", "--no-browser"});
        CHECK(relaunch_command(env_of({{"APPIMAGE", "/home/ana/Rumor_Village-x86_64.AppImage"}}),
                               "/tmp/.mount_Rumor/usr/bin/rumor-village", args) ==
              Line{"/home/ana/Rumor_Village-x86_64.AppImage", "--data-dir", "/home/ana/rv", "--no-browser"});
        CHECK(relaunch_command(env_of({{"APPIMAGE", ""}}), "/tmp/x/rumor-village", {}) ==
              Line{"/tmp/x/rumor-village"});
    }

    TEST_CASE("terminal: the first terminal on PATH, in order") {
        CHECK(terminal_commands(kCommand, path_of({})).empty());
        const Lines all = terminal_commands(
            kCommand, path_of({"xterm", "kitty", "konsole", "gnome-terminal", "x-terminal-emulator"}));
        REQUIRE(all.size() == 5);
        CHECK(all[0][0] == "x-terminal-emulator");
        CHECK(all[1][0] == "gnome-terminal");
        CHECK(all[2][0] == "konsole");
        CHECK(all[3][0] == "kitty");
        CHECK(all[4][0] == "xterm");
        CHECK(terminal_commands(kCommand, path_of({"xterm", "alacritty"})).front()[0] == "alacritty");
    }

    TEST_CASE("terminal: the command line of each terminal") {
        const std::map<std::string, Line> expected{
            {"x-terminal-emulator", {"x-terminal-emulator", "-e"}},
            {"gnome-terminal", {"gnome-terminal", "--"}},
            {"konsole", {"konsole", "-e"}},
            {"xfce4-terminal", {"xfce4-terminal", "-x"}},
            {"mate-terminal", {"mate-terminal", "-x"}},
            {"lxterminal", {"lxterminal", "-e"}},
            {"kitty", {"kitty"}},
            {"alacritty", {"alacritty", "-e"}},
            {"xterm", {"xterm", "-e"}},
        };
        for (const auto& [program, head] : expected) {
            CAPTURE(program);
            const Lines lines = terminal_commands(kCommand, path_of({program}));
            REQUIRE(lines.size() == 1);
            Line want = head;
            want.insert(want.end(), kCommand.begin(), kCommand.end());
            CHECK(lines[0] == want);
        }
    }
}

#ifndef _WIN32
#include <fcntl.h>
#include <unistd.h>

#include "launcher/os.h"

TEST_SUITE("launcher") {
    TEST_CASE("a child gets stdin, stdout and stderr, not the other descriptors of the launcher") {
        // A descriptor without close-on-exec, as the AppImage mount keeps one
        // and the listening socket of the game could be.
        const int fd = ::open("/dev/null", O_RDONLY);
        REQUIRE(fd > 2);
        const std::string path = "/proc/self/fd/" + std::to_string(fd);
        CHECK(os::run_and_wait({"sh", "-c", "[ ! -e " + path + " ]"}) == 0);
        CHECK(os::run_and_wait({"sh", "-c", "[ -e /proc/self/fd/2 ]"}) == 0);
        ::close(fd);
    }
}
#endif
