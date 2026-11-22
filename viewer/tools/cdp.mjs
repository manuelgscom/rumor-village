// Headless Chromium driven over the DevTools protocol, shared by shot.mjs and
// film.mjs: launch it, talk to it (Node's own WebSocket client; no npm
// packages) and evaluate expressions in the page. Error messages start with
// the caller's name (`who`), as each tool had them before.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function waitForFile(path, ms, who) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const text = await readFile(path, 'utf8');
      if (text.includes('\n')) return text;
    } catch {
      // not written yet
    }
    if (Date.now() > until) throw new Error(`${who}: chromium did not open its DevTools port`);
    await sleep(50);
  }
}

/** Minimal DevTools client over one browser WebSocket, with flat sessions. */
export class Cdp {
  constructor(url, who = 'cdp') {
    this.who = who;
    this.ws = new WebSocket(url);
    this.next = 1;
    this.pending = new Map();
    this.listeners = [];
    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id && this.pending.has(data.id)) {
        const { ok, fail } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) fail(new Error(`${data.error.message} (${data.error.code})`));
        else ok(data.result);
      } else if (data.method) {
        for (const fn of this.listeners) fn(data);
      }
    };
  }
  open() {
    return new Promise((ok, fail) => {
      this.ws.onopen = ok;
      this.ws.onerror = () => fail(new Error(`${this.who}: cannot connect to chromium`));
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  /** The params of the next event of this method. */
  once(method) {
    return new Promise((ok) => {
      const fn = (ev) => {
        if (ev.method !== method) return;
        this.listeners = this.listeners.filter((f) => f !== fn);
        ok(ev.params);
      };
      this.listeners.push(fn);
    });
  }
  on(fn) {
    this.listeners.push(fn);
  }
  close() {
    this.ws.close();
  }
}

/** The value of an expression in the page (promises awaited); throws on an exception. */
export async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/**
 * Starts headless Chromium on about:blank and opens one page (flat session).
 *   gpu false: WebGL 2 rendered on the CPU by SwiftShader (the container has no
 *     GPU; asking for it explicitly avoids Chromium's warning about the
 *     automatic software fallback).
 *   gpu true: draw on the NVIDIA card through ANGLE and Vulkan (the container
 *     needs --gpus all and NVIDIA_DRIVER_CAPABILITIES=all).
 *   onStderr(text): Chromium's own log, else it is dropped.
 * Returns {browser, cdp, sessionId, send, close}; close() always cleans up
 * (socket, process, profile folder). On a failure while starting, it cleans
 * up itself and throws.
 */
export async function launch({ chromium = 'chromium', width, height, gpu = false, onStderr = null, who = 'cdp' }) {
  const profile = await mkdtemp(join(tmpdir(), `${who}-`));
  const browser = spawn(
    chromium,
    [
      '--headless',
      '--no-sandbox',
      ...(gpu
        ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
      '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', onStderr ? 'pipe' : 'ignore'] },
  );
  if (onStderr) browser.stderr.on('data', (d) => onStderr(String(d)));

  let cdp = null;
  const close = async () => {
    if (cdp) cdp.close();
    browser.kill('SIGKILL');
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  try {
    const active = await waitForFile(join(profile, 'DevToolsActivePort'), 15000, who);
    const [port, path] = active.trim().split('\n');
    cdp = new Cdp(`ws://127.0.0.1:${port}${path}`, who);
    await cdp.open();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    return { browser, cdp, sessionId, send, close };
  } catch (err) {
    await close();
    throw err;
  }
}

/** Polls until <html> has data-ready; data-error or the timeout fail. */
export async function waitReady(send, { url, ms, who = 'cdp' }) {
  const until = Date.now() + ms;
  while (!(await evaluate(send, '!!document.documentElement.dataset.ready'))) {
    const error = await evaluate(send, 'document.documentElement.dataset.error || null');
    if (error) throw new Error(`${who}: viewer error: ${error}`);
    if (Date.now() > until) throw new Error(`${who}: page not ready after ${ms} ms: ${url}`);
    await sleep(100);
  }
}

/** The WebGL renderer the page gets (to tell the card from SwiftShader). */
export function rendererOf(send) {
  return evaluate(
    send,
    `(() => { const c = document.createElement('canvas').getContext('webgl2'); if (!c) return 'none';
      const e = c.getExtension('WEBGL_debug_renderer_info'); return String(c.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : c.RENDERER)); })()`,
  );
}
