#!/usr/bin/env bash
# Smoke test of the web version Sin IA (phase 10, package F): mounts the site
# in a folder of build/wasm/site/ (sub/), serves it with viewer/tools/static.mjs
# on 127.0.0.1 inside the viewer container and plays whole games in headless
# Chromium (viewer/tools/shot.mjs), with no console error allowed:
#
#   A  a free game from the menu; a reload half way gets the same game back;
#      the end at full speed (POST control "max"), the label «Sin IA» on screen
#   B  the same with localStorage and sessionStorage blocked
#   C  (--code) a «Reto del amigo» code opens the same game: the web log is the
#      one `rumor play --once` gives for the draft of the code (sha256)
#
#   scripts/wasm-smoke.sh                     A and B
#   scripts/wasm-smoke.sh --code RV1-…        A, B and C with that code
#   scripts/wasm-smoke.sh --code desktop      A, B and C with the code of a game
#                                             played natively (dist/drafts/village-100-en.json)
#
# Writes docs/fases/capturas/fase-10/web-smoke.txt and the pictures of the
# games ended there (web-partida.png, web-reto.png). Exit 1 on any failure.
set -euo pipefail
. "$(dirname "$0")/wasm-lib.sh"
. "$ROOT/scripts/viewer-lib.sh"
. "$ROOT/scripts/engine-lib.sh"

code=""
while [ $# -gt 0 ]; do
    case $1 in
        --code) code=${2:?usage: scripts/wasm-smoke.sh [--code <code>|desktop]}; shift 2 ;;
        *) echo "usage: scripts/wasm-smoke.sh [--code <code>|desktop]" >&2; exit 2 ;;
    esac
done

[ -f "$ROOT/$WASM_OUT/rumor_web.js" ] || "$ROOT/scripts/wasm-build.sh"
caps=docs/fases/capturas/fase-10
work=build/wasm/smoke
mkdir -p "$ROOT/$caps"
rm -rf "${ROOT:?}/$work"
mkdir -p "$ROOT/$work"

# The site: what the page needs of viewer/ (no tools, fixtures or tests) and
# the engine in wasm/, next to play-web.html (js/web/install.js WASM_MODULE).
site=build/wasm/site
rm -rf "${ROOT:?}/$site"
mkdir -p "$ROOT/$site/sub/wasm"
cp -r "$ROOT/viewer/play-web.html" "$ROOT/viewer/assets" "$ROOT/viewer/css" "$ROOT/viewer/js" "$ROOT/viewer/vendor" "$ROOT/$site/sub/"
find "$ROOT/$site/sub/js" \( -name '*.test.js' -o -name 'testing.js' -o -name '*.mjs' \) -delete
cp "$ROOT/$WASM_OUT/rumor_web.js" "$ROOT/$WASM_OUT/rumor_web.wasm" "$ROOT/$site/sub/wasm/"

# A code made on the desktop: the end card encodes the game data (endview.js).
if [ "$code" = desktop ]; then
    engine_run build/engine/rumor play --once dist/drafts/village-100-en.json --out "$work/desktop" >/dev/null
    game=$(ls "$ROOT/$work/desktop/"*.game.json)
    code=$(viewer_run -- node --input-type=module -e "
        import { readFileSync } from 'node:fs';
        import { encodeCode } from './viewer/js/game/score/code.js';
        const g = JSON.parse(readFileSync('${game#"$ROOT"/}', 'utf8'));
        console.log(encodeCode({ mode: g.settings.mode, settings: g.settings, rumors: g.rumors, challenge: g.challenge, bets: g.bets, race: g.race, score: null }));")
fi

page=http://127.0.0.1:8123/sub/play-web.html
# A game from the menu to its end: steps of shot.mjs (each prints "eval: …").
# «Partida libre» opens with the example rumor ready («Rumor listo»); without
# storage the viewer forgets it across the reload of the new town, so the
# player picks it: «Usar este ejemplo» and a neighbor.
start_a=(
    --click '[data-gm="menu-free"]'
    --until-phase prepare
    --click '[data-gm="start"]'
)
start_b=(
    --click '[data-gm="menu-free"]'
    --until-phase prepare
    --click '[data-gm="rumor-example"]'
    --sleep 500
    --click '[data-gm="neighbor-card"]'
    --sleep 1000
    --click '[data-gm="start"]'
)
game_steps=(
    --until-phase playing
    --until 'rumorWeb.stats().released >= 3'
    --eval "fetch('state').then((r) => r.json()).then((s) => ({ step: 'before', id: s.game.id, state: s.state, released: rumorWeb.stats().released, persistent: rumorWeb.persistent() }))"
    --reload 1
    --until-phase playing
    --eval "fetch('state').then((r) => r.json()).then((s) => ({ step: 'after', id: s.game.id, state: s.state, released: rumorWeb.stats().released, persistent: rumorWeb.persistent() }))"
    --eval "fetch('control', { method: 'POST', body: JSON.stringify({ speed: 'max' }) }).then((r) => r.json()).then((c) => ({ step: 'max', speed: c.speed, t: Date.now() }))"
    --until-phase ended
    --until "/Sin IA|Without AI/.test(document.querySelector('[data-gm=\"mode-label\"]')?.textContent ?? '')"
    --sleep 1500
    --eval "({ step: 'end', label: document.querySelector('[data-gm=\"mode-label\"]').textContent.trim(), download: !!document.querySelector('[data-gm=\"download\"]'), stats: rumorWeb.stats(), t: Date.now() })"
)
# «Mis partidas»: the game just played, opened again (computed again from its draft).
replay_steps=(
    --eval "fetch('state').then((r) => r.json()).then((s) => { location.href = '?log=' + encodeURIComponent('games/' + s.game.id + '.jsonl') + '&game=' + s.game.id + '&lang=es&tour=0'; return { step: 'open', id: s.game.id }; })"
    --until "location.search.includes('log=') && document.documentElement.dataset.game === 'replay' && !!document.documentElement.dataset.ready"
    --until "(window.rumorApp?.store?.events ?? []).some((e) => e.type === 'end')"
    --eval "({ step: 'replay', events: window.rumorApp.store.events.length, title: document.querySelector('.gm-bar-title')?.textContent ?? null })"
)
code_steps=(
    --until-phase prepare
    --click '[data-gm="start"]'
    --until-phase playing
    --eval "fetch('control', { method: 'POST', body: JSON.stringify({ speed: 'max' }) }).then((r) => r.json()).then((c) => ({ step: 'max', speed: c.speed, t: Date.now() }))"
    --until-phase ended
    --until "/Sin IA|Without AI/.test(document.querySelector('[data-gm=\"mode-label\"]')?.textContent ?? '')"
    --sleep 1500
    --eval "(async () => { const s = await (await fetch('state')).json(); const log = await (await fetch('games/' + s.game.id + '.jsonl')).text(); const game = await (await fetch('games/' + s.game.id + '.game.json')).json(); const t = Date.now(); const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(log)))].map((b) => b.toString(16).padStart(2, '0')).join(''); return { step: 'code', id: s.game.id, sha256: hash, lines: log.split('\n').length - 1, draft: { settings: game.settings, rumors: game.rumors, challenge: game.challenge, bets: game.bets, race: game.race }, label: document.querySelector('[data-gm=\"mode-label\"]').textContent.trim(), stats: rumorWeb.stats(), t }; })()"
)

q() { printf '%q ' "$@"; }
script="
set -e
node viewer/tools/static.mjs --root $site --host 127.0.0.1 --port 8123 >$work/static.log 2>&1 &
for i in \$(seq 50); do node -e \"fetch('$page').then(() => process.exit(0), () => process.exit(1))\" && break; sleep 0.2; done
node -e \"fetch('http://127.0.0.1:8123/sub/wasm/rumor_web.wasm').then((r) => console.log('wasm served as ' + r.headers.get('content-type')))\"
echo '== A: a free game, a reload half way, the end =='
node viewer/tools/shot.mjs --base $page --query '?lang=es' --out $caps/web-partida.png $(q "${start_a[@]}" "${game_steps[@]}") >$work/a.out 2>$work/a.err || { cat $work/a.err; exit 1; }
cat $work/a.out
echo '== B: the same with the storage blocked =='
node viewer/tools/shot.mjs --base $page --query '?lang=es' --out $work/blocked.png --block-storage 1 $(q "${start_b[@]}" "${game_steps[@]}" "${replay_steps[@]}") >$work/b.out 2>$work/b.err || { cat $work/b.err; exit 1; }
cat $work/b.out
"
if [ -n "$code" ]; then
    script+="
echo '== C: a «Reto del amigo» code =='
node viewer/tools/shot.mjs --base $page --query $(q "?play=1&code=$code") --out $caps/web-reto.png $(q "${code_steps[@]}") >$work/c.out 2>$work/c.err || { cat $work/c.err; exit 1; }
cat $work/c.out
"
fi

{
    echo "# scripts/wasm-smoke.sh${code:+ --code …} ($(date -u +%Y-%m-%dT%H:%M:%SZ), $(git -C "$ROOT" describe --always --dirty))"
    ls -l "$ROOT/$WASM_OUT/rumor_web.js" "$ROOT/$WASM_OUT/rumor_web.wasm" | awk '{print $5, $9}' | sed "s|$ROOT/||"
    viewer_run -- bash -c "$script"
} 2>&1 | tee "$ROOT/$work/run.txt" && run_status=0 || run_status=$?

# The checks, on what the pages said.
checks=$(viewer_run -- node --input-type=module -e "
import { readFileSync, existsSync } from 'node:fs';
const read = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('eval: ')).map((l) => JSON.parse(l.slice(6))) : null;
const out = [];
let ok = true;
const check = (name, cond, detail = '') => { out.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ': ' + detail : '')); ok = ok && !!cond; };
for (const [name, file, persistent] of [['A', '$work/a.out', true], ['B', '$work/b.out', false]]) {
  const e = read(file);
  if (!e) { check(name, false, 'no output'); continue; }
  const by = Object.fromEntries(e.map((x) => [x.step, x]));
  check(name + ' playing before the reload', by.before?.state === 'playing', 'game ' + by.before?.id + ', ' + by.before?.released + ' ticks out');
  check(name + ' the reload gets the same game back', by.after?.id === by.before?.id && by.after?.state === 'playing' && by.after?.released >= by.before?.released, by.after?.released + ' ticks out after it');
  check(name + ' storage ' + (persistent ? 'usable' : 'blocked'), by.after?.persistent === persistent);
  check(name + ' the game ends with «Sin IA» on screen', by.end?.stats?.state === 'ended' && /Sin IA/.test(by.end?.label ?? ''), JSON.stringify(by.end?.label));
  const s = by.end?.stats ?? {};
  out.push('     ' + name + ' engine: ' + s.ticks + ' ticks, ' + s.lines + ' lines in ' + (s.computeMs ?? 0).toFixed(1) + ' ms (' + Math.round(s.ticks * 1000 / s.computeMs) + ' ticks/s); from "max" to the end on screen ' + (by.end?.t - by.max?.t) + ' ms');
  if (by.open) check(name + ' «Mis partidas» opens the game again', by.replay?.events > 0, by.replay?.events + ' events, ' + JSON.stringify(by.replay?.title));
}
const c = read('$work/c.out');
if (c) {
  const x = c.find((e) => e.step === 'code');
  const m = c.find((e) => e.step === 'max');
  check('C the code is played to its end, «Sin IA» (Without AI in English)', !!x && /Sin IA|Without AI/.test(x.label), x ? x.id + ', ' + x.lines + ' lines, sha256 ' + x.sha256 : 'no result');
  if (x) {
    const s = x.stats;
    out.push('     C engine: ' + s.ticks + ' ticks, ' + s.lines + ' lines in ' + s.computeMs.toFixed(1) + ' ms (' + Math.round(s.ticks * 1000 / s.computeMs) + ' ticks/s); from "max" to the end on screen ' + (x.t - m?.t) + ' ms');
    console.error(JSON.stringify(x.draft));
  }
}
console.log(out.join('\n'));
process.exit(ok ? 0 : 1);
" 2>"$ROOT/$work/c-draft.json") && status=0 || status=$?
[ "$run_status" = 0 ] || status=1

# C: the same draft natively, and the two logs.
if [ -n "$code" ] && grep -q '^{' "$ROOT/$work/c-draft.json" 2>/dev/null; then
    engine_run build/engine/rumor play --once "$work/c-draft.json" --out "$work/native" >/dev/null
    native=$(ls "$ROOT/$work/native/"*.jsonl | grep -v '\.cards\.jsonl$')
    want=$(sha256sum "$native" | cut -d' ' -f1)
    got=$(grep -o '"sha256":"[0-9a-f]*"' "$ROOT/$work/c.out" | cut -d'"' -f4)
    if [ "$want" = "$got" ]; then
        checks+=$'\n'"PASS C the web log is the native one of the draft of the code (sha256 $want)"
    else
        checks+=$'\n'"FAIL C the web log differs from the native one ($got vs $want)"
        status=1
    fi
fi
echo "$checks" | tee -a "$ROOT/$work/run.txt"
{
    cat "$ROOT/$work/run.txt"
    [ -n "$code" ] && echo "code: $code"
} >"$ROOT/$caps/web-smoke.txt"
[ "$status" = 0 ] && echo "wasm-smoke: PASS" | tee -a "$ROOT/$caps/web-smoke.txt" || { echo "wasm-smoke: FAIL" | tee -a "$ROOT/$caps/web-smoke.txt"; exit 1; }
