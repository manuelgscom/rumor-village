// What the card of one neighbor shows, without DOM: who they are (job, trait,
// home, in the language of the run), what they believe now slot by slot
// against the original, and whom they have told. Pure functions.

import { holds, SLOTS } from '../core/version.js';
import { STRINGS as STORY } from '../story/strings.js';

/**
 * @typedef {object} BeliefRow
 * @property {string} slot
 * @property {string|number|null} original value of the inject
 * @property {{value: any, state: string}|null} now what the neighbor holds (null: nothing)
 * @property {'same'|'changed'|'missing'} status
 *   same     holds the original value (maybe in doubt)
 *   changed  holds another value (or one the original does not have)
 *   missing  the original has a value the neighbor does not hold
 */

/**
 * The belief of a neighbor slot by slot, against the original. Slots that
 * neither the original nor the neighbor have are left out. Agrees with
 * versionOf: some 'changed' is 'wrong', else some 'missing' is 'incomplete'.
 * @param {Object<string, {state: string, value: any}>|undefined|null} memory `neighbor.memory[fact]`
 * @param {object} original `slots` of the inject
 * @returns {BeliefRow[]}
 */
export function beliefOf(memory, original) {
  const rows = [];
  for (const slot of SLOTS) {
    const o = original?.[slot] ?? null;
    const m = memory?.[slot];
    const held = !!m && holds(m.state) && m.value !== null && m.value !== undefined;
    const now = held ? { value: m.value, state: m.state } : null;
    if (o === null && !now) continue;
    const status = !now ? 'missing' : now.value === o ? 'same' : 'changed';
    rows.push({ slot, original: o, now, status, forgotten: !now && m?.state === 'forgotten' });
  }
  return rows;
}

/**
 * Whom a neighbor has told a fact before idx: each listener once, at its first
 * tell, in log order.
 * @param {ReturnType<import('./history.js').createHistory>} h
 * @param {string} who
 * @param {string} fact
 * @param {number} idx
 * @returns {{to: string, tick: number, turn: number}[]}
 */
export function toldTo(h, who, fact, idx) {
  const seen = new Set();
  const out = [];
  for (const { e } of h.tellsBefore(fact, idx)) {
    if (e.who !== who || seen.has(e.to)) continue;
    seen.add(e.to);
    out.push({ to: e.to, tick: e.tick, turn: e.id });
  }
  return out;
}

/**
 * A word of the vocabulary in the right gender: tables are {key: [female, male]}.
 * @param {Object<string, string[]>} table
 * @param {string} key
 * @param {string} gender "f" or "m"
 * @returns {string} the key itself if unknown
 */
export function gendered(table, key, gender) {
  const forms = table?.[key];
  if (!forms) return key ?? '';
  return forms[gender === 'f' ? 0 : 1] ?? forms[0];
}

/** «07:00»; 24 is midnight, «00:00». */
const hourText = (h) => `${String(h % 24).padStart(2, '0')}:00`;

/**
 * A place of the header with its article: «el mercado», «la plaza», «the square».
 * @param {object} header
 * @param {string} id place id or key
 * @param {'es'|'en'} [lang]
 */
export function placeWithThe(header, id, lang = 'es') {
  const p = (header?.places ?? []).find((x) => x.id === id || x.key === id);
  const story = STORY[lang === 'en' ? 'en' : 'es'];
  return `${story.placeThe?.[p?.key] ?? story.placeDefault} ${p?.name ?? id}`;
}

/**
 * The lines of the card of a neighbor inside the game (phase 9-5), from
 * neighborProfile of core/neighbors.js: the character with what it means,
 * family and friends, rivals, and where they live and spend the day.
 *   ['😊 sociable: lo cuenta a menudo', 'Familia y amigos: Carmen, Luis',
 *    'Rivales: Pedro', 'Vive en el barrio bajo · pasa el día en el bar, de 11:00 a 22:00']
 * Rivals only when there are some; the day only with the timetable. Places
 * take their article (story/strings.js placeThe, as game/prepare.js does).
 * @param {object} p neighborProfile(…)
 * @param {object} t rumor/strings.js, picked
 * @param {'es'|'en'} [lang]
 * @returns {string[]}
 */
export function profileLines(p, t, lang = 'es') {
  if (!p) return [];
  const fillIn = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  const close = [...p.family, ...p.friends];
  const out = [fillIn(t.character, { icon: p.traitIcon, trait: p.traitName, phrase: p.traitPhrase }).trim()];
  out.push(close.length ? fillIn(t.familyFriends, { names: close.join(', ') }) : t.closeNone);
  if (p.rivals.length) out.push(fillIn(t.rivals, { names: p.rivals.join(', ') }));
  const where = [];
  const story = STORY[lang === 'en' ? 'en' : 'es'];
  const the = (key, name) => `${story.placeThe?.[key] ?? story.placeDefault} ${name}`;
  if (p.home) where.push(fillIn(t.livesIn, { place: the(p.home.key, p.home.name) }));
  if (p.usual?.key) where.push(fillIn(t.usualAt, { place: the(p.usual.key, p.usual.name), from: hourText(p.usual.from), to: hourText(p.usual.to) }));
  else if (p.usual?.roaming) where.push(fillIn(t.roaming, { places: p.usual.roaming.join(', ') }));
  if (where.length) out.push(where.join(' · '));
  return out;
}
