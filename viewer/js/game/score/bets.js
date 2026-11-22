// The bet (docs/juego.md, «Apuesta»): three guesses made before «Empezar»,
// scored at the end by closeness, 0..10 points each.
//
//   attend  how many will come          10 − 2·|Δ neighbors|
//   half    when half the village knows 10 − ⌊|Δ minutes| / 15⌋   (no half: 0)
//   last    who learns it last          10 − 2·|Δ position| in the order of arrival
//                                       (a neighbor never told: 0)
// A bet left null is not scored and does not count in the total. Nor is
// `attend` when the rumor has no place or no hour (the inject without
// `where` or `when`): there is nothing to come to, and a 0 would score 10.

import { arrivalOrder, attendOk, halfTick, injectOf, neighborId, tickOfTime } from './measures.js';

/** Points of each part, never below 0. */
const clamp = (x) => Math.max(0, Math.min(10, x));

/**
 * @typedef {{bet: any, actual: any, points: number}} BetPart
 */

/**
 * Points of a bet.
 * @param {{attend?: number|null, half?: string|number|null, last?: string|null}|null} bets
 *   half: "hoy 15:00" / "today 15:00" / "15:00" or a tick; last: a neighbor id (or name)
 * @param {import('./measures.js').Log} log
 * @param {string|null} [fact] the rumor bet on; default the first injected
 * @returns {{attend: BetPart|null, half: BetPart|null, last: BetPart|null, total: number}}
 *   attend null without a bet, or when the rumor has no place or no hour
 *   half.actual is a tick (null: never); last.actual is a neighbor id (null: nobody knew)
 */
export function scoreBets(bets, log, fact = null) {
  const out = { attend: null, half: null, last: null, total: 0 };
  const b = bets ?? {};

  const slots = injectOf(log, fact)?.slots ?? {};
  const watched = slots.where !== null && slots.where !== undefined && slots.when !== null && slots.when !== undefined;
  if (b.attend !== null && b.attend !== undefined && watched) {
    const actual = attendOk(log, fact);
    out.attend = { bet: b.attend, actual, points: clamp(10 - 2 * Math.abs(Number(b.attend) - actual)) };
  }

  if (b.half !== null && b.half !== undefined) {
    const actual = halfTick(log, fact);
    const guess = tickOfTime(b.half);
    const points = actual === null || guess === null ? 0 : clamp(10 - Math.floor(Math.abs(guess - actual) / 15));
    out.half = { bet: b.half, actual, points };
  }

  if (b.last !== null && b.last !== undefined && b.last !== '') {
    const order = arrivalOrder(log, fact).map((x) => x.who);
    const actual = order.length ? order[order.length - 1] : null;
    const pos = order.indexOf(neighborId(log.header, b.last) ?? '');
    const points = pos < 0 ? 0 : clamp(10 - 2 * (order.length - 1 - pos));
    out.last = { bet: b.last, actual, points };
  }

  for (const k of ['attend', 'half', 'last']) if (out[k]) out.total += out[k].points;
  return out;
}
