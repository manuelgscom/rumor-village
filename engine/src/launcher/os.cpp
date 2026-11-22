// What the launcher asks the operating system (os.h): Linux and Windows.

#include "launcher/os.h"

#include <iostream>
#include <stdexcept>
#include <system_error>

#include "launcher/terminal.h"

#ifdef _WIN32

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <objbase.h>
#include <shellapi.h>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")

#define RUMOR_CUDAAPI __stdcall

#else

#include <cerrno>
#include <cstdint>
#include <csignal>
#include <cstdlib>

#include <chrono>
#include <string_view>
#include <thread>

#include <arpa/inet.h>
#include <dlfcn.h>
#include <netinet/in.h>
#include <fcntl.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

extern char** environ;

#define RUMOR_CUDAAPI

#endif

namespace rumor::launcher::os {
namespace {

// The CUDA driver API, as cuda.h declares it (CUresult is an int-sized enum,
// CUdevice an int).
using CuInit = int(RUMOR_CUDAAPI*)(unsigned int);
using CuIntOut = int(RUMOR_CUDAAPI*)(int*);
using CuDeviceGet = int(RUMOR_CUDAAPI*)(int*, int);
using CuDeviceGetName = int(RUMOR_CUDAAPI*)(char*, int, int);

// Asks an opened driver library; `find(name)` gives a symbol or null.
template <typename Find>
void ask_cuda(Probes& p, Find find) {
    p.cuda_library = true;
    const auto cu_init = reinterpret_cast<CuInit>(find("cuInit"));
    const auto cu_version = reinterpret_cast<CuIntOut>(find("cuDriverGetVersion"));
    const auto cu_count = reinterpret_cast<CuIntOut>(find("cuDeviceGetCount"));
    const auto cu_get = reinterpret_cast<CuDeviceGet>(find("cuDeviceGet"));
    const auto cu_name = reinterpret_cast<CuDeviceGetName>(find("cuDeviceGetName"));
    if (cu_version) {
        int version = 0;
        if (cu_version(&version) == 0) p.cuda_driver = version;
    }
    if (!cu_init || !cu_count || cu_init(0) != 0) return;
    p.cuda_init = true;
    int count = 0;
    if (cu_count(&count) == 0) p.cuda_devices = count;
    if (p.cuda_devices > 0 && cu_get && cu_name) {
        int device = 0;
        char name[256] = {};
        if (cu_get(&device, 0) == 0 && cu_name(name, static_cast<int>(sizeof name), device) == 0) {
            p.cuda_name = name;
        }
    }
}

}  // namespace

#ifdef _WIN32

namespace {

// Narrow strings are in the active code page (os.h).
std::wstring wide(const std::string& text) {
    if (text.empty()) return {};
    const int n = MultiByteToWideChar(CP_ACP, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring out(static_cast<std::size_t>(n), L'\0');
    MultiByteToWideChar(CP_ACP, 0, text.data(), static_cast<int>(text.size()), out.data(), n);
    return out;
}

// One argument as CommandLineToArgvW reads it back.
std::wstring quote(const std::wstring& arg) {
    if (!arg.empty() && arg.find_first_of(L" \t\"") == std::wstring::npos) return arg;
    std::wstring out = L"\"";
    std::size_t slashes = 0;
    for (const wchar_t c : arg) {
        if (c == L'\\') {
            ++slashes;
        } else if (c == L'"') {
            out.append(slashes * 2 + 1, L'\\');
            slashes = 0;
        } else {
            out.append(slashes, L'\\');
            slashes = 0;
        }
        if (c != L'\\') out += c;
    }
    out.append(slashes * 2, L'\\');
    out += L'"';
    return out;
}

template <typename F>
F symbol(HMODULE lib, const char* name) {
    return reinterpret_cast<F>(reinterpret_cast<void*>(GetProcAddress(lib, name)));
}

}  // namespace

std::filesystem::path exe_dir() {
    std::wstring buffer(MAX_PATH, L'\0');
    for (;;) {
        const DWORD n = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (n == 0) throw std::runtime_error("cannot find the folder of the executable");
        if (n < buffer.size()) {
            buffer.resize(n);
            return std::filesystem::path(buffer).parent_path();
        }
        buffer.resize(buffer.size() * 2);
    }
}

std::optional<std::string> env(const std::string& name) {
    const DWORD n = GetEnvironmentVariableA(name.c_str(), nullptr, 0);
    if (n == 0) return std::nullopt;
    std::string value(n, '\0');
    const DWORD got = GetEnvironmentVariableA(name.c_str(), value.data(), n);
    if (got >= n) return std::nullopt;  // changed in between
    value.resize(got);
    return value;
}

UiLang system_lang() {
    return PRIMARYLANGID(GetUserDefaultUILanguage()) == LANG_SPANISH ? UiLang::es : UiLang::en;
}

void console_utf8() { SetConsoleOutputCP(CP_UTF8); }

int run_and_wait(const std::vector<std::string>& args, const std::function<bool()>& stop) {
    if (args.empty()) return -1;
    std::wstring line;
    for (const std::string& arg : args) {
        if (!line.empty()) line += L' ';
        line += quote(wide(arg));
    }
    STARTUPINFOW startup{};
    startup.cb = sizeof startup;
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(nullptr, line.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &startup,
                        &process)) {
        return -1;
    }
    for (;;) {
        const DWORD waited = WaitForSingleObject(process.hProcess, stop ? DWORD{100} : INFINITE);
        if (waited != WAIT_TIMEOUT) break;
        if (stop()) {
            TerminateProcess(process.hProcess, 1);
            WaitForSingleObject(process.hProcess, INFINITE);
            break;
        }
    }
    DWORD code = 1;
    GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return static_cast<int>(code);
}

std::string curl_program() {
    wchar_t system[MAX_PATH];
    const UINT n = GetSystemDirectoryW(system, MAX_PATH);
    if (n == 0 || n >= MAX_PATH) return "curl.exe";
    return (std::filesystem::path(std::wstring(system, n)) / L"curl.exe").string();
}

bool open_browser(const std::string& url) {
    // ShellExecute may hand the URL to shell extensions, which want COM.
    const HRESULT com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    const HINSTANCE result = ShellExecuteW(nullptr, L"open", wide(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    if (SUCCEEDED(com)) CoUninitialize();
    return reinterpret_cast<INT_PTR>(result) > 32;
}

bool port_free(int port) {
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return false;
    bool is_free = false;
    const SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock != INVALID_SOCKET) {
        BOOL exclusive = TRUE;
        setsockopt(sock, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<const char*>(&exclusive),
                   static_cast<int>(sizeof exclusive));
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(static_cast<u_short>(port));
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        is_free = bind(sock, reinterpret_cast<const sockaddr*>(&addr), static_cast<int>(sizeof addr)) == 0;
        closesocket(sock);
    }
    WSACleanup();
    return is_free;
}

long long process_id() { return static_cast<long long>(GetCurrentProcessId()); }

void wait_if_own_console(UiLang lang) {
    DWORD ids[2];
    if (GetConsoleProcessList(ids, 2) != 1) return;
    std::cerr << (lang == UiLang::es ? "Pulsa Intro para cerrar." : "Press Enter to close.") << std::endl;
    std::cin.get();
}

void probe_cuda(Probes& p) {
    const HMODULE lib = LoadLibraryW(L"nvcuda.dll");
    if (!lib) return;
    ask_cuda(p, [lib](const char* name) { return symbol<void*>(lib, name); });
}

void probe_vulkan(Probes& p) {
    // Kept loaded: the delay-loaded import of vulkan-1.dll finds it.
    p.vulkan_loader = LoadLibraryW(L"vulkan-1.dll") != nullptr;
}

#else  // POSIX (Linux)

namespace {

// Starts `args` with an empty signal mask (the launcher blocks SIGINT and
// SIGTERM for the game server), with `envp` or this environment. Returns the
// pid, or -1.
//
// The child gets stdin, stdout and stderr and nothing else: every other
// descriptor of the launcher is closed in it. Inherited, they outlived the
// launcher: the listening socket of the game in a browser started by
// xdg-open, and in the AppImage the descriptor that keeps its mount alive,
// which kept the first AppImage process (and its mount) up for as long as
// the terminal it opened (phase 10). With `quiet`, stdout and stderr go to
// /dev/null (what the browser prints is not the game's).
pid_t spawn(const std::vector<std::string>& args, char* const* envp = environ, bool quiet = false) {
    if (args.empty()) return -1;
    std::vector<char*> argv;
    for (const std::string& arg : args) argv.push_back(const_cast<char*>(arg.c_str()));
    argv.push_back(nullptr);
    posix_spawnattr_t attr;
    if (posix_spawnattr_init(&attr) != 0) return -1;
    sigset_t none;
    sigemptyset(&none);
    posix_spawnattr_setsigmask(&attr, &none);
    posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETSIGMASK);
    posix_spawn_file_actions_t files;
    if (posix_spawn_file_actions_init(&files) != 0) {
        posix_spawnattr_destroy(&attr);
        return -1;
    }
    if (quiet) {
        posix_spawn_file_actions_addopen(&files, STDOUT_FILENO, "/dev/null", O_WRONLY, 0);
        posix_spawn_file_actions_adddup2(&files, STDOUT_FILENO, STDERR_FILENO);
    }
    posix_spawn_file_actions_addclosefrom_np(&files, 3);  // glibc 2.34, the minimum of the build
    pid_t pid = -1;
    const int error = posix_spawnp(&pid, argv[0], &files, &attr, argv.data(), envp);
    posix_spawn_file_actions_destroy(&files);
    posix_spawnattr_destroy(&attr);
    return error == 0 ? pid : -1;
}

}  // namespace

std::filesystem::path self_exe() {
    std::error_code ec;
    const std::filesystem::path exe = std::filesystem::read_symlink("/proc/self/exe", ec);
    if (ec) throw std::runtime_error("cannot find the executable: " + ec.message());
    return exe;
}

std::filesystem::path exe_dir() { return self_exe().parent_path(); }

bool stderr_is_terminal() { return isatty(STDERR_FILENO) == 1; }

bool on_path(const std::string& program) {
    const char* path = std::getenv("PATH");
    if (!path || program.empty() || program.find('/') != std::string::npos) return false;
    const std::string folders = path;
    std::size_t start = 0;
    while (start <= folders.size()) {
        std::size_t end = folders.find(':', start);
        if (end == std::string::npos) end = folders.size();
        if (end > start) {
            const std::string file = folders.substr(start, end - start) + "/" + program;
            std::error_code ec;
            if (std::filesystem::is_regular_file(file, ec) && access(file.c_str(), X_OK) == 0) return true;
        }
        start = end + 1;
    }
    return false;
}

bool start_in_terminal(const std::vector<std::string>& args) {
    // This environment with RUMOR_IN_TERMINAL=1 (not set here: if no terminal
    // starts, this process goes on without one).
    const std::string mark = std::string(kInTerminalVar) + "=";
    std::vector<std::string> vars;
    for (char** var = environ; *var; ++var) {
        if (std::string_view(*var).substr(0, mark.size()) != mark) vars.emplace_back(*var);
    }
    vars.push_back(mark + "1");
    std::vector<char*> envp;
    for (std::string& var : vars) envp.push_back(var.data());
    envp.push_back(nullptr);

    const pid_t pid = spawn(args, envp.data());
    if (pid < 0) return false;
    // A terminal that cannot open a window ends at once with an error; one
    // that hands the command to its server (gnome-terminal) ends at once with
    // 0; the others stay.
    for (int i = 0; i < 20; ++i) {
        int status = 0;
        const pid_t done = waitpid(pid, &status, WNOHANG);
        if (done == pid) return WIFEXITED(status) && WEXITSTATUS(status) == 0;
        if (done < 0 && errno != EINTR) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    return true;
}

std::optional<std::string> env(const std::string& name) {
    const char* value = std::getenv(name.c_str());
    if (!value) return std::nullopt;
    return std::string(value);
}

UiLang system_lang() { return lang_from_env([](const std::string& name) { return env(name); }); }

void console_utf8() {}

int run_and_wait(const std::vector<std::string>& args, const std::function<bool()>& stop) {
    const pid_t pid = spawn(args);
    if (pid < 0) return -1;
    int status = 0;
    bool killed = false;
    for (;;) {
        // Polled while `stop` may still be asked; else a plain wait.
        const pid_t done = waitpid(pid, &status, stop && !killed ? WNOHANG : 0);
        if (done == pid) break;
        if (done < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (stop()) {
            kill(pid, SIGKILL);
            killed = true;
        } else {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    return 128 + (WIFSIGNALED(status) ? WTERMSIG(status) : 0);
}

std::string curl_program() { return "curl"; }

bool open_browser(const std::string& url) {
    // Not waited for: xdg-open may stay until the browser is up. The child is
    // reaped at exit.
    return spawn({"xdg-open", url}, environ, true) > 0;
}

bool port_free(int port) {
    const int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) return false;
    // SO_REUSEADDR only lets a port in TIME_WAIT be used again; a listener,
    // even one with SO_REUSEPORT, still makes the bind fail.
    const int one = 1;
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<std::uint16_t>(port));
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    const bool is_free = bind(sock, reinterpret_cast<const sockaddr*>(&addr), sizeof addr) == 0;
    close(sock);
    return is_free;
}

long long process_id() { return static_cast<long long>(getpid()); }

void wait_if_own_console(UiLang lang) {
    if (!in_own_terminal([](const std::string& name) { return env(name); })) return;
    std::cerr << (lang == UiLang::es ? "Pulsa Intro para cerrar." : "Press Enter to close.") << std::endl;
    std::cin.get();
}

void probe_cuda(Probes& p) {
    void* lib = dlopen("libcuda.so.1", RTLD_NOW | RTLD_LOCAL);
    if (!lib) return;
    ask_cuda(p, [lib](const char* name) { return dlsym(lib, name); });
}

void probe_vulkan(Probes& p) { p.vulkan_loader = dlopen("libvulkan.so.1", RTLD_NOW | RTLD_LOCAL) != nullptr; }

#endif

}  // namespace rumor::launcher::os
