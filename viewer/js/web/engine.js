// The engine of the web version (phase 10, package F): rumor_web.wasm
// (engine/src/web/, contract in its README.md) behind async methods, run in a
// Web Worker so that computing a game never blocks the page.
//
//   page (server.js)                      Worker (worker.js)
//   createWorkerEngine(url) ─postMessage─► wrapModule(createRumorWeb())
//     info / preview / header / play  ◄─── rw_call(method, JSON) parsed here
//
// wrapModule is also what the Node tests use, on the module itself.

/**
 * @typedef {object} PlayResult
 * @property {true} ok
 * @property {object} game <id>.game.json (ended null, stopped false)
 * @property {string} gameText the same, as play_server writes it
 * @property {Array<[number, number, number]>} ticks [tick, quiet 0|1, log lines after it]
 * @property {string[]} log the lines of <id>.jsonl, without '\n'
 * @property {string[]} cards the lines of <id>.cards.jsonl
 * @property {number|null} endTick
 * @property {number} computeMs
 */

/**
 * The engine over an instantiated Emscripten module (createRumorWeb()).
 * @param {{ccall: Function}} module
 */
export function wrapModule(module) {
  const raw = (method, input) => module.ccall('rw_call', 'string', ['string', 'string'], [method, JSON.stringify(input)]);
  const json = (method, input) => JSON.parse(raw(method, input));
  const sure = (method, input) => {
    const out = json(method, input);
    if (!out.ok) throw new Error(`rumor_web ${method}: ${out.body?.error ?? JSON.stringify(out.body)}`);
    return out;
  };
  return {
    /** {version, challenges, timetable, default_draft}. */
    info: async () => sure('info', {}),
    /**
     * POST preview against the village shown (a draft, or null): {ok, status,
     * body, draft (normalized), changed, header (text)}; {ok: false, status,
     * body} for a 400.
     */
    preview: async (draft, village) => json('preview', { draft, village }),
    /** The header line of the village of a draft. */
    header: async (draft) => sure('header', { draft }).header,
    /**
     * A whole game Sin IA: {ok: false, status, body} for a draft that cannot
     * be played, else a PlayResult. A new game gets its id from nowMs and the
     * ids taken; a game played again keeps its id and start.
     * @param {object} draft
     * @param {{stopAt?: number|null, id?: string, started?: string, nowMs?: number, taken?: string[]}} opts
     * @returns {Promise<PlayResult|{ok: false, status: number, body: any}>}
     */
    play: async (draft, { stopAt = null, id, started, nowMs, taken = [] } = {}) => {
      const input = id ? { draft, stop_at: stopAt, id, started } : { draft, stop_at: stopAt, now_ms: nowMs ?? Date.now(), taken };
      const text = raw('play', input);
      const nl = text.indexOf('\n');
      const meta = JSON.parse(nl < 0 ? text : text.slice(0, nl));
      if (!meta.ok) return { ok: false, status: meta.status, body: meta.body };
      const lines = text.slice(nl + 1).split('\n');
      return {
        ok: true,
        game: meta.game,
        gameText: meta.game_text,
        ticks: meta.ticks,
        log: lines.slice(0, meta.log_lines),
        cards: lines.slice(meta.log_lines, meta.log_lines + meta.cards_lines),
        endTick: meta.end_tick,
        computeMs: meta.compute_ms,
      };
    },
  };
}

/**
 * The engine in a Web Worker. `moduleUrl` is rumor_web.js (the .wasm next to
 * it); the worker loads it on the first message.
 * @param {string} moduleUrl absolute URL
 * @param {{Worker?: typeof Worker, workerUrl?: string|URL}} [opts]
 */
export function createWorkerEngine(moduleUrl, { Worker: W = globalThis.Worker, workerUrl = new URL('./worker.js', import.meta.url) } = {}) {
  const worker = new W(workerUrl, { type: 'module' });
  const pending = new Map();
  let next = 1;
  let broken = null;
  const failAll = (err) => {
    broken = err;
    for (const { fail } of pending.values()) fail(err);
    pending.clear();
  };
  worker.onmessage = (ev) => {
    const { id, result, error } = ev.data ?? {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.fail(new Error(error));
    else p.ok(result);
  };
  worker.onerror = (ev) => {
    ev?.preventDefault?.();
    failAll(new Error(`web engine: the worker failed: ${ev?.message ?? 'unknown error'}`));
  };
  const call = (method, args) =>
    new Promise((ok, fail) => {
      if (broken) return fail(broken);
      const id = next++;
      pending.set(id, { ok, fail });
      worker.postMessage({ id, moduleUrl, method, args });
    });
  return {
    info: () => call('info', []),
    preview: (draft, village) => call('preview', [draft, village]),
    header: (draft) => call('header', [draft]),
    play: (draft, opts) => call('play', [draft, opts]),
  };
}
