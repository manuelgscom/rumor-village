// Items of the chronicle, built from the structured events only (never from
// the text of the bubbles), in one forward pass over the log. Pure: no DOM.
//
//   const n = createNarrator(header);
//   n.ingest(store.events);        // takes the events not seen yet (append only)
//   n.items                        // every item so far, in log order
//
// Each item depends only on the events before it (and the memory events of
// the same tick that follow a turn), so "the chronicle at position idx" is
// the items with i < idx: rewinding needs no rebuild.
//
//   event          item kind   class (what the director prefers)
//   inject         inject      4
//   turn tell      tell        4 if it bends a slot, else 3 (spread)
//   memory forgot  forgot      4 (deformation by the engine)
//   memory doubt…  doubt       4 if the value is not the original, else 2
//   move with fact move        2
//   arrive         arrive      2
//   conv_start     conv        1 (hidden in the chronicle; director only)
//   end            end         0 (the director goes back home)

import { versionOf, SLOTS } from '../core/version.js';
import { groupKey } from '../rumor/groups.js';

/** Verdicts that bend a slot as it passes (docs/contrato.md §Validación). */
export const BENDS = new Set(['contradiction', 'invented', 'declared_guess', 'hardened_doubt']);

/**
 * @typedef {object} Item
 * @property {number} i position of the event in the log
 * @property {number} tick
 * @property {'inject'|'tell'|'forgot'|'doubt'|'move'|'arrive'|'conv'|'end'} kind
 * @property {string|null} fact
 * @property {string|null} who main neighbor (the listener of a tell)
 * @property {number} importance 0..5, how much it matters in the chronicle
 * @property {number} cls class for the director (see the table above)
 * @property {'correct'|'incomplete'|'wrong'|null} version of `who` right after it
 * @property {boolean} hidden not shown in the chronicle
 * @property {object} d details by kind
 */

const held = (m) => (m && (m.state === 'sure' || m.state === 'doubt') && m.value !== null && m.value !== undefined ? m.value : null);

/**
 * Creates a narrator for a run.
 * @param {object} header
 */
export function createNarrator(header) {
  /** memory by `who|fact` → {slot: {state, value}} */
  const mem = new Map();
  /** injected facts: id → inject event */
  const facts = new Map();
  /** place of each active conversation */
  const convPlace = new Map();
  /** last item of each `who|fact` in the current tick, refreshed by its memory events */
  const pending = new Map();
  /** @type {Item[]} */
  const items = [];
  let next = 0;

  const key = (who, fact) => `${who}|${fact}`;
  const versionNow = (who, fact) => versionOf(mem.get(key(who, fact)), facts.get(fact)?.slots);
  const push = (item) => {
    items.push({ hidden: false, ...item });
    return items[items.length - 1];
  };

  const step = (e, i) => {
    switch (e.type) {
      case 'inject': {
        facts.set(e.fact, e);
        for (const id of e.to) if (!mem.has(key(id, e.fact))) mem.set(key(id, e.fact), {});
        const it = push({
          i,
          tick: e.tick,
          kind: 'inject',
          fact: e.fact,
          who: e.to[0] ?? null,
          importance: 5,
          cls: 4,
          version: 'correct',
          d: { what: e.what, slots: e.slots, to: e.to },
        });
        for (const id of e.to) pending.set(key(id, e.fact), it);
        break;
      }
      case 'conv_start': {
        convPlace.set(e.conv, e.place);
        let knows = false;
        for (const f of facts.keys()) knows ||= mem.has(key(e.a, f)) || mem.has(key(e.b, f));
        push({
          i,
          tick: e.tick,
          kind: 'conv',
          fact: null,
          who: e.a,
          importance: knows ? 0.7 : 0.5,
          cls: knows ? 1.2 : 1,
          version: null,
          hidden: true,
          d: { a: e.a, b: e.b, place: e.place },
        });
        break;
      }
      case 'conv_end':
        convPlace.delete(e.conv);
        break;
      case 'turn': {
        if (e.reject !== null || e.action !== 'say' || e.act !== 'tell' || !e.fact || !e.claim) break;
        const inj = facts.get(e.fact);
        const original = inj?.slots ?? {};
        const speaker = mem.get(key(e.who, e.fact)) ?? {};
        const listener = mem.get(key(e.to, e.fact));
        const fresh = !listener;
        const changes = [];
        const wrong = [];
        for (const s of SLOTS) {
          const said = e.claim[s];
          if (said === null || said === undefined) continue;
          const v = e.verdict?.[s];
          if (BENDS.has(v)) changes.push({ slot: s, verdict: v, from: held(speaker[s]), to: said, off: said !== (original[s] ?? null) });
          else if (said !== (original[s] ?? null)) wrong.push({ slot: s, value: said });
        }
        const conflicts = (e.conflicts ?? []).map((s) => ({ slot: s, kept: held(listener?.[s]) })).filter((c) => c.kept !== null);
        const bends = changes.some((c) => c.off);
        const importance = changes.length ? (bends ? 4 : 3.2) : fresh ? (wrong.length ? 3.3 : 3) : conflicts.length ? 2.5 : 2;
        if (fresh) mem.set(key(e.to, e.fact), {});
        const it = push({
          i,
          tick: e.tick,
          kind: 'tell',
          fact: e.fact,
          who: e.to,
          importance,
          cls: changes.length ? 4 : fresh ? 3 : 2.5,
          version: versionNow(e.to, e.fact),
          // A plain retell (nothing new, nothing bent) only feeds the director.
          hidden: !fresh && !changes.length && !conflicts.length,
          d: { a: e.who, b: e.to, what: inj?.what ?? null, place: convPlace.get(e.conv) ?? null, fresh, changes, wrong, conflicts },
        });
        pending.set(key(e.to, e.fact), it);
        break;
      }
      case 'memory': {
        const k = key(e.who, e.fact);
        const before = mem.get(k)?.[e.slot];
        if (!mem.has(k)) mem.set(k, {});
        mem.get(k)[e.slot] = { state: e.state, value: e.value };
        const original = facts.get(e.fact)?.slots ?? {};
        if (e.cause === 'forgot') {
          push({
            i,
            tick: e.tick,
            kind: 'forgot',
            fact: e.fact,
            who: e.who,
            importance: 3,
            cls: 4,
            version: versionNow(e.who, e.fact),
            d: { slot: e.slot, lost: held(before), what: facts.get(e.fact)?.what ?? null },
          });
        } else if (e.cause === 'doubt_dropped') {
          const off = e.value !== (original[e.slot] ?? null);
          push({
            i,
            tick: e.tick,
            kind: 'doubt',
            fact: e.fact,
            who: e.who,
            importance: off ? 3.4 : 2,
            cls: off ? 4 : 2,
            version: versionNow(e.who, e.fact),
            d: { slot: e.slot, value: e.value, off, what: facts.get(e.fact)?.what ?? null },
          });
        } else {
          const it = pending.get(k);
          if (it && it.tick === e.tick) it.version = versionNow(e.who, e.fact);
        }
        break;
      }
      case 'move':
        if (e.fact) {
          push({
            i,
            tick: e.tick,
            kind: 'move',
            fact: e.fact,
            who: e.who,
            importance: 1.5,
            cls: 2,
            version: versionNow(e.who, e.fact),
            d: { to: e.to, what: facts.get(e.fact)?.what ?? null },
          });
        }
        break;
      case 'arrive': {
        const original = facts.get(e.fact)?.slots ?? {};
        const group = groupKey(e.place, e.slot, original);
        const when = original.when ?? null;
        push({
          i,
          tick: e.tick,
          kind: 'arrive',
          fact: e.fact,
          who: e.who,
          importance: group === 'right' ? 2.5 : 3,
          cls: 2,
          version: group === 'right' ? 'correct' : 'wrong',
          d: {
            place: e.place,
            slot: e.slot,
            group,
            late: group === 'other_time' && when !== null && e.slot > when,
            early: group === 'other_time' && when !== null && e.slot < when,
            where: original.where ?? null,
            when,
          },
        });
        break;
      }
      case 'end':
        push({
          i,
          tick: e.tick,
          kind: 'end',
          fact: null,
          who: null,
          importance: 4,
          cls: 0,
          version: null,
          d: { informed: e.informed ?? null, total: header.neighbors?.length ?? 0 },
        });
        break;
      default:
        break;
    }
  };

  return {
    items,
    /** Takes the events not seen yet (the log is only appended). */
    ingest(events) {
      for (; next < events.length; next++) step(events[next], next);
    },
    /** Number of events taken. */
    get size() {
      return next;
    },
  };
}

/**
 * Number of items with i < idx (items are in log order).
 * @param {Item[]} items
 * @param {number} idx
 * @returns {number}
 */
export function countBefore(items, idx) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].i < idx) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
