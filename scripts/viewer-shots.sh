#!/usr/bin/env bash
# Take the screenshots of the "Resultados" tables of the viewer phases, a few
# at a time: phase 8-2 (visual impact) into docs/fases/capturas/fase-8-2/<name>.png,
# with --phase 8-1 the start screen, story mode and views into
# docs/fases/capturas/fase-8-1/, and with --phase 7 the ones of the 3D viewer
# into docs/fases/capturas/fase-7/ (shown in the full view, as then), and with
# --phase 9 the game screens into docs/fases/capturas/fase-9/.
#
#   scripts/viewer-shots.sh                 # phase 8-2
#   scripts/viewer-shots.sh --phase 8-1     # phase 8-1
#   scripts/viewer-shots.sh --twice rastro-dia   # shoot it twice and cmp (clock=0 repeats)
#   scripts/viewer-shots.sh --phase 7       # phase 7
#   scripts/viewer-shots.sh --phase 7 --live  # also the live one: needs scripts/serve.sh party-25 1 running
#   scripts/viewer-shots.sh historia-1 movil  # only these names
#   VIEWER_SHOTS_DIR=build/shots/all scripts/viewer-shots.sh   # elsewhere (repo-relative)
#   scripts/viewer-shots.sh --phase 9 menu preparar            # needs ./play.sh running
#   scripts/viewer-shots.sh --phase 9 --base http://127.0.0.1:8081/ menu
#
# Edit the tables below: one row per view, "name|query" or "name|query|options"
# (the query of /viewer/index.html; options "size=WxH" and "expect=error|loading",
# comma-separated, see scripts/viewer-shot.sh). The live view is apart because
# it needs the engine. A console error on the page fails the shot.
#
# Phase 9 rows are pages of a running `rumor play` (./play.sh), so they always
# use --base (default http://127.0.0.1:8080/) and are taken one at a time.
# What they show depends on the state of the running game: the orchestrator
# takes them in order, by name, setting the game up between calls (boot, menu,
# preparar, mis-partidas, tutorial and que-penso with the village waiting or
# after a game; carrera during a race game; final-juego after a game ended).
set -euo pipefail
. "$(dirname "$0")/viewer-lib.sh"

P100=/runs/samples/party-100-es-s2.jsonl
P25=/runs/samples/party-25-en-s4.jsonl
TEL=/runs/samples/telephone-20-es-s5.jsonl
HAND=/viewer/fixtures/hand-text.jsonl
BASE25=/runs/eval/base/party-25-es/seed-1.jsonl  # local only (runs/eval is not in git)
FT25=/runs/eval/ft/party-25-es/seed-1.jsonl

SHOTS_7=(
    "lejos-dia|?log=$P100&zoom=far&t=1000&paused=1"
    "lejos-noche|?log=$P100&zoom=far&t=1300&paused=1"
    "media|?log=$P100&zoom=mid&focus=bar&t=1055.5&paused=1"
    "cerca-texto|?log=$HAND&zoom=near&focus=bar&t=1216.5&paused=1"
    "cerca-claim|?log=$P25&zoom=near&focus=n001&t=455.5&paused=1"
    "onda|?log=$P100&zoom=mid&focus=n003&t=479.6&paused=1"
    "cadena|?log=$HAND&select=n005&t=1440&paused=1"
    "consecuencias|?log=$P100&t=1440&paused=1"
    "culpable|?log=$P100&group=other_time&t=1110&paused=1"
    "grafo|?log=$P100&select=n045&t=1440&paused=1"
    "rebobinado-antes|?log=$P100&t=1300&paused=1"
    "rebobinado-despues|?log=$P100&t=700&paused=1"
    "panel-lote|?log=$HAND&t=1211.5&paused=1"
    "telefono|?log=$TEL&t=1210.5&paused=1"
    "ficha|?log=$P100&select=n003&t=1440&paused=1"
    "director|?log=$P100&t=1250&paused=1&director=1"
    "resumen|?log=$P100&t=1440&paused=1&summary=1"
    "noche-cerca|?log=$P100&zoom=near&focus=square&t=1290&paused=1"
    "partida|?left=$P100&right=$P100&t=1250&paused=1"
    "ingles|?log=$P25&t=1000&paused=1"
)
SHOTS_81=(
    "portada-en|?lang=en&manifest=/runs/samples/manifest.json"
    "portada-es|?lang=es&manifest=/runs/samples/manifest.json"
    "carga|?log=$P100&hold=1|expect=loading"
    "error|?log=/runs/samples/no-such-recording.jsonl&lang=es|expect=error"
    "historia-1|?log=$P100&tour=1&chapter=1&paused=1"
    "historia-2|?log=$P100&tour=1&chapter=2&paused=1"
    "historia-3|?log=$P100&tour=1&chapter=3&paused=1"
    "historia-4|?log=$P100&tour=1&chapter=4&paused=1"
    "historia-5|?log=$P100&tour=1&chapter=5&paused=1"
    "historia-6|?log=$HAND&tour=1&chapter=6&paused=1"
    "historia-7|?log=$P100&tour=1&chapter=7&paused=1"
    "vista-sencilla|?log=$P100&t=1100&paused=1&ui=simple"
    "vista-tecnica|?log=$HAND&t=1211.5&paused=1&ui=tech"
    "rotulo-info|?log=$P100&t=1100&paused=1&open=info"
    "pasar-raton|?log=$P100&zoom=mid&focus=bar&t=1055.5&paused=1&hover=n073"
    "fichas-forma|?log=$P100&zoom=16&focus=n008&t=1100&paused=1"
    "portatil|?log=$P100&t=1440&paused=1&summary=1|size=1366x768"
    "movil|?log=$P100&tour=1&chapter=3&paused=1|size=390x844"
)
# Phase 8-2: every row has clock=0 (decorative time fixed), so two shots of a
# row are the same file. The recordings start at 07:00, so «amanecer» is the
# low sun of the first minutes.
SHOTS_82=(
    "rastro-dia|?log=$P100&zoom=far&t=1000&paused=1&clock=0"
    "rastro-noche|?log=$P100&zoom=far&t=1300&paused=1&clock=0"
    "amanecer|?log=$P100&zoom=far&t=425&paused=1&clock=0"
    "atardecer|?log=$P100&zoom=far&t=1255&paused=1&clock=0"
    "noche-lejos|?log=$P100&zoom=far&t=1380&paused=1&clock=0"
    "rio|?log=$P100&zoom=near&focus=p12&t=900&paused=1&clock=0"
    "faros|?log=$P100&t=1275&paused=1&clock=0"
    "cadena-foco|?log=$P100&select=n003&t=1440&paused=1&clock=0"
    "apertura|?log=$P100&opening=0.4&t=1000&paused=1&clock=0"
    "iconos|?log=$P100&zoom=near&focus=n003&t=479.6&paused=1&clock=0"
    "llegada|?log=$P100&zoom=near&focus=p01&t=1261.5&paused=1&clock=0"
    "retratos|?log=$P100&t=1440&paused=1&summary=ranking&clock=0"
    "tarjeta-final|?log=$P100&t=1440&paused=1&summary=1&clock=0"
    "partida-marcador|?left=$BASE25&right=$FT25&labels=base,ft&t=1250&paused=1&clock=0"
    "telefono-tira|?log=$TEL&t=1210.5&paused=1&clock=0"
    "plaza-llena|?log=$P100&zoom=mid&focus=square&t=1303&paused=1&clock=0"
    "calidad-baja|?log=$P100&zoom=far&t=1000&paused=1&q=low&clock=0"
    "foto|?log=$P100&zoom=far&t=1250&paused=1&photo=1&clock=0"
)
# Phase 9: the game, on the page served by `rumor play` (see above).
SHOTS_9=(
    "modo-sin-ia|?play=1&lang=es&screen=boot"
    "menu|?play=1&lang=es&screen=menu"
    "preparar|?play=1&lang=es&screen=prepare"
    "mis-partidas|?play=1&lang=es&screen=games"
    "final-juego|?play=1&lang=es"
    "carrera|?play=1&lang=es"
    "que-penso|?play=1&lang=es&select=n001&open=inspect"
    "tutorial|?play=1&lang=es&screen=tutorial"
)
LIVE_SHOT="directo|http://127.0.0.1:8080/|?live=1&draft=fiesta|plaza|hoy 21:00|bar"
JOBS=${VIEWER_SHOT_JOBS:-4}

live=0 phase=8-2 only=() twice=0 base=""
while [ $# -gt 0 ]; do
    case $1 in
        --live) live=1 ;;
        --base) base=${2:?}; shift ;;
        --twice) twice=1 ;;
        --phase) phase=${2:?}; shift ;;
        *) only+=("$1") ;;
    esac
    shift
done
case $phase in
    7) SHOTS=("${SHOTS_7[@]}") ;;
    8-1) SHOTS=("${SHOTS_81[@]}") ;;
    8-2) SHOTS=("${SHOTS_82[@]}") ;;
    9) SHOTS=("${SHOTS_9[@]}") ;;
    *) echo "viewer-shots: unknown phase $phase (7, 8-1, 8-2 or 9)" >&2; exit 2 ;;
esac
[ "$live" = 1 ] && [ "$phase" != 7 ] && { echo "viewer-shots: --live goes with --phase 7" >&2; exit 2; }
[ -n "$base" ] && [ "$phase" != 9 ] && { echo "viewer-shots: --base goes with --phase 9" >&2; exit 2; }
# Phase 9: the running game is one, so its shots go one at a time.
if [ "$phase" = 9 ]; then
    base=${base:-http://127.0.0.1:8080/}
    base=${base%/}/
    JOBS=1
fi

out=${VIEWER_SHOTS_DIR:-docs/fases/capturas/fase-$phase}
mkdir -p "$ROOT/$out"
logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT
viewer_image

wanted() {
    [ ${#only[@]} -eq 0 ] && return 0
    local n
    for n in "${only[@]}"; do [ "$n" = "$1" ] && return 0; done
    return 1
}

shot() {  # shot <name> <args of viewer-shot.sh...>
    local name=$1
    shift
    if "$ROOT/scripts/viewer-shot.sh" "$@" >"$logs/$name.log" 2>&1; then
        echo "ok    $name"
    else
        echo "FAIL  $name"
        sed 's/^/      /' "$logs/$name.log"
        touch "$logs/$name.failed"
    fi
}

for row in "${SHOTS[@]}"; do
    IFS='|' read -r name query opts <<<"$row"
    wanted "$name" || continue
    [ "$phase" = 7 ] && query="$query&ui=full"
    args=()
    [ -n "$base" ] && args+=(--base "$base")
    IFS=',' read -ra kv <<<"${opts:-}"
    for o in "${kv[@]}"; do
        case $o in
            size=*) args+=(--size "${o#size=}") ;;
            expect=*) args+=(--expect "${o#expect=}") ;;
            '') ;;
            *) echo "viewer-shots: bad option $o in $name" >&2; exit 2 ;;
        esac
    done
    while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n || true; done
    shot "$name" "${args[@]}" "$query" "$out/$name.png" &
    if [ "$twice" = 1 ]; then
        while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n || true; done
        shot "$name.again" "${args[@]}" "$query" "$out/$name.again.png" &
    fi
done
wait

# --twice: both shots of a row must be the same file (clock=0 makes them repeat).
if [ "$twice" = 1 ]; then
    for row in "${SHOTS[@]}"; do
        IFS='|' read -r name _ <<<"$row"
        wanted "$name" || continue
        [ -f "$ROOT/$out/$name.again.png" ] || continue
        if cmp -s "$ROOT/$out/$name.png" "$ROOT/$out/$name.again.png"; then
            echo "same  $name"
        else
            echo "DIFF  $name"
            touch "$logs/$name.differs"
        fi
        rm -f "$ROOT/$out/$name.again.png"
    done
    if compgen -G "$logs/*.differs" >/dev/null; then exit 1; fi
fi

if [ "$live" = 1 ]; then
    IFS='|' read -r name base query <<<"$LIVE_SHOT"
    shot "$name" --base "$base" "$query&ui=full" "$out/$name.png"
fi

if compgen -G "$logs/*.failed" >/dev/null; then
    exit 1
fi
