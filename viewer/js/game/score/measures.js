// The common measures of the game (docs/juego.md, «Medidas comunes»). Pure
// functions over a recording {header, events}, the same in both modes.
//
//   inject.to ─┐
//              ├─► who knows which fact since which tick (first time only)
//   turn tell ─┘      │
//                     ├─► informedAt / informedEnd / halfTick / subjectTick / arrivalOrder
//   inject.to ────────┴─► toldDirectly
//   first arrive per neighbor + original where/when ─► attendOk (the engine's attendance.right)
//   last `memory` of the last of the row (slot when) ─► lastWhenShift
//   informed + `memory` of slot when ─► noGoodHour ─┬─► telephonePoints
//                               lastWhenShift ──────┘
//   turn tell by speaker + conv_start place ─► topTellers («Quién lo movió»)
//   informed − speakers of a tell ──────────► keptQuiet  («Dónde se paró»)
//
// "Facts" arguments take a fact id, a list of ids, or null/undefined for any
// fact. Measures of one rumor (attendOk, halfTick, lastWhenShift) default to
// the first fact injected.

import { MINUTES_PER_DAY } from '../../core/clock.js';
import { holds } from '../../core/version.js';
import { parseWhen } from '../../live/inject.js';
import { isTell } from '../../rumor/history.js';

/**
 * @typedef {{header: object, events: object[]}} Log a recording, as loadLog
 *   (core/testing.js) or the store gives it
 */

/**
 * @typedef {object} Inform how a neighbor first came to know a fact
 * @property {string} who
 * @property {string} fact
 * @property {number} tick
 * @property {number} i position of the inject or turn in events
 * @property {string|null} from speaker; null for an inject
 */

// Index of the informs of a log, built once per events array.
const cache = new WeakMap();

/**
 * Every first inform of the log, in log order, and by fact.
 * @param {Log} log
 * @returns {{list: Inform[], byFact: Map<string, Map<string, Inform>>, injects: object[]}}
 */
function index(log) {
  const events = log.events ?? [];
  const hit = cache.get(events);
  if (hit && hit.size === events.length) return hit.value;
  const list = [];
  const byFact = new Map();
  const injects = [];
  const add = (who, fact, tick, i, from) => {
    let m = byFact.get(fact);
    if (!m) byFact.set(fact, (m = new Map()));
    if (m.has(who)) return;
    const x = { who, fact, tick, i, from };
    m.set(who, x);
    list.push(x);
  };
  events.forEach((e, i) => {
    if (e.type === 'inject') {
      injects.push(e);
      for (const who of e.to ?? []) add(who, e.fact, e.tick, i, null);
    } else if (isTell(e)) {
      add(e.to, e.fact, e.tick, i, e.who);
    }
  });
  const value = { list, byFact, injects };
  cache.set(events, { size: events.length, value });
  return value;
}

/** A facts argument as a predicate. */
function factFilter(facts) {
  if (facts === null || facts === undefined) return () => true;
  const set = new Set(Array.isArray(facts) ? facts : [facts]);
  return (f) => set.has(f);
}

/**
 * The facts injected, in inject order, without repeats.
 * @param {Log} log
 * @returns {string[]}
 */
export function factsOf(log) {
  return [...new Set(index(log).injects.map((e) => e.fact))];
}

/**
 * The first inject of a fact (default: the first inject of the log).
 * @param {Log} log
 * @param {string|null} [fact]
 * @returns {object|null} the `inject` event
 */
export function injectOf(log, fact = null) {
  const injects = index(log).injects;
  if (fact === null || fact === undefined) return injects[0] ?? null;
  return injects.find((e) => e.fact === fact) ?? null;
}

/** The fact a one-rumor measure is about: the one given, else the first injected. */
function oneFact(log, fact) {
  return fact ?? injectOf(log)?.fact ?? null;
}

/**
 * Mode of a recording: "ai" with the model, "rules" with the baseline.
 * @param {object} header
 * @returns {'ai'|'rules'}
 */
export function modeOf(header) {
  return header?.policy === 'model' ? 'ai' : 'rules';
}

/**
 * Last tick of a recording: its `end` event, else its last event, else the
 * start.
 * @param {Log} log
 * @returns {number}
 */
export function endTick(log) {
  const events = log.events ?? [];
  const last = events[events.length - 1];
  return last ? last.tick : (log.header?.start_tick ?? 0);
}

/**
 * Tick of a time: a number is already a tick; "HH:MM" is day 0; "hoy HH:MM",
 * "today HH:MM", "mañana HH:MM", "tomorrow HH:MM" are day 0 or day 1 (games
 * start on day 0, so "today" is day 0, as for the engine).
 * @param {string|number|null|undefined} at
 * @returns {number|null} null when it cannot be read
 */
export function tickOfTime(at) {
  if (typeof at === 'number') return Number.isFinite(at) ? Math.floor(at) : null;
  if (typeof at !== 'string') return null;
  const plain = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(at);
  if (plain) {
    const h = Number(plain[1]);
    const m = Number(plain[2]);
    return h < 24 && m < 60 ? h * 60 + m : null;
  }
  const w = parseWhen(at);
  if (!w) return null;
  const [h, m] = w.time.split(':').map(Number);
  return (w.day === 'tomorrow' ? MINUTES_PER_DAY : 0) + h * 60 + m;
}

/**
 * Neighbors who know any of `facts` by the end of `tick` (an inject names
 * them in `to`, or a not rejected `turn` with act `tell` reaches them).
 * @param {Log} log
 * @param {number} tick
 * @param {string|string[]|null} [facts] default any fact
 * @returns {Set<string>}
 */
export function informedAt(log, tick, facts = null) {
  const ok = factFilter(facts);
  const out = new Set();
  for (const x of index(log).list) if (x.tick <= tick && ok(x.fact)) out.add(x.who);
  return out;
}

/**
 * Neighbors who know any of `facts` at the end of the recording.
 * @param {Log} log
 * @param {string|string[]|null} [facts] default any fact
 * @returns {Set<string>}
 */
export function informedEnd(log, facts = null) {
  return informedAt(log, Infinity, facts);
}

/**
 * Neighbors who know a fact, in the order the fact reached them (tick, then
 * log order): the order of the bet «¿Quién será el último en enterarse?».
 * @param {Log} log
 * @param {string|null} [fact] default the first injected
 * @returns {{who: string, tick: number, from: string|null}[]}
 */
export function arrivalOrder(log, fact = null) {
  const f = oneFact(log, fact);
  const m = f === null ? undefined : index(log).byFact.get(f);
  if (!m) return [];
  return [...m.values()].sort((a, b) => a.tick - b.tick || a.i - b.i).map(({ who, tick, from }) => ({ who, tick, from }));
}

/**
 * «Hora de la mitad»: the first tick at which the neighbors who know the fact
 * reach half the village, rounding up (13 of 25, 50 of 100, 10 of 20).
 * @param {Log} log
 * @param {string|null} [fact] default the first injected
 * @returns {number|null} null when it never gets there
 */
export function halfTick(log, fact = null) {
  const n = (log.header?.neighbors ?? []).length;
  const need = Math.ceil(n / 2);
  const order = arrivalOrder(log, fact);
  if (need === 0 || order.length < need) return null;
  return order[need - 1].tick;
}

/**
 * «Acuden bien»: neighbors whose first `arrive` for the fact is at the
 * original place (`where`, a place id in the inject) and at the original hour
 * (`when`, a slot). The first arrive of each neighbor, like `attendance.right`
 * of the engine's metrics (engine/src/metrics/metrics.cpp).
 * @param {Log} log
 * @param {string|null} [fact] default the first injected
 * @returns {number}
 */
export function attendOk(log, fact = null) {
  const inj = injectOf(log, oneFact(log, fact));
  if (!inj) return 0;
  const where = inj.slots?.where ?? null;
  const when = inj.slots?.when ?? null;
  if (where === null || when === null) return 0;
  const seen = new Set();
  let n = 0;
  for (const e of log.events ?? []) {
    if (e.type !== 'arrive' || e.fact !== inj.fact || seen.has(e.who)) continue;
    seen.add(e.who);
    if (e.place === where && e.slot === when) n++;
  }
  return n;
}

/**
 * The last neighbor of the row in the telephone: the highest id, as the row
 * is laid out (render/layout.js, rumor/strip.js).
 * @param {object} header
 * @returns {string|null}
 */
export function lastOfRow(header) {
  const ids = (header?.neighbors ?? []).map((n) => n.id).sort();
  return ids.length ? ids[ids.length - 1] : null;
}

/**
 * Teléfono roto: how many half hours the hour that reached the furthest
 * neighbor of the row is away from the original `when`: that neighbor's last
 * version of slot `when` with a value (sure or doubt), even if forgotten later
 * (telephone-20 forgets fast). The furthest, not the last of the row: with the
 * model the chain is often cut halfway (phase 9 calibration, decided by the
 * user on 2026-11-17).
 * @param {Log} log
 * @param {string|null} [fact] default the first injected
 * @returns {number|null} null when the original has no hour or no hour reached anybody
 */
export function lastWhenShift(log, fact = null) {
  const inj = injectOf(log, oneFact(log, fact));
  const original = inj?.slots?.when ?? null;
  if (!inj || original === null) return null;
  const held = new Map(); // who -> last memory of `when`
  for (const e of log.events ?? []) {
    if (e.type === 'memory' && e.fact === inj.fact && e.slot === 'when' && holds(e.state) && e.value !== null && e.value !== undefined) held.set(e.who, e);
  }
  const row = (log.header?.neighbors ?? []).map((n) => n.id).sort().reverse();
  for (const who of row) {
    const mem = held.get(who);
    if (mem && holds(mem.state) && mem.value !== null && mem.value !== undefined) return Math.abs(original - mem.value);
  }
  return null;
}

/**
 * Neighbors who know a fact but never held its original hour (slot `when`,
 * sure or doubt): they heard it changed, or with no hour at all.
 * @param {Log} log
 * @param {string|null} [fact] default the first injected
 * @returns {number|null} null when the original has no hour
 */
export function noGoodHour(log, fact = null) {
  const inj = injectOf(log, oneFact(log, fact));
  const original = inj?.slots?.when ?? null;
  if (!inj || original === null) return null;
  const good = new Set();
  for (const e of log.events ?? []) {
    if (e.type === 'memory' && e.fact === inj.fact && e.slot === 'when' && holds(e.state) && e.value === original) good.add(e.who);
  }
  let n = 0;
  for (const who of index(log).byFact.get(inj.fact)?.keys() ?? []) if (!good.has(who)) n++;
  return n;
}

/**
 * Teléfono roto: one point per neighbor of the row without the right hour
 * (noGoodHour) plus one per half hour of lastWhenShift. With the model the
 * hour is forgotten, not changed, so the first term scores; with the rules
 * everybody hears it and the second one tells villages apart (phase 9-1).
 * @param {Log} log
 * @param {string|null} [fact] default the first injected
 * @returns {number|null} null when the original has no hour
 */
export function telephonePoints(log, fact = null) {
  const n = noGoodHour(log, fact);
  return n === null ? null : n + (lastWhenShift(log, fact) ?? 0);
}

/**
 * Tick at which a neighbor first knows any of `facts`.
 * @param {Log} log
 * @param {string} who
 * @param {string|string[]|null} [facts] default any fact
 * @returns {number|null} null when it never does
 */
export function subjectTick(log, who, facts = null) {
  const ok = factFilter(facts);
  for (const x of index(log).list) if (x.who === who && ok(x.fact)) return x.tick;
  return null;
}

/**
 * «Contado directamente»: the neighbor is in the `to` of some inject (a rumor
 * dropped at a place counts too: the engine names who was there).
 * @param {Log} log
 * @param {string} who
 * @returns {boolean}
 */
export function toldDirectly(log, who) {
  return index(log).injects.some((e) => (e.to ?? []).includes(who));
}

/**
 * The priest: the neighbor with job "priest" in the header.
 * @param {object} header
 * @returns {string|null} its id
 */
export function priestOf(header) {
  return (header?.neighbors ?? []).find((n) => n.job === 'priest')?.id ?? null;
}

/**
 * Id of a neighbor given by id or by name (any case).
 * @param {object} header
 * @param {string|null|undefined} x
 * @returns {string|null}
 */
export function neighborId(header, x) {
  if (x === null || x === undefined || x === '') return null;
  const list = header?.neighbors ?? [];
  const s = String(x);
  if (list.some((n) => n.id === s)) return s;
  const low = s.toLocaleLowerCase();
  return list.find((n) => String(n.name).toLocaleLowerCase() === low)?.id ?? null;
}

/**
 * @typedef {object} Mover a neighbor who told a fact («Quién lo movió»)
 * @property {string} who
 * @property {number} tells valid `tell` turns of the fact by them
 * @property {number} firsts neighbors who first heard the fact from them
 * @property {string|null} place id of the place where they told it most
 *   (the `place` of the conversation, conv_start); ties go to the place where
 *   they told it first; null when no conversation of theirs has a place
 */

/**
 * «Quién lo movió»: the neighbors who told a fact most, in the order of the
 * summary's «Quién lo contó más» (summary/ranking.js): most tells, then most
 * firsts, then id.
 * @param {Log} log
 * @param {string|null} [fact] default the first injected
 * @param {number} [n] how many, default 3
 * @returns {Mover[]}
 */
export function topTellers(log, fact = null, n = 3) {
  const f = oneFact(log, fact);
  if (f === null) return [];
  const convPlace = new Map();
  const movers = new Map();
  for (const e of log.events ?? []) {
    if (e.type === 'conv_start') convPlace.set(e.conv, e.place ?? null);
    else if (isTell(e) && e.fact === f) {
      let m = movers.get(e.who);
      if (!m) movers.set(e.who, (m = { who: e.who, tells: 0, firsts: 0, places: new Map() }));
      m.tells++;
      const p = convPlace.get(e.conv) ?? null;
      if (p !== null) m.places.set(p, (m.places.get(p) ?? 0) + 1);
    }
  }
  for (const x of index(log).byFact.get(f)?.values() ?? []) {
    const m = x.from ? movers.get(x.from) : null;
    if (m) m.firsts++;
  }
  const byId = (a, b) => (a.who < b.who ? -1 : a.who > b.who ? 1 : 0);
  return [...movers.values()]
    .sort((a, b) => b.tells - a.tells || b.firsts - a.firsts || byId(a, b))
    .slice(0, Math.max(0, n))
    .map(({ who, tells, firsts, places }) => {
      // Map order is the order of the first tell at each place: the first wins a tie.
      let place = null;
      let most = 0;
      for (const [p, k] of places) if (k > most) [place, most] = [p, k];
      return { who, tells, firsts, place };
    });
}

/**
 * «Dónde se paró»: the neighbors who knew a fact and never told it to anybody
 * (no valid `tell` of that fact by them), in the order the fact reached them.
 * The recipients of the player's rumor count too.
 * @param {Log} log
 * @param {string|null} [fact] default the first injected
 * @returns {{who: string, tick: number}[]}
 */
export function keptQuiet(log, fact = null) {
  const f = oneFact(log, fact);
  if (f === null) return [];
  const told = new Set();
  for (const e of log.events ?? []) if (isTell(e) && e.fact === f) told.add(e.who);
  return arrivalOrder(log, f)
    .filter((x) => !told.has(x.who))
    .map(({ who, tick }) => ({ who, tick }));
}
