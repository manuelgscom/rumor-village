// Client of the engine's live routes (engine/src/server/live_server.h). Paths
// are relative to the page: the engine serves the viewer at "/". No DOM.
//
// Every call resolves to a Reply and never rejects:
//   {ok, status, body, error}   status 0 = no answer (network)
//   error: the server's {"error"} message, or the network failure

/**
 * @typedef {object} Reply
 * @property {boolean} ok 2xx
 * @property {number} status HTTP status, 0 without an answer
 * @property {any} body parsed JSON, or null (204, or not JSON)
 * @property {string|null} error
 */

/**
 * Creates the client.
 * @param {{base?: string, fetch?: typeof fetch}} [opts] base: URL the paths are
 *   resolved against (default the page)
 */
export function createApi({ base = globalThis.location?.href ?? 'http://localhost/', fetch: fetchFn } = {}) {
  const doFetch = fetchFn ?? ((...a) => globalThis.fetch(...a));

  /** @returns {Promise<Reply>} */
  const call = async (method, path, body) => {
    const init = { method, cache: 'no-store' };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await doFetch(new URL(path, base).href, init);
    } catch (err) {
      return { ok: false, status: 0, body: null, error: err?.message ?? String(err) };
    }
    let parsed = null;
    try {
      const text = await res.text();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const error = res.ok ? null : (parsed?.error ?? `HTTP ${res.status}`);
    return { ok: res.ok, status: res.status, body: parsed, error };
  };

  return {
    /** GET control: {paused, speed, tick, ended, extract, run}. */
    control: () => call('GET', 'control'),
    /** POST control: {action: 'pause'|'resume'} and/or {speed: n|'max'}. */
    setControl: (body) => call('POST', 'control', body),
    /** POST viewport: the ids that would show text. 204. */
    viewport: (ids) => call('POST', 'viewport', { neighbors: ids }),
    /** POST inject: see inject.js for the body. */
    inject: (body) => call('POST', 'inject', body),
    /** POST extract: {text}. 501 without an extractor. */
    extract: (text) => call('POST', 'extract', { text }),

    // --- Game mode (`rumor play`, phase 9; docs/arquitectura.md, «Formatos») ---

    /**
     * GET state: {state: 'waiting'|'playing'|'ended', run, ai: {available, reason},
     * check: {state: 'running'|'done'|'skipped', decisions_per_s, advice: null|'neighbors25'|'rules'},
     * draft, game: null|{id, started}, challenges: [challenge files]}.
     */
    state: () => call('GET', 'state'),
    /**
     * POST preview with a draft {settings, rumors, challenge, bets, race}:
     * 200 {header: Format 1 header, town_changed}. Keeps the draft and writes
     * nothing; with town_changed there is a new run and the page reloads.
     * @param {object} draft
     */
    preview: (draft) => call('POST', 'preview', draft),
    /**
     * POST start with a draft: 200 {game: {id}}; 400 {errors: [{rumor, field,
     * error}]}; 409 when not waiting or the hardware check is not over.
     * @param {object} draft
     */
    start: (draft) => call('POST', 'start', draft),
    /** POST stop («Terminar ya»): 200, the game ends at the current tick with its end; 409 when not playing. */
    stop: () => call('POST', 'stop', {}),
    /**
     * POST reset: 200, back to waiting with the draft; {clear: true} without it.
     * @param {{clear?: boolean}} [body]
     */
    reset: (body = {}) => call('POST', 'reset', body),
    /** POST quit: 200, the program ends. */
    quit: () => call('POST', 'quit', {}),
    /**
     * GET card?game=&tick=&who=: 200 {tick, who, kind: 'turn'|'plan', policy:
     * 'model'|'baseline', card: text|null, rule: {rule, rolls: [{name,
     * chance_ppm, roll_ppm, hit}]}|null}; 404 when there is none. Without
     * `game`, the current game.
     * @param {{game?: string|null, tick: number, who: string}} q
     */
    card: ({ game = null, tick, who }) => {
      const q = new URLSearchParams();
      if (game) q.set('game', game);
      q.set('tick', String(tick));
      q.set('who', who);
      return call('GET', `card?${q}`);
    },
    /** GET games: 200 {games: [game data…]}, newest first. Files: games/<id>.jsonl and games/<id>.game.json. */
    games: () => call('GET', 'games'),
    /** GET profile: 200 with the profile, or {format: 1} when there is none. */
    profile: () => call('GET', 'profile'),
    /**
     * POST profile: the whole profile {format: 1, tutorial_seen, stars, games}.
     * 200, or 400 when not a JSON object or over 1 MB.
     * @param {object} profile
     */
    saveProfile: (profile) => call('POST', 'profile', profile),
    /**
     * GET timetable: 200 {jobs: {<job>: [24 place keys or "home"]}}, where
     * each job is at each hour (data/world/timetable.json; phase 9-5).
     */
    timetable: () => call('GET', 'timetable'),
    /**
     * POST ai/download (the downloaded game, when the model is missing; phase
     * 10): 200 {download: GET state's ai.download}; 409 when it cannot start
     * now; 404 without the route.
     */
    aiDownload: () => call('POST', 'ai/download', {}),
    /**
     * POST ai/activate: 200 {activating: true}, then the server closes and comes
     * back on the same port with the AI; 409 (a game under way, not ready).
     */
    aiActivate: () => call('POST', 'ai/activate', {}),
  };
}

/**
 * Body of POST control for a bus event of package B, or null when it is not
 * meant for the engine.
 * @param {'pause'|'speed'} type
 * @param {{paused?: boolean, value?: number, engine?: boolean}} payload
 * @returns {object|null}
 */
export function controlBody(type, payload) {
  if (payload?.engine !== true) return null;
  if (type === 'pause') return { action: payload.paused ? 'pause' : 'resume' };
  if (type === 'speed') {
    const v = Number(payload.value);
    if (!Number.isFinite(v)) return null;
    return { speed: Math.max(1, Math.round(v)) };
  }
  return null;
}

/**
 * The engine state for the bus event 'engine' from a GET/POST control body,
 * or null when the body is not one.
 * @param {any} body {paused, speed: n|'max', ended, ...}
 * @returns {{paused: boolean, speed: number|'max', ended: boolean}|null}
 */
export function engineState(body) {
  if (!body || typeof body.paused !== 'boolean') return null;
  const speed = body.speed === 'max' || Number.isFinite(body.speed) ? body.speed : null;
  return { paused: body.paused, speed, ended: body.ended === true };
}
