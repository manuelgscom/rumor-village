#!/usr/bin/env bash
# Serve a run live with the viewer, from the repo root.
#
#   scripts/serve.sh party-25 1                       http://127.0.0.1:8080/?live=1
#   scripts/serve.sh party-100 3 --lang en --port 8081 --speed max
#   scripts/serve.sh party-25 1 --port 8090 --out runs/live/mine.jsonl
#   scripts/serve.sh party-25 1 --model /models/<file>.gguf --text camera
#
# usage: scripts/serve.sh <scenario> <seed> [--lang es|en] [--port N] [--speed N|max]
#                         [more options of `rumor run`]
#
# The log goes to runs/live/<scenario>-<lang>-s<seed>.jsonl (a later --out
# wins), with the baseline policy unless --model is given. Inside the container
# the server listens on 0.0.0.0; the port is published only on 127.0.0.1 of the
# host. Ctrl-C or `docker stop rumor-serve-<port>` stops it; a run cut short
# still ends with its end event. With --model it runs in the GPU image, with
# the GPU (build first with scripts/engine-build.sh --cuda); without it, in the
# CPU image (scripts/engine-build.sh).
set -euo pipefail
. "$(dirname "$0")/engine-lib.sh"

usage() {
    echo "usage: $0 <scenario> <seed> [--lang es|en] [--port N] [--speed N|max] [rumor run options]" >&2
    exit 2
}

[ $# -ge 2 ] || usage
scenario=$1 seed=$2
shift 2
lang=es port=8080 gpu=0 rest=()
while [ $# -gt 0 ]; do
    [ $# -ge 2 ] || usage
    case $1 in
        --lang) lang=$2 ;;
        --port) port=$2 ;;
        --model) gpu=1; rest+=("$1" "$2") ;;
        *) rest+=("$1" "$2") ;;
    esac
    shift 2
done

ENGINE_DOCKER_OPTS=(--init --name "rumor-serve-$port" -p "127.0.0.1:$port:$port")
cmd=(run --scenario "$scenario" --lang "$lang" --seed "$seed" --policy baseline
    --out "runs/live/$scenario-$lang-s$seed.jsonl" --serve "$port" --bind 0.0.0.0
    "${rest[@]}")

echo "serve: http://127.0.0.1:$port/?live=1 (stop: Ctrl-C or docker stop rumor-serve-$port)" >&2
if [ "$gpu" = 1 ]; then
    if [ ! -x "$ROOT/build/engine-cuda/rumor" ]; then
        echo "serve: build/engine-cuda/rumor not found; run scripts/engine-build.sh --cuda first" >&2
        exit 1
    fi
    engine_gpu_run build/engine-cuda/rumor "${cmd[@]}"
else
    if [ ! -x "$ROOT/build/engine/rumor" ]; then
        echo "serve: build/engine/rumor not found; run scripts/engine-build.sh first" >&2
        exit 1
    fi
    engine_run build/engine/rumor "${cmd[@]}"
fi
