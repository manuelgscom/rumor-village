// Helpers of the tests of viewer/js/web/: a clock with timers, memory
// stores, and an engine that plays a tiny made-up game (no wasm).

import { createStore } from './storage.js';

/** A clock that only moves when told, with the timers it fires. */
export function fakeClock(start = 1_000_000) {
  let t = start;
  let timers = [];
  let next = 1;
  return {
    now: () => t,
    setTimer(fn, ms) {
      const id = next++;
      timers.push({ id, at: t + Math.max(0, ms), fn });
      return id;
    },
    clearTimer(id) {
      timers = timers.filter((x) => x.id !== id);
    },
    /** Moves the clock, firing every timer due on the way. */
    advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const due = timers[0];
        if (!due || due.at > end) break;
        timers.shift();
        t = Math.max(t, due.at);
        due.fn();
      }
      t = end;
    },
    pending: () => timers.length,
  };
}

/** A store over a Map (a working Web Storage). */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

export const memoryStore = (storage = memoryStorage()) => createStore(() => storage);

export const DEFAULT_DRAFT = Object.freeze({
  settings: { distortion: 'normal', lang: 'es', mode: 'rules', neighbors: 25, town: 1, trait_mix: 0, type: 'village' },
  rumors: [],
  challenge: null,
  bets: null,
  race: null,
});

const headerOf = (draft) =>
  JSON.stringify({ format: 1, seed: draft?.settings?.town ?? 1, scenario: 'party-25', neighbors: [{ id: 'n001' }, { id: 'n002' }, { id: 'n003' }] });

const normalize = (draft) => ({
  settings: { ...DEFAULT_DRAFT.settings, ...(draft.settings ?? {}) },
  rumors: draft.rumors ?? [],
  challenge: draft.challenge ?? null,
  bets: draft.bets ?? null,
  race: draft.race ?? null,
});

/**
 * An engine with the shape of engine.js wrapModule: a game of `ticks` ticks
 * (from 100), one event per tick and a card per tick; even ticks are quiet.
 * A draft with settings.town 0 is invalid; one without rumors cannot start.
 */
export function fakeEngine({ ticks: count = 10 } = {}) {
  const calls = [];
  return {
    calls,
    info: async () => ({ version: '1.0.0-test', challenges: [{ id: 'c1', order: 1 }], timetable: { jobs: {} }, default_draft: DEFAULT_DRAFT }),
    header: async (draft) => headerOf(draft),
    preview: async (draft, village) => {
      calls.push(['preview', draft]);
      if (draft?.settings?.town === 0) return { ok: false, status: 400, body: { errors: [{ rumor: null, field: 'settings', error: 'town' }] } };
      const n = normalize(draft);
      const changed = !village || village.settings?.town !== n.settings.town;
      const header = headerOf(changed ? n : village);
      return { ok: true, status: 200, body: { header: JSON.parse(header), town_changed: changed }, draft: n, changed, header };
    },
    play: async (draft, { stopAt = null, id, started, nowMs } = {}) => {
      calls.push(['play', draft, stopAt]);
      if (!draft?.rumors?.length) return { ok: false, status: 400, body: { errors: [{ rumor: null, field: 'rumors', error: 'empty' }] } };
      const n = normalize(draft);
      const gameId = id ?? `20261117-100405-rules-t${n.settings.town}`;
      const log = [headerOf(n)];
      const cards = [];
      const tickList = [];
      let end = 100 + count;
      for (let t = 100; t < 100 + count; t++) {
        if (stopAt !== null && t >= stopAt) {
          end = t;
          break;
        }
        log.push(JSON.stringify({ type: 'move', tick: t }));
        cards.push(JSON.stringify({ tick: t, who: 'n001', kind: 'turn', card: null, rule: { rule: 'tell_chance', rolls: [] } }));
        tickList.push([t, t % 2 === 0 ? 1 : 0, log.length]);
      }
      log.push(JSON.stringify({ type: 'end', tick: end, informed: tickList.length }));
      const game = { format: 1, id: gameId, game_version: 1, started: started ?? new Date(nowMs ?? 0).toISOString().replace(/\.\d{3}Z$/, 'Z'), ended: null, ...n, stopped: false, end_tick: null };
      return { ok: true, game, gameText: `${JSON.stringify(game, null, 2)}\n`, ticks: tickList, log, cards, endTick: end, computeMs: 1 };
    },
  };
}

export const RUMOR = { fact: { what: 'party' }, to: { neighbors: ['n001'] }, at: 'start' };
