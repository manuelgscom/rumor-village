#!/usr/bin/env bash
# Check that a live run streams its log byte for byte: serves the run at full
# speed, reads /events up to the end event and diffs the data lines against
# the file of that same run. No output and exit code 0 when they are equal.
#
#   scripts/sse-diff.sh party-25 1
#   SSE_DIFF_PORT=8097 scripts/sse-diff.sh party-100 2
#
# The port (default 8099) is published only on 127.0.0.1 of the host. The log
# and the stream stay in runs/live/sse-diff-<scenario>-s<seed>.{jsonl,sse}.
set -euo pipefail
. "$(dirname "$0")/engine-lib.sh"

[ $# -eq 2 ] || { echo "usage: $0 <scenario> <seed>" >&2; exit 2; }
scenario=$1 seed=$2
port=${SSE_DIFF_PORT:-8099}
name=rumor-serve-$port
log=runs/live/sse-diff-$scenario-s$seed.jsonl
stream=$ROOT/runs/live/sse-diff-$scenario-s$seed.sse
url=http://127.0.0.1:$port

if [ ! -x "$ROOT/build/engine/rumor" ]; then
    echo "sse-diff: build/engine/rumor not found; run scripts/engine-build.sh first" >&2
    exit 1
fi
mkdir -p "$ROOT/runs/live"
rm -f "$ROOT/$log" "$stream"

server=""
curl_pid=""
cleanup() {
    docker stop -t 10 "$name" >/dev/null 2>&1 || true
    [ -z "$curl_pid" ] || kill "$curl_pid" 2>/dev/null || true
    [ -z "$server" ] || wait "$server" 2>/dev/null || true
}
trap cleanup EXIT

ENGINE_DOCKER_OPTS=(--init --name "$name" -p "127.0.0.1:$port:$port")
engine_run build/engine/rumor run --scenario "$scenario" --lang es --seed "$seed" \
    --policy baseline --out "$log" --serve "$port" --bind 0.0.0.0 --speed max \
    </dev/null >/dev/null 2>&1 &
server=$!

# Until the port answers (or the server is gone).
for _ in $(seq 300); do
    curl -s -o /dev/null "$url/control" && break
    kill -0 "$server" 2>/dev/null || { echo "sse-diff: the server did not start" >&2; exit 1; }
    sleep 0.1
done

curl -sN --max-time 600 "$url/events" >"$stream" &
curl_pid=$!
# Until the whole end event has arrived: its data line and the blank line.
until grep -q '^data: {"type":"end"' "$stream" 2>/dev/null &&
    [ "$(tail -c 2 "$stream" | od -An -c | tr -d ' ')" = '\n\n' ]; do
    kill -0 "$curl_pid" 2>/dev/null || { echo "sse-diff: the stream ended before the end event" >&2; exit 1; }
    sleep 0.1
done

docker stop -t 10 "$name" >/dev/null
wait "$server" || true
wait "$curl_pid" || true
server="" curl_pid=""

sed -n 's/^data: //p' "$stream" | diff - "$ROOT/$log"
