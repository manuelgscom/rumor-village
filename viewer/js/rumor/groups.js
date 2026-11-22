// Consequences of a rumor: who goes where, grouped against the original, and
// the culprit of each wrong group. Pure functions over a history (history.js).
//
//   right        at the original place and hour
//   other_time   at the original place, another hour
//   other_place  somewhere else
//
// A neighbor is in a group by its first `arrive` for the fact (the engine's
// attendance, engine/src/metrics/metrics.cpp), or, before arriving, by the
// plan in force (a `go` not rejected with where and when, neither failed)
// whose hour has not passed yet; those are marked as pending.

import { slotTick } from '../core/clock.js';
import { holds } from '../core/version.js';
import { chainOf, deviationIndex, FAILURES } from './chain.js';

/** Group keys, in display order. */
export const GROUP_KEYS = ['right', 'other_time', 'other_place'];

/** The slot that defines each group (the one whose culprit is looked for). */
export const GROUP_SLOT = { right: 'when', other_time: 'when', other_place: 'where' };

/**
 * Group of a visit against the original fact.
 * @param {string} place
 * @param {number} slot
 * @param {{where?: any, when?: any}} original
 * @returns {'right'|'other_time'|'other_place'}
 */
export function groupKey(place, slot, original) {
  const where = original?.where ?? null;
  const when = original?.when ?? null;
  if (where === null || place !== where) return 'other_place';
  return when !== null && slot === when ? 'right' : 'other_time';
}

/**
 * Whether a plan puts a visit in the agenda (the engine's `planned`).
 * @param {object} p a `plan` event
 */
export function planned(p) {
  if (p.action !== 'go' || p.reject !== null || !p.claim || !p.verdict) return false;
  for (const s of ['where', 'when']) {
    if (p.claim[s] === null || p.claim[s] === undefined || FAILURES.has(p.verdict[s])) return false;
  }
  return true;
}

/**
 * @typedef {object} Member
 * @property {string} who
 * @property {boolean} arrived false: only planned so far
 * @property {string} place
 * @property {number} slot
 * @property {number} i position of the arrive (or of the plan when pending)
 * @property {number} tick
 */

/**
 * Members of each group as of position idx (tick = floor of the playback position).
 * @param {ReturnType<import('./history.js').createHistory>} h
 * @param {string} fact
 * @param {number} idx
 * @param {number} tick
 * @param {string[]} ids every neighbor id, in header order
 * @returns {{right: Member[], other_time: Member[], other_place: Member[]}|null} null before the inject
 */
export function groupsAt(h, fact, idx, tick, ids) {
  const inj = h.inject(fact, idx);
  if (!inj) return null;
  const original = inj.e.slots;
  const out = { right: [], other_time: [], other_place: [] };
  for (const who of ids) {
    const a = h.arrival(who, fact, idx);
    if (a) {
      out[groupKey(a.e.place, a.e.slot, original)].push({
        who,
        arrived: true,
        place: a.e.place,
        slot: a.e.slot,
        i: a.i,
        tick: a.e.tick,
      });
      continue;
    }
    const p = h.planBefore(who, fact, idx);
    if (p && planned(p.e) && slotTick(p.e.claim.when) >= tick) {
      out[groupKey(p.e.claim.where, p.e.claim.when, original)].push({
        who,
        arrived: false,
        place: p.e.claim.where,
        slot: p.e.claim.when,
        i: p.i,
        tick: p.e.tick,
      });
    }
  }
  return out;
}

const PLAN_CAUSE = {
  declared_guess: 'guess',
  invented: 'invented',
  contradiction: 'contradiction',
  hardened_doubt: 'hardened',
};

/**
 * @typedef {object} Culprit
 * @property {string} who
 * @property {'turn'|'plan'} kind a hop of the chain, or the member's own plan
 * @property {number} id turn or plan id
 * @property {number} tick
 * @property {number} i position
 * @property {string} slot
 * @property {string|null} cause
 * @property {{value: any, state: string}|null} old the value before (what the culprit had received)
 * @property {{value: any, state: string}|null} new the value it passed on
 * @property {import('./history.js').MemEntry[]} notes the culprit's forgot/doubt_dropped before it
 * @property {import('./chain.js').Chain|null} chain the member's chain on that slot
 * @property {number} hop index of the culprit hop in chain.steps (-1 for a plan)
 */

/**
 * Culprit of a member of a wrong group: the neighbor in whose turn the slot of
 * the group stopped matching the original, along the member's chain on that
 * slot, as of the plan behind the visit. If the member itself put the value in
 * its plan (it did not hold it), the culprit is the member and that plan.
 * @param {ReturnType<import('./history.js').createHistory>} h
 * @param {string} fact
 * @param {Member} member
 * @param {'other_time'|'other_place'} key
 * @param {number} idx
 * @returns {Culprit|null}
 */
export function culpritOf(h, fact, member, key, idx) {
  if (key === 'right') return null;
  const inj = h.inject(fact, idx);
  if (!inj) return null;
  const slot = GROUP_SLOT[key];
  const original = inj.e.slots?.[slot] ?? null;
  const value = slot === 'when' ? member.slot : member.place;
  const p = member.arrived ? h.planBefore(member.who, fact, member.i) : h.planBefore(member.who, fact, member.i + 1);
  const at = p ? p.i : Math.min(member.i, idx);

  if (p && p.e.claim?.[slot] === value) {
    const mine = h.slotAt(member.who, fact, slot, p.i);
    const held = !!mine && holds(mine.state) && mine.value !== null;
    if (!held || mine.value !== value) {
      const rec = h.reception(member.who, fact, slot, p.i);
      return {
        who: member.who,
        kind: 'plan',
        id: p.e.id,
        tick: p.e.tick,
        i: p.i,
        slot,
        cause: PLAN_CAUSE[p.e.verdict?.[slot]] ?? null,
        old: rec ? { value: rec.entry.value, state: rec.entry.state } : null,
        new: { value, state: (p.e.claim.guess ?? []).includes(slot) ? 'doubt' : 'sure' },
        notes: rec ? rec.after : [],
        chain: chainOf(h, member.who, fact, p.i, slot),
        hop: -1,
      };
    }
  }

  const chain = chainOf(h, member.who, fact, at, slot);
  if (!chain) return null;
  const k = deviationIndex(chain, slot, original);
  if (k < 0) return null;
  const hop = chain.steps[k];
  const x = hop.slots.find((s) => s.slot === slot);
  return {
    who: hop.from,
    kind: 'turn',
    id: hop.turn.id,
    tick: hop.tick,
    i: hop.i,
    slot,
    cause: x.cause,
    old: x.old,
    new: x.got ?? x.heard,
    notes: x.notes,
    chain,
    hop: k,
  };
}

/**
 * Culprits of a group, each with the members it led there; members without a
 * culprit found go apart.
 * @returns {{culprits: {culprit: Culprit, members: string[]}[], unexplained: string[], chains: Map<string, import('./chain.js').Chain>}}
 */
export function culpritsOf(h, fact, members, key, idx) {
  const byKey = new Map();
  const unexplained = [];
  const chains = new Map();
  for (const m of members) {
    const c = culpritOf(h, fact, m, key, idx);
    if (!c) {
      unexplained.push(m.who);
      continue;
    }
    if (c.chain) chains.set(m.who, c.chain);
    const k = `${c.kind}|${c.id}|${c.who}`;
    if (!byKey.has(k)) byKey.set(k, { culprit: c, members: [] });
    byKey.get(k).members.push(m.who);
  }
  const culprits = [...byKey.values()].sort((a, b) => b.members.length - a.members.length || a.culprit.i - b.culprit.i);
  return { culprits, unexplained, chains };
}

/**
 * The tiles of «Consecuencias» inside the game (phase 9-5): while it runs, the
 * plans (everyone in the group: who will go, and how many are there already);
 * once it ended, only who arrived.
 * @param {{right: object[], other_time: object[], other_place: object[]}|null} groups groupsAt
 * @param {boolean} ended
 * @returns {Object<string, {n: number, there: number}>} by group key
 */
export function gameTiles(groups, ended) {
  const out = {};
  for (const k of GROUP_KEYS) {
    const members = groups?.[k] ?? [];
    const there = members.filter((x) => x.arrived).length;
    out[k] = { n: ended ? there : members.length, there };
  }
  return out;
}

/**
 * Whether the hour of the rumor has passed at a tick: from then on the panel
 * of the game counts who arrived, not who plans to go.
 * @param {{when?: number|null}|null} slots of the inject
 * @param {number} tick floor of the position
 */
export function hourPassed(slots, tick) {
  const when = slots?.when;
  return when !== null && when !== undefined && tick > slotTick(when);
}

/**
 * When the hour of the rumor falls after the end of the game: nobody
 * can go. The tick of that hour, or null (no hour, or before the end).
 * @param {{when?: number|null}|null} slots of the inject
 * @param {number|null|undefined} endTick header.params.end_tick (or the tick of `end`)
 * @returns {number|null}
 */
export function afterTheEnd(slots, endTick) {
  const when = slots?.when;
  if (when === null || when === undefined || !Number.isFinite(endTick)) return null;
  const t = slotTick(when);
  return t > endTick ? t : null;
}
