// Screenshot of the viewer with headless Chromium, driven over the DevTools
// protocol (Node's own WebSocket client; no npm packages).
//
//   node viewer/tools/shot.mjs --query '?log=/runs/samples/party-25-en-s4.jsonl' --out build/shots/a.png
//   node viewer/tools/shot.mjs --base http://127.0.0.1:8080/ --query '?live=1' --out build/shots/live.png
//
// Without --base it serves the repo root (--root, default the current folder)
// on a free port and opens /viewer/index.html<query>; with --base it opens
// <base><query>. It waits until <html> has data-ready (or data-error, which
// fails), then one more frame, and writes the PNG. Page errors and console
// warnings are printed to stderr, and a page error or exception fails the shot;
// with SHOT_CHROMIUM_LOG=1, Chromium's own log too.
//
//   --expect ready    (default) as above
//   --expect error    the page must stop with data-error (the error screen);
//                     its console errors are expected
//   --expect loading  shoot as soon as <html> has data-loading (with hold=1 in
//                     the query the loading screen stays)
// Widths under 600 px are emulated as a phone (touch, mobile viewport).
//
//   --measure N       no picture: once ready, play (pause off) and time N
//                     frames; appends one line to --out (a text file) with the
//                     median and p90 ms per frame, plus what the scene's frame
//                     meter says (window.rumorApp.stats.snapshot(), ?stats=1)
//
// Playing without an interface (phase 10, scripts/wasm-smoke.sh): steps run in
// the order given, once the page is ready, before the picture. Each may be
// repeated; a step that does not happen within --wait-ms (120000) fails.
//
//   --click SEL        click the first element of the selector (once it is there and enabled)
//   --until-phase P    wait for <html data-game-phase=P> (boot|menu|prepare|playing|ended) and data-ready
//   --until JS         wait until the expression is truthy (promises are awaited)
//   --eval JS          evaluate it and print "eval: <JSON of the value>" on stdout
//   --sleep MS         wait
//   --reload 1         reload the page and wait for it to be ready again
//   --block-storage 1  localStorage and sessionStorage throw, as with blocked site data

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { evaluate, launch, sleep } from './cdp.mjs';
import { serve } from './static.mjs';

// Software WebGL needs time to load the models and draw the first frames.
const TIMEOUT_MS = 90000;

const STEPS = ['click', 'until-phase', 'until', 'eval', 'sleep', 'reload'];

function parseArgs(argv) {
  const opt = { root: '.', base: '', query: '', out: '', size: '1600x900', chromium: 'chromium', expect: 'ready', measure: '0', 'block-storage': '', 'wait-ms': '120000', steps: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (STEPS.includes(key)) {
      opt.steps.push({ kind: key, value: argv[i + 1] ?? '' });
      continue;
    }
    if (!(key in opt) || key === 'steps') throw new Error(`shot: unknown option ${argv[i]}`);
    opt[key] = argv[i + 1] ?? '';
  }
  opt.waitMs = Number(opt['wait-ms']);
  if (!Number.isFinite(opt.waitMs) || opt.waitMs <= 0) throw new Error('shot: bad --wait-ms');
  if (!opt.out) throw new Error('shot: --out is required');
  if (!['ready', 'error', 'loading'].includes(opt.expect)) throw new Error(`shot: bad --expect ${opt.expect}`);
  const m = /^(\d+)x(\d+)$/.exec(opt.size);
  if (!m) throw new Error(`shot: bad --size ${opt.size} (expected WxH)`);
  opt.measure = Number(opt.measure);
  if (!Number.isInteger(opt.measure) || opt.measure < 0) throw new Error('shot: bad --measure (frames)');
  opt.width = Number(m[1]);
  opt.height = Number(m[2]);
  return opt;
}

/** Polls an expression until it is truthy; a page being replaced (a reload) just retries. */
async function waitFor(send, expression, what, ms) {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    try {
      if (await evaluate(send, expression)) return;
    } catch (err) {
      last = err;
    }
    await sleep(100);
  }
  throw new Error(`shot: ${what} did not happen in ${ms} ms${last ? ` (${last.message})` : ''}`);
}

const READY = '!!document.documentElement.dataset.ready';

/** The steps of --click, --until-phase, --until, --eval, --sleep and --reload, in order. */
async function runSteps(send, steps, ms) {
  for (const { kind, value } of steps) {
    const q = JSON.stringify(value);
    console.error(`step: ${kind} ${value}`);
    if (kind === 'click') {
      await waitFor(send, `(() => { const e = document.querySelector(${q}); if (!e || e.disabled) return false; e.click(); return true; })()`, `click ${value}`, ms);
    } else if (kind === 'until-phase') {
      await waitFor(send, `document.documentElement.dataset.gamePhase === ${q} && ${READY}`, `phase ${value}`, ms);
    } else if (kind === 'until') {
      await waitFor(send, value, `until ${value}`, ms);
    } else if (kind === 'eval') {
      console.log(`eval: ${JSON.stringify(await evaluate(send, value))}`);
    } else if (kind === 'sleep') {
      await sleep(Number(value) || 0);
    } else if (kind === 'reload') {
      await evaluate(send, 'window.__shotBefore = true');
      await send('Page.reload', {});
      await waitFor(send, `!window.__shotBefore && ${READY}`, 'the reload', ms);
    }
  }
}

function describeRemote(arg) {
  if (arg.type === 'string') return arg.value;
  if ('value' in arg) return JSON.stringify(arg.value);
  return arg.description ?? arg.type;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  let server = null;
  let url;
  if (opt.base) {
    url = opt.base + opt.query;
  } else {
    server = await serve({ root: opt.root, host: '127.0.0.1', port: 0, quiet: true });
    url = `http://127.0.0.1:${server.address().port}/viewer/index.html${opt.query}`;
  }

  const chromiumLog = [];
  let page = null;
  let failed = null;
  try {
    // WebGL 2 for the 3D scene, rendered on the CPU by SwiftShader (cdp.mjs).
    page = await launch({
      chromium: opt.chromium,
      width: opt.width,
      height: opt.height,
      onStderr: (text) => chromiumLog.push(text),
      who: 'shot',
    });
    const { cdp, sessionId, send } = page;

    let pageErrors = 0;
    cdp.on((ev) => {
      if (ev.sessionId !== sessionId) return;
      if (ev.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(ev.params.type)) {
        if (ev.params.type !== 'warning') pageErrors++;
        console.error(`page ${ev.params.type}: ${ev.params.args.map(describeRemote).join(' ')}`);
      } else if (ev.method === 'Runtime.exceptionThrown') {
        pageErrors++;
        const d = ev.params.exceptionDetails;
        console.error(`page exception: ${d.exception?.description ?? d.text}`);
      } else if (ev.method === 'Log.entryAdded' && ['error', 'warning'].includes(ev.params.entry.level)) {
        const e = ev.params.entry;
        if (e.level === 'error') pageErrors++;
        console.error(`page ${e.level}: ${e.text}${e.url ? ` (${e.url})` : ''}`);
      }
    });
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: opt.width,
      height: opt.height,
      deviceScaleFactor: 1,
      mobile: opt.width < 600,
    });
    if (opt.width < 600) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (opt['block-storage']) {
      // As Chromium does with blocked site data: reading either storage throws.
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException('blocked by shot --block-storage', 'SecurityError'); } });`,
      });
    }
    const nav = await send('Page.navigate', { url });
    if (nav.errorText) throw new Error(`shot: cannot open ${url}: ${nav.errorText}`);

    const until = Date.now() + TIMEOUT_MS;
    let state = null;
    while (Date.now() < until) {
      const { result } = await send('Runtime.evaluate', {
        expression:
          'JSON.stringify({ready: document.documentElement.dataset.ready || null, error: document.documentElement.dataset.error || null, loading: document.documentElement.dataset.loading || null})',
        returnByValue: true,
      });
      state = result.value ? JSON.parse(result.value) : null;
      if (state && (state.ready || state.error || (opt.expect === 'loading' && state.loading))) break;
      await sleep(100);
    }
    const reached = state && (opt.expect === 'loading' ? state.loading && !state.error : state.ready || state.error);
    if (!reached) throw new Error(`shot: page not ${opt.expect} after ${TIMEOUT_MS} ms: ${url}`);
    if (opt.expect === 'error' && !state.error) throw new Error(`shot: expected a viewer error: ${url}`);
    if (opt.expect !== 'error' && state.error) throw new Error(`shot: viewer error: ${state.error}`);
    // The loading screen: give it a moment to show its first progress.
    if (opt.expect === 'loading') await sleep(1500);

    if (opt.measure) {
      // Frame times while playing (the split screen plays through its own bar).
      await send('Runtime.evaluate', {
        expression: "window.rumorApp ? window.rumorApp.bus.emit('pause', {paused: false}) : document.querySelector('.rp-play')?.click()",
      });
      const { result } = await send('Runtime.evaluate', {
        expression: `new Promise((ok) => {
          const t = [];
          let last = performance.now();
          const step = (now) => {
            t.push(now - last);
            last = now;
            if (t.length <= ${opt.measure}) return requestAnimationFrame(step);
            t.shift();
            t.sort((a, b) => a - b);
            const meter = window.rumorApp?.stats?.snapshot?.() ?? null;
            ok(JSON.stringify({ frames: t.length, medianMs: +t[t.length >> 1].toFixed(1), p90Ms: +t[Math.floor(t.length * 0.9)].toFixed(1), meter }));
          };
          requestAnimationFrame(step);
        })`,
        awaitPromise: true,
        returnByValue: true,
      });
      await mkdir(dirname(opt.out), { recursive: true });
      await appendFile(opt.out, `${opt.query} ${opt.size}: ${result.value}\n`);
      console.error(`measure: ${opt.query}: ${result.value}`);
      if (pageErrors) throw new Error(`shot: ${pageErrors} console error(s) on the page`);
      return;
    }

    await runSteps(send, opt.steps, opt.waitMs);

    // One more frame, so that whatever the ready mark triggered is painted.
    await send('Runtime.evaluate', {
      expression: 'new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))',
      awaitPromise: true,
    });
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await mkdir(dirname(opt.out), { recursive: true });
    await writeFile(opt.out, Buffer.from(data, 'base64'));
    console.error(`shot: ${opt.out} (${url})`);
    if (pageErrors && opt.expect !== 'error') throw new Error(`shot: ${pageErrors} console error(s) on the page`);
  } catch (err) {
    failed = err;
  } finally {
    if (page) await page.close();
    if (server) server.close();
  }
  if (process.env.SHOT_CHROMIUM_LOG) console.error(chromiumLog.join(''));
  if (failed) {
    console.error(failed.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
