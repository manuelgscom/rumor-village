// The rumor seen from afar (pure, no three.js, no DOM): the trail of the
// contagion over the last hours, the tint of each place by the versions of the
// people there, and the beacons of the consequences.
//
//   trail     one stretch per tell not rejected, from the place where the
//             teller heard the rumor to the place of the conversation where
//             it tells it; green if every slot passed as it was, red if any
//             changed (rumor/chain.js hopSlot). Fades in TRAIL_TICKS ticks.
//
//        heard it at the bar          tells it at the market
//              ● ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━► ●
//                      faint ············ strong
//
//             Same place (heard and told at the bar): a pulse on the ground.
//   tint      per place, how many of the people there hold each version (the
//             bar of the place labels, scene/labels.js)
//   beacons   green at the original place during its hour, amber at the
//             original place where people arrive at another hour, red at
//             another place where people arrive (rumor/groups.js)
//   race      with two rumors (app.race, phase 9) the trail and the tint go by
//             rumor instead of by version: raceTrailsAt and raceTintAt, in the
//             colours of rumor/race.js
//
// Where the teller heard it: the place of the conversation of the tell that
// first reached it; for the neighbors named by the inject, the last place they
// were seen at before it (the `to` of their last move or the place of their
// last conversation), or, when nothing was seen yet, the place where they tell
// it for the first time (a pulse).
//
// Everything is a function of (events[0..index), pos, fact): an index built
// incrementally over the events array (they are only appended) is cached in a
// WeakMap, and every query filters it by position, so playing up to a position
// or jumping to it gives the same answer.

import { slotTick, MINUTES_PER_SLOT } from '../core/clock.js';
import { VERSION_COLORS } from '../core/theme.js';
import { SLOTS, versionOf } from '../core/version.js';
import { hopSlot } from '../rumor/chain.js';
import { groupsAt } from '../rumor/groups.js';
import { createHistory, isTell } from '../rumor/history.js';
import { RACE_COLORS } from '../rumor/race.js';

/** Life of a stretch of the trail, in ticks (three simulated hours). */
export const TRAIL_TICKS = 180;

/** Share of the life (0..1) a stretch keeps its full strength before fading. */
export const TRAIL_HOLD = 0.15;

/** Versions in the order of the bar of a place. */
export const TINT_ORDER = ['correct', 'incomplete', 'wrong', 'unknown'];

/** A beacon lights up this many ticks before its hour and lasts the hour. */
export const BEACON = { before: 30, after: MINUTES_PER_SLOT * 2 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Opacity of a stretch at an age (0 just told, 1 gone): full while young,
 * then a smooth fade to nothing.
 * @param {number} age 0..1
 */
export function trailFade(age) {
  return 1 - smooth(TRAIL_HOLD, 1, age);
}

/**
 * @typedef {object} Stretch
 * @property {number} i position of the turn
 * @property {number} tick
 * @property {string} fact
 * @property {string} who teller
 * @property {string} listener
 * @property {string} from place where the teller heard it
 * @property {string} to place of the conversation
 * @property {boolean} changed some slot changed in this hop
 */

/** @type {WeakMap<object[], ReturnType<typeof newIndex>>} */
const INDEXES = new WeakMap();

function newIndex() {
  return {
    n: 0,
    h: createHistory(),
    /** conv id → place */
    convPlace: new Map(),
    /** neighbor → last place seen (move.to or conv_start.place) */
    lastPlace: new Map(),
    /** `${who}|${fact}` → place where it first heard the fact (null: unknown yet) */
    heard: new Map(),
    /** fact → stretches in log order */
    tells: new Map(),
  };
}

/**
 * The index of an events array, extended to its current length.
 * @param {object[]} events store.events (only appended)
 */
function indexOf(events) {
  let ix = INDEXES.get(events);
  if (!ix || ix.n > events.length) {
    ix = newIndex();
    INDEXES.set(events, ix);
  }
  if (ix.n === events.length) return ix;
  ix.h.ingest(events);
  for (let i = ix.n; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case 'move':
        ix.lastPlace.set(e.who, e.to);
        break;
      case 'conv_start':
        ix.convPlace.set(e.conv, e.place);
        ix.lastPlace.set(e.a, e.place);
        ix.lastPlace.set(e.b, e.place);
        break;
      case 'inject':
        for (const who of e.to ?? []) {
          const k = `${who}|${e.fact}`;
          if (!ix.heard.has(k)) ix.heard.set(k, ix.lastPlace.get(who) ?? null);
        }
        break;
      case 'turn': {
        if (!isTell(e)) break;
        const at = ix.convPlace.get(e.conv) ?? null;
        if (at === null) break;
        const from = ix.heard.get(`${e.who}|${e.fact}`) ?? at;
        const k = `${e.to}|${e.fact}`;
        if (!ix.heard.has(k) || ix.heard.get(k) === null) ix.heard.set(k, at);
        const changed = SLOTS.some((s) => hopSlot(ix.h, e, i, e.fact, s).changed);
        let list = ix.tells.get(e.fact);
        if (!list) ix.tells.set(e.fact, (list = []));
        list.push({ i, tick: e.tick, fact: e.fact, who: e.who, listener: e.to, from, to: at, changed });
        break;
      }
      default:
        break;
    }
  }
  ix.n = events.length;
  return ix;
}

/** Number of items of a list sorted by `i` with i < idx. */
function countBefore(list, idx) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].i < idx) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The trail of a fact at a position: the stretches of the last `ticks` ticks,
 * oldest first.
 * @param {object[]} events store.events
 * @param {number} index store.index (events applied)
 * @param {number} pos playback position
 * @param {string|null} fact
 * @param {number} [ticks]
 * @returns {(Stretch & {age: number, alpha: number})[]}
 */
export function trailsAt(events, index, pos, fact, ticks = TRAIL_TICKS) {
  if (!fact) return [];
  const list = indexOf(events).tells.get(fact);
  if (!list) return [];
  const out = [];
  for (let k = countBefore(list, Math.min(index, events.length)) - 1; k >= 0; k--) {
    const s = list[k];
    if (s.tick > pos) continue;
    if (s.tick <= pos - ticks) break;
    const age = clamp01((pos - s.tick) / ticks);
    out.push({ ...s, age, alpha: trailFade(age) });
  }
  return out.reverse();
}

/**
 * Stretches merged by way (from, to, changed): what is drawn. `n` tells, the
 * strongest alpha and the youngest age. Pulses (from === to) come apart.
 * @param {ReturnType<typeof trailsAt>} trails
 * @returns {{ways: {from: string, to: string, changed: boolean, n: number, alpha: number, age: number}[], pulses: {place: string, changed: boolean, n: number, alpha: number, age: number}[]}}
 */
export function mergeTrails(trails) {
  const ways = new Map();
  const pulses = new Map();
  for (const t of trails) {
    const same = t.from === t.to;
    const key = same ? `${t.to}|${t.changed}` : `${t.from}>${t.to}|${t.changed}`;
    const map = same ? pulses : ways;
    let w = map.get(key);
    if (!w) {
      w = same ? { place: t.to, changed: t.changed, n: 0, alpha: 0, age: 1 } : { from: t.from, to: t.to, changed: t.changed, n: 0, alpha: 0, age: 1 };
      map.set(key, w);
    }
    w.n++;
    w.alpha = Math.max(w.alpha, t.alpha);
    w.age = Math.min(w.age, t.age);
  }
  // Faithful first, so the red ones are drawn on top.
  const order = (a, b) => Number(a.changed) - Number(b.changed) || a.alpha - b.alpha;
  return { ways: [...ways.values()].sort(order), pulses: [...pulses.values()].sort(order) };
}

/**
 * The trails of the two rumors of a race, merged by way and side (0 or 1)
 * instead of by change: what is drawn in the race colours. Faintest first, so
 * the strongest stretch is drawn on top.
 * @param {object[]} events store.events
 * @param {number} index store.index
 * @param {number} pos
 * @param {[string, string]} race app.race
 * @param {number} [ticks]
 * @returns {{ways: {from: string, to: string, side: 0|1, n: number, alpha: number, age: number}[], pulses: {place: string, side: 0|1, n: number, alpha: number, age: number}[]}}
 */
export function raceTrailsAt(events, index, pos, race, ticks = TRAIL_TICKS) {
  const ways = [];
  const pulses = [];
  race.forEach((fact, side) => {
    const m = mergeTrails(trailsAt(events, index, pos, fact, ticks).map((t) => ({ ...t, changed: false })));
    for (const { changed, ...w } of m.ways) ways.push({ ...w, side });
    for (const { changed, ...p } of m.pulses) pulses.push({ ...p, side });
  });
  const order = (a, b) => a.alpha - b.alpha || a.side - b.side;
  return { ways: ways.sort(order), pulses: pulses.sort(order) };
}

/**
 * @typedef {object} Tint
 * @property {number} n people at the place
 * @property {number} correct
 * @property {number} incomplete
 * @property {number} wrong
 * @property {number} unknown has not heard of the fact
 */

/**
 * Per place, how many of the people there hold each version of a fact.
 * @param {import('../core/reduce.js').State} state
 * @param {string|null} fact
 * @param {Map<string, string>} placeOf neighbor → place (not travelling), render/layout.js placeLayout
 * @returns {Map<string, Tint>}
 */
export function tintAt(state, fact, placeOf) {
  const original = fact ? state?.facts.get(fact)?.slots : undefined;
  const out = new Map();
  for (const [id, place] of placeOf) {
    let t = out.get(place);
    if (!t) out.set(place, (t = { n: 0, correct: 0, incomplete: 0, wrong: 0, unknown: 0 }));
    t.n++;
    const v = original ? versionOf(state.neighbors.get(id)?.memory[fact], original) : null;
    t[v ?? 'unknown']++;
  }
  return out;
}

/**
 * How a tint is drawn: its keys in order (the last one, `unknown`, is the
 * people who know nothing) and the colour of each.
 * @typedef {{order: string[], colors: Object<string, string>}} TintPalette
 */

/** @type {TintPalette} The versions of one fact (tintAt). */
export const VERSION_TINT = { order: TINT_ORDER, colors: VERSION_COLORS };

/** @type {TintPalette} The two rumors of a race (raceTintAt). */
export const RACE_TINT = { order: ['first', 'second', 'unknown'], colors: { first: RACE_COLORS[0], second: RACE_COLORS[1], unknown: VERSION_COLORS.unknown } };

/**
 * Per place, how many of the people there are on each side of a race (the
 * rumor they heard first, rumor/race.js) and how many know neither.
 * @param {Map<string, 0|1>} sides rumor/race.js raceSides
 * @param {Map<string, string>} placeOf neighbor → place (not travelling)
 * @returns {Map<string, {n: number, first: number, second: number, unknown: number}>}
 */
export function raceTintAt(sides, placeOf) {
  const out = new Map();
  for (const [id, place] of placeOf) {
    let t = out.get(place);
    if (!t) out.set(place, (t = { n: 0, first: 0, second: 0, unknown: 0 }));
    t.n++;
    const side = sides.get(id);
    t[side === 0 ? 'first' : side === 1 ? 'second' : 'unknown']++;
  }
  return out;
}

/**
 * CSS gradient of the bar of a place ('' when nobody there knows).
 * @param {{n: number, unknown: number}|undefined} t a Tint, or a race tint with RACE_TINT
 * @param {TintPalette} [palette]
 * @returns {string}
 */
export function tintBar(t, palette = VERSION_TINT) {
  if (!t || !t.n || t.unknown === t.n) return '';
  const stops = [];
  let at = 0;
  for (const v of palette.order) {
    if (!t[v]) continue;
    const from = (at / t.n) * 100;
    at += t[v];
    stops.push(`${palette.colors[v]} ${from.toFixed(1)}% ${((at / t.n) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/**
 * @typedef {object} Beacon
 * @property {'right'|'other_time'|'other_place'} kind
 * @property {string} place
 * @property {number} slot the hour it stands for
 * @property {number} n people who arrived for it so far (0: the original before anyone)
 * @property {number} strength 0..1, rises before the hour and falls after it
 */

/** @type {WeakMap<object[], {h: ReturnType<typeof createHistory>, byFact: Map<string, {key: string, groups: any}>}>} */
const HISTORIES = new WeakMap();

/**
 * The beacons of a fact at a position: the original place during its hour,
 * and every place and hour where people arrived for it (rumor/groups.js:
 * right, other_time, other_place), each lit around its hour.
 * @param {object[]} events store.events
 * @param {number} index store.index
 * @param {number} pos
 * @param {string|null} fact
 * @param {string[]} ids every neighbor id
 * @returns {Beacon[]}
 */
export function beaconsAt(events, index, pos, fact, ids) {
  if (!fact) return [];
  let memo = HISTORIES.get(events);
  if (!memo || memo.h.size > events.length) HISTORIES.set(events, (memo = { h: createHistory(), byFact: new Map() }));
  const { h } = memo;
  h.ingest(events);
  const idx = Math.min(index, events.length);
  const inj = h.inject(fact, idx);
  if (!inj) return [];
  const strength = (slot) => {
    const t = slotTick(slot);
    return smooth(t - BEACON.before, t, pos) * (1 - smooth(t + BEACON.after - 15, t + BEACON.after, pos));
  };
  const out = new Map();
  const where = inj.e.slots?.where ?? null;
  const when = inj.e.slots?.when ?? null;
  if (where !== null && when !== null) out.set(`right|${where}|${when}`, { kind: 'right', place: where, slot: when, n: 0, strength: strength(when) });
  // The groups change only with the events applied and the tick: kept for the
  // frames between, per fact (a race asks for two).
  const key = `${idx}|${Math.floor(pos)}|${ids.length}`;
  let g = memo.byFact.get(fact);
  if (!g) memo.byFact.set(fact, (g = { key: '', groups: null }));
  if (g.key !== key) {
    g.key = key;
    g.groups = groupsAt(h, fact, idx, Math.floor(pos), ids);
  }
  const groups = g.groups;
  for (const kind of ['right', 'other_time', 'other_place']) {
    for (const m of groups?.[kind] ?? []) {
      if (!m.arrived) continue;
      const key = `${kind}|${m.place}|${m.slot}`;
      let b = out.get(key);
      if (!b) out.set(key, (b = { kind, place: m.place, slot: m.slot, n: 0, strength: strength(m.slot) }));
      b.n++;
    }
  }
  return [...out.values()].filter((b) => b.strength > 0.001);
}
