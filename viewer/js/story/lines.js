// What the chronicle and the "Now" headline show at a playback position: a
// pure function of the narrator's items with i < idx and of the tick.
//
//   chronicle  newest first; repeated things merge into one line
//              ("12 neighbors head to the square") while they keep coming
//              less than GROUP_GAP ticks apart
//   headline   the most important line of the moment, held at least
//              HOLD ticks unless something more important happens; after
//              IDLE quiet ticks it gives way to a calm summary (null here)

import { countBefore } from './narrate.js';

/** Ticks between two members of one merged line. */
export const GROUP_GAP = 15;
/** Longest chronicle. */
export const MAX_LINES = 40;
/** Ticks a headline stays before something as or less important replaces it. */
export const HOLD = 14;
/** Quiet ticks after which the headline turns into a summary. */
export const IDLE = 60;

/**
 * Key that merges an item with the ones like it, or null.
 * @param {import('./narrate.js').Item} it
 * @returns {string|null}
 */
export function mergeKey(it) {
  if (it.kind === 'move') return `move|${it.fact}|${it.d.to}`;
  if (it.kind === 'arrive') return `arrive|${it.fact}|${it.d.place}|${it.d.slot}`;
  return null;
}

/**
 * @typedef {object} Line
 * @property {string} key
 * @property {import('./narrate.js').Item} item the latest item of the line
 * @property {import('./narrate.js').Item} first
 * @property {string[]} members neighbors of the merged items, in order
 * @property {number} count
 * @property {number} tick of the latest item
 * @property {number} importance the highest of its items
 */

function grow(line, it) {
  line.item = it;
  line.tick = it.tick;
  line.count++;
  if (it.who && !line.members.includes(it.who)) line.members.push(it.who);
  line.importance = Math.max(line.importance, it.importance);
}

function open(key, it) {
  return { key, item: it, first: it, members: it.who ? [it.who] : [], count: 1, tick: it.tick, importance: it.importance };
}

/**
 * The chronicle at position idx, newest first.
 * @param {import('./narrate.js').Item[]} items
 * @param {number} idx store.index
 * @param {number} [limit]
 * @returns {Line[]}
 */
export function linesAt(items, idx, limit = MAX_LINES) {
  const end = countBefore(items, idx);
  const lines = [];
  const openLines = new Map();
  for (let k = 0; k < end; k++) {
    const it = items[k];
    if (it.hidden) continue;
    const mk = mergeKey(it);
    const prev = mk ? openLines.get(mk) : undefined;
    if (prev && it.tick - prev.tick <= GROUP_GAP) {
      grow(prev, it);
      continue;
    }
    const line = open(mk ?? `i${it.i}`, it);
    if (mk) openLines.set(mk, line);
    lines.push(line);
  }
  // A merged line goes up with its latest item.
  lines.sort((a, b) => b.item.i - a.item.i);
  return lines.slice(0, limit);
}

/**
 * The headline line at position idx and tick, or null when nothing worth it
 * happened in the last IDLE ticks (the caller shows a summary then).
 * @param {import('./narrate.js').Item[]} items
 * @param {number} idx
 * @param {number} tick floor of the playback position
 * @returns {Line|null}
 */
export function headlineAt(items, idx, tick) {
  const end = countBefore(items, idx);
  let cur = null;
  for (let k = 0; k < end; k++) {
    const it = items[k];
    if (it.hidden || it.importance < 1.5) continue;
    const mk = mergeKey(it);
    if (cur && mk && mk === cur.key && it.tick - cur.tick <= GROUP_GAP) {
      grow(cur, it);
      continue;
    }
    if (!cur || it.importance > cur.importance || it.tick - cur.since >= HOLD) {
      cur = open(mk ?? `i${it.i}`, it);
      cur.since = it.tick;
    }
  }
  if (!cur) return null;
  if (cur.item.kind !== 'end' && tick - cur.tick > IDLE) return null;
  return cur;
}
