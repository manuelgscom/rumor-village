// The strip of the telephone game (phase 8-2, 2.12): one cell per neighbor in
// the order of the row (ids sorted, as render/layout.js rowLayout), each with
// the four details as they reached it, in the hop that brought it the rumor,
// and in red the ones that changed in that hop (hopSlot of chain.js). On the
// left what went in (the inject), on the right what came out (what reached
// the last one told so far). Pure: a function of the history up to idx.
//
//   ENTRA            Carmen    Ana       Elena     …          SALE · Rafael
//   Manuel           Manuel    Manuel    Manuel               Manuel
//   plaza            plaza     plaza     plaza                bar
//   21:00            21:00     21:00     19:30                19:30
//   50               0?        0         0                    6
//
// What a neighbor holds later (forgotten, doubt dropped) is in its card and in
// the colors of the scene; the strip is the message passed hand to hand.

import { SLOTS } from '../core/version.js';
import { hopSlot } from './chain.js';

/**
 * @typedef {object} StripSlot
 * @property {string} slot
 * @property {any} value null when not held
 * @property {'sure'|'doubt'|'forgotten'|null} state as it reached the neighbor; null when nothing did
 * @property {boolean} changed it changed in the hop that brought the rumor (cells) or differs from the original (out)
 */

/**
 * @typedef {object} StripCell
 * @property {string} who
 * @property {boolean} told knows the rumor by idx
 * @property {string|null} from who told it (null for the inject recipient or not told)
 * @property {number|null} i position of the event that told it
 * @property {StripSlot[]} slots in SLOTS order
 */

const empty = (slot) => ({ slot, value: null, state: null, changed: false });

/** A memory entry as a strip slot (a value only while it holds one). */
function slotOf(slot, m, changed) {
  if (!m) return { ...empty(slot), changed };
  const held = (m.state === 'sure' || m.state === 'doubt') && m.value !== null && m.value !== undefined;
  return { slot, value: held ? m.value : null, state: m.state, changed };
}

/**
 * The strip as of position idx.
 * @param {ReturnType<import('./history.js').createHistory>} h
 * @param {object} header
 * @param {string|null} fact
 * @param {number} idx
 * @returns {{original: Object<string, any>, cells: StripCell[], out: {who: string, slots: StripSlot[]}|null}|null}
 *   null before the inject
 */
export function stripAt(h, header, fact, idx) {
  const inj = fact ? h.inject(fact, idx) : undefined;
  if (!inj) return null;
  const original = inj.e.slots ?? {};
  const ids = (header.neighbors ?? []).map((n) => n.id).sort();
  const cells = ids.map((who) => {
    const inf = h.informed(who, fact, idx);
    if (!inf) return { who, told: false, from: null, i: null, slots: SLOTS.map(empty) };
    let slots;
    if (inf.turn === null) {
      // The inject recipient: the original, as it came in.
      slots = SLOTS.map((slot) => slotOf(slot, original[slot] === null || original[slot] === undefined ? null : { state: 'sure', value: original[slot] }, false));
    } else {
      const turn = h.event(inf.i);
      slots = SLOTS.map((slot) => {
        const hop = hopSlot(h, turn, inf.i, fact, slot);
        return slotOf(slot, hop.got, hop.changed);
      });
    }
    return { who, told: true, from: inf.from, i: inf.i, slots };
  });

  // What came out: the one told last, against the original.
  let last = null;
  for (const c of cells) if (c.told && (!last || c.i > last.i)) last = c;
  const out = last
    ? {
        who: last.who,
        slots: last.slots.map((s) => ({ ...s, changed: s.value !== (original[s.slot] ?? null) })),
      }
    : null;
  return { original, cells, out };
}
