#!/usr/bin/env bash
# The developer door of the game (phase 9): build the engine in Docker, start
# `rumor play` (the village waiting) and open the browser on the game.
#
#   ./play.sh                    Con IA if there is a usable NVIDIA GPU and the model
#   ./play.sh --no-ai            Sin IA (the baseline rules), no GPU needed
#   ./play.sh --port 8081 --no-open
#
# usage: ./play.sh [--port N] [--no-ai] [--no-build] [--no-open] [-h]
#
# Con IA needs scripts/check-gpu.sh to pass and models/gemma-4-E4B-it-rumor-Q4_K_M.gguf
# (MODELS_DIR overrides the folder). If either is missing it never aborts: it
# starts Sin IA and says why. The server runs in a container named
# rumor-play-<port>, published only on 127.0.0.1 of the host; the games go to
# runs/play/. Ctrl-C stops it.
set -euo pipefail
. "$(dirname "$0")/scripts/engine-lib.sh"  # ROOT, IMAGE, MODELS_DIR, engine_run, engine_gpu_run

GAME_MODEL=gemma-4-E4B-it-rumor-Q4_K_M.gguf

usage() {
    cat >&2 <<'EOF'
usage: ./play.sh [--port N] [--no-ai] [--no-build] [--no-open] [-h]

  --port N     port on 127.0.0.1 (default 8080)
  --no-ai      play Without AI even if there is a graphics card
  --no-build   do not build: use the engine already built in build/
  --no-open    do not open the browser; only print the address
  -h, --help   this help

With AI needs an NVIDIA card that works in Docker (scripts/check-gpu.sh)
and the model models/gemma-4-E4B-it-rumor-Q4_K_M.gguf. If anything is missing, it plays Without AI.
Ctrl-C closes the game.
EOF
    exit "${1:-2}"
}

say() { echo "play: $*" >&2; }
die() { echo "play: $*" >&2; exit 1; }

port=8080 ai=1 build=1 open_browser=1
while [ $# -gt 0 ]; do
    case $1 in
        --port) [ $# -ge 2 ] || usage; port=$2; shift ;;
        --no-ai) ai=0 ;;
        --no-build) build=0 ;;
        --no-open) open_browser=0 ;;
        -h | --help) usage 0 ;;
        *) usage ;;
    esac
    shift
done
[[ $port =~ ^[0-9]+$ ]] || die "the port must be a number: $port"

# 1. Docker.
command -v docker >/dev/null 2>&1 ||
    die "Docker not found. Install it (https://docs.docker.com/engine/install/) and try again."
docker info >/dev/null 2>&1 ||
    die "Docker does not answer. Is the service running, and can your user use it (docker group)?"

# 2. The llama.cpp submodule (the engine links it, and the HTTP server comes with it).
if [ ! -f "$ROOT/engine/third_party/llama.cpp/CMakeLists.txt" ]; then
    say "the submodule engine/third_party/llama.cpp is missing; downloading it (only the first time)..."
    git -C "$ROOT" submodule update --init --depth 1 engine/third_party/llama.cpp ||
        die "could not download the submodule. Try by hand: git submodule update --init --depth 1 engine/third_party/llama.cpp"
fi

# 3. Con IA or Sin IA. Never aborts: whatever fails, it falls back to Sin IA.
mkdir -p "$ROOT/build"
why=""
# The GPU runs one job at a time (build/.gpu.lock): say so instead of waiting
# in silence when another run holds it.
if [ "$ai" = 1 ] && ! flock -n "$GPU_LOCK" true 2>/dev/null; then
    say "the graphics card is busy with another run (another ./play.sh, a test or a measurement); waiting for it..."
    say "  (to see which: docker ps; to play Without AI now: Ctrl-C and ./play.sh --no-ai)"
fi
if [ "$ai" = 0 ]; then
    why="you asked for --no-ai"
elif ! "$ROOT/scripts/check-gpu.sh" >"$ROOT/build/play-check-gpu.log" 2>&1; then
    why="the graphics card cannot be used from Docker (details in build/play-check-gpu.log)"
elif [ ! -f "$MODELS_DIR/$GAME_MODEL" ]; then
    why="the model $MODELS_DIR/$GAME_MODEL is not there"
fi
[ -z "$why" ] || ai=0

# The GPU image is built once (it compiles llama.cpp with CUDA: it takes a while).
if [ "$ai" = 1 ] && [ "$build" = 1 ] && ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    say "first time With AI: building the engine image with GPU ($IMAGE); it takes a few minutes..."
    if ! "$ROOT/scripts/build-image.sh" >"$ROOT/build/play-build-image.log" 2>&1; then
        ai=0 why="the GPU image could not be built (details in build/play-build-image.log)"
    fi
fi

# 4. Build the engine.
if [ "$build" = 1 ] && [ "$ai" = 1 ]; then
    say "building the engine with GPU (scripts/engine-build.sh --cuda)..."
    if ! "$ROOT/scripts/engine-build.sh" --cuda; then
        ai=0 why="the GPU build failed"
    fi
fi
if [ "$build" = 1 ] && [ "$ai" = 0 ]; then
    say "building the engine (scripts/engine-build.sh)..."
    "$ROOT/scripts/engine-build.sh" || die "the build failed; see the messages above."
fi
if [ "$ai" = 1 ] && [ ! -x "$ROOT/build/engine-cuda/rumor" ]; then
    ai=0 why="build/engine-cuda/rumor is not built (drop --no-build)"
fi
if [ "$ai" = 0 ] && [ ! -x "$ROOT/build/engine/rumor" ]; then
    die "build/engine/rumor is not built; drop --no-build."
fi

if [ "$ai" = 1 ]; then
    say "mode With AI: the fine-tuned model decides on your graphics card."
else
    say "mode Without AI (rules): $why."
fi

# 5. Start `rumor play` in Docker.
name=rumor-play-$port
url="http://127.0.0.1:$port/?play=1"
if [ -n "$(docker ps -q -f "name=^${name}\$")" ]; then
    say "a game is already running on port $port ($name): $url"
    say "to close it: docker stop $name"
    exit 0
fi
docker rm -f "$name" >/dev/null 2>&1 || true

ENGINE_DOCKER_OPTS=(--init --name "$name" -p "127.0.0.1:$port:$port")
cmd=(play --port "$port" --bind 0.0.0.0)
stop() { docker stop -t 10 "$name" >/dev/null 2>&1 || true; }
trap 'echo >&2; say "closing the game..."; stop; exit 130' INT TERM

if [ "$ai" = 1 ]; then
    engine_gpu_run build/engine-cuda/rumor "${cmd[@]}" --model "/models/$GAME_MODEL" --prompt card </dev/null &
else
    engine_run build/engine/rumor "${cmd[@]}" </dev/null &
fi
pid=$!

# 6. Wait until the server answers, then open the browser.
state_ok() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$port/state"
    else
        python3 -c 'import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=2)' \
            "http://127.0.0.1:$port/state" 2>/dev/null
    fi
}
say "starting the engine..."
# No time limit: the GPU lock may be held by another job of the repo and the
# model takes a while to load. A failed start ends the container, and the loop.
ready=0 waited=0
while kill -0 "$pid" 2>/dev/null; do
    if state_ok; then ready=1; break; fi
    sleep 1
    waited=$((waited + 1))
    [ $((waited % 60)) -ne 0 ] || say "still waiting for the engine (${waited} s; With AI, the GPU may be busy with another job)..."
done
if [ "$ready" = 0 ]; then
    stop
    wait "$pid" 2>/dev/null || true
    die "the engine closed without answering on port $port (is it in use?). See the messages above."
fi

say "ready: $url"
say "to close: Ctrl-C (or docker stop $name)"
if [ "$open_browser" = 1 ]; then
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
        open "$url" >/dev/null 2>&1 || true
    else
        say "open that address in the browser."
    fi
fi

# Until the engine exits (Ctrl-C, "Close the game" in the game or docker stop).
status=0
wait "$pid" || status=$?
trap - INT TERM
say "game closed."
exit "$status"
