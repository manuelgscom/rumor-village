#!/usr/bin/env bash
# Smoke test of a Linux prebuilt (an AppImage) in a clean container (phase 10).
#
#   scripts/dist-smoke.sh <file.AppImage> [--gpu] [--fuse] [--image <image>]
#                         [--port N] [--timeout S]
#
# Starts the AppImage, as a player would, in a container without the CUDA
# toolkit (ubuntu:22.04, or with --gpu or --fuse docker/smoke-desktop.Dockerfile,
# unless --image says another one, e.g. debian:12 or fedora:46):
# `<file.AppImage> --no-browser --data-dir <data> --port N`, with the data
# folder in build/dist-smoke/<name>-data/ (emptied first). A container has no
# FUSE, so by default the AppImage runs with APPIMAGE_EXTRACT_AND_RUN=1 (its
# runtime unpacks it into the container's /tmp and runs it from there). The
# container has no network but its own loopback (--network none); a second
# container in the same network namespace (the viewer image) asks GET /state
# until it answers, checks that "version" is dist/VERSION, prints
# ai.available, ai.reason and the hardware check, and ends the game with
# POST /quit. The console of the launcher is
# printed at the end. PASS or FAIL, and the exit status says the same.
#
#   --gpu       the container sees the GPU (--gpus all) and the shortcut holds
#               the GPU lock; the model of model.json is taken from models/ and
#               mounted read only in <data>/models/, so nothing is downloaded.
#               (model.json is dist/model.json, the one the AppImage carries.)
#               Then "Con IA" must be available.
#   --fuse      mount the AppImage for real, as a double click does: the
#               container gets /dev/fuse and SYS_ADMIN, and the image needs
#               fusermount3 (the default one has it).
#   --timeout   seconds to wait for GET /state (default 120; 600 with --gpu).
#
# The server only accepts Host 127.0.0.1:<port> or localhost:<port>, so the
# probe talks to it from inside the namespace, on the same port.
set -euo pipefail
. "$(dirname "$0")/viewer-lib.sh"  # ROOT, MODELS_DIR, gpu_locked, viewer_run

usage() {
    echo "usage: $0 <file.AppImage> [--gpu] [--fuse] [--image <image>] [--port N] [--timeout S]" >&2
    exit 2
}
archive="" gpu=0 fuse=0 image="" port=8080 timeout=""
while [ $# -gt 0 ]; do
    case $1 in
        --gpu) gpu=1 ;;
        --image) image=${2:-}; [ -n "$image" ] || usage; shift ;;
        --port) port=${2:-}; [[ $port =~ ^[0-9]+$ ]] || usage; shift ;;
        --fuse) fuse=1 ;;
        --timeout) timeout=${2:-}; [[ $timeout =~ ^[0-9]+$ ]] || usage; shift ;;
        -*) usage ;;
        *) [ -z "$archive" ] || usage; archive=$1 ;;
    esac
    shift
done
[ -n "$archive" ] || usage
case $archive in
    *.AppImage) ;;
    *.zip) echo "dist-smoke: Windows packages are tested in the VM (dist/windows/smoke.ps1)" >&2; exit 2 ;;
    *) usage ;;
esac
[ -f "$archive" ] || { echo "dist-smoke: no file $archive" >&2; exit 1; }
[ -n "$timeout" ] || { [ $gpu = 1 ] && timeout=600 || timeout=120; }
# With the GPU or FUSE, by default a clean Ubuntu with what any desktop has:
# the NVIDIA Vulkan driver (libGLX_nvidia) does not load without libX11, and
# the AppImage mounts itself with fusermount3.
if [ -z "$image" ]; then
    if [ $gpu = 1 ] || [ $fuse = 1 ]; then
        image=rumor-village-smoke-desktop:3
        docker image inspect "$image" >/dev/null 2>&1 ||
            docker build -q -f "$ROOT/docker/smoke-desktop.Dockerfile" -t "$image" "$ROOT/docker" >&2
    else
        image=ubuntu:22.04
    fi
fi

# Hold the GPU lock for the whole run (re-entering this script under it).
if [ $gpu = 1 ] && [ "${RUMOR_GPU_LOCKED:-0}" != 1 ]; then
    gpu_locked "$0" "$archive" --gpu --image "$image" --port "$port" --timeout "$timeout" \
        $([ $fuse = 1 ] && echo --fuse)
    exit
fi

name=$(basename "$archive" .AppImage)
file=$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")
[ -x "$file" ] || { echo "dist-smoke: $archive is not executable" >&2; exit 1; }
smoke=$ROOT/build/dist-smoke
data=$smoke/$name-data
version=$(tr -d '[:space:]' <"$ROOT/dist/VERSION")

rm -rf "$data"
mkdir -p "$smoke" "$data"

cname=rv-smoke-$$
run_args=(-d --name "$cname" --init --network none --user "$(id -u):$(id -g)" -e HOME=/tmp
    -v "$file:/app/$name.AppImage:ro" -v "$data:/data" -w /tmp)
if [ $fuse = 1 ]; then
    # fusermount3 wants the user in /etc/passwd: the image's plus the host user.
    passwd=$smoke/$name-passwd
    docker run --rm "$image" cat /etc/passwd >"$passwd"
    echo "player:x:$(id -u):$(id -g)::/tmp:/bin/sh" >>"$passwd"
    run_args+=(--device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor:unconfined
        -v "$passwd:/etc/passwd:ro")
else
    run_args+=(-e APPIMAGE_EXTRACT_AND_RUN=1)
fi
if [ $gpu = 1 ]; then
    # The model the package asks for: the model.json it was built with.
    model=$(sed -n 's/^ *"file": *"\([^"]*\)".*/\1/p' "$ROOT/dist/model.json")
    [ -f "$MODELS_DIR/$model" ] || { echo "dist-smoke: --gpu needs $MODELS_DIR/$model" >&2; exit 1; }
    mkdir -p "$data/models"
    run_args+=(--gpus all -e NVIDIA_DRIVER_CAPABILITIES=all -v "$MODELS_DIR/$model:/data/models/$model:ro")
fi
cmd=("/app/$name.AppImage" --no-browser --data-dir /data --port "$port")

cleanup() { docker rm -f "$cname" "$cname-probe" >/dev/null 2>&1 || true; }
trap cleanup EXIT
how=extracted
if [ $fuse = 1 ]; then how='mounted with FUSE'; fi
if [ $gpu = 1 ]; then how+=', with the GPU'; fi
echo "dist-smoke: $name in $image ($how): ${cmd[*]}" >&2
docker run "${run_args[@]}" "$image" "${cmd[@]}" >/dev/null

# The probe: waits for GET /state, prints a summary, then POST /quit. With
# --gpu it also waits for the hardware check, plays dist/drafts/default.json
# Con IA at full speed to its end, and says what the log header says
# (first start, criterion of docs/fases/fase-10.md).
probe='
const [port, timeout, gpu] = process.argv.slice(1).map(Number);
const base = `http://127.0.0.1:${port}`;
const t0 = Date.now();
const end = Date.now() + timeout * 1000;
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
const json = { "content-type": "application/json" };
let state = null;
while (Date.now() < end) {
  try {
    const r = await fetch(`${base}/state`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) { state = await r.json(); break; }
  } catch {}
  await new Promise((ok) => setTimeout(ok, 1000));
}
if (!state) { console.log("state=none"); process.exit(0); }
console.log(`version=${state.version}`);
console.log(`ai.available=${state.ai?.available}`);
console.log(`ai.reason=${state.ai?.reason ?? ""}`);
console.log(`check.state=${state.check?.state ?? ""}`);
console.log(`state=${state.state}`);
console.log(`t.state_s=${secs()}`);
if (gpu && state.ai?.available) {
  try {
    while (state.check?.state === "running" && Date.now() < end) {
      await new Promise((ok) => setTimeout(ok, 500));
      state = await (await fetch(`${base}/state`)).json();
    }
    console.log(`t.ready_s=${secs()}`);
    console.log(`check.final=${state.check?.state} dps=${state.check?.decisions_per_s} advice=${state.check?.advice}`);
    const draft = JSON.parse((await import("node:fs")).readFileSync("/work/dist/drafts/default.json", "utf8"));
    draft.settings.mode = "ai";
    const started = Date.now();
    let r = await fetch(`${base}/start`, { method: "POST", headers: json, body: JSON.stringify(draft) });
    const body = await r.json();
    console.log(`start=${r.status} ${JSON.stringify(body)}`);
    await fetch(`${base}/control`, { method: "POST", headers: json, body: JSON.stringify({ speed: "max" }) });
    while (Date.now() < end) {
      state = await (await fetch(`${base}/state`)).json();
      if (state.state === "ended") break;
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    console.log(`game.state=${state.state} game_s=${((Date.now() - started) / 1000).toFixed(1)}`);
    const id = body.game?.id;
    if (id) {
      const log = await (await fetch(`${base}/games/${id}.jsonl`)).text();
      const lines = log.trim().split("\n");
      const head = JSON.parse(lines[0]);
      const last = JSON.parse(lines[lines.length - 1]);
      console.log(`game.policy=${head.policy}`);
      console.log(`game.model=${head.model?.file ?? head.model?.name ?? JSON.stringify(head.model)}`);
      console.log(`game.lines=${lines.length} last=${last.type} tick=${last.tick}`);
    }
  } catch (e) { console.log(`game=error ${e.message}`); }
}
try {
  const r = await fetch(`${base}/quit`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  console.log(`quit=${r.status}`);
} catch (e) { console.log(`quit=error ${e.message}`); }
'
probe_out=$smoke/$name-probe.txt
viewer_run --name "$cname-probe" --network "container:$cname" -- \
    node --input-type=module -e "$probe" "$port" "$timeout" "$gpu" >"$probe_out" 2>&1 &
probe_pid=$!
# If the package dies before it answers, stop waiting for it.
while kill -0 "$probe_pid" 2>/dev/null; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$cname" 2>/dev/null)" != true ]; then
        sleep 2
        docker rm -f "$cname-probe" >/dev/null 2>&1 || true
        break
    fi
    sleep 1
done
wait "$probe_pid" 2>/dev/null || true
out=$(cat "$probe_out")
rm -f "$probe_out"

# After /quit the process must end by itself.
exit_code=""
for _ in $(seq 1 30); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$cname" 2>/dev/null)" != true ]; then
        exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$cname")
        break
    fi
    sleep 1
done

echo "--- console of the launcher ---"
docker logs "$cname" 2>&1 | tail -n 60
echo "--- GET /state ---"
echo "$out"

field() { printf '%s\n' "$out" | sed -n "s/^$1=//p" | head -n1; }
fails=()
if [ "$(field state)" = none ] || [ -z "$(field state)" ]; then
    if [ -n "$exit_code" ]; then
        fails+=("the package ended before GET /state answered (exit code $exit_code; see its console)")
    else
        fails+=("GET /state did not answer in ${timeout}s")
    fi
fi
[ "$(field version)" = "$version" ] || fails+=("version '$(field version)' is not dist/VERSION '$version'")
[[ $(field quit) == 2?? ]] || fails+=("POST /quit: $(field quit)")
[ "$exit_code" = 0 ] || fails+=("the process did not end cleanly after /quit (exit code '${exit_code:-still running}')")
if [ $gpu = 1 ] && [ "$(field ai.available)" != true ]; then
    fails+=("Con IA is not available with the GPU: $(field ai.reason)")
fi
if [ $gpu = 1 ]; then
    [ "$(field game.state | cut -d' ' -f1)" = ended ] || fails+=("the Con IA game did not end: $(field game.state) $(field game)")
    [ "$(field game.policy)" = model ] || fails+=("the game was not played by the model: policy $(field game.policy)")
fi
echo "AI reason: $(field ai.reason)"

if [ ${#fails[@]} -eq 0 ]; then
    echo "PASS $name ($image, $how)"
else
    printf 'FAIL: %s\n' "${fails[@]}"
    echo "FAIL $name ($image, $how)"
    exit 1
fi
