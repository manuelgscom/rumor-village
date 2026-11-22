// «Cómo funciona», part 1 of the tutorial (phase 9-5, docs/fases/fase-9.md
// «B. Tutorial, parte 1»): eight cards without interaction, «Atrás»,
// «Siguiente» and «Saltar explicación», over the still village. Pure: no DOM.
// howtoview.js puts them on screen; tutorialview.js chains them with part 2.
//
//   intro ('first' | 'only' | false, startTutorial):
//     'first'  part 1, then part 2 (the last card: «Preparar mi rumor ▶»)
//     'only'   part 1 alone, then back to the menu (the last card: «Volver al menú»)
//     false    part 2 straight away (a reload in the middle of the guided game)
//
//   1 village  Conoce a tus vecinos      one neighbor per character (howtoCast)
//   2 start    Tú empiezas un rumor
//   3 meet     Corre cuando se cruzan
//   4 ai       Vecinos con IA            the real exchange of core/showcase.js
//   5 move     Dónde y cuándo mueven a la gente
//   6 distort  El rumor se deforma
//   7 goal     Tu objetivo               the hour of this game (howtoUntil)
//   8 read     Cómo leer el pueblo       the legend (help.js legendList)

import { neighborProfile, TRAITS } from '../core/neighbors.js';

/** Keys of the cards, in order. */
export const HOWTO_KEYS = ['village', 'start', 'meet', 'ai', 'move', 'distort', 'goal', 'read'];

/**
 * The intro option of startTutorial, normalized: anything else than 'first'
 * or 'only' is false (part 2 straight away, as before phase 9-5).
 * @param {any} v
 * @returns {'first'|'only'|false}
 */
export function introOf(v) {
  return v === 'first' || v === 'only' ? v : false;
}

/**
 * The cast of the first card: one neighbor per character, in the order of
 * TRAITS (the most talkative first), the first by id of each (n001–n006 in
 * the towns of the game). A character nobody has is left out.
 * @param {object} header
 * @param {object|null} timetable GET /timetable, or null (no «pasa el día»)
 * @param {string} lang
 * @returns {object[]} neighborProfile of each
 */
export function howtoCast(header, timetable, lang) {
  const byId = [...(header?.neighbors ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const out = [];
  for (const trait of TRAITS) {
    const n = byId.find((x) => x.trait === trait);
    const p = n ? neighborProfile(header, timetable, n.id, lang) : null;
    if (p) out.push(p);
  }
  return out;
}

/**
 * The controls of a card.
 * @param {number} k index of the card
 * @param {number} total number of cards
 * @param {'first'|'only'} intro
 * @returns {{back: boolean, next: 'next'|'game'|'menu', skip: boolean}}
 *   back: «Atrás» enabled; next: what the main button does (the last card
 *   hands over to part 2 or goes back to the menu); skip: «Saltar explicación» shown
 */
export function howtoNav(k, total, intro) {
  const last = k >= total - 1;
  return { back: k > 0, next: last ? (intro === 'only' ? 'menu' : 'game') : 'next', skip: !last };
}

/**
 * The hour the guided game counts until, for «Tu objetivo»: only when part 2
 * follows (the draft is the game about to be played) and it has one.
 * @param {'first'|'only'} intro
 * @param {object|null} draft
 * @returns {string|null} «13:00»
 */
export function howtoUntil(intro, draft) {
  const until = draft?.settings?.until;
  return intro === 'first' && typeof until === 'string' && /^\d{1,2}:\d{2}$/.test(until) ? until : null;
}
