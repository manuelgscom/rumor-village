# Shared by the host-side shortcuts in scripts/. Source it, do not run it.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
read -r LLAMA_REF LLAMA_COMMIT < "$ROOT/docker/LLAMA_COMMIT"
IMAGE="rumor-village-engine:${LLAMA_REF}-${LLAMA_COMMIT:0:7}"
MODELS_DIR=${MODELS_DIR:-$ROOT/models}
GPU_LOCK="$ROOT/build/.gpu.lock"

# --- Phase 5: the vast.ai pod -------------------------------------------------
# On the pod (training/pod/env.sh exports RUMOR_POD=1) there is no Docker: the
# shortcuts run Python and the native build (build/pod/) directly.
on_pod() { [ "${RUMOR_POD:-0}" = 1 ]; }

# need_pod <who> / need_local <who>: fail when run on the wrong machine.
need_pod() {
    on_pod || { echo "$1: runs on the pod only (scripts/pod.sh exec scripts/$1.sh ...)" >&2; exit 2; }
}
need_local() {
    ! on_pod || { echo "$1: runs on the local machine only, not on the pod" >&2; exit 2; }
}

# need_file <who> <path> <package>: fail when an entry point of another package
# is not there yet.
need_file() {
    [ -e "$ROOT/$2" ] || { echo "$1: $2 not found (package $3 has not delivered it yet)" >&2; exit 1; }
}

# gpu_locked <cmd...>: run a command holding the GPU lock (one GPU job at a
# time). Nested calls (a queue that calls scripts/rumor.sh) do not wait for
# themselves: RUMOR_GPU_LOCKED=1 marks the holder.
gpu_locked() {
    if [ "${RUMOR_GPU_LOCKED:-0}" = 1 ]; then
        "$@"
    else
        mkdir -p "$ROOT/build"
        RUMOR_GPU_LOCKED=1 flock "$GPU_LOCK" "$@"
    fi
}

# py <script> [args...]: run a repo Python script, from the repo root: the venv
# Python on the pod, the tools image (no network) locally.
py() {
    if on_pod; then
        (cd "$ROOT" && python "$@")
    else
        "$ROOT/scripts/tools.sh" python "$@"
    fi
}
