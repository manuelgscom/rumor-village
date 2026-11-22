// Pure logic of the timeline: its range, its marks, what each one says and
// the mapping between ticks and pixels. No DOM here.

import { neighborName, slotValueText, whatName } from '../core/names.js';

/**
 * @typedef {{tick: number, kind: 'inject', fact: string, what: string}
 *   | {tick: number, kind: 'arrive', ok: boolean, who: string[]}
 *   | {tick: number, kind: 'change', slot: string, who: string, from: string|null, cause: string, state: string, value: any, original: any}
 *   | {tick: number, kind: 'forget', slot: string, who: string}} Mark
 *   inject: a fact starts to spread. arrive: the arrivals of one tick for
 *   the chosen fact, split by whether they came to the right place and hour
 *   (ok). change: per slot, the first time somebody holds a value other than
 *   the original (it got distorted; the rule of the culprit, game/score/
 *   culprit.js and core/version.js «wrong»): `who` holds it, `from` told it
 *   (the speaker of its turn; null without one). forget: per slot, the first
 *   time somebody forgets a slot the original has (it is incomplete then, not
 *   distorted). A doubt about the right value is neither.
 */

/**
 * Range of the timeline: from start_tick to params.end_tick, or to the tick of
 * the `end` event when the run ended (sooner or later); never before the last
 * event.
 * @param {object} header
 * @param {object[]} events
 * @returns {{start: number, end: number, ended: boolean}}
 */
export function rangeOf(header, events) {
  const start = header.start_tick ?? (events.length ? events[0].tick : 0);
  const last = events.length ? events[events.length - 1] : null;
  const endEvent = last && last.type === 'end' ? last : null;
  let end = endEvent ? endEvent.tick : (header.params?.end_tick ?? start);
  if (last) end = Math.max(end, last.tick);
  return { start, end: Math.max(end, start + 1), ended: endEvent !== null };
}

/**
 * Inside the game, while it is being prepared (phase 9-5): the village that
 * waits is only a stand-in, so the track shows one day, cut at the hour the
 * draft ends (`until`, "HH:MM" of day 0) when it has one: never the days of
 * the stand-in (Teléfono roto) nor its hours past a deadline.
 * @param {{start: number, end: number, ended: boolean}} range
 * @param {string|null|undefined} until
 * @returns {{start: number, end: number, ended: boolean}}
 */
export function preparingRange(range, until) {
  const m = /^(\d\d):(\d\d)$/.exec(until ?? '');
  const day = 24 * 60;
  const cut = m ? Math.min(day, Number(m[1]) * 60 + Number(m[2])) : day;
  return { ...range, end: Math.max(range.start + 1, Math.min(range.end, cut)) };
}

/**
 * Marks of the timeline, in tick order (several may share a tick).
 * @param {object[]} events
 * @param {string|null} factId the chosen fact (app.factId()); arrivals,
 *   changes and forgets are of this fact only, injects of every fact
 * @returns {Mark[]}
 */
export function marksOf(events, factId) {
  const out = [];
  let original = null;
  const changed = new Set();
  const forgot = new Set();
  const speakers = new Map(); // turn id -> who spoke
  const arrivals = new Map(); // `${tick}|${ok}` -> mark
  for (const e of events) {
    if (e.type === 'turn') {
      speakers.set(e.id, e.who);
    } else if (e.type === 'inject') {
      out.push({ tick: e.tick, kind: 'inject', fact: e.fact, what: e.what });
      if (e.fact === factId && !original) original = e.slots ?? {};
    } else if (e.type === 'memory' && e.fact === factId && original) {
      const was = original[e.slot] ?? null;
      const held = e.state !== 'forgotten' && e.value !== null && e.value !== undefined;
      if (held && e.value !== was && !changed.has(e.slot)) {
        changed.add(e.slot);
        const from = e.cause === 'told' && e.turn !== null ? (speakers.get(e.turn) ?? null) : null;
        out.push({ tick: e.tick, kind: 'change', slot: e.slot, who: e.who, from, cause: e.cause, state: e.state, value: e.value, original: was });
      } else if (!held && was !== null && !forgot.has(e.slot)) {
        forgot.add(e.slot);
        out.push({ tick: e.tick, kind: 'forget', slot: e.slot, who: e.who });
      }
    } else if (e.type === 'arrive' && e.fact === factId) {
      const ok = !!original && e.place === original.where && e.slot === original.when;
      const key = `${e.tick}|${ok}`;
      let m = arrivals.get(key);
      if (!m) {
        m = { tick: e.tick, kind: 'arrive', ok, who: [] };
        arrivals.set(key, m);
        out.push(m);
      }
      m.who.push(e.who);
    }
  }
  return out;
}

/**
 * What a mark says, for the tooltip and «next moment»: «Ana se lo contó
 * deformado a Luis · cambió la hora: 22:00 → 23:00», «Luis se olvida de la
 * hora: le queda incompleto».
 * @param {Mark} m
 * @param {object} header
 * @param {'es'|'en'} lang
 * @param {object} text replay/strings.js, picked
 * @returns {string}
 */
export function markText(m, header, lang, text) {
  const fillIn = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  const name = (id) => neighborName(header, id);
  if (m.kind === 'inject') return fillIn(text.inject, { what: whatName(m.what, lang) });
  if (m.kind === 'forget') return fillIn(text.forget, { who: name(m.who), slot: text.slots[m.slot] ?? m.slot });
  if (m.kind === 'change') {
    const added = m.original === null || m.original === undefined;
    const key = (m.from ? 'change' : 'changeAlone') + (added ? 'Added' : '');
    const value = (v) => slotValueText(m.slot, v, header);
    return fillIn(text[key], {
      from: m.from ? name(m.from) : '',
      who: name(m.who),
      slot: text.slots[m.slot] ?? m.slot,
      old: added ? '' : value(m.original),
      new: value(m.value) + (m.state === 'doubt' ? '?' : ''),
    });
  }
  const list = m.who.slice(0, 4).map(name);
  const who = list.join(', ') + (m.who.length > 4 ? ` +${m.who.length - 4}` : '');
  return fillIn(m.ok ? text.arriveOk : text.arriveOther, { who });
}

/**
 * Horizontal position of a tick on a track.
 * @param {number} tick
 * @param {{start: number, end: number}} range
 * @param {number} width track width in pixels
 */
export function xOfTick(tick, range, width) {
  return ((tick - range.start) / (range.end - range.start)) * width;
}

/**
 * Tick under a horizontal position, rounded to a whole tick and kept inside
 * the range (and before `limit`, the live edge, when given).
 * @param {number} x
 * @param {{start: number, end: number}} range
 * @param {number} width
 * @param {number} [limit]
 */
export function tickAtX(x, range, width, limit = Infinity) {
  const t = Math.round(range.start + (x / Math.max(1, width)) * (range.end - range.start));
  return Math.max(range.start, Math.min(range.end, limit, t));
}

/**
 * Marks near a horizontal position, nearest first.
 * @param {Mark[]} marks
 * @param {number} x
 * @param {{start: number, end: number}} range
 * @param {number} width
 * @param {number} radius pixels
 * @returns {Mark[]}
 */
export function marksNear(marks, x, range, width, radius) {
  return marks
    .map((m) => ({ m, d: Math.abs(xOfTick(m.tick, range, width) - x) }))
    .filter((o) => o.d <= radius)
    .sort((a, b) => a.d - b.d)
    .map((o) => o.m);
}

/**
 * The moment (marks sharing one tick) next to a position: the first tick of a
 * mark after `pos` (dir 1), or the last one before it (dir -1). Going back
 * skips the mark the position sits on, so that pressing «previous» right
 * after a jump goes further back; a mark is reachable only up to `limit`
 * (the live edge).
 * @param {Mark[]} marks in tick order
 * @param {number} pos playback position
 * @param {1|-1} dir
 * @param {number} [limit]
 * @returns {{tick: number, marks: Mark[]}|null}
 */
export function stepMark(marks, pos, dir, limit = Infinity) {
  let tick = null;
  if (dir > 0) {
    for (const m of marks) {
      if (m.tick > pos && m.tick <= limit) {
        tick = m.tick;
        break;
      }
    }
  } else {
    for (const m of marks) {
      if (m.tick < pos - 0.5 && m.tick <= limit) tick = m.tick;
      else if (m.tick >= pos - 0.5) break;
    }
  }
  return tick === null ? null : { tick, marks: marks.filter((m) => m.tick === tick) };
}

/**
 * Where a recording opened without `t` starts: `lead` ticks before its first
 * inject, so that the rumor comes in soon (never before the start of the
 * range); the start of the range when no rumor ever comes in.
 * @param {object} header
 * @param {object[]} events
 * @param {number} lead ticks before the inject (constants.js START_LEAD)
 * @returns {number}
 */
export function startTick(header, events, lead) {
  const start = header.start_tick ?? (events.length ? events[0].tick : 0);
  const inject = events.find((e) => e.type === 'inject');
  return inject ? Math.max(start, inject.tick - lead) : start;
}
