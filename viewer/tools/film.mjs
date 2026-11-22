// Film of the viewer, frame by frame, with headless Chromium over the DevTools
// protocol (phase 11, 11.7). Deterministic: the page runs on Chromium's
// virtual time, which advances exactly 1/fps per frame (requestAnimationFrame,
// performance.now and CSS transitions alike); on top of that each frame seeks
// the replay to its tick, fixes the decorative clock and places the camera.
// The frames are piped to ffmpeg.
//
//   node viewer/tools/film.mjs [--shots viewer/tools/film-shots.json] [--only a,b] [--lang es|en]
//                              [--workers N] [--gpu 1] [--frames DIR] [--size WxH]
//
// Each shot goes to <out>/<lang>/<id>.mp4 (default out: build/promo/footage),
// Chromium's own log to <logs>/film-<lang>-<id>.chromium.log (build/promo/logs).
// The games are served by the game server (`rumor play --out runs/demo`, no
// model; scripts/viewer-film.sh starts it) at --base (http://127.0.0.1:8098/).
//
//   --shots FILE   {"shots": [shot, ...]}
//   --only a,b     only these shot ids
//   --lang es|en   only the shots of this language
//   --workers N    N shots at once, each with its own Chromium (default 1)
//   --gpu 1        draw on the NVIDIA card instead of SwiftShader; fails if
//                  Chromium still gets a software renderer
//   --frames DIR   also keep the PNG frames, in DIR/<lang>/<id>/ (to compare two films)
//   --size WxH     tests and previews only: film every shot at this size
//   --fps N        film every shot at N fps (same seconds; holds scaled)
//   --capture jpeg capture JPEG (quality 95) instead of PNG: faster, invisible after H.264
//   --out DIR · --logs DIR · --base URL · --root DIR · --crf N (12) · --chromium BIN
//
// A shot:
//   { "id": "j3-aerial",                      file name; [A-Za-z0-9_-]
//     "source": "20261119-220615-ai-t417",    id of runs/demo/manifest.json (promo/tools/check-sources.mjs)
//     "lang": "es",                           optional; must be the game's language (default: it)
//     "size": "1920x1080",                    1920x1080, 1080x1920 or 1080x1080
//     "fps": 30, "seconds": 4,
//     "ticks": [[0, 1100], [1, 1300]],        keyframes [fraction of the shot, tick]
//     "tickEase": "linear",                   linear (default), inOut, in, out
//     "camera": [[0, {"x": 500, "y": 350, "zoom": 1}], [1, {"x": 500, "y": 350, "zoom": 3}]],
//     "follow": "n006",                       instead of camera x/y: centre on this neighbor
//     "followSmooth": 0.5,                    seconds of the centred window that smooths it
//     "ease": "inOut",                        easing of the camera (default inOut)
//     "warm": 1,                              seconds of virtual time on the first state (models, fades)
//     "ui": "photo",                          photo (default): only the scene; game: the game's interface
//     "query": {"select": "n006"},            extra URL parameters (object or "a=1&b=2")
//     "steps": ["rumorApp.bus.emit('inspect', {neighbor: 'n006'})"],  JS run once, before the warm-up
//     "holds": [[1, 15]] }                    freezes: [fraction, n] repeats that frame n more times
//
// Ticks and camera are interpolated between keyframes (fractions 0..1 of the
// shot); the camera zoom is relative to the fitted view (camera.base) and moves
// geometrically. Without "camera" and "follow" the viewer's camera is left alone.
// With "follow", "camera" may still give the zoom (its x and y are ignored).
//
// The URL is built from the source (buildUrl): log=games/<id>.jsonl&game=<id>,
// the game's lang, tour=0, paused=1, t=<first tick>, photo=1 for ui "photo",
// the extra query, and always q=high and clock=0 (without them the film is not
// deterministic).
//
// Follow: the viewer already knows where a neighbor is drawn at any position,
// rumorApp.positionOf(id) (package A, render/view.js: routes, crowd spots and
// glides; a pure function of the state and the position). Before filming, a
// pass seeks every frame's tick and reads it; the path is then smoothed with a
// centred triangular window (smoothPath), so the camera neither lags nor shakes,
// and the same shot always gives the same path.
//
// Steps run with the virtual time paused and the warm-up lets what they start
// (panels, fades) finish. They should be synchronous: a step that waits on a
// timer would wait for ever. Virtual time does not advance while a fetch of the
// page is pending (pauseIfNetworkFetchesPending), so a card asked to the server
// lands at the same virtual moment every time.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSources } from '../../promo/tools/check-sources.mjs';
import { evaluate, launch, rendererOf, waitReady } from './cdp.mjs';

const TIMEOUT_MS = 120000;
/** Frames drawn and dropped before the first one (filmShot). */
const PREROLL = 2;

/** The sizes of the promo material (docs/guion.md): landscape, vertical, square. */
export const SIZES = ['1920x1080', '1080x1920', '1080x1080'];

export const EASE = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
  in: (k) => k * k * k,
};

/** The value at fraction f of keyframes [[f0, v0], [f1, v1], …] (numbers or flat objects). */
export function interpolate(keys, f, ease = EASE.linear) {
  if (!keys?.length) return null;
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1] = keys[i];
    if (f <= f1) {
      const [f0, v0] = keys[i - 1];
      const k = ease(f1 > f0 ? (f - f0) / (f1 - f0) : 1);
      if (typeof v0 === 'number') return v0 + (v1 - v0) * k;
      const out = {};
      for (const key of Object.keys(v1)) {
        const a = v0[key] ?? v1[key];
        // The zoom moves geometrically, so a push-in feels even.
        out[key] = key === 'zoom' ? a * Math.pow(v1[key] / a, k) : a + (v1[key] - a) * k;
      }
      return out;
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * A path of points [x, y] smoothed with a centred triangular window of
 * `radius` points each side (the ends repeat the first and last point).
 */
export function smoothPath(points, radius) {
  const r = Math.max(0, Math.floor(radius));
  if (!r || points.length < 2) return points.map(([x, y]) => [x, y]);
  const last = points.length - 1;
  return points.map((_, i) => {
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let k = -r; k <= r; k++) {
      const w = r + 1 - Math.abs(k);
      const [x, y] = points[Math.min(last, Math.max(0, i + k))];
      sx += w * x;
      sy += w * y;
      sw += w;
    }
    return [sx / sw, sy / sw];
  });
}

/**
 * The viewer URL of a shot, from its source game.
 * @param {{source: string, ui?: string, query?: object|string}} shot
 * @param {{base: string, lang: string, tick: number}} at
 */
export function buildUrl(shot, { base, lang, tick }) {
  const q = new URLSearchParams();
  q.set('log', `games/${shot.source}.jsonl`);
  q.set('game', shot.source);
  q.set('lang', lang);
  q.set('tour', '0');
  q.set('paused', '1');
  if ((shot.ui ?? 'photo') === 'photo') q.set('photo', '1');
  const extra = typeof shot.query === 'string' ? new URLSearchParams(shot.query.replace(/^[?&]/, '')) : Object.entries(shot.query ?? {});
  for (const [k, v] of extra) q.set(k, String(v));
  // Always, whatever the extra query says: the film is deterministic only so.
  q.set('q', 'high');
  q.set('clock', '0');
  q.set('t', String(tick));
  return `${base}?${q}`;
}

const fail = (shot, msg) => {
  throw new Error(`film: shot ${shot?.id ?? '?'}: ${msg}`);
};

function checkKeys(shot, name, keys, isValue) {
  if (!Array.isArray(keys) || !keys.length) fail(shot, `${name} must be a list of [fraction, value]`);
  let prev = -Infinity;
  for (const k of keys) {
    if (!Array.isArray(k) || k.length !== 2 || typeof k[0] !== 'number' || k[0] < 0 || k[0] > 1 || k[0] < prev || !isValue(k[1]))
      fail(shot, `bad ${name} key ${JSON.stringify(k)}`);
    prev = k[0];
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Checks a shot and works out what filming it needs.
 * @param {object} shot as in the file
 * @param {{header: object, base: string, size?: string}} ctx header of its source; size overrides (tests)
 */
export function planShot(shot, { header, base, size = '', fps: fpsOverride = 0 }) {
  if (typeof shot?.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(shot.id)) fail(shot, 'id must be [A-Za-z0-9_-]');
  const sz = size || shot.size || '1920x1080';
  if (!size && !SIZES.includes(sz)) fail(shot, `size ${sz} is not one of ${SIZES.join(', ')}`);
  const m = /^(\d+)x(\d+)$/.exec(sz);
  if (!m || Number(m[1]) % 2 || Number(m[2]) % 2) fail(shot, `bad size ${sz} (even WxH)`);
  const ownFps = shot.fps ?? 30;
  if (!Number.isInteger(ownFps) || ownFps < 1 || ownFps > 120) fail(shot, `bad fps ${ownFps}`);
  // --fps N films every shot at N fps: same seconds, holds scaled to last as long.
  const fps = fpsOverride || ownFps;
  const holdScale = fps / ownFps;
  const seconds = shot.seconds ?? 2;
  if (!isNum(seconds) || seconds <= 0) fail(shot, `bad seconds ${seconds}`);
  const total = Math.max(1, Math.round(seconds * fps));
  checkKeys(shot, 'ticks', shot.ticks, isNum);
  if (shot.camera !== undefined) {
    checkKeys(shot, 'camera', shot.camera, (v) => v && typeof v === 'object' && Object.values(v).every(isNum) && (v.zoom === undefined || v.zoom > 0));
    if (!shot.follow && !shot.camera.every(([, v]) => isNum(v.x) && isNum(v.y) && isNum(v.zoom))) fail(shot, 'camera keys need x, y and zoom');
  }
  if (shot.follow !== undefined && !(header.neighbors ?? []).some((n) => n.id === shot.follow)) fail(shot, `follow: no neighbor ${shot.follow} in the game`);
  for (const k of ['ease', 'tickEase']) if (shot[k] !== undefined && !EASE[shot[k]]) fail(shot, `bad ${k} ${shot[k]}`);
  const ui = shot.ui ?? 'photo';
  if (!['photo', 'game'].includes(ui)) fail(shot, `bad ui ${ui} (photo or game)`);
  const warm = shot.warm ?? 1;
  if (!isNum(warm) || warm < 0) fail(shot, `bad warm ${warm}`);
  const smooth = shot.followSmooth ?? 0.5;
  if (!isNum(smooth) || smooth < 0) fail(shot, `bad followSmooth ${smooth}`);
  const steps = shot.steps ?? [];
  if (!Array.isArray(steps) || !steps.every((s) => typeof s === 'string')) fail(shot, 'steps must be a list of JS strings');
  const holds = new Map();
  for (const h of shot.holds ?? []) {
    if (!Array.isArray(h) || !isNum(h[0]) || h[0] < 0 || h[0] > 1 || !Number.isInteger(h[1]) || h[1] < 1) fail(shot, `bad hold ${JSON.stringify(h)}`);
    const i = Math.round(h[0] * (total - 1));
    holds.set(i, (holds.get(i) ?? 0) + Math.max(1, Math.round(h[1] * holdScale)));
  }
  if (shot.query !== undefined && typeof shot.query !== 'string' && (typeof shot.query !== 'object' || Array.isArray(shot.query))) fail(shot, 'query must be an object or a string');

  const lang = shot.lang ?? header.lang;
  const tickEase = EASE[shot.tickEase ?? 'linear'];
  const ease = EASE[shot.ease ?? 'inOut'];
  const fraction = (i) => (total > 1 ? i / (total - 1) : 0);
  return {
    id: shot.id,
    lang,
    width: Number(m[1]),
    height: Number(m[2]),
    fps,
    total,
    frameMs: 1000 / fps,
    warm,
    steps,
    holds,
    follow: shot.follow ?? null,
    smoothRadius: Math.round(smooth * fps),
    url: buildUrl(shot, { base, lang, tick: interpolate(shot.ticks, 0) }),
    tickAt: (i) => interpolate(shot.ticks, fraction(i), tickEase),
    cameraAt: (i) => interpolate(shot.camera, fraction(i), ease),
  };
}

export function parseArgs(argv) {
  const opt = {
    shots: 'viewer/tools/film-shots.json', only: '', lang: '', workers: '1', gpu: '', frames: '', size: '',
    out: 'build/promo/footage', logs: 'build/promo/logs', base: 'http://127.0.0.1:8098/', root: '.', chromium: 'chromium', crf: '12',
    fps: '', capture: 'png',
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opt)) throw new Error(`film: unknown option ${argv[i]}`);
    opt[key] = argv[i + 1] ?? '';
  }
  opt.workers = Number(opt.workers);
  if (!Number.isInteger(opt.workers) || opt.workers < 1) throw new Error('film: bad --workers');
  if (opt.lang && !['es', 'en'].includes(opt.lang)) throw new Error('film: --lang is es or en');
  if (opt.size && !/^\d+x\d+$/.test(opt.size)) throw new Error('film: bad --size (WxH)');
  opt.gpu = !!opt.gpu && opt.gpu !== '0';
  opt.only = opt.only ? opt.only.split(',').map((s) => s.trim()).filter(Boolean) : [];
  opt.fps = opt.fps ? Number(opt.fps) : 0;
  if (opt.fps && (!Number.isInteger(opt.fps) || opt.fps < 1 || opt.fps > 120)) throw new Error('film: bad --fps');
  if (!['png', 'jpeg'].includes(opt.capture)) throw new Error('film: --capture is png or jpeg');
  return opt;
}

/** Films one planned shot; returns {frames, loadS, frameS}. */
async function filmShot(plan, opt) {
  const tag = `${plan.lang}/${plan.id}`;
  const dir = join(opt.out, plan.lang);
  const out = join(dir, `${plan.id}.mp4`);
  const part = join(dir, `${plan.id}.part.mp4`);
  const framesDir = opt.frames ? join(opt.frames, plan.lang, plan.id) : '';
  await mkdir(dir, { recursive: true });
  await mkdir(opt.logs, { recursive: true });
  if (framesDir) {
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
  }
  const chromiumLog = createWriteStream(join(opt.logs, `film-${plan.lang}-${plan.id}.chromium.log`));

  let page = null;
  let ffmpeg = null;
  let ffmpegDone = null;
  let failed = null;
  let written = 0;
  const t0 = Date.now();
  let t1 = t0;
  try {
    // One page loads at a time: the game server fails fetches (models) when
    // several pages load at once. The frames are filmed in parallel.
    page = await opt.loading(() =>
      launch({ chromium: opt.chromium, width: plan.width, height: plan.height, gpu: opt.gpu, onStderr: (t) => chromiumLog.write(t), who: 'film' }),
    );
    const { cdp, sessionId, send } = page;
    let pageErrors = 0;
    cdp.on((ev) => {
      if (ev.sessionId !== sessionId) return;
      if (ev.method === 'Runtime.exceptionThrown') {
        pageErrors++;
        console.error(`film: ${tag}: page exception: ${ev.params.exceptionDetails.exception?.description ?? ev.params.exceptionDetails.text}`);
      } else if (ev.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(ev.params.type)) {
        if (ev.params.type === 'error') pageErrors++;
        console.error(`film: ${tag}: page ${ev.params.type}: ${ev.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      }
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: plan.width, height: plan.height, deviceScaleFactor: 1, mobile: false });
    await opt.loading(async () => {
      const nav = await send('Page.navigate', { url: plan.url });
      if (nav.errorText) throw new Error(`film: cannot open ${plan.url}: ${nav.errorText}`);
      await waitReady(send, { url: plan.url, ms: TIMEOUT_MS, who: `film: ${tag}` });
    });
    const renderer = await rendererOf(send);
    console.error(`film: ${tag}: ${plan.width}x${plan.height}, ${plan.total} frames, renderer ${renderer}`);
    if (opt.gpu && /swiftshader|llvmpipe|software/i.test(renderer))
      throw new Error(`film: ${tag}: --gpu asked, but Chromium draws with ${renderer} (slow path; does the container have --gpus all?)`);

    // From here on the page only moves when we advance its virtual time.
    await send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
    const advance = async (ms) => {
      const expired = cdp.once('Emulation.virtualTimeBudgetExpired');
      await send('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: ms });
      await expired;
    };

    // Follow: where the neighbor is drawn at every frame's tick, smoothed.
    let path = null;
    if (plan.follow) {
      const ticks = Array.from({ length: plan.total }, (_, i) => plan.tickAt(i));
      const raw = await evaluate(
        send,
        `(() => { const out = []; for (const t of ${JSON.stringify(ticks)}) { rumorApp.bus.emit('seek', {pos: t});
           const p = rumorApp.positionOf(${JSON.stringify(plan.follow)}); out.push([p.x, p.y]); } return out; })()`,
      );
      path = smoothPath(raw, plan.smoothRadius);
    }
    // The zoom is over camera.base, read in the page every frame: the home view
    // depends on the room the panels leave (render/index.js), which the steps change.
    const place = (i) => {
      const tick = plan.tickAt(i);
      const cam = plan.cameraAt(i);
      const parts = [`rumorApp.setClock(() => ${Math.round(i * plan.frameMs)})`, `rumorApp.bus.emit('seek', {pos: ${tick}})`];
      if (path) {
        const [x, y] = path[i];
        parts.push(`rumorApp.camera.set({x: ${x}, y: ${y}, scale: ${cam?.zoom ?? 1} * rumorApp.camera.base})`);
      } else if (cam) {
        parts.push(`rumorApp.camera.set({x: ${cam.x}, y: ${cam.y}, scale: ${cam.zoom} * rumorApp.camera.base})`);
      }
      return parts.join(';');
    };

    // Warm-up: the first state, the steps, and a moment of virtual time.
    await evaluate(send, place(0));
    for (const js of plan.steps) await evaluate(send, js);
    if (plan.warm > 0) await advance(plan.warm * 1000);

    ffmpeg = spawn(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(plan.fps), '-c:v', opt.capture === 'jpeg' ? 'mjpeg' : 'png', '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', opt.crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', part],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    ffmpegDone = new Promise((ok, no) => ffmpeg.on('close', (code) => (code === 0 ? ok() : no(new Error(`film: ${tag}: ffmpeg exited ${code}`)))));
    // --capture jpeg: quality 95, much cheaper to encode than PNG; after the
    // H.264 encode the difference does not show.
    const shotFormat = opt.capture === 'jpeg' ? { format: 'jpeg', quality: 95 } : { format: 'png' };
    const write = async (png) => {
      if (!ffmpeg.stdin.write(png)) await new Promise((ok) => ffmpeg.stdin.once('drain', ok));
      if (framesDir) await writeFile(join(framesDir, `${String(written).padStart(5, '0')}.${opt.capture === 'jpeg' ? 'jpg' : 'png'}`), png);
      written++;
    };

    // Pre-roll: frames drawn and thrown away on the first state. The home view
    // of the map follows the size of the panels measured in the frame before,
    // so the first frame drawn (game interface) is not settled yet.
    for (let k = 0; k < PREROLL; k++) {
      await evaluate(send, place(0));
      await advance(plan.frameMs);
      await send('Page.captureScreenshot', shotFormat);
    }

    t1 = Date.now();
    for (let i = 0; i < plan.total; i++) {
      await evaluate(send, place(i));
      await advance(plan.frameMs);
      const { data } = await send('Page.captureScreenshot', shotFormat);
      const png = Buffer.from(data, 'base64');
      await write(png);
      for (let k = 0; k < (plan.holds.get(i) ?? 0); k++) await write(png);
      if (i % 30 === 0) console.error(`film: ${tag}: frame ${i}/${plan.total} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    if (pageErrors) throw new Error(`film: ${tag}: ${pageErrors} error(s) on the page`);
  } catch (err) {
    failed = err;
  } finally {
    if (ffmpeg) ffmpeg.stdin.end();
    if (page) await page.close();
    chromiumLog.end();
  }
  if (!failed && ffmpegDone) await ffmpegDone.catch((e) => (failed = e));
  if (failed) {
    if (ffmpegDone) await ffmpegDone.catch(() => {});
    await rm(part, { force: true });
    throw failed;
  }
  await rename(part, out);
  const frameS = (Date.now() - t1) / 1000 / plan.total;
  console.error(`film: ${out}: ${written} frames; load ${((t1 - t0) / 1000).toFixed(1)} s, ${frameS.toFixed(2)} s/frame`);
  return { frames: written, loadS: (t1 - t0) / 1000, frameS };
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(await readFile(join(opt.root, opt.shots), 'utf8'));
  let shots = doc.shots;
  if (!Array.isArray(shots)) throw new Error(`film: ${opt.shots} has no "shots" list`);
  // Only new Con IA games (promo/README.md), for the whole list, before anything is filmed.
  const { errors, sources } = await checkSources(shots, { root: opt.root, where: opt.shots });
  if (errors.length) throw new Error(`film: sources:\n  ${errors.join('\n  ')}`);
  if (opt.only.length) {
    const ids = new Set(shots.map((s) => s.id));
    const missing = opt.only.filter((id) => !ids.has(id));
    if (missing.length) throw new Error(`film: no shot ${missing.join(', ')} in ${opt.shots}`);
    shots = shots.filter((s) => opt.only.includes(s.id));
  }

  const plans = [];
  const seen = new Set();
  for (const shot of shots) {
    const plan = planShot(shot, { header: sources.get(shot.source).header, base: opt.base, size: opt.size, fps: opt.fps });
    if (opt.lang && plan.lang !== opt.lang) continue;
    const key = `${plan.lang}/${plan.id}`;
    if (seen.has(key)) throw new Error(`film: shot ${key} twice`);
    seen.add(key);
    plans.push(plan);
  }
  if (!plans.length) throw new Error('film: no shot to film');
  console.error(`film: ${plans.length} shot(s), ${opt.workers} worker(s), ${opt.gpu ? 'GPU' : 'SwiftShader (CPU)'}`);

  // A queue of one: what goes through it runs after what went before.
  let tail = Promise.resolve();
  opt.loading = (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
  const t0 = Date.now();
  const queue = [...plans];
  const failures = [];
  const results = [];
  const worker = async () => {
    for (let plan = queue.shift(); plan; plan = queue.shift()) {
      try {
        results.push(await filmShot(plan, opt));
      } catch (err) {
        console.error(err.message);
        failures.push(`${plan.lang}/${plan.id}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opt.workers, plans.length) }, worker));
  const frames = results.reduce((a, r) => a + r.frames, 0);
  const s = (Date.now() - t0) / 1000;
  console.error(`film: ${results.length}/${plans.length} shot(s), ${frames} frames in ${s.toFixed(1)} s`);
  if (failures.length) {
    console.error(`film: failed: ${failures.join(', ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
