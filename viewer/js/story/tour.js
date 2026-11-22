// The story mode (phase 8-1, package B): seven chapters computed from the
// recording itself. Pure: no DOM, same chapters for the same recording.
//
//   chaptersOf({header, events, marks}) → [{n, key, from, to, ms, speed, shot, line, zones, parts}]
//     n        1-7 (the number of the chapter in the chapter table of fase-8.md, section 8-1)
//     from/to  span of ticks; ms its length on screen; speed = ticks per second
//     shot     a Shot of director.js · zones: what is seen (app.ui.only), cumulative
//     line     {key, ...data} for the sentence (phrase.js chapterPhrase)
//     parts    1 or 2 steps inside the chapter, each {from, to, ms, speed, shot, select, group}
//   chapterAt(chapters, pos) → the chapter at a position, or null
//   marks: marksOf of replay/timeline.js for the first rumor
//
//   n  starts at                          shot                         left out when
//   1  20 ticks before the first inject   the whole village            —
//   2  the first inject                   who hears it first, selected —
//   3  the first tell not rejected        the pair; then the village   no tell
//   4  the first `change` mark (after 3)  that neighbor, selected      no change mark
//   5  10 ticks before the original hour  the place; then a wrong group  no arrive
//   6  the busiest tick after 2-4         a conversation               policy baseline
//   7  the `end` event                    the whole village            —
//
// The chapters play forward in time, so they are sorted by their start (a tie
// keeps the number order): chapter 6 may come before 5. Each one runs until
// the next starts; a chapter with no ticks of its own is a still.

import { slotTick } from '../core/clock.js';
import { groupKey } from '../rumor/groups.js';
import { ARRIVE_ZOOM, PAIR_ZOOM } from './director.js';

/** Length of each chapter on screen before stretching, in ms. */
export const CHAPTER_MS = { 1: 9000, 2: 10000, 3: 16000, 4: 13000, 5: 15000, 6: 12000, 7: 10000 };
/** Length of the first part of the chapters that have two (close-up, then wide). */
export const FIRST_PART_MS = { 3: 5000, 5: 7000 };
/** Ticks of the first part of chapters 3 and 5. */
export const FIRST_PART_TICKS = { 3: 4, 5: 20 };
/** The whole tour aims at this length; short recordings stretch up to MAX_STRETCH. */
export const TARGET_MS = 90000;
export const MAX_STRETCH = 1.25;
/** Chapter 1 starts this many ticks before the first inject. */
export const LEAD_TICKS = 20;
/** Chapter 5 starts this many ticks before the original hour. */
export const ARRIVE_LEAD = 10;
/** Speeds from this one (ticks per second) up skip the reading pauses. */
export const FAST_TPS = 8;

/** Zones always seen during the tour, and what each chapter uncovers. */
export const BASE_ZONES = ['tour', 'help', 'banner', 'bar'];
export const CHAPTER_ZONES = { 1: ['now'], 2: ['rumor'], 3: [], 4: ['side'], 5: ['side'], 6: ['dock'], 7: ['summary'] };
/** Zones a chapter puts away again: in 7 the summary card takes the rumor card's place. */
export const CHAPTER_HIDES = { 7: ['rumor'] };

const KEYS = { 1: 'village', 2: 'inject', 3: 'spread', 4: 'distort', 5: 'consequences', 6: 'model', 7: 'day' };

/** A director Shot (director.js) framing a subject from a tick. */
function shotOf(kind, { ids = [], place = null, zoom = 1 } = {}, tick = 0) {
  const key = kind === 'home' ? 'home' : kind === 'place' ? `place|${place}` : `${kind}|${ids.join('|')}`;
  return { key, kind, ids, place, zoom, cls: 0, since: tick, last: tick, item: null };
}

const isTell = (e) => e.type === 'turn' && e.reject === null && e.action === 'say' && e.act === 'tell' && !!e.fact;

/**
 * Chapter candidates in number order: {n, from, shot, line, parts?}.
 * Parts here are drafts with a tick length (`ticks`) and a share of the time.
 */
function candidates(header, events, marks) {
  const start = header.start_tick ?? (events.length ? events[0].tick : 0);
  const endEvent = events.find((e) => e.type === 'end');
  const end = endEvent ? endEvent.tick : events.length ? events[events.length - 1].tick : start;
  const clamp = (t) => Math.max(start, Math.min(end, t));
  const inject = events.find((e) => e.type === 'inject');
  const fact = inject?.fact ?? null;
  const original = inject?.slots ?? {};
  const home = (t) => shotOf('home', {}, t);
  const out = [];

  // 1. The village, with who decides.
  const t0 = inject ? inject.tick : start;
  out.push({
    n: 1,
    from: clamp(t0 - LEAD_TICKS),
    shot: home(clamp(t0 - LEAD_TICKS)),
    line: { key: 'village', neighbors: header.neighbors?.length ?? 0, model: header.policy === 'baseline' ? null : header.model ?? null },
  });
  if (!inject) {
    out.push({ n: 7, from: end, shot: home(end), line: { key: 'day', informed: endEvent?.informed ?? null, total: header.neighbors?.length ?? 0 } });
    return { out, end };
  }

  // 2. The rumor comes in.
  const first = inject.to?.[0] ?? null;
  out.push({
    n: 2,
    from: clamp(inject.tick),
    shot: first ? shotOf('neighbor', { ids: [first], zoom: PAIR_ZOOM * 0.75 }, inject.tick) : home(inject.tick),
    select: first,
    line: { key: 'inject', fact, what: inject.what, slots: original, to: inject.to ?? [] },
  });

  // 3. From mouth to mouth: the pair, then the village at speed.
  const tell = events.find((e) => isTell(e) && e.fact === fact);
  if (tell) {
    const ids = [tell.who, tell.to].sort();
    out.push({
      n: 3,
      from: clamp(tell.tick),
      shot: shotOf('pair', { ids, zoom: PAIR_ZOOM }, tell.tick),
      line: { key: 'spread', a: tell.who, b: tell.to },
      parts: [
        { ticks: FIRST_PART_TICKS[3], ms: FIRST_PART_MS[3], shot: shotOf('pair', { ids, zoom: PAIR_ZOOM }, tell.tick) },
        { ticks: Infinity, shot: home(tell.tick) },
      ],
    });
  }

  // 4. It gets distorted: the first change mark once the rumor travels (the
  //    first one at all if none comes after the first tell), its neighbor selected.
  const changes = marks.filter((m) => m.kind === 'change');
  const change = changes.find((m) => !tell || m.tick >= tell.tick) ?? changes[0];
  if (change) {
    out.push({
      n: 4,
      from: clamp(change.tick),
      shot: shotOf('neighbor', { ids: [change.who], zoom: ARRIVE_ZOOM }, change.tick),
      select: change.who,
      line: { key: 'distort', who: change.who, slot: change.slot, state: change.state, value: change.value, original: original[change.slot] ?? null, what: inject.what },
    });
  }

  // 5. Consequences: the original place before the original hour, then the
  //    biggest group that came wrong (its culprit is in the side card).
  const arrives = events.filter((e) => e.type === 'arrive' && e.fact === fact);
  if (arrives.length) {
    const at = original.when !== null && original.when !== undefined ? slotTick(original.when) : arrives[0].tick;
    const from = clamp(at - ARRIVE_LEAD);
    const seen = new Set();
    const groups = { other_time: [], other_place: [] };
    for (const a of arrives) {
      if (seen.has(a.who)) continue;
      seen.add(a.who);
      const g = groupKey(a.place, a.slot, original);
      if (g !== 'right') groups[g].push(a);
    }
    const wrong = groups.other_time.length >= groups.other_place.length ? 'other_time' : 'other_place';
    const place = original.where ?? arrives[0].place;
    const shot = shotOf('place', { place, zoom: ARRIVE_ZOOM }, from);
    const c = { n: 5, from, shot, line: { key: 'consequences', where: original.where ?? null, when: original.when ?? null, wrong: groups[wrong].length ? wrong : null } };
    if (groups[wrong].length) {
      const g = groups[wrong][0];
      c.parts = [
        { ticks: FIRST_PART_TICKS[5], ms: FIRST_PART_MS[5], shot },
        { ticks: Infinity, shot: shotOf('place', { place: g.place, zoom: ARRIVE_ZOOM }, from), group: wrong },
      ];
    }
    out.push(c);
  }

  // 6. A model decides: the tick with the most decisions after the rumor has
  //    started to travel (after the latest of chapters 2-4).
  if (header.policy !== 'baseline') {
    const after = Math.max(...out.filter((c) => c.n >= 2 && c.n <= 4).map((c) => c.from));
    const count = new Map();
    for (const e of events) {
      if ((e.type === 'turn' || e.type === 'plan') && e.tick > after && e.tick < end) count.set(e.tick, (count.get(e.tick) ?? 0) + 1);
    }
    let best = null;
    for (const [tick, k] of count) if (!best || k > best.k || (k === best.k && tick < best.tick)) best = { tick, k };
    if (best) {
      const at = events.filter((e) => e.tick === best.tick && (e.type === 'turn' || e.type === 'plan'));
      const turn = at.find(isTell) ?? at.find((e) => e.type === 'turn');
      const shot = turn
        ? shotOf('pair', { ids: [turn.who, turn.to].sort(), zoom: PAIR_ZOOM }, best.tick)
        : shotOf('neighbor', { ids: [at[0].who], zoom: PAIR_ZOOM }, best.tick);
      out.push({ n: 6, from: clamp(best.tick), shot, line: { key: 'model', decisions: best.k, model: header.model ?? null } });
    }
  }

  // 7. The day in figures.
  out.push({ n: 7, from: end, shot: home(end), line: { key: 'day', informed: endEvent?.informed ?? null, total: header.neighbors?.length ?? 0 } });
  return { out, end };
}

/**
 * The chapters of a recording, in playing order.
 * @param {{header: object, events: object[], marks: object[]}} rec
 * @returns {object[]}
 */
export function chaptersOf({ header, events, marks }) {
  const { out } = candidates(header, events ?? [], marks ?? []);
  const list = out.map((c, i) => ({ c, i })).sort((a, b) => a.c.from - b.c.from || a.c.n - b.c.n).map((o) => o.c);
  const sum = list.reduce((s, c) => s + CHAPTER_MS[c.n], 0);
  const stretch = Math.min(MAX_STRETCH, Math.max(1, TARGET_MS / Math.max(1, sum)));
  const ms = (v) => Math.round((v * stretch) / 100) * 100;
  const zones = new Set(BASE_ZONES);
  return list.map((c, k) => {
    const to = k + 1 < list.length ? list[k + 1].from : c.from;
    const total = ms(CHAPTER_MS[c.n]);
    for (const z of CHAPTER_ZONES[c.n]) zones.add(z);
    const drafts = c.parts ?? [{ ticks: Infinity, shot: c.shot }];
    const parts = [];
    let at = c.from;
    let left = total;
    drafts.forEach((d, j) => {
      const last = j === drafts.length - 1;
      const pTo = last ? to : Math.min(to, at + d.ticks);
      const pMs = last ? left : ms(d.ms);
      left -= pMs;
      parts.push({
        from: at,
        to: pTo,
        ms: pMs,
        speed: (pTo - at) / (pMs / 1000),
        shot: d.shot,
        select: c.select ?? null,
        group: d.group ?? null,
      });
      at = pTo;
    });
    return {
      n: c.n,
      key: KEYS[c.n],
      from: c.from,
      to,
      ms: total,
      speed: (to - c.from) / (total / 1000),
      shot: c.shot,
      line: c.line,
      zones: [...zones].filter((z) => !(CHAPTER_HIDES[c.n] ?? []).includes(z)),
      parts,
    };
  });
}

/**
 * The chapter at a playback position: the last one started by then (the last
 * chapter also holds the positions after it); null before the first.
 * @param {object[]} chapters
 * @param {number} pos
 * @returns {object|null}
 */
export function chapterAt(chapters, pos) {
  let found = null;
  for (const c of chapters) if (pos >= c.from) found = c;
  return found;
}

/**
 * Index of the part of a chapter at a time inside it (ms since it started).
 * @param {object} chapter
 * @param {number} elapsedMs
 * @returns {number}
 */
export function partAt(chapter, elapsedMs) {
  let t = 0;
  for (let k = 0; k < chapter.parts.length; k++) {
    t += chapter.parts[k].ms;
    if (elapsedMs < t) return k;
  }
  return chapter.parts.length - 1;
}
