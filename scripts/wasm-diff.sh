#!/usr/bin/env bash
# The same game Sin IA, native and WebAssembly (phase 10, package F): plays a
# draft with `rumor play --once` (build/engine/rumor, in the CPU image) and
# with build/wasm/rumor_web.js in Node (the Emscripten image), and compares
# the logs (.jsonl) and the cards of «¿Qué pensó?» (.cards.jsonl) with cmp.
# Prints PASS or FAIL per draft; exits 1 on any FAIL. No GPU.
#
#   scripts/wasm-diff.sh dist/drafts/default.json
#   scripts/wasm-diff.sh dist/drafts/*.json
#
# The files stay in build/wasm-diff/<draft>/{native,web}/. Builds the native
# engine (scripts/engine-build.sh) or the web one (scripts/wasm-build.sh) when
# missing.
set -euo pipefail
. "$(dirname "$0")/wasm-lib.sh"
. "$ROOT/scripts/engine-lib.sh"

[ $# -ge 1 ] || { echo "usage: scripts/wasm-diff.sh <draft.json>..." >&2; exit 2; }
[ -x "$ROOT/build/engine/rumor" ] || "$ROOT/scripts/engine-build.sh"
[ -f "$ROOT/$WASM_OUT/rumor_web.js" ] || "$ROOT/scripts/wasm-build.sh"

# rel <path>: the path relative to the repo root (the containers see /work).
rel() {
    local abs
    abs=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
    case $abs in
        "$ROOT"/*) echo "${abs#"$ROOT"/}" ;;
        *) echo "wasm-diff: $1 is outside the repo" >&2; exit 2 ;;
    esac
}

failed=0
for draft in "$@"; do
    d=$(rel "$draft")
    name=$(basename "$d" .json)
    out=build/wasm-diff/$name
    rm -rf "${ROOT:?}/$out"
    mkdir -p "$ROOT/$out/native" "$ROOT/$out/web"
    engine_run build/engine/rumor play --once "$d" --out "$out/native" >/dev/null
    wasm_run node engine/src/web/play_once.mjs "$WASM_OUT/rumor_web.js" "$d" "$out/web" >/dev/null 2>"$ROOT/$out/web/stderr.txt"
    result=PASS
    detail=""
    for kind in jsonl cards.jsonl; do
        # One game per folder: <id>.jsonl and <id>.cards.jsonl.
        if [ "$kind" = jsonl ]; then
            native=$(ls "$ROOT/$out/native/"*.jsonl 2>/dev/null | grep -v '\.cards\.jsonl$' || true)
            web=$(ls "$ROOT/$out/web/"*.jsonl 2>/dev/null | grep -v '\.cards\.jsonl$' || true)
        else
            native=$(ls "$ROOT/$out/native/"*.cards.jsonl 2>/dev/null || true)
            web=$(ls "$ROOT/$out/web/"*.cards.jsonl 2>/dev/null || true)
        fi
        if [ -z "$native" ] || [ -z "$web" ]; then
            result=FAIL
            detail+=" $kind: missing;"
            continue
        fi
        if cmp -s "$native" "$web"; then
            detail+=" $kind: $(wc -l <"$native") lines, $(wc -c <"$native") bytes, identical;"
        else
            result=FAIL
            detail+=" $kind: $(cmp "$native" "$web" 2>&1 | head -n1);"
        fi
    done
    timing=$(tr -d '\n' <"$ROOT/$out/web/stderr.txt")
    echo "$result $d:$detail ($timing)"
    [ "$result" = PASS ] || failed=1
done
exit "$failed"
