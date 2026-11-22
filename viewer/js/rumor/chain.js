// The chain of a rumor, hop by hop, from the inject to a neighbor, as of a
// log position. Pure functions over a history (history.js).
//
//   inject ─► Carmen ──turn 10──► Luis ──turn 20──► Ana ──turn 25──► Elena
//
// The chain follows one slot (the "lead"): from the neighbor, the turn whose
// `memory` event left the value it holds (its last reception, cause told), then
// the same from the speaker as of that turn, until a reception caused by the
// inject. A neighbor that never received the lead slot follows the turn that
// first told it the fact. Each hop is analysed for the four slots with the
// engine's definition of a change per hop (engine/src/metrics/metrics.cpp,
// count_hop), with contradiction and invented apart.

import { holds, SLOTS } from '../core/version.js';

/** Verdicts that keep a slot from reaching the listener. */
export const FAILURES = new Set(['contradiction', 'invented']);

/** Preference of the lead slot: the hour is the one the story is about. */
export const LEAD_ORDER = ['when', 'where', 'who', 'amount'];

/**
 * @typedef {object} HopSlot
 * @property {string} slot
 * @property {string|null} verdict
 * @property {string|number|null} said value in the claim
 * @property {boolean} marked in `guess`
 * @property {{value: any, state: string}|null} old what the speaker had received (null if never)
 * @property {{value: any, state: string}|null} now the speaker's memory at the turn (maybe forgotten)
 * @property {{value: any, state: string}|null} heard what reached the listener (null if nothing did)
 * @property {{value: any, state: string}|null} got the memory the turn left in the listener
 * @property {boolean} conflict the listener kept its own sure value
 * @property {boolean} changed
 * @property {string|null} cause forgot · guess · doubt_dropped · invented · contradiction · hardened · omission
 * @property {import('./history.js').MemEntry[]} notes the speaker's forgot/doubt_dropped since its reception
 */

/**
 * One slot of one hop (a tell from turn.who to turn.to at position iT).
 * @param {ReturnType<import('./history.js').createHistory>} h
 * @param {object} turn the `turn` event
 * @param {number} iT its position
 * @param {string} fact
 * @param {string} slot
 * @returns {HopSlot}
 */
export function hopSlot(h, turn, iT, fact, slot) {
  const verdict = turn.verdict?.[slot] ?? null;
  const said = turn.claim?.[slot] ?? null;
  const marked = (turn.claim?.guess ?? []).includes(slot);
  const rec = h.reception(turn.who, fact, slot, iT);
  const nowEntry = h.slotAt(turn.who, fact, slot, iT);
  const gotEntry = h.entryOfTurn(turn.to, fact, slot, turn.id);
  const reaches = verdict !== null && verdict !== 'omitted' && !FAILURES.has(verdict) && said !== null;
  const old = rec ? { value: rec.entry.value, state: rec.entry.state } : null;
  const notes = rec ? rec.after : [];

  let changed;
  if (old) changed = !(reaches && said === old.value && !(old.state === 'doubt' && !marked));
  else changed = reaches;

  let cause = null;
  if (changed) {
    if (FAILURES.has(verdict)) cause = verdict;
    else if (verdict === 'hardened_doubt') cause = 'hardened';
    else if (verdict === 'declared_guess' && said !== old?.value) cause = 'guess';
    else if (verdict === 'omitted' && nowEntry?.state === 'forgotten') cause = 'forgot';
    else if (verdict === 'omitted' && holds(nowEntry?.state)) cause = 'omission';
    else if (verdict === 'faithful' && old?.state === 'doubt' && !marked && notes.some((m) => m.cause === 'doubt_dropped')) {
      cause = 'doubt_dropped';
    }
  }

  return {
    slot,
    verdict,
    said,
    marked,
    old,
    now: nowEntry ? { value: nowEntry.value, state: nowEntry.state } : null,
    heard: reaches ? { value: said, state: marked ? 'doubt' : 'sure' } : null,
    got: gotEntry ? { value: gotEntry.value, state: gotEntry.state } : null,
    conflict: (turn.conflicts ?? []).includes(slot),
    changed,
    cause,
    notes,
  };
}

/**
 * @typedef {object} Hop
 * @property {object} turn the `turn` event
 * @property {number} i its position
 * @property {number} tick
 * @property {string} from speaker
 * @property {string} to listener
 * @property {HopSlot[]} slots in SLOTS order
 */

/**
 * @typedef {object} Chain
 * @property {string} target
 * @property {string} lead the slot followed
 * @property {{who: string, i: number, tick: number}|null} origin the inject recipient (null if none found)
 * @property {Hop[]} steps origin → target
 * @property {import('./history.js').MemEntry[]} tail the target's forgot/doubt_dropped since its receptions
 */

/**
 * Chain of a neighbor for a fact, following one slot, as of position idx.
 * @param {ReturnType<import('./history.js').createHistory>} h
 * @param {string} who
 * @param {string} fact
 * @param {number} idx only events before idx count
 * @param {string} lead slot to follow
 * @returns {Chain|null} null when the neighbor does not know the fact by idx
 */
export function chainOf(h, who, fact, idx, lead) {
  if (!h.informed(who, fact, idx)) return null;
  const steps = [];
  let origin = null;
  let node = who;
  let at = idx;
  for (let guard = 0; guard < 10000; guard++) {
    const rec = h.reception(node, fact, lead, at);
    let turnId = null;
    let injected = false;
    if (rec) {
      if (rec.entry.cause === 'inject') injected = true;
      else turnId = rec.entry.turn;
    } else {
      const inf = h.informed(node, fact, at);
      if (!inf) break;
      if (inf.turn === null) injected = true;
      else turnId = inf.turn;
    }
    if (injected) {
      const inj = h.inject(fact, at);
      origin = { who: node, i: inj?.i ?? -1, tick: inj?.e.tick ?? rec?.entry.tick ?? 0 };
      break;
    }
    const iT = h.position(turnId);
    const turn = iT === undefined ? undefined : h.event(iT);
    if (!turn || iT >= at) break;
    steps.push({
      turn,
      i: iT,
      tick: turn.tick,
      from: turn.who,
      to: node,
      slots: SLOTS.map((s) => hopSlot(h, turn, iT, fact, s)),
    });
    node = turn.who;
    at = iT;
  }
  steps.reverse();

  const tail = [];
  for (const s of SLOTS) {
    const rec = h.reception(who, fact, s, idx);
    if (rec) tail.push(...rec.after);
  }
  tail.sort((a, b) => a.i - b.i);
  return { target: who, lead, origin, steps, tail };
}

/**
 * Value of a slot held at a position (sure or doubt with a value), or null.
 */
function heldValue(h, who, fact, slot, idx) {
  const m = h.slotAt(who, fact, slot, idx);
  return m && holds(m.state) && m.value !== null ? m.value : null;
}

/**
 * Slot to follow for a neighbor: the first in LEAD_ORDER that it holds with a
 * value other than the original; else the first it holds; else 'when'.
 * @param {ReturnType<import('./history.js').createHistory>} h
 * @param {string} who
 * @param {string} fact
 * @param {object} original `slots` of the inject
 * @param {number} idx
 * @returns {string}
 */
export function leadSlot(h, who, fact, original, idx) {
  const held = LEAD_ORDER.filter((s) => heldValue(h, who, fact, s, idx) !== null);
  return held.find((s) => heldValue(h, who, fact, s, idx) !== (original?.[s] ?? null)) ?? held[0] ?? 'when';
}

/**
 * The slots grouped by the chain they follow, when they do not all agree
 * (a neighbor who heard the fact from several). One entry per distinct path.
 * @returns {{slots: string[], turns: string}[]}
 */
export function chainPaths(h, who, fact, idx) {
  const out = [];
  for (const s of LEAD_ORDER) {
    if (heldValue(h, who, fact, s, idx) === null) continue;
    const c = chainOf(h, who, fact, idx, s);
    if (!c) continue;
    const turns = c.steps.map((st) => st.turn.id).join(',');
    const same = out.find((p) => p.turns === turns);
    if (same) same.slots.push(s);
    else out.push({ slots: [s], turns });
  }
  return out;
}

/**
 * Value a hop left in the listener for a slot (what it got, or else what it heard).
 * @param {Hop} hop
 * @param {string} slot
 */
export function hopValue(hop, slot) {
  const x = hop.slots.find((s) => s.slot === slot);
  return x?.got?.value ?? x?.heard?.value ?? null;
}

/**
 * Index in chain.steps of the hop where `slot` stopped matching the original:
 * the last hop whose listener got a value other than the original while the
 * speaker had received the original (or nothing). -1 if none.
 * @param {Chain} chain
 * @param {string} slot
 * @param {any} original original value of the slot
 * @returns {number}
 */
export function deviationIndex(chain, slot, original) {
  let found = -1;
  chain.steps.forEach((hop, k) => {
    const x = hop.slots.find((s) => s.slot === slot);
    const got = x?.got ?? x?.heard;
    if (!got || got.value === original) return;
    if (!x.old || x.old.value === original) found = k;
  });
  return found;
}
