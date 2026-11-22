// The race of phase 9 (docs/juego.md, «Carrera de rumores»): two rumors on the
// map at once, each in its own colour. app.race is null or [factA, factB]
// (core/app.js); while it is set, the discs, the trail and the tint of the
// places take the race colours instead of the versions of app.factId().
//
//   side 0 · factA   blue      ●
//   side 1 · factB   orange    ●
//   knows neither    grey      ·
//   knows both       the colour of the one it heard first
//
// The side of each neighbor is a pure function of store.events[0..index): the
// first inject or tell that reached it (rumor/history.js informed), so playing
// up to a position or jumping to it gives the same colours.

import { VERSION_COLORS } from '../core/theme.js';
import { createHistory } from './history.js';

/**
 * Colours of the two rumors of a race: blue and orange, apart from the
 * versions (green, pale green, red, grey) and readable on the day and night
 * ground. Blue and orange also stay apart for colour-blind readers.
 */
export const RACE_COLORS = ['#3b7ddd', '#f08419'];

/**
 * Colour of a side (0 or 1); grey for undefined (knows neither).
 * @param {0|1|undefined} side
 * @returns {string}
 */
export function raceColor(side) {
  return RACE_COLORS[side] ?? VERSION_COLORS.unknown;
}

/**
 * Side of every neighbor that knows a rumor of the race, as of idx: 0 for the
 * first fact, 1 for the second; a neighbor who knows both gets the one it
 * heard first. Neighbors who know neither are left out.
 * @param {ReturnType<typeof createHistory>} h ingested at least up to idx
 * @param {number} idx store.index
 * @param {[string, string]} race
 * @param {string[]} ids every neighbor id
 * @returns {Map<string, 0|1>}
 */
export function sidesOf(h, idx, race, ids) {
  const out = new Map();
  for (const id of ids) {
    const a = h.informed(id, race[0], idx);
    const b = h.informed(id, race[1], idx);
    if (!a && !b) continue;
    out.set(id, !b || (a && a.i <= b.i) ? 0 : 1);
  }
  return out;
}

/** @type {WeakMap<object[], {h: ReturnType<typeof createHistory>, key: string, sides: Map<string, 0|1>}>} */
const MEMO = new WeakMap();

/**
 * sidesOf over store.events, with a history cached per events array (only
 * appended) and the last answer kept for the frames in between.
 * @param {object[]} events store.events
 * @param {number} index store.index
 * @param {[string, string]|null} race app.race
 * @param {string[]} ids every neighbor id
 * @returns {Map<string, 0|1>}
 */
export function raceSides(events, index, race, ids) {
  if (!race) return new Map();
  let m = MEMO.get(events);
  if (!m || m.h.size > events.length) MEMO.set(events, (m = { h: createHistory(), key: '', sides: new Map() }));
  m.h.ingest(events);
  const idx = Math.min(index, events.length);
  const key = `${idx}|${race[0]}|${race[1]}|${ids.length}`;
  if (m.key !== key) {
    m.key = key;
    m.sides = sidesOf(m.h, idx, race, ids);
  }
  return m.sides;
}
