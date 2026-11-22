#!/usr/bin/env bash
# Run a command inside the engine image, with the repo at /work and the models
# at /models.
#
#   scripts/bench-run.sh --gpu   <cmd...>   anything that runs a model. The GPU
#                                           is unique: runs wait for a lock.
#   scripts/bench-run.sh --tools <cmd...>   no GPU, for commands that never run
#                                           a model (download, sha256, jq, build).
#
# Nothing that runs a model goes on the CPU. BENCH_* variables are passed through.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

mode=${1:-}
[ $# -gt 0 ] && shift
if [ $# -eq 0 ] || { [ "$mode" != --gpu ] && [ "$mode" != --tools ]; }; then
    echo "usage: $0 --gpu|--tools <cmd...>" >&2
    exit 2
fi

mkdir -p "$MODELS_DIR" "$ROOT/build"

args=(--rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$ROOT:/work" -w /work)
while IFS= read -r name; do
    args+=(-e "$name")
done < <(compgen -e | grep '^BENCH_' || true)

if [ "$mode" = --gpu ]; then
    args+=(--gpus all -e NVIDIA_DRIVER_CAPABILITIES=all -v "$MODELS_DIR:/models:ro")
    exec flock "$GPU_LOCK" docker run "${args[@]}" "$IMAGE" "$@"
else
    # no driver in the container: let the llama.cpp tools load with the CUDA stub
    args+=(-v "$MODELS_DIR:/models" -e LD_LIBRARY_PATH=/opt/llama/lib:/opt/cuda-stub)
    exec docker run "${args[@]}" "$IMAGE" "$@"
fi
