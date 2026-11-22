#!/usr/bin/env bash
# Run the `rumor` command in a container, from the repo root.
#
#   scripts/rumor.sh run --scenario party-25 --lang es --seed 1 --policy baseline --out runs/check/a.jsonl
#   scripts/rumor.sh metrics runs/check/a.jsonl
#   scripts/rumor.sh bench --policy baseline --scenario party-25 --lang es --runs 3
#   scripts/rumor.sh bench --model /models/<file>.gguf --scenario party-25 --lang es --runs 10
#   scripts/rumor.sh extract --model /models/<file>.gguf --lang es --text "hay fiesta en la plaza a las 9"
#
# Paths are relative to the repo root; the models folder is /models inside the
# container. With --model the command runs in the GPU image, with the GPU and
# one run at a time (build first with scripts/engine-build.sh --cuda); without
# it, in the CPU image (scripts/engine-build.sh). Nothing runs a model on the
# CPU. On the pod (RUMOR_POD=1) it runs build/pod/rumor natively, without Docker.
set -euo pipefail
. "$(dirname "$0")/engine-lib.sh"

gpu=0
for arg in "$@"; do
    [ "$arg" != --model ] || gpu=1
done

# On the pod (RUMOR_POD=1, training/pod/env.sh) there is no Docker: the native
# build of training/pod/setup.sh, from the repo root, with the GPU lock when it
# runs a model. `rumor prompts --vocab` only reads the vocabulary: no lock.
if on_pod; then
    bin=$ROOT/build/pod/rumor
    [ -x "$bin" ] || { echo "rumor: $bin not found; run training/pod/setup.sh first" >&2; exit 1; }
    cd "$ROOT"
    if [ "$gpu" = 1 ] && [ "${1:-}" != prompts ]; then
        gpu_locked "$bin" "$@"
        exit
    fi
    exec "$bin" "$@"
fi

if [ "$gpu" = 1 ]; then
    if [ ! -x "$ROOT/build/engine-cuda/rumor" ]; then
        echo "rumor: build/engine-cuda/rumor not found; run scripts/engine-build.sh --cuda first" >&2
        exit 1
    fi
    engine_gpu_run build/engine-cuda/rumor "$@"
else
    if [ ! -x "$ROOT/build/engine/rumor" ]; then
        echo "rumor: build/engine/rumor not found; run scripts/engine-build.sh first" >&2
        exit 1
    fi
    engine_run build/engine/rumor "$@"
fi
