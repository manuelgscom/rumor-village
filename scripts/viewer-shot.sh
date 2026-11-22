#!/usr/bin/env bash
# Take a screenshot of the viewer with headless Chromium, in one container.
#
#   scripts/viewer-shot.sh '?log=/runs/samples/party-100-es-s2.jsonl' build/shots/core/party-100.png
#   scripts/viewer-shot.sh --size 1280x720 '?log=/viewer/fixtures/hand-text.jsonl&zoom=near' build/shots/near.png
#   scripts/viewer-shot.sh --base http://127.0.0.1:8080/ '?live=1' build/shots/live.png
#   scripts/viewer-shot.sh --expect error '?log=/runs/samples/nope.jsonl' build/shots/error.png
#
# Without --base, a static server for the repo root starts inside the container
# on an internal port (nothing is published, so several shots can run at once)
# and the page is /viewer/index.html<query>. With --base, no server starts, the
# container uses the host network and the page is <base><query> (the live mode
# served by the engine). The shot is taken once <html> has data-ready; if it
# gets data-error instead, the script fails with that message (unless
# --expect error; --expect loading shoots the loading screen, see
# viewer/tools/shot.mjs). A console error on the page fails the shot too. The
# output path is relative to the repo root.
set -euo pipefail
. "$(dirname "$0")/viewer-lib.sh"

usage() {
    echo "usage: scripts/viewer-shot.sh [--base <url>] [--size WxH] [--expect ready|error|loading] '<query>' <out.png>" >&2
    exit 2
}

base="" size=1600x900 expect=ready
while [ $# -gt 0 ]; do
    case $1 in
        --base) base=${2:?}; shift 2 ;;
        --size) size=${2:?}; shift 2 ;;
        --expect) expect=${2:?}; shift 2 ;;
        -h | --help) usage ;;
        *) break ;;
    esac
done
[ $# -eq 2 ] || usage
query=$1 out=$2

args=(node viewer/tools/shot.mjs --size "$size" --expect "$expect" --query "$query" --out "$out")
if [ -n "$base" ]; then
    viewer_run --network host -- "${args[@]}" --base "$base"
else
    viewer_run -- "${args[@]}"
fi
