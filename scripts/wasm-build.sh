#!/usr/bin/env bash
# Build the web version (phase 10, package F): the engine of the game Sin IA
# compiled to WebAssembly in docker/wasm.Dockerfile (engine/cmake/web.cmake).
#
#   scripts/wasm-build.sh     build/wasm/rumor_web.js and build/wasm/rumor_web.wasm
#
# The data of the game goes inside the .wasm. The object files stay in
# build/wasm-obj/. Prints the sizes at the end.
set -euo pipefail
. "$(dirname "$0")/wasm-lib.sh"

engine_commit=$(git -C "$ROOT" describe --always --dirty 2>/dev/null || echo unknown)
mkdir -p "$ROOT/$WASM_OUT" "$ROOT/build/wasm-cache"
wasm_run sh -c "
    emcmake cmake -S engine -B build/wasm-obj -DCMAKE_BUILD_TYPE=Release \
        -DRUMOR_ENGINE_COMMIT=$engine_commit >/dev/null &&
    cmake --build build/wasm-obj -j4 &&
    cp build/wasm-obj/rumor_web.js build/wasm-obj/rumor_web.wasm $WASM_OUT/"
ls -l "$ROOT/$WASM_OUT/rumor_web.js" "$ROOT/$WASM_OUT/rumor_web.wasm"
