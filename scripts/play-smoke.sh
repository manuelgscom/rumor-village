#!/usr/bin/env bash
# The smoke game of phase 9: start `rumor play` in Docker, play one game with
# the default settings and one rumor, and check what it leaves in runs/play/.
#
#   scripts/play-smoke.sh                  Sin IA (mode "rules"), CPU image
#   scripts/play-smoke.sh --model          Con IA (mode "ai"), GPU image, the fine-tuned model
#   scripts/play-smoke.sh --port 8095
#   scripts/play-smoke.sh --neighbors 50   a village of 10, 25, 50, 70 or 100 (default 25)
#
# Checks, in order: GET /state answers and the hardware check is not running;
# a POST with a foreign Origin gets 403; POST /preview writes nothing under
# runs/play/; POST /start with the draft; POST /control {"speed":"max"}; the
# game ends (timeout 300 s on CPU, 1800 s on GPU); the log ends with an end
# event and the .game.json and .cards.jsonl are there; POST /quit ends the
# container. Prints PASS or FAIL; exits non-zero on failure. Build first with
# scripts/engine-build.sh (or --cuda for --model). The server output goes to
# build/play-smoke.log. Reads JSON with jq, or python3 if there is no jq.
set -euo pipefail
. "$(dirname "$0")/engine-lib.sh"

GAME_MODEL=gemma-4-E4B-it-rumor-Q4_K_M.gguf

usage() {
    echo "usage: scripts/play-smoke.sh [--model] [--port N] [--neighbors N]" >&2
    exit "${1:-2}"
}

gpu=0 port=8090 neighbors=25
while [ $# -gt 0 ]; do
    case $1 in
        --model) gpu=1 ;;
        --port) [ $# -ge 2 ] || usage; port=$2; shift ;;
        --neighbors) [ $# -ge 2 ] || usage; neighbors=$2; shift ;;
        -h | --help) usage 0 ;;
        *) usage ;;
    esac
    shift
done
command -v curl >/dev/null 2>&1 || { echo "play-smoke: curl is needed on the host" >&2; exit 2; }

if [ "$gpu" = 1 ]; then
    bin=build/engine-cuda/rumor mode=ai timeout=1800
    [ -f "$MODELS_DIR/$GAME_MODEL" ] || { echo "play-smoke: $MODELS_DIR/$GAME_MODEL not found" >&2; exit 1; }
else
    bin=build/engine/rumor mode=rules timeout=300
fi
[ -x "$ROOT/$bin" ] || {
    echo "play-smoke: $bin not found; run scripts/engine-build.sh$([ "$gpu" = 1 ] && echo ' --cuda') first" >&2
    exit 1
}

base=http://127.0.0.1:$port
name=rumor-play-smoke-$port
out=runs/play
log=$ROOT/build/play-smoke.log
mkdir -p "$ROOT/$out" "$ROOT/build"

# jget <path>: a value of the JSON on stdin, by dotted path ("check.state");
# empty when missing or null.
jget() {
    if command -v jq >/dev/null 2>&1; then
        jq -r ".$1 | select(. != null)" 2>/dev/null || true
    else
        python3 -c '
import json, sys
try:
    v = json.load(sys.stdin)
except ValueError:
    sys.exit(0)
for k in sys.argv[1].split("."):
    v = v.get(k) if isinstance(v, dict) else None
if v is not None:
    print(json.dumps(v) if isinstance(v, (dict, list)) else str(v).lower() if isinstance(v, bool) else v)
' "$1"
    fi
}

# post <route> <body> [curl args...]: prints the HTTP status ("000" when the
# server does not answer); the response body is left in $tmp/body.
post() {
    local route=$1 body=$2
    shift 2
    rm -f "$tmp/body"
    curl -sS --max-time 30 -X POST -H 'Content-Type: application/json' --data "$body" \
        -o "$tmp/body" -w '%{http_code}' "$@" "$base$route" 2>/dev/null || true
}
body() { cat "$tmp/body" 2>/dev/null || true; }
get_state() { curl -fsS --max-time 10 "$base/state"; }

failed=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; failed=1; }
finish() {
    if [ "$failed" = 0 ]; then echo "PASS  play-smoke ($mode)"; exit 0; fi
    echo "FAIL  play-smoke ($mode); server output in build/play-smoke.log"
    exit 1
}
alive() { kill -0 "$pid" 2>/dev/null; }

tmp=$(mktemp -d "$ROOT/build/play-smoke.XXXXXX")
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap 'cleanup; rm -rf "$tmp"' EXIT
cleanup

# Start the server in the background.
ENGINE_DOCKER_OPTS=(--init --name "$name" -p "127.0.0.1:$port:$port")
cmd=("$bin" play --port "$port" --bind 0.0.0.0 --out "$out")
if [ "$gpu" = 1 ]; then
    engine_gpu_run "${cmd[@]}" --model "/models/$GAME_MODEL" --prompt card </dev/null >"$log" 2>&1 &
else
    engine_run "${cmd[@]}" </dev/null >"$log" 2>&1 &
fi
pid=$!
echo "play-smoke: $mode, port $port, container $name" >&2

# 1. GET /state answers (the GPU lock and the model load may take a while).
state=""
for _ in $(seq 1 "$timeout"); do
    alive || break
    state=$(get_state 2>/dev/null) && break
    state=""
    sleep 1
done
[ -n "$state" ] || { bad "GET /state does not answer"; finish; }
ok "GET /state answers ($(jget state <<<"$state"))"

# 2. The hardware check has finished.
for _ in $(seq 1 "$timeout"); do
    [ "$(jget check.state <<<"$state")" != running ] && break
    sleep 1
    state=$(get_state) || break
done
c=$(jget check.state <<<"$state")
if [ "$c" = done ] || [ "$c" = skipped ]; then ok "check.state is $c"; else bad "check.state is '$c'"; fi
if [ "$gpu" = 1 ] && [ "$(jget ai.available <<<"$state")" != true ]; then
    bad "ai.available is not true: $(jget ai.reason <<<"$state")"
fi

rumor='{"fact":{"what":"party","who":"n006","where":"square","when":"hoy 21:00","amount":50},"text":null,"to":{"neighbors":["n001"]},"at":"start"}'
draft="{\"settings\":{\"mode\":\"$mode\",\"neighbors\":$neighbors},\"rumors\":[$rumor],\"challenge\":null}"

# 3. Origin check: an order from another page is refused.
r=$(post /start "$draft" -H 'Origin: http://example.org')
if [ "$r" = 403 ]; then ok "foreign Origin gets 403"; else bad "foreign Origin got $r, not 403"; fi

# 4. POST /preview writes nothing to disk.
listing() { find "$ROOT/$out" -printf '%P %s %T@\n' | sort; }
before=$(listing)
code=$(post /preview "$draft")
after=$(listing)
if [ "$code" = 200 ] && [ -n "$(body | jget header)" ]; then
    ok "POST /preview answers 200 with a header"
else
    bad "POST /preview: status $code"
fi
if [ "$before" = "$after" ]; then ok "POST /preview wrote nothing in $out/"; else bad "POST /preview changed $out/"; fi

# 5. Start the game, at full speed.
code=$(post /start "$draft")
id=$(body | jget game.id)
if [ "$code" = 200 ] && [ -n "$id" ]; then
    ok "POST /start: game $id"
else
    bad "POST /start: status $code: $(body)"
    finish
fi
code=$(post /control '{"speed":"max"}')
[[ $code == 2?? ]] && ok "POST /control speed max" || bad "POST /control: status $code"

# 6. The game ends.
t0=$SECONDS s=""
while [ $((SECONDS - t0)) -lt "$timeout" ]; do
    alive || break
    s=$(get_state 2>/dev/null | jget state) || s=""
    [ "$s" = ended ] && break
    sleep 2
done
if [ "$s" = ended ]; then ok "game ended in $((SECONDS - t0)) s"; else bad "game not ended (state '$s') after $((SECONDS - t0)) s"; fi

# 7. What the game left in runs/play/.
f=$ROOT/$out/$id
if [ -s "$f.jsonl" ] && [ "$(tail -n1 "$f.jsonl" | jget type)" = end ]; then
    ok "$out/$id.jsonl ends with an end event"
else
    bad "$out/$id.jsonl missing or not ending with an end event"
fi
sc=$(head -n1 "$f.jsonl" 2>/dev/null | jget scenario)
[ "$sc" = "party-$neighbors" ] && ok "scenario $sc" || bad "scenario is '$sc', not party-$neighbors"
if [ -f "$f.game.json" ] && [ "$(jget id <"$f.game.json")" = "$id" ]; then
    ok "$out/$id.game.json"
else
    bad "$out/$id.game.json missing or without its id"
fi
[ -f "$f.cards.jsonl" ] && ok "$out/$id.cards.jsonl" || bad "$out/$id.cards.jsonl missing"

# 8. POST /quit ends the process, and with it the container.
code=$(post /quit '{}')
[[ $code == 2?? ]] && ok "POST /quit" || bad "POST /quit: status $code"
for _ in $(seq 1 30); do alive || break; sleep 1; done
if alive || [ -n "$(docker ps -q -f "name=^${name}\$")" ]; then
    bad "the container is still running after /quit"
else
    ok "container gone"
fi
finish
