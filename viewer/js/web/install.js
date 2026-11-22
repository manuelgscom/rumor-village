// The web version Sin IA (phase 10, package F), put in place by
// viewer/play-web.html before the viewer starts (js/core/app.js, unchanged):
//
//   play-web.html
//     └ installWeb(window)
//         ├ ?play=1 unless the page opens a played game (?game=, ?log=)
//         ├ Worker (worker.js) ── wasm/rumor_web.js + .wasm, next to the page
//         ├ fake server (server.js): session and local stores (storage.js)
//         └ window.fetch, window.EventSource ── fake.js (the rest: the real ones)
//
// Everything is relative to the page, so the site works from any folder.

import { createWorkerEngine } from './engine.js';
import { createEventSource, createFetch } from './fake.js';
import { createServer } from './server.js';
import { createStore, nameMap } from './storage.js';

/** Where the engine is, relative to play-web.html (build/wasm/site/… and web/ of phase 11). */
export const WASM_MODULE = 'wasm/rumor_web.js';

/**
 * The query of the page with ?play=1 added when it opens neither the game
 * nor a played game; null when it needs no change.
 * @param {string} search
 */
export function playSearch(search) {
  const q = new URLSearchParams(search);
  if (q.has('play') || q.has('game') || q.has('log')) return null;
  q.set('play', '1');
  return `?${q}`;
}

/**
 * Installs the web version in `win` (the window). Returns the fake server.
 * @param {Window & typeof globalThis} win
 */
export function installWeb(win = globalThis) {
  const search = playSearch(win.location.search);
  if (search !== null) win.history.replaceState(win.history.state, '', `${win.location.pathname}${search}${win.location.hash}`);

  const fallback = nameMap(win);
  const session = createStore(() => win.sessionStorage, fallback);
  const local = createStore(() => win.localStorage, fallback);
  const engine = createWorkerEngine(new URL(WASM_MODULE, win.location.href).href);
  const server = createServer({ engine, session, local });
  const pageHref = () => win.location.href;
  win.fetch = createFetch(server, win.fetch.bind(win), pageHref);
  win.EventSource = createEventSource(server.stream, server.ready, win.EventSource, pageHref);
  // For the smoke test (scripts/wasm-smoke.sh): what the engine took, and the game state.
  win.rumorWeb = { stats: server.stats, persistent: () => session.persistent && local.persistent };
  server.ready.catch((err) => console.error('web: the engine did not start', err));
  return server;
}
