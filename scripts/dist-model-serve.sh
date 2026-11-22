#!/usr/bin/env bash
# Serve a folder of the repo over HTTP on 127.0.0.1 of the host, with byte
# ranges, to test the model download of the launcher without the real origin
# (phase 10).
#
#   scripts/dist-model-serve.sh [--port N] [--dir models]
#
# Defaults: port 8090, folder models/. Then, for example:
#   rumor-village --model-url http://127.0.0.1:8090/gemma-4-E4B-it-rumor-Q4_K_M.gguf
# The server is viewer/tools/static.mjs (it answers "Range: bytes=N-" with
# 206), in the viewer image, with the folder mounted read only. Ctrl+C stops it.
set -euo pipefail
. "$(dirname "$0")/viewer-lib.sh"  # ROOT, viewer_run

port=8090 dir=models
while [ $# -gt 0 ]; do
    case $1 in
        --port) port=${2:?usage: $0 [--port N] [--dir <folder>]}; shift ;;
        --dir) dir=${2:?usage: $0 [--port N] [--dir <folder>]}; shift ;;
        *) echo "usage: $0 [--port N] [--dir <folder>]" >&2; exit 2 ;;
    esac
    shift
done
[[ $port =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] ||
    { echo "dist-model-serve: bad port '$port'" >&2; exit 2; }
# The folder, inside the repo (models/ may be a link to elsewhere: it is
# resolved and mounted on its own).
src=$(cd "$ROOT" && cd "$dir" 2>/dev/null && pwd -P) ||
    { echo "dist-model-serve: no folder '$dir'" >&2; exit 1; }

echo "dist-model-serve: http://127.0.0.1:$port/ serves $dir/" >&2
(cd "$src" && find . -maxdepth 1 -type f -name '*.gguf' -printf '  http://127.0.0.1:'"$port"'/%P\n') >&2
viewer_run -p "127.0.0.1:$port:$port" -v "$src:/serve:ro" -- \
    node viewer/tools/static.mjs --root /serve --host 0.0.0.0 --port "$port"
