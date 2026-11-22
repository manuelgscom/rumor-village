// Names for people, places, hours and facts, from the header. The log brings
// place names in the language of the run, but not the translation of `what`:
// that table is here and must match data/vocab/{es,en}.json (a test checks it).

import { slotTime } from './clock.js';
import { langOf } from './lang.js';

/** Translation of `what` keys (data/vocab/<lang>.json, key "what"). */
export const WHAT = {
  es: {
    party: 'fiesta',
    lottery: 'premio de lotería',
    wedding: 'boda',
    concert: 'concierto',
    works: 'obra',
    inheritance: 'herencia',
    fine: 'multa',
  },
  en: {
    party: 'party',
    lottery: 'lottery prize',
    wedding: 'wedding',
    concert: 'concert',
    works: 'building works',
    inheritance: 'inheritance',
    fine: 'fine',
  },
};

/**
 * Each `what` with its indefinite article, to open the sentence of a rumor
 * («Una fiesta en la plaza…», game/prepare.js factSentence), and the word that
 * joins its «who» («de Manuel», «para Manuel»).
 */
export const WHAT_A = {
  es: {
    party: 'una fiesta',
    lottery: 'un premio de lotería',
    wedding: 'una boda',
    concert: 'un concierto',
    works: 'una obra',
    inheritance: 'una herencia',
    fine: 'una multa',
  },
  en: {
    party: 'a party',
    lottery: 'a lottery prize',
    wedding: 'a wedding',
    concert: 'a concert',
    works: 'building works',
    inheritance: 'an inheritance',
    fine: 'a fine',
  },
};
export const WHO_JOIN = {
  es: { party: 'de', lottery: 'para', wedding: 'de', concert: 'de', works: 'de', inheritance: 'para', fine: 'para' },
  en: { party: 'for', lottery: 'for', wedding: 'of', concert: 'by', works: 'by', inheritance: 'for', fine: 'for' },
};

/** Unit of the `amount` of each `what` (people, euros, guests, days). */
export const UNITS = {
  es: {
    party: 'personas',
    lottery: 'euros',
    wedding: 'invitados',
    concert: 'personas',
    works: 'días',
    inheritance: 'euros',
    fine: 'euros',
  },
  en: {
    party: 'people',
    lottery: 'euros',
    wedding: 'guests',
    concert: 'people',
    works: 'days',
    inheritance: 'euros',
    fine: 'euros',
  },
};

/**
 * Unit of the amount of a fact ("party" → "personas"); '' if unknown.
 * @param {string} what
 * @param {string} lang
 * @returns {string}
 */
export function unitOf(what, lang) {
  return (UNITS[lang] ?? UNITS.en)[what] ?? '';
}

const indexes = new WeakMap();

function index(header) {
  let ix = indexes.get(header);
  if (!ix) {
    ix = {
      neighbors: new Map((header.neighbors ?? []).map((n) => [n.id, n])),
      places: new Map((header.places ?? []).map((p) => [p.id, p])),
    };
    indexes.set(header, ix);
  }
  return ix;
}

/**
 * Neighbor of the header by id.
 * @param {object} header
 * @param {string} id "n003"
 * @returns {{id: string, name: string, gender: string, job: string, trait: string, home: string}|undefined}
 */
export function neighborOf(header, id) {
  return index(header).neighbors.get(id);
}

/**
 * Place of the header by id.
 * @param {object} header
 * @param {string} id "p01"
 * @returns {{id: string, key: string, name: string, kind: string, x: number, y: number}|undefined}
 */
export function placeOf(header, id) {
  return index(header).places.get(id);
}

/**
 * Name of a neighbor ("Carmen"); the id if it is not in the header.
 * @param {object} header
 * @param {string} id
 * @returns {string}
 */
export function neighborName(header, id) {
  return neighborOf(header, id)?.name ?? String(id);
}

/**
 * Initials of a name: the first two letters of a single name ("Carmen" → "CA"),
 * the first letter of each word otherwise ("José Luis" → "JL").
 * @param {string} name
 * @returns {string}
 */
export function initialsOf(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('')
    .toUpperCase();
}

/**
 * Initials of a neighbor.
 * @param {object} header
 * @param {string} id
 * @returns {string}
 */
export function neighborInitials(header, id) {
  return initialsOf(neighborName(header, id));
}

/**
 * Name of a place in the language of the run ("plaza"); the id if unknown.
 * @param {object} header
 * @param {string} id
 * @returns {string}
 */
export function placeName(header, id) {
  return placeOf(header, id)?.name ?? String(id);
}

/**
 * Translation of a `what` key ("party" → "fiesta"); the key itself if unknown.
 * @param {string} what
 * @param {string} lang
 * @returns {string}
 */
export function whatName(what, lang) {
  return WHAT[lang]?.[what] ?? what;
}

/**
 * Text of one slot value: a neighbor's name, a place name, "HH:MM", or the amount.
 * @param {'who'|'where'|'when'|'amount'} slot
 * @param {string|number} value
 * @param {object} header
 * @returns {string}
 */
export function slotValueText(slot, value, header) {
  if (value === null || value === undefined) return '';
  switch (slot) {
    case 'who':
      return neighborName(header, value);
    case 'where':
      return placeName(header, value);
    case 'when':
      return slotTime(value);
    default:
      return String(value);
  }
}

/**
 * Short summary of a claim: "fiesta · Manuel · plaza · 22:00? · 50". Slots
 * that are null are left out; a "?" marks the slots in `guess`.
 * @param {{who: any, where: any, when: any, amount: any, guess?: string[]}|null} claim
 * @param {object} header
 * @param {string} [what] the `what` key of the fact, to put in front
 * @returns {string}
 */
export function claimSummary(claim, header, what) {
  const parts = [];
  if (what) parts.push(whatName(what, langOf(header)));
  if (claim) {
    const guess = new Set(claim.guess ?? []);
    for (const s of ['who', 'where', 'when', 'amount']) {
      if (claim[s] === null || claim[s] === undefined) continue;
      parts.push(slotValueText(s, claim[s], header) + (guess.has(s) ? '?' : ''));
    }
  }
  return parts.join(' · ');
}
