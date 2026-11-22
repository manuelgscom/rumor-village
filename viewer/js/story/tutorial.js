// «Tu primera partida», part 2 of the tutorial (phase 9, package F, rewritten
// in phases 9-3 and 9-5; docs/juego.md «Tutorial»): chapters in the style of
// the story mode of phase 8-1 (tour.js), short, one idea each, uncovering the
// interface little by little. Part 1, «Cómo funciona», is howto.js. Pure: no
// DOM, no storage. tutorialview.js puts them on screen.
//
// The page reloads after «Empezar» (the engine keeps the state), so the chapter
// is never stored: it is derived from what can be read again after a reload,
// the game phase and the effective draft (bus 'game': the draft plus the rumor
// open in the editor, what «Empezar» would start) and the log. A rumor counts
// as the form counts it (game/prepare.js rumorIssues).
//
//   n  key       phase           points at (first one present)   moves on with
//   1  write     boot·menu·prep  freetext · rumor-example ·       a rumor with a valid type (Sin IA: also «Siguiente»)
//                                rumor-what
//   2  tell      prepare         rumor-to · neighbor-card (*)     a rumor with nothing missing
//   3  start     prepare         start (*)                        the game starts
//   4  watch     playing         #rumor · mode-label              «Siguiente»
//   5  heard     playing         the listener · rumor-count       «Siguiente» (when 6 follows)
//   6  think     playing         a neighbor, then #inspect        the game ends; once one is opened, «Siguiente» puts the card away (left out without #inspect)
//   7  retry     ended           retry · final                    «Listo», or leaving the end
//
//   (*) while the rumor has no valid type (Sin IA «Siguiente» skips it, or it
//       is cleared later) the card stays and says what is missing, pointing at
//       rumor-what · rumor-example (tutorialTargets, MISSING_TARGETS).
//
// Targets: 'gm:<key>' is the element [data-gm="<key>"] of the game package;
// 'freetext' is the free text (rumor-text) while it is empty and «Rellenar la
// frase» (understood) once it has something written (Con IA only; the view
// reads the textarea); 'zone:<id>' the zone #<id> when it has content;
// 'listener' a ring on who heard the rumor first from a neighbor
// (tutorialFacts().heard; while nobody has, no ring at all); 'neighbor' a ring
// on the neighbor whose decision the guide opens (tutorialFacts().decision).
//
// How a rumor reached someone (`how`, the glossary of docs/fases/fase-9.md
// 9-5): 'intact' every detail as it was; 'incomplete' some detail forgotten
// (omitted, when the original rumor has it); 'distorted' some detail changed
// (any other verdict). A detail the original rumor lacks is never counted.
//
// The facts are read from the log as far as it is applied (store.index), not
// from events received live and not shown yet.

import { rumorIssues } from '../game/prepare.js';
import { informedEnd, topTellers } from '../game/score/measures.js';
import { isTell } from '../rumor/history.js';

/** Zones always seen during the guided game (app.ui.only): the game screens and the banner. */
export const BASE_ZONES = ['game', 'banner'];

/**
 * The table of chapters. phases: the game phases the chapter belongs to;
 * next: «Siguiente» shown ({ai, rules} when it depends on the mode); hold: the
 * chapter waits for «Siguiente» while the phase stays one of its own, whatever
 * the facts say; zones: what it uncovers (cumulative).
 */
const TABLE = [
  { key: 'write', phases: ['boot', 'menu', 'prepare'], targets: ['freetext', 'gm:rumor-example', 'gm:rumor-what'], next: { ai: false, rules: true }, zones: [] },
  { key: 'tell', phases: ['prepare'], targets: ['gm:rumor-to', 'gm:neighbor-card'], next: false, zones: [] },
  { key: 'start', phases: ['prepare'], targets: ['gm:start'], next: false, zones: [] },
  { key: 'watch', phases: ['playing'], targets: ['zone:rumor', 'gm:mode-label'], next: true, hold: true, zones: ['rumor', 'now', 'bar', 'side'] },
  { key: 'heard', phases: ['playing'], targets: ['listener', 'gm:rumor-count'], next: true, zones: ['side'] },
  { key: 'think', phases: ['playing'], targets: ['neighbor'], next: false, zones: ['side', 'inspect'], needs: 'inspect' },
  { key: 'retry', phases: ['ended'], targets: ['gm:retry', 'gm:final'], next: false, last: true, zones: ['summary'] },
];

/** What tell and start point at while the rumor has no valid type. */
export const MISSING_TARGETS = ['gm:rumor-what', 'gm:rumor-example'];

/** Keys of every chapter, in order. */
export const TUTORIAL_KEYS = TABLE.map((c) => c.key);

/** The chapter from which the guided game counts as seen (profile `tutorial_seen`). */
export const SEEN_FROM = 'retry';

/**
 * The chapters of the guided game for a mode.
 * @param {{mode?: 'ai'|'rules', inspect?: boolean}} [opts] inspect: the «¿Qué pensó?» card exists
 * @returns {{n: number, key: string, phases: string[], targets: string[], next: boolean, hold: boolean, last: boolean, zones: string[]}[]}
 */
export function tutorialChapters({ mode = 'ai', inspect = true } = {}) {
  const m = mode === 'rules' ? 'rules' : 'ai';
  const list = TABLE.filter((c) => c.needs !== 'inspect' || inspect);
  const zones = new Set(BASE_ZONES);
  return list.map((c, i) => {
    for (const z of c.zones) zones.add(z);
    const following = list[i + 1];
    // «Siguiente» only leads to a chapter of the same phase: the next phase
    // comes with the player's action (Empezar) or the end of the game.
    const sameNext = !!following && following.phases.some((p) => c.phases.includes(p));
    const next = (typeof c.next === 'object' ? c.next[m] : c.next) && sameNext;
    return { n: i + 1, key: c.key, phases: [...c.phases], targets: [...c.targets], next, hold: !!c.hold, last: !!c.last, zones: [...zones] };
  });
}

/** The event list of a log given as {events} or as the list itself. */
const eventsOf = (log) => (Array.isArray(log) ? log : (log?.events ?? []));

/**
 * How a turn passed its fact on (docs/contrato.md, `verdict`): 'intact',
 * 'incomplete' (only details forgotten) or 'distorted' (some detail changed).
 * A detail the original rumor does not have (slots[k] null) comes out
 * 'omitted' and is not counted.
 * @returns {'intact'|'incomplete'|'distorted'}
 */
export function turnHow(e, slots = {}) {
  let how = 'intact';
  for (const [k, v] of Object.entries(e?.verdict ?? {})) {
    if (v === 'faithful') continue;
    if (v === 'omitted') {
      if ((slots?.[k] ?? null) !== null && how === 'intact') how = 'incomplete';
      continue;
    }
    return 'distorted';
  }
  return how;
}

/**
 * What the chapters are derived from.
 * @param {{phase?: string|null, draft?: any, log?: any}} input
 *   draft: the effective draft (with the rumor open in the editor); log:
 *   {events} or the event list, as far as it is shown
 * @returns {{phase: string|null, written: boolean, told: boolean, started: boolean, ended: boolean,
 *   fact: string|null, heard: {who: string, from: string, tick: number, turn: number, intact: boolean, how: string}|null,
 *   decision: {who: string, tick: number, turn: number|null, told: boolean}|null}}
 *   fact: the first rumor injected; heard: its first transmission, a tell
 *   that reached someone who did not know it (how: turnHow; intact: how is
 *   'intact'); decision: what «¿Qué pensó?»
 *   opens: the first tell of the rumor of that listener, else of who told
 *   them (told: true; Sin IA it carries the dice); with nobody told yet, the
 *   first who heard it from the player and their first decision after it
 */
export function tutorialFacts({ phase = null, draft = null, log = null } = {}) {
  const events = eventsOf(log);
  const rumors = Array.isArray(draft?.rumors) ? draft.rumors : [];
  const settings = draft?.settings ?? {};
  // The same test as the form: written = a valid type; told = nothing missing.
  const issues = rumors.map((r) => rumorIssues(r, settings));
  const written = issues.some((x) => !x.includes('what'));
  const told = issues.some((x) => x.length === 0);
  const ended = phase === 'ended' || (events.length > 0 && events[events.length - 1].type === 'end');
  let inject = null;
  let heard = null;
  const knows = new Set();
  for (const e of events) {
    if (e.type === 'inject' && (!inject || e.fact === inject.fact)) {
      inject ??= e;
      for (const who of e.to ?? []) knows.add(who);
    } else if (inject && isTell(e) && e.fact === inject.fact) {
      if (!knows.has(e.to)) {
        const how = turnHow(e, inject.slots);
        heard = { who: e.to, from: e.who, tick: e.tick, turn: e.id, intact: how === 'intact', how };
        break;
      }
    }
  }
  let decision = null;
  const first = heard?.who ?? inject?.to?.[0] ?? null;
  if (first) {
    // A tell of the rumor first (Sin IA it carries the dice of telling): the
    // listener's, else the one that reached them (heard.from told it).
    const tellOf = (id) => events.find((e) => isTell(e) && e.who === id && e.fact === inject.fact);
    const teller = [first, heard?.from].find((id) => id && tellOf(id));
    if (teller) {
      const own = tellOf(teller);
      decision = { who: teller, tick: own.tick, turn: own.id, told: true };
    } else {
      // Nobody told it yet: their first decision after hearing it (a turn or a plan, what
      // «¿Qué pensó?» lists: inspect/plain.js decisionsOf), else none (the newest).
      const since = heard?.tick ?? inject.tick;
      const next = events.find((e) => (e.type === 'turn' || e.type === 'plan') && e.who === first && e.tick >= since && Number.isInteger(e.id));
      decision = next ? { who: first, tick: next.tick, turn: next.id, told: false } : { who: first, tick: since, turn: null, told: false };
    }
  }
  const started = ended || phase === 'playing' || !!inject;
  return { phase, written, told, started, ended, fact: inject?.fact ?? null, heard, decision };
}

/**
 * What happened to a rumor around one neighbor, for the summary of
 * «¿Qué pensó?»: how it reached them and to whom they told it.
 * @param {object[]|{events: object[]}} log as far as it is shown
 * @param {string} who
 * @param {string|null} [fact] default the first injected
 * @returns {{received: {from: string|null, intact: boolean, how: string, tick: number}|null, told: {to: string, intact: boolean, how: string, turn: number}[]}}
 *   received.from: null when the player told them (inject); tick: when; how:
 *   turnHow (intact: how is 'intact'); told: one entry per listener, their
 *   first tell, in log order
 */
export function tutorialStory(log, who, fact = null) {
  const events = eventsOf(log);
  const f = fact ?? events.find((e) => e.type === 'inject')?.fact ?? null;
  let received = null;
  const told = [];
  const seen = new Set();
  if (f === null) return { received, told };
  const slots = events.find((e) => e.type === 'inject' && e.fact === f)?.slots ?? {};
  for (const e of events) {
    if (e.type === 'inject') {
      if (!received && e.fact === f && (e.to ?? []).includes(who)) received = { from: null, intact: true, how: 'intact', tick: e.tick };
      continue;
    }
    if (!isTell(e) || e.fact !== f) continue;
    const how = turnHow(e, slots);
    if (!received && e.to === who) received = { from: e.who, intact: how === 'intact', how, tick: e.tick };
    if (e.who === who && !seen.has(e.to)) {
      seen.add(e.to);
      told.push({ to: e.to, intact: how === 'intact', how, turn: e.id });
    }
  }
  return { received, told };
}

/**
 * What a chapter points at with these facts: its own targets, except that
 * «¿A quién?» and «Empezar» go back to the type while the rumor has none.
 * @param {{key: string, targets: string[]}} chapter
 * @param {ReturnType<typeof tutorialFacts>|null} facts
 * @returns {{targets: string[], missing: boolean}} missing: the type is what is missing
 */
export function tutorialTargets(chapter, facts) {
  const missing = !!facts && !facts.written && (chapter?.key === 'tell' || chapter?.key === 'start');
  return { targets: missing ? [...MISSING_TARGETS] : [...(chapter?.targets ?? [])], missing };
}

/**
 * Index of the chapter the facts put the player in.
 * @param {Parameters<typeof tutorialFacts>[0] & {inspect?: boolean}} input
 * @returns {number}
 */
export function tutorialChapterAt(input = {}) {
  const chapters = tutorialChapters({ mode: input.mode, inspect: input.inspect ?? true });
  const f = tutorialFacts(input);
  let key = 'write';
  if (f.ended) key = 'retry';
  else if (f.started) key = 'watch';
  else if (f.phase === 'prepare') key = f.told ? 'start' : f.written ? 'tell' : 'write';
  return chapters.findIndex((c) => c.key === key);
}

/**
 * The chapter to open at: the derived one (kept as a function: the opening
 * rule changed with the chapters, phase 9-5, and may change again).
 * @param {object[]} chapters
 * @param {number} derived tutorialChapterAt
 */
export function tutorialEntry(chapters, derived) {
  return Math.max(0, Math.min(chapters.length - 1, derived));
}

/**
 * The chapter after a change of the facts: only forward, and a held chapter
 * (the rumor card) waits for «Siguiente» while the derived one shares its phases.
 * @param {object[]} chapters
 * @param {number} current
 * @param {number} derived
 */
export function tutorialAdvance(chapters, current, derived) {
  if (derived <= current) return current;
  const cur = chapters[current];
  if (cur?.hold && chapters[derived].phases.some((p) => cur.phases.includes(p))) return current;
  return derived;
}

/**
 * The chapter after «Siguiente»: the next one, or the derived one if it is further.
 * @param {object[]} chapters
 * @param {number} current
 * @param {number} derived
 */
export function tutorialNext(chapters, current, derived) {
  return Math.min(chapters.length - 1, Math.max(current + 1, derived));
}

/**
 * Whether the guide holds the village still (POST control pause, through the
 * bus 'pause' {engine: true}): while it waits for «Siguiente» on a step of the
 * game, so a short game without text does not end before the player reads it.
 * «Míralo correr» always; «Alguien se ha enterado» once someone has (before,
 * the village has to run for it to happen); never in «¿Qué pensó?», nor with
 * the card folded, nor once the player resumed it on that step. Only the pace:
 * the result does not change.
 * @param {{key: string, next: boolean}|null} chapter
 * @param {{phase: string|null, known?: boolean, folded?: boolean, resumed?: boolean}} o
 *   known: the first exchange was seen; resumed: the player pressed play on this step
 * @returns {boolean}
 */
export function tutorialHolds(chapter, { phase, known = false, folded = false, resumed = false }) {
  if (!chapter?.next || phase !== 'playing' || folded || resumed) return false;
  return chapter.key === 'watch' || (chapter.key === 'heard' && known);
}

/**
 * Whom the camera frames in «Míralo correr» (phase 9-5): the first encounter
 * that passes the rumor on (who told it and who heard it), else who heard it
 * from the player, so the step shows what the headline says.
 * @param {ReturnType<typeof tutorialFacts>|null} facts
 * @param {object[]|{events: object[]}} log as far as it is shown
 * @returns {string[]} neighbor ids, [] for nobody
 */
export function tutorialFocus(facts, log) {
  if (facts?.heard) return [facts.heard.from, facts.heard.who];
  const inject = eventsOf(log).find((e) => e.type === 'inject' && (facts?.fact == null || e.fact === facts.fact));
  return (inject?.to ?? []).slice(0, 1);
}

/**
 * Whether the card shows «Siguiente»: where the chapter has it, the last one
 * («Listo»), and «¿Qué pensó?» once the player opened one (thinkSeen): there it
 * closes the panels and puts the card away until the end of the game.
 * @param {{key: string, next: boolean, last: boolean}|null} chapter
 * @param {{thinkSeen?: boolean}} [o]
 */
export function tutorialShowsNext(chapter, { thinkSeen = false } = {}) {
  return !!chapter && (chapter.next || chapter.last || (chapter.key === 'think' && thinkSeen));
}

/**
 * What the last step says of the game (phase 9-5): how many heard about the
 * rumor and who moved it most, as the end card counts them (game/score/
 * measures.js informedEnd and topTellers), and whether someone told it
 * changed (a tell of it that came out distorted: a game for «Adivina: ¿quién
 * cambió el rumor?»).
 * @param {object[]|{events: object[]}} log the whole log
 * @param {string|null} [fact] default the first injected
 * @returns {{informed: number, top: string|null, distorted: boolean}|null} null without a rumor
 */
export function tutorialResult(log, fact = null) {
  const events = eventsOf(log);
  const inject = events.find((e) => e.type === 'inject' && (fact === null || e.fact === fact));
  if (!inject) return null;
  const f = inject.fact;
  const l = { events };
  return {
    informed: informedEnd(l, f).size,
    top: topTellers(l, f, 1)[0]?.who ?? null,
    distorted: events.some((e) => isTell(e) && e.fact === f && turnHow(e, inject.slots) === 'distorted'),
  };
}

/**
 * Whether the guided game is over for good: the last chapter was reached and
 * the game left its end («Probar con otro vecino», «Otra vez», «Partida nueva»). 'boot' does not count:
 * the game package says it again after every reload.
 * @param {object[]} chapters
 * @param {number} current
 * @param {string|null} phase
 */
export function tutorialLeft(chapters, current, phase) {
  const seen = chapters.findIndex((c) => c.key === SEEN_FROM);
  return current >= seen && phase !== null && phase !== 'ended' && phase !== 'boot';
}

/**
 * The profile with the guided game marked as seen, and `tutorial_guided`
 * gone (read-modify-write of the whole profile of POST /profile: everything
 * else is kept).
 * @param {any} profile body of GET /profile
 * @returns {object}
 */
export function withTutorialSeen(profile) {
  const base = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
  // Seen means no longer under way: a reload does not bring the guide back (game/profile.js).
  const out = { ...base, format: base.format ?? 1, tutorial_seen: true };
  delete out.tutorial_guided;
  return out;
}
