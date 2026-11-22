// The summary of the day, as of a log position. Pure: no DOM. See README.md.
//
//   inject of the rumor followed (default: the first) ──► original slots
//   h.informed ──► told ──► versionOf (h.slotAt × 4) ──► correct · incomplete · wrong
//   each wrong neighbor × each held slot ≠ original
//        └─► chainOf + deviationIndex ──► culprit hop ──► changes[(turn, slot)]
//   tells and changes by speaker ──► ranking (ranking.js)
//   first `arrive` by neighbor ── groupKey ──► attendance {right, other_time, other_place}
//
// Only `inject`, `turn` and `memory` events count (through rumor/history.js),
// so the figures of the first rumor match `reach` of `scripts/rumor.sh metrics`.
// With several rumors, `fact` chooses the one measured and the title names it.

import { clockOf } from '../core/clock.js';
import { pick } from '../core/lang.js';
import { neighborName, slotValueText, whatName } from '../core/names.js';
import { holds, SLOTS, versionOf } from '../core/version.js';
import { chainOf, deviationIndex } from '../rumor/chain.js';
import { groupKey } from '../rumor/groups.js';
import { createHistory } from '../rumor/history.js';
import { fill } from '../rumor/strings.js';
import { rankingAt } from './ranking.js';
import { STRINGS } from './strings.js';

/**
 * @typedef {object} Change
 * @property {string} who neighbor whose turn changed the slot
 * @property {number} turn turn id
 * @property {number} tick
 * @property {string} slot
 * @property {any} from original value of the slot (null if the original has none)
 * @property {any} to value the listener got
 * @property {string|null} cause see rumor/chain.js (HopSlot.cause)
 * @property {string[]} affected neighbors who hold the changed value through that turn
 */

/**
 * @typedef {object} Summary
 * @property {string|null} fact id of the measured fact (`fact`, else the first inject)
 * @property {object|null} original `slots` of that inject
 * @property {string|null} what `what` of that inject
 * @property {number} tick tick of the last event counted
 * @property {boolean} ended an `end` event is among those counted
 * @property {number} total neighbors in the header
 * @property {number} told
 * @property {number} correct
 * @property {number} incomplete
 * @property {number} wrong
 * @property {number} changed same as wrong
 * @property {Change[]} changes most affected first, then by tick
 * @property {{who: string, slot: string}[]} unexplained wrong slots without a culprit hop
 * @property {import('./ranking.js').Ranking} ranking who told it most and who changed it most
 * @property {{right: number, other_time: number, other_place: number, arrived: number}} attendance
 *   neighbors by their first `arrive` for the fact, against the original place
 *   and hour (the engine's `attendance`; plans not yet carried out do not count)
 * @property {Object<string, 'correct'|'incomplete'|'wrong'>} versionOf version of every told neighbor
 * @property {string[]} lines the card as text, in `lang`
 */

// Positions of the injects and of the end event, found once per history.
const scans = new WeakMap();

function scan(h) {
  let s = scans.get(h);
  if (!s) scans.set(h, (s = { seen: 0, injects: [], end: -1 }));
  for (; s.seen < h.size; s.seen++) {
    const e = h.event(s.seen);
    if (e?.type === 'inject') s.injects.push(s.seen);
    else if (e?.type === 'end' && s.end < 0) s.end = s.seen;
  }
  return s;
}

/** Memory of a fact as versionOf takes it, from the history at idx. */
function memoryAt(h, who, fact, idx) {
  const mem = {};
  for (const s of SLOTS) {
    const m = h.slotAt(who, fact, s, idx);
    if (m) mem[s] = { state: m.state, value: m.value };
  }
  return mem;
}

/** Text of a slot value, or "—" for none. */
function valueText(slot, value, header) {
  return value === null || value === undefined ? '—' : slotValueText(slot, value, header);
}

/**
 * One line of a change: "Luis cambió la hora: 22:00 → 23:00 · lo creen 2".
 * @param {Change} c
 * @param {object} header
 * @param {object} t texts (strings.js, picked)
 * @returns {string}
 */
export function changeLine(c, header, t) {
  const values = {
    name: neighborName(header, c.who),
    slot: t.slots[c.slot] ?? c.slot,
    from: valueText(c.slot, c.from, header),
    to: valueText(c.slot, c.to, header),
  };
  const head = fill(c.from === null || c.from === undefined ? t.changeAdded : t.change, values);
  const n = c.affected.length;
  return `${head} · ${fill(n === 1 ? t.believersOne : t.believers, { n })}`;
}

/**
 * Short text of the fact: "fiesta · Manuel · plaza · 22:00 · 50".
 * @param {string|null} what
 * @param {object|null} original
 * @param {object} header
 * @param {string} lang
 */
export function factText(what, original, header, lang) {
  const parts = what ? [whatName(what, lang)] : [];
  for (const s of SLOTS) {
    const v = original?.[s];
    if (v !== null && v !== undefined) parts.push(slotValueText(s, v, header));
  }
  return parts.join(' · ');
}

/**
 * Summary as of position idx of a history already fed with the events.
 * @param {ReturnType<typeof createHistory>} h
 * @param {object} header
 * @param {number} idx number of events that count (events[0..idx))
 * @param {'es'|'en'} lang
 * @param {string|null} [factId] the rumor to measure (app.factId()); default the first
 * @returns {Summary}
 */
export function summaryAt(h, header, idx, lang, factId = null) {
  const t = pick(STRINGS, lang);
  const ids = (header.neighbors ?? []).map((n) => n.id);
  const s = scan(h);
  const last = idx > 0 ? h.event(idx - 1) : undefined;
  const tick = last ? last.tick : (header.start_tick ?? 0);
  const ended = s.end >= 0 && s.end < idx;
  const out = {
    fact: null,
    original: null,
    what: null,
    tick,
    ended,
    total: ids.length,
    told: 0,
    correct: 0,
    incomplete: 0,
    wrong: 0,
    changed: 0,
    changes: [],
    unexplained: [],
    ranking: { tellers: [], distorters: [] },
    attendance: { right: 0, other_time: 0, other_place: 0, arrived: 0 },
    versionOf: {},
    lines: [],
  };
  const time = clockOf(tick, header.start_weekday ?? 0, lang).time;
  const title = ended ? t.title : fill(t.titleUntil, { time });

  // The injects counted so far, and the one measured.
  const injects = s.injects.filter((i) => i < idx);
  const nth = factId === null || factId === undefined ? 0 : injects.findIndex((i) => h.event(i).fact === factId);
  if (nth < 0 || nth >= injects.length) {
    out.lines.push(title, t.noFact);
    return out;
  }
  const inj = h.event(injects[nth]);
  // With more than one rumor the title says which one is measured.
  out.lines.push(
    injects.length > 1
      ? fill(t.titleOf, { title, n: nth + 1, count: injects.length, what: whatName(inj.what, lang) })
      : title,
  );
  const fact = inj.fact;
  const original = inj.slots ?? {};
  out.fact = fact;
  out.original = original;
  out.what = inj.what ?? null;

  // Versions.
  const wrong = [];
  for (const who of ids) {
    if (!h.informed(who, fact, idx)) continue;
    const v = versionOf(memoryAt(h, who, fact, idx), original);
    if (v === null) continue;
    out.told++;
    out[v]++;
    out.versionOf[who] = v;
    if (v === 'wrong') wrong.push(who);
  }
  out.changed = out.wrong;

  // Attendance: the first arrive of each neighbor for the fact (as
  // engine/src/metrics/metrics.cpp, `arrivals`, first one of each neighbor).
  for (const who of ids) {
    const a = h.arrival(who, fact, idx);
    if (!a) continue;
    out.attendance[groupKey(a.e.place, a.e.slot, original)]++;
    out.attendance.arrived++;
  }

  // Culprit hop of every changed slot, grouped by (turn, slot).
  const byKey = new Map();
  for (const who of wrong) {
    for (const slot of SLOTS) {
      const m = h.slotAt(who, fact, slot, idx);
      const orig = original[slot] ?? null;
      if (!m || !holds(m.state) || m.value === null || m.value === orig) continue;
      const chain = chainOf(h, who, fact, idx, slot);
      const k = chain ? deviationIndex(chain, slot, orig) : -1;
      if (k < 0) {
        out.unexplained.push({ who, slot });
        continue;
      }
      const hop = chain.steps[k];
      const x = hop.slots.find((y) => y.slot === slot);
      const key = `${hop.turn.id}|${slot}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          who: hop.from,
          turn: hop.turn.id,
          tick: hop.tick,
          slot,
          from: orig,
          to: x?.got?.value ?? x?.heard?.value ?? null,
          cause: x?.cause ?? null,
          affected: [],
        });
      }
      byKey.get(key).affected.push(who);
    }
  }
  out.changes = [...byKey.values()].sort(
    (a, b) => b.affected.length - a.affected.length || a.tick - b.tick || a.turn - b.turn,
  );
  out.ranking = rankingAt(h, header, idx, out);

  // Text.
  out.lines.push(factText(out.what, original, header, lang));
  out.lines.push(fill(out.told === 1 ? t.toldOne : t.told, { told: out.told, total: out.total }));
  out.lines.push(
    ['correct', 'incomplete', 'wrong'].map((k) => fill(t.version, { label: t.versions[k], n: out[k] })).join(' · '),
  );
  out.lines.push(fill(t.changed, { changed: out.changed }));
  out.lines.push(fill(t.attendance, out.attendance));
  if (out.changes.length) {
    out.lines.push(t.whoChanged);
    for (const c of out.changes) out.lines.push(changeLine(c, header, t));
  }
  if (out.unexplained.length) {
    const names = [...new Set(out.unexplained.map((u) => neighborName(header, u.who)))].join(', ');
    out.lines.push(fill(t.unexplained, { names }));
  }
  return out;
}

/**
 * Summary of a recording.
 * @param {{header: object, events: object[]}} recording
 * @param {'es'|'en'} lang
 * @param {{until?: number, fact?: string|null}} [opts] until: number of events
 *   that count (default all); fact: id of the rumor to measure (default the first)
 * @returns {Summary}
 */
export function buildSummary(recording, lang, { until, fact = null } = {}) {
  const { header, events } = recording;
  const h = createHistory();
  h.ingest(events);
  const idx = until === undefined || until === null ? events.length : Math.max(0, Math.min(until, events.length));
  return summaryAt(h, header, idx, lang, fact);
}
