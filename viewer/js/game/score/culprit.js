// «¿Quién fue?» (docs/juego.md): who changed some detail of the rumor first.
// The same culprit rule as the summary card and the side panel: summaryAt of
// summary/build.js finds, for every neighbor holding a wrong value, the hop of
// its chain where that slot stopped matching the original (chainOf +
// deviationIndex, rumor/chain.js) and groups them by (turn, slot). The culprit
// is the earliest of those changes. With no wrong neighbor: «Nadie lo cambió».
// A wrong value that no tell explains (the neighbor filled in a detail by
// itself) has no culprit: nobody told it changed, and the right answer is
// «Nadie lo cambió» too. Forgetting never counts.
//
//   inject ─► Carmen ──10──► Luis ──20 (when 44→46)──► Ana ──25──► Elena
//                             ▲ culprit: Luis, turn 20

import { chainOf, leadSlot } from '../../rumor/chain.js';
import { createHistory } from '../../rumor/history.js';
import { summaryAt } from '../../summary/build.js';
import { arrivalOrder, injectOf } from './measures.js';

/**
 * @typedef {object} Culprit
 * @property {string} who neighbor whose turn changed the slot
 * @property {number} tick
 * @property {string} slot
 * @property {any} from original value
 * @property {any} to value the listener got
 * @property {number} turn turn id
 */

/**
 * @typedef {object} Hop
 * @property {string} from speaker
 * @property {string} to listener
 * @property {number} tick
 * @property {number} turn turn id
 * @property {string[]} changed slots changed in this hop (hopSlot.changed)
 * @property {HopChange[]} details the same slots, with what the speaker had and what was said
 * @property {boolean} culprit this is the culprit's turn
 */

/**
 * @typedef {object} HopChange
 * @property {string} slot
 * @property {any} from the value the speaker had received (null: none)
 * @property {any} to the value said (null: nothing reached the listener)
 * @property {string|null} cause rumor/chain.js HopSlot.cause (forgot, guess, hardened…)
 */

/**
 * The culprit of a rumor and the chain to reveal, hop by hop.
 * @param {import('./measures.js').Log} log
 * @param {string|null} [fact] default the first injected
 * @returns {{culprit: Culprit|null, honest: boolean, origin: {who: string, tick: number}|null, hops: Hop[],
 *   unexplained: string[]}}
 *   honest: no neighbor holds a changed detail. hops: the chain of the first
 *   neighbor fooled by the culprit's change, following that slot; in an honest
 *   village, the chain of the last one told. culprit may be null with honest
 *   false when a wrong value has no hop that explains it: unexplained lists
 *   those neighbors (summary/build.js `unexplained`), without repeats.
 */
export function whoDidIt(log, fact = null) {
  const inj = injectOf(log, fact);
  if (!inj) return { culprit: null, honest: true, origin: null, hops: [], unexplained: [] };
  const h = createHistory();
  h.ingest(log.events);
  const idx = log.events.length;
  const s = summaryAt(h, log.header, idx, log.header?.lang === 'en' ? 'en' : 'es', inj.fact);
  const first = [...s.changes].sort((a, b) => a.tick - b.tick || a.turn - b.turn)[0] ?? null;
  const culprit = first
    ? { who: first.who, tick: first.tick, slot: first.slot, from: first.from, to: first.to, turn: first.turn }
    : null;
  const honest = s.wrong === 0;

  let chain = null;
  if (first) chain = chainOf(h, first.affected[0], inj.fact, idx, first.slot);
  else {
    const order = arrivalOrder(log, inj.fact);
    const last = order[order.length - 1]?.who;
    if (last) chain = chainOf(h, last, inj.fact, idx, leadSlot(h, last, inj.fact, inj.slots, idx));
  }
  const hops = (chain?.steps ?? []).map((st) => ({
    from: st.from,
    to: st.to,
    tick: st.tick,
    turn: st.turn.id,
    changed: st.slots.filter((x) => x.changed).map((x) => x.slot),
    details: st.slots
      .filter((x) => x.changed)
      .map((x) => ({ slot: x.slot, from: x.old?.value ?? null, to: x.heard?.value ?? null, cause: x.cause ?? null })),
    culprit: !!culprit && st.turn.id === culprit.turn,
  }));
  const origin = chain?.origin ? { who: chain.origin.who, tick: chain.origin.tick } : null;
  const unexplained = [...new Set(s.unexplained.map((u) => u.who))];
  return { culprit, honest, origin, hops, unexplained };
}

/**
 * Whether the player's guess is right: the culprit's id; without a culprit
 * (an honest village, or wrong values that no tell explains), «Nadie lo
 * cambió»: no guess (null or '').
 * @param {string|null} guessWho neighbor id
 * @param {{culprit: Culprit|null}} result of whoDidIt
 * @returns {boolean}
 */
export function guessResult(guessWho, result) {
  if (!result) return false;
  if (result.culprit) return guessWho === result.culprit.who;
  return guessWho === null || guessWho === undefined || guessWho === '';
}
