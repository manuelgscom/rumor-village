#!/usr/bin/env bash
# Serve the repo root over HTTP for the viewer, only on 127.0.0.1 of the host.
# ES modules do not load from file://, so the viewer needs a server.
#
#   scripts/viewer-serve.sh          # port 8000
#   scripts/viewer-serve.sh 8001
#
# Then open http://127.0.0.1:8000/viewer/index.html?log=/runs/samples/party-100-es-s2.jsonl
set -euo pipefail
. "$(dirname "$0")/viewer-lib.sh"

port=${1:-8000}
echo "viewer: http://127.0.0.1:$port/viewer/index.html?log=/runs/samples/party-100-es-s2.jsonl" >&2
viewer_run -p "127.0.0.1:$port:$port" -- \
    node viewer/tools/static.mjs --root /work --host 0.0.0.0 --port "$port"
