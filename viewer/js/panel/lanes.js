// Batch panel logic (no DOM). Every decision with `gen` (turn and plan) is an
// interval [t0, t1) in milliseconds since the start of the run. The intervals
// of the whole log are split into lanes, one per sequence of the batch:
//
//   greedy interval partitioning by t0 (ties by id), each one into the first
//   lane that is free at its t0 → no overlap inside a lane, and as many lanes
//   as the maximum number of intervals at the same time (the minimum).
//
// Playback clock of the batch: the fraction of the playback position inside
// its tick is turned into milliseconds inside the window of that tick, from
// the smallest t0 to the largest t1 of its generations:
//
//   tick 1211          pos 1211.5
//   ├────────────────────┼────────────────────┤
//   min t0 2000      ms = 2320          max t1 2640
//   lane 1  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░     turn 4  2000–2420
//   lane 2  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░     turn 5  2000–2560
//   lane 3   ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░    turn 6  2010–2640
//
// A tick without generations shows, idle, the generations of the last tick
// that had them. Everything is a function of the events and the position.

import { claimSummary } from '../core/names.js';
import { fill } from './strings.js';

/**
 * @typedef {object} GenItem
 * @property {object} event the turn or plan event
 * @property {number} tick
 * @property {number} t0
 * @property {number} t1 never below t0
 * @property {number} lane 0-based
 */

/**
 * @typedef {object} BatchIndex
 * @property {GenItem[]} items in (t0, id) order
 * @property {number} laneCount
 * @property {number[]} ticks ticks with generations, ascending
 * @property {Map<number, {tick: number, t0: number, t1: number, items: GenItem[]}>} byTick
 * @property {Map<string, string>} what `what` key of each injected fact
 * @property {number[]} laneEnds end of the last interval of each lane
 */

/** @returns {BatchIndex} an empty index */
export function createBatchIndex() {
  return { items: [], laneCount: 0, ticks: [], byTick: new Map(), what: new Map(), laneEnds: [] };
}

const byStart = (a, b) => a.t0 - b.t0 || a.event.id - b.event.id;

function place(ix, item) {
  let lane = ix.laneEnds.findIndex((end) => end <= item.t0);
  if (lane < 0) lane = ix.laneEnds.length;
  ix.laneEnds[lane] = item.t1;
  item.lane = lane;
}

/**
 * Adds events (incrementally: only events[from..to) are read). Generations
 * that arrive in order are placed at once; one that sorts before the last
 * placed starts the partition again, so the result is always the same as
 * partitioning the whole log at once.
 * @param {BatchIndex} ix
 * @param {object[]} events
 * @param {number} [from]
 * @param {number} [to]
 * @returns {boolean} whether any generation was added
 */
export function addEvents(ix, events, from = 0, to = events.length) {
  const fresh = [];
  for (let i = from; i < to; i++) {
    const e = events[i];
    if (e.type === 'inject') ix.what.set(e.fact, e.what);
    if ((e.type !== 'turn' && e.type !== 'plan') || !e.gen) continue;
    const t0 = Number(e.gen.t0);
    const t1 = Math.max(t0, Number(e.gen.t1));
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    const item = { event: e, tick: e.tick, t0, t1, lane: -1 };
    fresh.push(item);
    let entry = ix.byTick.get(e.tick);
    if (!entry) {
      entry = { tick: e.tick, t0, t1, items: [] };
      ix.byTick.set(e.tick, entry);
      ix.ticks.push(e.tick);
      if (ix.ticks.length > 1 && ix.ticks[ix.ticks.length - 2] > e.tick) ix.ticks.sort((a, b) => a - b);
    }
    entry.t0 = Math.min(entry.t0, t0);
    entry.t1 = Math.max(entry.t1, t1);
    entry.items.push(item);
  }
  if (!fresh.length) return false;
  fresh.sort(byStart);
  const last = ix.items[ix.items.length - 1];
  ix.items.push(...fresh);
  if (last && byStart(fresh[0], last) < 0) {
    ix.items.sort(byStart);
    ix.laneEnds = [];
    for (const item of ix.items) place(ix, item);
  } else {
    for (const item of fresh) place(ix, item);
  }
  ix.laneCount = ix.laneEnds.length;
  return true;
}

/** Index of the last element of a sorted array that is <= v, or -1. */
export function lastAtMost(sorted, v) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * @typedef {object} LaneRow
 * @property {number} lane 0-based
 * @property {GenItem} item
 * @property {'run'|'done'|'idle'} phase run: generating at `ms`; done: finished in
 *   the current tick; idle: from the last tick with generations (rest)
 * @property {number} progress 0..1
 */

/**
 * @typedef {object} BatchView
 * @property {'empty'|'before'|'active'|'rest'} mode empty: no generation in the
 *   whole log; before: none yet at this position; active: the current tick has
 *   generations; rest: shows those of the last tick that had them
 * @property {number} laneCount
 * @property {number|null} tick tick whose generations are shown
 * @property {number|null} ms batch clock (active only)
 * @property {LaneRow[]} rows at most one per lane, ascending lane
 * @property {number} running rows in phase 'run'
 */

/**
 * Batch clock: milliseconds since the start of the run at a playback position,
 * inside the window of its tick (smallest t0 to largest t1 of its generations).
 * @param {BatchIndex} ix
 * @param {number} pos ticks with decimals
 * @returns {number|null} null when the tick has no generation
 */
export function batchClock(ix, pos) {
  const tick = Math.floor(pos);
  const entry = ix.byTick.get(tick);
  if (!entry) return null;
  return entry.t0 + (entry.t1 - entry.t0) * Math.min(1, Math.max(0, pos - tick));
}

/**
 * What the batch panel shows at a playback position.
 * @param {BatchIndex} ix
 * @param {number} pos ticks with decimals
 * @returns {BatchView}
 */
export function batchView(ix, pos) {
  const view = { mode: 'empty', laneCount: ix.laneCount, tick: null, ms: null, rows: [], running: 0 };
  if (!ix.items.length) return view;
  const tick = Math.floor(pos);
  let entry = ix.byTick.get(tick);
  let ms = null;
  if (entry) {
    view.mode = 'active';
    ms = batchClock(ix, pos);
  } else {
    const k = lastAtMost(ix.ticks, tick);
    if (k < 0) {
      view.mode = 'before';
      return view;
    }
    view.mode = 'rest';
    entry = ix.byTick.get(ix.ticks[k]);
  }
  view.tick = entry.tick;
  view.ms = ms;
  // The latest started generation of each lane.
  const byLane = new Map();
  for (const item of entry.items) {
    if (ms !== null && item.t0 > ms) continue;
    const cur = byLane.get(item.lane);
    if (!cur || byStart(item, cur) > 0) byLane.set(item.lane, item);
  }
  for (const [lane, item] of byLane) {
    let progress = 1;
    if (ms !== null && item.t1 > item.t0) progress = Math.min(1, Math.max(0, (ms - item.t0) / (item.t1 - item.t0)));
    const phase = ms === null ? 'idle' : progress < 1 ? 'run' : 'done';
    if (phase === 'run') view.running++;
    view.rows.push({ lane, item, phase, progress });
  }
  view.rows.sort((a, b) => a.lane - b.lane);
  return view;
}

/**
 * The first characters of a text, in proportion to the progress (by code
 * point, so no emoji or accent is cut in half).
 * @param {string} text
 * @param {number} progress 0..1
 * @returns {string}
 */
export function revealed(text, progress) {
  const chars = Array.from(text);
  if (progress >= 1) return text;
  return chars.slice(0, Math.max(0, Math.floor(chars.length * progress))).join('');
}

/**
 * Full text of a generation: its `text`, or, for a plan or a turn without
 * text, the summarized claim or the action.
 * @param {object} e turn or plan event
 * @param {object} header
 * @param {Map<string, string>} what `what` key by fact id
 * @param {object} s strings of the language (strings.js)
 * @returns {string}
 */
export function itemText(e, header, what, s) {
  if (e.type === 'turn' && typeof e.text === 'string' && e.text) return e.text;
  if (e.reject) return fill(s.rejected, { reason: s.rejects?.[e.reject] ?? e.reject });
  const summary = e.claim ? claimSummary(e.claim, header, e.fact ? what.get(e.fact) : undefined) : '';
  if (e.type === 'plan') return e.action === 'go' ? `${s.planGo} ${summary}`.trim() : s.planNone;
  const act = s.acts[e.act ?? e.action] ?? e.act ?? e.action ?? '';
  return summary ? `${act}: ${summary}` : act;
}
