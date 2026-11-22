// The race of two rumors (docs/juego.md, «Carrera de rumores»): at the hour
// the player chose, which of the two had reached more neighbors. `pick` is the
// index (0 or 1) of the rumor in the draft's list that the player bet on.
//
// The facts of the log come in inject order, not in draft order: the engine
// injects each rumor at its tick ('start' is the first tick, else its hour)
// and, inside a tick, in draft order (engine/src/server/play_server.cpp,
// GameControl::before_tick). raceFactsByDraft undoes that:
//
//   draft rumors ──sort by (tick of `at`, draft index)──► inject order k
//   factsOf(log)[k] ──────────────────────────────────► fact of that rumor
//
// A game cut short by «Terminar ya» before the hour of the race has no winner:
// the counts are the ones at the end and the race is `interrupted`.

import { endTick, factsOf, informedAt, tickOfTime } from './measures.js';

/**
 * The fact of each rumor of a draft, in draft order.
 * @param {{at?: string|null}[]|null|undefined} rumors the rumors of the draft or game
 * @param {import('./measures.js').Log} log
 * @returns {(string|null)[]} one entry per rumor; null for a rumor not injected (yet)
 */
export function raceFactsByDraft(rumors, log) {
  const list = Array.isArray(rumors) ? rumors : [];
  const start = log?.header?.start_tick ?? -Infinity;
  const tickOf = (r) => (r?.at === 'start' || r?.at === null || r?.at === undefined ? start : (tickOfTime(r.at) ?? start));
  const order = list.map((r, i) => ({ i, tick: tickOf(r) })).sort((a, b) => a.tick - b.tick || a.i - b.i);
  const facts = factsOf(log);
  const out = list.map(() => null);
  order.forEach((x, k) => {
    out[x.i] = facts[k] ?? null;
  });
  return out;
}

/**
 * The two facts of the race in draft order (rumor 1, rumor 2); without the
 * draft's rumors, the first two facts injected.
 * @param {import('./measures.js').Log} log
 * @param {object[]|null} [rumors]
 * @returns {(string|null)[]} without rumors: only the facts found (0 to 2)
 */
function twoFacts(log, rumors) {
  if (!Array.isArray(rumors) || !rumors.length) return factsOf(log).slice(0, 2);
  return raceFactsByDraft(rumors, log).slice(0, 2);
}

/**
 * Result of the race.
 * @param {{at: string|number, pick?: 0|1|null}} race at: "hoy 14:00" / "today 14:00" / "14:00" or a tick
 * @param {import('./measures.js').Log} log
 * @param {object[]|null} [rumors] the draft's rumors, so that rumor 1 is the draft's first
 * @returns {{at: number|null, facts: (string|null)[], counts: [number, number], winner: 0|1|null,
 *   hit: boolean, interrupted: boolean, end: number}}
 *   at: the tick of the race; winner null on a tie, with fewer than two rumors
 *   or when interrupted; hit: pick === winner; interrupted: the log ends before
 *   `at`, and the counts are the ones at `end` (endTick)
 */
export function raceResult(race, log, rumors = null) {
  const at = tickOfTime(race?.at);
  const end = endTick(log);
  const interrupted = at !== null && end < at;
  const when = interrupted ? end : at;
  const facts = twoFacts(log, rumors);
  const counts = /** @type {[number, number]} */ (
    [0, 1].map((k) => (when === null || !facts[k] ? 0 : informedAt(log, when, facts[k]).size))
  );
  let winner = null;
  if (!interrupted && facts[0] && facts[1] && counts[0] !== counts[1]) winner = counts[0] > counts[1] ? 0 : 1;
  return { at, facts, counts, winner, hit: winner !== null && race?.pick === winner, interrupted, end };
}
