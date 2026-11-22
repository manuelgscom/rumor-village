// The map as a preview while preparing a game (phase 9-4, pure, no DOM): from
// the bus event 'game' {phase, draft, editing}, which neighbors and places
// scene/labels.js marks and with what small caption. Only in the phase
// 'prepare'; anything else (playing, menu, a recording without a game) gives
// null and the labels are as always.
//
//      ┌─────────────────┐
//      │       Ana       │    first: the name always shown, top priority
//      │ Lo sabe primero │
//      └─────────────────┘
//   ┌──────────────────────┐
//   │ Lugar de la fiesta   │  place: where the fact happens (fact.where)
//   │ (☕) plaza      👤 3  │  drop:  «Aquí empieza a contarse» (to.place)
//   └──────────────────────┘
//
// When the rumor is dropped at the very place of the fact, the label says
// only «Aquí empieza a contarse»: the form already says where the fact is.
//
// Phase 9-5:
//   focusTags  the card under the pointer in the list of whom to tell (bus
//              'prepare-focus' {neighbor, home, usual}): «Vive aquí» on their
//              quarter, «Pasa el día aquí» on their place of the day
//   playNames  during the game, the names always shown: whom the player told
//              («Se lo contaste») and the subject of the challenge («El cura»,
//              «Es su fiesta»)

import { pick } from '../core/lang.js';
import { whatName } from '../core/names.js';
import { previewOf } from '../game/prepare.js';
import { fill } from '../rumor/strings.js';
import { STRINGS } from './strings.js';

/**
 * Id of the header place named by a draft reference (its key or its id).
 * @param {object} header
 * @param {string|null} ref
 * @returns {string|null}
 */
function placeId(header, ref) {
  if (!ref) return null;
  const p = (header?.places ?? []).find((x) => x.key === ref || x.id === ref);
  return p ? p.id : null;
}

/**
 * Caption of the place of the fact: «Lugar de la fiesta», or the neutral one
 * when the article does not fit the kind of fact (or it is unknown).
 * @param {string|null} what
 * @param {'es'|'en'} lang
 */
export function placeCaption(what, lang) {
  const t = pick(STRINGS, lang).preview;
  const tpl = what ? t.placeOf[what] : null;
  return tpl ? fill(tpl, { what: whatName(what, lang) }) : t.placeAny;
}

/**
 * What the map marks while preparing.
 * @param {{phase?: string, draft?: object, editing?: object|null}|null} game the last 'game' event
 * @param {object} header
 * @param {'es'|'en'} lang
 * @returns {null|{names: Map<string, string>, places: Map<string, string>}}
 *   neighbor id → caption and header place id → caption; null outside 'prepare' or without a rumor
 */
export function previewTags(game, header, lang) {
  if (game?.phase !== 'prepare') return null;
  const p = previewOf(game.draft ?? null, game.editing ?? null);
  if (!p) return null;
  const t = pick(STRINGS, lang).preview;
  const known = new Set((header?.neighbors ?? []).map((n) => n.id));
  const names = new Map();
  for (const id of p.first) if (known.has(id)) names.set(id, t.first);
  const places = new Map();
  const where = placeId(header, p.place);
  if (where) places.set(where, placeCaption(p.what, lang));
  // The drop wins when both are the same place.
  const drop = placeId(header, p.drop);
  if (drop) places.set(drop, t.drop);
  return { names, places };
}

/**
 * The places of the card under the pointer while preparing.
 * @param {{neighbor?: string|null, home?: string|null, usual?: string|null}|null} focus bus 'prepare-focus'
 * @param {object} header
 * @param {'es'|'en'} lang
 * @returns {Map<string, string>|null} header place id → caption; null without a neighbor
 */
export function focusTags(focus, header, lang) {
  if (!focus?.neighbor) return null;
  const t = pick(STRINGS, lang).preview;
  const places = new Map();
  const usual = placeId(header, focus.usual ?? null);
  if (usual) places.set(usual, t.usualHere);
  const home = placeId(header, focus.home ?? null);
  if (home) places.set(home, t.livesHere);
  return places;
}

/**
 * The neighbors whose name is always shown during the game: whom the rumors
 * were told to (every `inject` of the log, its `to`) and the subject of the
 * challenge (`subject` "priest": the priest of the header; "who": the «who»
 * of the first rumor, or of the draft before it starts).
 * @param {{header: object, events: object[], challenge?: {subject?: string|null}|null, draft?: object|null}} o
 * @param {'es'|'en'} lang
 * @returns {Map<string, string>} neighbor id → caption
 */
export function playNames({ header, events, challenge = null, draft = null }, lang) {
  const t = pick(STRINGS, lang).play;
  const known = new Set((header?.neighbors ?? []).map((n) => n.id));
  const names = new Map();
  let firstWho = null;
  for (const e of events ?? []) {
    if (e.type !== 'inject') continue;
    if (firstWho === null) firstWho = e.slots?.who ?? null;
    for (const id of e.to ?? []) if (known.has(id)) names.set(id, t.told);
  }
  let subject = null;
  if (challenge?.subject === 'priest') subject = (header?.neighbors ?? []).find((n) => n.job === 'priest')?.id ?? null;
  else if (challenge?.subject === 'who') subject = firstWho ?? draft?.rumors?.[0]?.fact?.who ?? null;
  if (subject && known.has(subject)) names.set(subject, t[challenge.subject]);
  return names;
}

/**
 * How far (CSS px, to the right) the map must move so that the labels of the
 * preview leave the panel of the game on the left (phase 9-5): enough for the
 * leftmost to clear `freeLeft`, never so much that the rightmost leaves the
 * screen. 0 when nothing is under the panel.
 * @param {{x: number, w: number}[]} boxes the labels with a caption, in screen px
 * @param {number} freeLeft first free x right of the panel
 * @param {number} width of the screen
 * @param {number} [margin]
 * @returns {number}
 */
export function panShift(boxes, freeLeft, width, margin = 16) {
  if (!boxes.length) return 0;
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const need = freeLeft + margin - minX;
  if (need <= 0) return 0;
  return Math.max(0, Math.min(need, width - margin - maxX));
}
