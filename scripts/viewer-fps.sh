#!/usr/bin/env bash
# Frame times of the viewer in headless Chromium (SwiftShader: the container
# has no GPU), at 1600x900 and DPR 1, playing from the URL's position. One
# line per query is appended to the output file (median and p90 ms per frame,
# and the scene's frame meter when the query has stats=1).
#
#   scripts/viewer-fps.sh docs/fases/capturas/fase-8-2/rendimiento-swiftshader.txt \
#       '?log=/runs/samples/party-100-es-s2.jsonl&t=1250&zoom=far&q=high&stats=1' \
#       '?log=/runs/samples/party-100-es-s2.jsonl&t=1250&zoom=far&q=low&stats=1'
#   FPS_FRAMES=60 scripts/viewer-fps.sh build/fps.txt '?log=...'
#   FPS_SIZE=1920x1080 scripts/viewer-fps.sh ...   # another window size
#
# The queries run one after another: measuring two at once would share the CPU.
set -euo pipefail
. "$(dirname "$0")/viewer-lib.sh"

[ $# -ge 2 ] || { echo "usage: scripts/viewer-fps.sh <out.txt> '<query>'..." >&2; exit 2; }
out=$1
shift
frames=${FPS_FRAMES:-40}
size=${FPS_SIZE:-1600x900}
mkdir -p "$ROOT/$(dirname "$out")"
for query in "$@"; do
    viewer_run -- node viewer/tools/shot.mjs --measure "$frames" --size "$size" --query "$query" --out "$out"
done
