# The web version (phase 10, package F): Emscripten at a fixed version, to
# compile the engine of the game Sin IA to WebAssembly (engine/cmake/web.cmake)
# and to run it in Node (scripts/wasm-diff.sh). No GPU. The repo is mounted at
# /work; nothing is copied into the image.
FROM emscripten/emsdk:6.0.13

WORKDIR /work
