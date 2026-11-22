// The fake `rumor play` of the web version (phase 10, package F): the routes
// of engine/src/server/play_server.cpp and live_run.cpp, answered in the page
// with the engine in a Worker (engine.js). fake.js puts it behind fetch and
// EventSource; the viewer does not know.
//
//   waiting ──POST start──► playing ──last tick or POST stop──► ended
//      ▲   (the whole game is computed at once:               │
//      │    Sin IA is deterministic)                          │
//      └──────────────────── POST reset ──────────────────────┘
//
//   playing: the log is released tick by tick at the pace of pace.js
//            (speed, pause, hold_ms, quiet ticks), as LiveRun lets the
//            simulation through; POST stop computes the game again with a
//            stop before the next tick, so the end carries the counters of
//            that point.
//
// What survives a reload of the page (the viewer reloads at start, reset and
// a new town) goes to the session store (storage.js): the draft, the village
// shown, the game (its normalized draft, id, start, stop tick and the ticks
// released) and the pace. The game is computed again from its draft after a
// reload. The profile and «Mis partidas» (the <id>.game.json of each game,
// never the logs: a game opened again is computed again) go to the local
// store.
//
// Answers: {status, body} (JSON) or {status, text, type}. A route does its
// synchronous part before its first await, so the requests sent with
// keepalive on pagehide (POST preview, POST control) are kept even when the
// page goes away at once: a preview leaves its draft as `pending` in the
// session, taken up by the next page.

import { DEFAULT_CONTROL, dueAt, released } from './pace.js';

export const SESSION_KEY = 'rv-web-session';
export const GAMES_KEY = 'rv-web-games';
export const PROFILE_KEY = 'rv-web-profile';
const SESSION_VERSION = 1;
const MAX_HOLD_MS = 10000; // live_run.h kMaxHoldMs
const PROFILE_MAX_BYTES = 1 << 20; // game_files.h kProfileMaxBytes
const CARD_USAGE = 'GET /card?game=<id>&tick=<t>&who=<id>[&kind=turn|plan]';

/** 16 hex digits, different for each call (http_util new_run_id). */
export function newRunId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** "2026-11-17T10:04:05Z" (game_files iso_utc). */
export const isoUtc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** game_files valid_game_id: YYYYMMDD-HHMMSS-<ai|rules>-t<town>[-<n>]. */
export const validGameId = (id) => typeof id === 'string' && id.length <= 64 && /^\d{8}-\d{6}-(ai|rules)-t\d{1,20}(-\d{1,20})?$/.test(id);

const json = (status, body) => ({ status, body });
const error = (status, message) => json(status, { error: message });
const blank = (text) => !/[^ \t\r\n]/.test(text ?? '');

/** http_util object_body: the body as a JSON object, or null. */
function objectBody(text) {
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

/** The draft of a game data: {settings, rumors, challenge, bets, race}. */
const draftOf = (game) => ({ settings: game.settings, rumors: game.rumors, challenge: game.challenge ?? null, bets: game.bets ?? null, race: game.race ?? null });

/**
 * Creates the server. Every request waits for `ready` (the engine loaded and
 * the session of the tab restored).
 * @param {{
 *   engine: ReturnType<import('./engine.js').wrapModule>,
 *   session: ReturnType<import('./storage.js').createStore>,
 *   local: ReturnType<import('./storage.js').createStore>,
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (t: any) => void,
 *   runId?: () => string,
 * }} opts
 */
export function createServer({ engine, session, local, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t), runId = newRunId }) {
  let info = null; // {version, challenges, timetable, default_draft}
  let s = null; // the persisted session (see fresh())
  let header = null; // waiting: the header line of the village shown
  let data = null; // playing / ended: the PlayResult of the game
  let timer = null;
  let stopping = null; // a POST stop under way (a promise)
  let isReady = false;
  const listeners = new Set();
  const cache = new Map(); // id -> PlayResult of games opened again (the last two)
  const stats = { computeMs: null, ticks: null, lines: null, startedAt: null, endedAt: null };

  const fresh = (draft = info.default_draft) => ({
    v: SESSION_VERSION,
    draft, // draft_ of play_server: the last normalized draft
    village: draft, // the draft whose village the waiting session shows
    pending: null, // a POST preview not processed yet (keepalive on pagehide)
    state: 'waiting',
    run: runId(),
    control: { ...DEFAULT_CONTROL },
    game: null, // {id, started, draft, stopAt, released, done}
  });
  const persist = () => {
    if (s?.game) s.game.released = releasedTicks;
    session.set(SESSION_KEY, s);
  };
  const notify = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        console.error('web: a stream listener failed', err);
      }
    }
  };

  // --- «Mis partidas» and the profile (the local store) ----------------------
  const games = () => {
    const g = local.get(GAMES_KEY);
    return g && typeof g === 'object' && !Array.isArray(g) ? g : {};
  };
  const keepGame = (game) => {
    const all = games();
    all[game.id] = game;
    local.set(GAMES_KEY, all);
  };

  // --- The game being played --------------------------------------------------
  let releasedTicks = 0; // ticks let through
  const ticks = () => data?.ticks ?? [];
  /** How many lines of the log are out after `k` ticks: the header before the first; all after the last. */
  const linesAfter = (k) => {
    if (!data) return 0;
    if (k >= ticks().length) return data.log.length;
    return k === 0 ? 1 : ticks()[k - 1][2];
  };

  /** The lines of the current run, from index `from` (line n of the file is index n-1). */
  const lines = (from = 0) => {
    if (s.state === 'waiting') return from < 1 && header ? [header] : [];
    return data ? data.log.slice(from, linesAfter(releasedTicks)) : [];
  };
  const lineCount = () => (s.state === 'waiting' ? (header ? 1 : 0) : linesAfter(releasedTicks));

  /** The game ended: its file says so; an ended page reloaded does not write it again. */
  const finish = () => {
    s.state = 'ended';
    if (s.game && !s.game.done) {
      s.game.done = true;
      const game = { ...data.game, ended: isoUtc(now()), stopped: s.game.stopAt !== null, end_tick: data.endTick };
      keepGame(game);
      stats.endedAt = now();
    }
  };

  /** Lets through every tick that is due, and waits for the next one. */
  const step = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!isReady || stopping || s.state !== 'playing' || !data) return;
    const t = now();
    let moved = false;
    while (releasedTicks < ticks().length) {
      const due = dueAt(s.control);
      if (due === null) break; // paused: POST control wakes it
      if (t < due) {
        timer = setTimer(step, Math.max(0, due - t));
        break;
      }
      s.control = released(s.control, t, ticks()[releasedTicks][1] === 1);
      releasedTicks++;
      moved = true;
    }
    if (releasedTicks >= ticks().length) {
      finish();
      moved = true;
    }
    if (moved) {
      persist();
      notify();
    }
  };

  /** A new session (start, reset, another village): a new run id and pace; the old streams end. */
  const swap = () => {
    s.run = runId();
    s.control = { ...DEFAULT_CONTROL };
  };

  const playGame = (game, stopAt) => engine.play(draftOf(game), { stopAt, id: game.id, started: game.started });

  /** POST stop and the stop of POST reset: the game again, stopped before the next tick. */
  const stopGame = async () => {
    if (stopping) return stopping;
    stopping = (async () => {
      const at = releasedTicks < ticks().length ? ticks()[releasedTicks][0] : null;
      if (at !== null) {
        const again = await playGame({ ...s.game.draft, id: s.game.id, started: s.game.started }, at);
        if (!again.ok) throw new Error(`web: the game cannot be stopped: ${JSON.stringify(again.body)}`);
        data = again;
        s.game.stopAt = at;
        releasedTicks = data.ticks.length;
      }
      finish();
      persist();
      notify();
    })();
    try {
      await stopping;
    } finally {
      stopping = null;
    }
  };

  /** The PlayResult of a game: the current one, or one of «Mis partidas» computed again. */
  const gameData = async (id) => {
    if (s.game?.id === id && data) return { data, current: true };
    if (cache.has(id)) return { data: cache.get(id), current: false };
    const game = games()[id];
    if (!game?.settings) return null;
    const result = await playGame(game, game.stopped && Number.isInteger(game.end_tick) ? game.end_tick : null);
    if (!result.ok) return null;
    cache.set(id, result);
    while (cache.size > 2) cache.delete(cache.keys().next().value);
    return { data: result, current: false };
  };

  // --- Routes -------------------------------------------------------------------

  const controlJson = () => {
    let tick = null;
    if (s.state !== 'waiting' && data) {
      const list = ticks();
      if (releasedTicks < list.length) tick = list[releasedTicks][0];
      else if (s.game?.stopAt !== null && s.game?.stopAt !== undefined) tick = s.game.stopAt;
      else if (list.length) tick = list[list.length - 1][0];
    }
    const c = s.control;
    return { ended: s.state === 'ended', extract: false, paused: c.paused, run: s.run, speed: c.speed === 0 ? 'max' : c.speed, tick };
  };

  const stateJson = () => ({
    ai: { available: false, reason: 'web' },
    challenges: info.challenges,
    check: { advice: null, decisions_per_s: null, state: 'skipped' },
    draft: s.draft,
    game: s.game ? { id: s.game.id, started: s.game.started } : null,
    platform: 'web',
    run: s.run,
    state: s.state,
    version: info.version,
  });

  function postControl(text) {
    const body = objectBody(text);
    if (!body) return error(400, 'the body is not a JSON object');
    let pause = null;
    let speed = null;
    let hold = null;
    for (const [key, value] of Object.entries(body)) {
      if (key === 'action') {
        if (value === 'pause') pause = true;
        else if (value === 'resume') pause = false;
        else return error(400, 'action is "pause" or "resume"');
      } else if (key === 'speed') {
        if (value === 'max') speed = 0;
        else if (Number.isInteger(value) && value >= 1 && value <= 2147483647) speed = value;
        else return error(400, 'speed is an integer of at least 1 or "max"');
      } else if (key === 'hold_ms') {
        if (!Number.isInteger(value) || value < 0 || value > MAX_HOLD_MS) return error(400, `hold_ms is an integer from 0 to ${MAX_HOLD_MS}`);
        hold = value;
      } else {
        return error(400, `unknown key '${key}'`);
      }
    }
    if (pause === null && speed === null && hold === null) return error(400, 'nothing to do: give action, speed or hold_ms');
    const c = { ...s.control };
    // After a pause the next tick goes at once, and the clock starts again from it.
    if (pause === false && c.paused) c.released = null;
    if (pause !== null) c.paused = pause;
    if (speed !== null) c.speed = speed;
    s.control = c;
    const answer = controlJson();
    if (hold !== null) s.control = { ...s.control, holdUntil: Math.max(s.control.holdUntil, now() + hold) };
    persist();
    step();
    return json(200, answer);
  }

  function postViewport(text) {
    const body = objectBody(text);
    const usage = 'the body is {"neighbors":[...]}';
    if (!body || Object.keys(body).length !== 1 || !Array.isArray(body.neighbors)) return error(400, usage);
    const h = currentHeader();
    const count = Array.isArray(h?.neighbors) ? h.neighbors.length : 0;
    for (const item of body.neighbors) {
      const m = typeof item === 'string' ? /^n(\d{3})$/.exec(item) : null;
      const index = m ? Number(m[1]) - 1 : -1;
      if (index < 0 || index >= count) return error(400, `unknown neighbor ${JSON.stringify(item)}`);
    }
    // The baseline writes no text: who is on screen changes nothing in the game.
    return { status: 204 };
  }

  let parsedHeader = { line: null, value: null };
  const currentHeader = () => {
    const line = s.state === 'waiting' ? header : (data?.log[0] ?? null);
    if (parsedHeader.line !== line) {
      let value = null;
      try {
        value = line ? JSON.parse(line) : null;
      } catch {
        value = null;
      }
      parsedHeader = { line, value };
    }
    return parsedHeader.value;
  };

  /** POST preview after its synchronous part (the draft kept as pending). */
  async function preview(draft) {
    const res = await engine.preview(draft, s.village);
    if (s.pending === draft) s.pending = null;
    if (!res.ok) {
      persist();
      return json(res.status, res.body);
    }
    if (s.state !== 'waiting') {
      persist();
      return error(409, 'not waiting: reset first');
    }
    if (res.changed) {
      swap();
      s.village = res.draft;
      header = res.header;
      notify();
    }
    s.draft = res.draft;
    persist();
    return json(200, res.body);
  }

  async function start(text) {
    let draft;
    if (blank(text)) {
      draft = s.draft; // the draft kept by /preview
    } else {
      draft = objectBody(text);
      if (!draft) return error(400, 'the body is a draft: a JSON object');
    }
    if (s.state !== 'waiting') return error(409, 'not waiting: reset first');
    const result = await engine.play(draft, { stopAt: null, nowMs: now(), taken: Object.keys(games()) });
    if (!result.ok) return json(result.status, result.body);
    if (s.state !== 'waiting') return error(409, 'not waiting: reset first');
    data = result;
    releasedTicks = 0;
    swap();
    s.draft = draftOf(result.game);
    s.state = 'playing';
    s.game = { id: result.game.id, started: result.game.started, draft: draftOf(result.game), stopAt: null, released: 0, done: false };
    header = null;
    stats.computeMs = result.computeMs;
    stats.ticks = result.ticks.length;
    stats.lines = result.log.length;
    stats.startedAt = now();
    stats.endedAt = null;
    keepGame(result.game);
    persist();
    notify();
    step();
    return json(200, { game: { id: result.game.id } });
  }

  async function reset(text) {
    let clear = false;
    if (!blank(text)) {
      const body = objectBody(text);
      const usage = 'the body is {"clear": true|false} or nothing';
      if (!body) return error(400, usage);
      for (const [key, value] of Object.entries(body)) {
        if (key !== 'clear' || typeof value !== 'boolean') return error(400, usage);
        clear = value;
      }
    }
    if (s.state === 'playing') await stopGame();
    const draft = clear ? info.default_draft : s.draft;
    const line = await engine.header(draft);
    if (timer !== null) clearTimer(timer);
    timer = null;
    swap();
    s.draft = draft;
    s.village = draft;
    s.state = 'waiting';
    s.game = null;
    data = null;
    releasedTicks = 0;
    header = line;
    persist();
    notify();
    return json(200, { state: 'waiting', run: s.run });
  }

  async function card(query) {
    let id = query.get('game') ?? '';
    if (!id) id = s.game?.id ?? '';
    if (!id || !validGameId(id)) return error(404, 'no such game');
    const tickText = query.get('tick') ?? '';
    const who = query.get('who') ?? '';
    if (!tickText || tickText.length > 9 || /[^0-9]/.test(tickText) || !who) return error(400, CARD_USAGE);
    const tick = Number(tickText);
    const kind = query.has('kind') ? query.get('kind') : null;
    const found = await gameData(id);
    if (!found) return error(404, 'no such decision');
    // card_recorder find_card: the lines start with tick and who, in this order.
    const prefix = `{"tick":${tick},"who":${JSON.stringify(who)},`;
    for (const text of found.data.cards) {
      if (!text.startsWith(prefix)) continue;
      let line;
      try {
        line = JSON.parse(text);
      } catch {
        continue;
      }
      if (kind !== null && line.kind !== kind) continue;
      const cardText = line.card ?? null;
      const rule = line.rule ?? null;
      const policy = cardText === null && rule !== null ? 'baseline' : 'model';
      return { status: 200, text: JSON.stringify({ tick: line.tick, who: line.who, kind: line.kind, policy, card: cardText, rule }), type: 'application/json' };
    }
    return error(404, 'no such decision');
  }

  async function gameFile(id, suffix) {
    if (!validGameId(id)) return error(404, 'no such game');
    if (suffix === '.game.json') {
      const game = games()[id];
      if (!game) return error(404, 'no such game');
      return { status: 200, text: `${JSON.stringify(game, null, 2)}\n`, type: 'application/json' };
    }
    const found = await gameData(id);
    if (!found) return error(404, 'no such game');
    // The game being played: what is out so far, as its file.
    const log = found.current ? found.data.log.slice(0, lineCount()) : found.data.log;
    return { status: 200, text: log.map((l) => `${l}\n`).join(''), type: 'application/x-ndjson' };
  }

  function listGames() {
    const list = Object.values(games()).filter((g) => g && typeof g === 'object' && validGameId(g.id));
    const field = (g, k) => (typeof g[k] === 'string' ? g[k] : '');
    list.sort((a, b) => {
      const sa = field(a, 'started');
      const sb = field(b, 'started');
      if (sa !== sb) return sa > sb ? -1 : 1;
      const ia = field(a, 'id');
      const ib = field(b, 'id');
      if (ia.length !== ib.length) return ib.length - ia.length;
      return ia > ib ? -1 : ia < ib ? 1 : 0;
    });
    return list;
  }

  function postProfile(text) {
    if (new TextEncoder().encode(text ?? '').length > PROFILE_MAX_BYTES) return error(400, 'the profile is over 1 MB');
    const profile = objectBody(text);
    if (!profile) return error(400, 'the profile is a JSON object');
    local.set(PROFILE_KEY, profile);
    return json(200, profile);
  }

  function getProfile() {
    const p = local.get(PROFILE_KEY);
    return json(200, p && typeof p === 'object' && !Array.isArray(p) ? p : { format: 1 });
  }

  /** The routes, with their synchronous part done before any await. */
  function route(method, path, query, body) {
    const key = `${method} ${path}`;
    switch (key) {
      case 'GET state':
        return json(200, stateJson());
      case 'GET control':
        return json(200, controlJson());
      case 'POST control':
        return postControl(body);
      case 'POST viewport':
        return postViewport(body);
      case 'POST inject':
        return error(409, 'a game takes its rumors from the draft (POST /start), not from /inject');
      case 'POST extract':
        return error(501, 'there is no model: play Sin IA');
      case 'POST preview': {
        const draft = objectBody(body);
        if (!draft) return error(400, 'the body is a draft: a JSON object');
        if (s.state === 'waiting') {
          s.pending = draft;
          persist();
        }
        return preview(draft);
      }
      case 'POST start':
        return start(body);
      case 'POST stop':
        if (s.state !== 'playing') return error(409, 'no game is being played');
        return stopGame().then(() => json(200, { state: 'ended', game: { id: s.game.id } }));
      case 'POST reset':
        return reset(body);
      case 'POST quit':
        // The tab is the game: nothing to close.
        return json(200, { quit: true });
      case 'GET card':
        return card(query);
      case 'GET games':
        return json(200, { games: listGames() });
      case 'GET profile':
        return getProfile();
      case 'POST profile':
        return postProfile(body);
      case 'GET timetable':
        return info.timetable && typeof info.timetable === 'object' ? json(200, info.timetable) : error(500, 'the timetable cannot be read');
      default: {
        const m = /^games\/([^/]+)(\.game\.json|\.jsonl)$/.exec(path);
        if (method === 'GET' && m) return gameFile(m[1], m[2]);
        return error(404, `no route ${method} /${path}`);
      }
    }
  }

  /** The session of the tab back, or a fresh one; the game computed again. */
  async function restore() {
    info = await engine.info();
    const saved = session.get(SESSION_KEY);
    s = saved && saved.v === SESSION_VERSION && saved.control && saved.draft ? saved : fresh();
    s.control = { ...DEFAULT_CONTROL, ...s.control };
    try {
      if (s.state === 'waiting' || !s.game) {
        s.state = 'waiting';
        s.game = null;
        header = await engine.header(s.village ?? s.draft);
      } else {
        const result = await playGame({ ...s.game.draft, id: s.game.id, started: s.game.started }, s.game.stopAt ?? null);
        if (!result.ok) throw new Error(JSON.stringify(result.body));
        data = result;
        releasedTicks = s.game.done ? result.ticks.length : Math.min(Number(s.game.released) || 0, result.ticks.length);
        stats.computeMs = result.computeMs;
        stats.ticks = result.ticks.length;
        stats.lines = result.log.length;
      }
    } catch (err) {
      console.warn('web: the session of this tab cannot be restored; a new one starts', err);
      s = fresh();
      data = null;
      releasedTicks = 0;
      header = await engine.header(s.village);
    }
    if (s.pending && s.state === 'waiting') await preview(s.pending);
    s.pending = null;
    persist();
  }

  const ready = restore().then(() => {
    isReady = true;
    step();
  });

  return {
    ready,
    /**
     * One request. `path` is relative to the folder of the page ("state",
     * "games/<id>.jsonl"); `query` its URLSearchParams.
     * @returns {Promise<{status: number, body?: any, text?: string, type?: string}>}
     */
    async handle(method, path, query = new URLSearchParams(), body = '') {
      if (!isReady) await ready;
      try {
        return await route(method, path, query, body);
      } catch (err) {
        console.error('web: internal error', err);
        return error(500, err?.message ?? 'internal error');
      }
    },
    /** The run of the stream (`events`) and its lines, for fake.js. */
    stream: {
      run: () => s?.run ?? null,
      count: () => (s ? lineCount() : 0),
      lines: (from) => (s ? lines(from) : []),
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    /** What the smoke test measures: compute time, ticks, lines, wall times. */
    stats: () => ({ ...stats, state: s?.state ?? null, released: releasedTicks }),
  };
}
