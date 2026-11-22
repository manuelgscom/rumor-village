# Shared by the web version shortcuts (wasm-build.sh, wasm-diff.sh,
# wasm-smoke.sh; phase 10, package F). Source it, do not run it.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"  # ROOT
WASM_IMAGE=${WASM_IMAGE:-rumor-village-wasm:1}
# Where the build leaves rumor_web.js and rumor_web.wasm.
WASM_OUT=build/wasm

# wasm_run <cmd...>: run a command in the Emscripten image, with the repo at
# /work, as the host user. The image is built the first time it is needed. The
# Emscripten cache (system libraries built on first use) stays in build/.
wasm_run() {
    docker image inspect "$WASM_IMAGE" >/dev/null 2>&1 ||
        docker build -q -f "$ROOT/docker/wasm.Dockerfile" -t "$WASM_IMAGE" "$ROOT/docker" >&2
    docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp -e EM_CACHE=/work/build/wasm-cache \
        -v "$ROOT:/work" -w /work "$WASM_IMAGE" "$@"
}
