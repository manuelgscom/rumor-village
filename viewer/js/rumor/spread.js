// How many neighbors hold each version of a fact, tick by tick: the curve of
// the "El rumor" card. One sweep over the log replays only what the version
// depends on (inject, tell turns and memory events, like core/reduce.js), so
// the count at a tick is the one versionsAt (tree.js) gives for the state at
// the end of that tick. Pure functions.
//
//   ticks    20:10 20:13 20:28 …     one point per tick where a count changed
//   correct     1     2     2
//   incomplete  0     0     1
//   wrong       0     0     0

import { versionOf } from '../core/version.js';
import { isTell } from './history.js';

/**
 * @typedef {object} Spread
 * @property {number|null} start tick of the inject (null: not in the log)
 * @property {number[]} ticks
 * @property {number[]} correct
 * @property {number[]} incomplete
 * @property {number[]} wrong
 */

/**
 * Counts of each version after every tick of events[0..upto).
 * @param {object[]} events store.events
 * @param {string|null} fact
 * @param {string[]} ids neighbors counted (every neighbor id)
 * @param {number} [upto]
 * @returns {Spread}
 */
export function spreadSeries(events, fact, ids, upto = events.length) {
  const out = { start: null, ticks: [], correct: [], incomplete: [], wrong: [] };
  if (!fact) return out;
  const counted = new Set(ids);
  const memory = new Map();
  const version = new Map();
  const counts = { correct: 0, incomplete: 0, wrong: 0 };
  let original = null;

  const memOf = (who) => {
    let m = memory.get(who);
    if (!m) memory.set(who, (m = {}));
    return m;
  };
  const update = (who) => {
    if (!counted.has(who) || !original) return false;
    const v = versionOf(memory.get(who), original);
    const old = version.get(who) ?? null;
    if (v === old) return false;
    if (old) counts[old]--;
    if (v) counts[v]++;
    version.set(who, v);
    return true;
  };
  const record = (tick) => {
    const k = out.ticks.length - 1;
    if (k >= 0 && out.ticks[k] === tick) {
      out.correct[k] = counts.correct;
      out.incomplete[k] = counts.incomplete;
      out.wrong[k] = counts.wrong;
      return;
    }
    out.ticks.push(tick);
    out.correct.push(counts.correct);
    out.incomplete.push(counts.incomplete);
    out.wrong.push(counts.wrong);
  };

  for (let i = 0; i < Math.min(upto, events.length); i++) {
    const e = events[i];
    if (e.fact !== fact) continue;
    let changed = false;
    if (e.type === 'inject') {
      if (original) continue;
      original = e.slots;
      out.start = e.tick;
      for (const who of e.to ?? []) {
        memOf(who);
        update(who);
      }
      changed = true;
    } else if (isTell(e)) {
      memOf(e.to);
      changed = update(e.to);
    } else if (e.type === 'memory') {
      memOf(e.who)[e.slot] = { state: e.state, value: e.value };
      changed = update(e.who);
    }
    if (changed) record(e.tick);
  }
  return out;
}

/**
 * Index of the last point at or before a tick, or -1.
 * @param {Spread} s
 * @param {number} tick
 * @returns {number}
 */
export function pointAt(s, tick) {
  let lo = 0;
  let hi = s.ticks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.ticks[mid] <= tick) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Counts of each version at the end of a tick (all zero before the inject).
 * @param {Spread} s
 * @param {number} tick
 * @returns {{correct: number, incomplete: number, wrong: number}}
 */
export function countsAt(s, tick) {
  const k = pointAt(s, tick);
  if (k < 0) return { correct: 0, incomplete: 0, wrong: 0 };
  return { correct: s.correct[k], incomplete: s.incomplete[k], wrong: s.wrong[k] };
}

/**
 * Stacked areas of the series up to a tick, in a box w × h: x goes from the
 * inject to `end`, y from 0 to `total` neighbors (bottom). Each band is a
 * closed polygon of steps; the bands stack wrong, incomplete, correct from the
 * bottom, so the red that matters sits on the axis.
 * @param {Spread} s
 * @param {number} tick last tick drawn
 * @param {number} end tick at the right edge
 * @param {number} total neighbors at the top edge
 * @param {number} w
 * @param {number} h
 * @returns {{bands: {key: string, points: {x: number, y: number}[]}[], head: {x: number, y: number}|null}}
 */
export function spreadBands(s, tick, end, total, w, h) {
  if (s.start === null || tick < s.start) return { bands: [], head: null };
  const span = Math.max(1, end - s.start);
  const x = (t) => (Math.min(Math.max(t, s.start), end) - s.start) * (w / span);
  const y = (n) => h - (n / Math.max(1, total)) * h;
  const last = pointAt(s, tick);
  const keys = ['wrong', 'incomplete', 'correct'];
  // Step points shared by every band: [x, stacked heights after the step].
  const steps = [];
  for (let k = 0; k <= last; k++) {
    let acc = 0;
    steps.push({ x: x(s.ticks[k]), tops: keys.map((key) => (acc += s[key][k])) });
  }
  const xEnd = x(tick);
  const bands = keys.map((key, b) => {
    const top = [];
    const bottom = [];
    let prev = { x: 0, tops: [0, 0, 0] };
    for (const st of steps) {
      top.push({ x: st.x, y: y(prev.tops[b]) }, { x: st.x, y: y(st.tops[b]) });
      bottom.push({ x: st.x, y: y(b ? prev.tops[b - 1] : 0) }, { x: st.x, y: y(b ? st.tops[b - 1] : 0) });
      prev = st;
    }
    top.push({ x: xEnd, y: y(prev.tops[b]) });
    bottom.push({ x: xEnd, y: y(b ? prev.tops[b - 1] : 0) });
    return { key, points: [{ x: 0, y: h }, ...top, ...bottom.reverse()] };
  });
  const lastTops = steps.length ? steps[steps.length - 1].tops : [0, 0, 0];
  return { bands, head: { x: xEnd, y: y(lastTops[2]) } };
}
