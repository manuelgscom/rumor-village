// What the text input sends, without DOM: the vocabulary of the fields, the
// body of POST inject, the `draft` parameter and the default recipients.
// Names go in the language of the run (header.lang): the engine reads labels
// of its vocabulary ("fiesta", "plaza", "hoy 21:00"), keys or ids.

import { unitOf, WHAT } from '../core/names.js';

/** "today"/"tomorrow" words of the engine's vocabulary (data/vocab/<lang>.json). */
export const DAY_WORDS = {
  es: { today: 'hoy', tomorrow: 'mañana' },
  en: { today: 'today', tomorrow: 'tomorrow' },
};

/** The four slots of a fact, in the engine's order. */
export const SLOTS = ['who', 'where', 'when', 'amount'];

/**
 * @typedef {object} Fields
 * @property {string} what label or free text ("fiesta")
 * @property {string} [where] public place name, '' = none
 * @property {'today'|'tomorrow'|''} [day]
 * @property {string} [time] "HH:MM", '' = none
 * @property {string} [who] neighbor name, '' = none
 * @property {string|number} [amount] '' = none
 * @property {string} to place that receives it (name, key or id)
 */

/** Labels of `what` in the language of the run. */
export function whatLabels(lang) {
  return Object.values(WHAT[lang === 'es' ? 'es' : 'en']);
}

/**
 * The `what` key of a label or key in either language ("fiesta", "party" →
 * "party"), or null when it is none of them.
 * @param {string} what
 * @returns {string|null}
 */
export function whatKey(what) {
  const w = String(what ?? '').trim().toLocaleLowerCase();
  if (!w) return null;
  for (const table of Object.values(WHAT)) {
    for (const [key, label] of Object.entries(table)) if (w === key || w === label.toLocaleLowerCase()) return key;
  }
  return null;
}

/**
 * Label of the amount for a rumor: «Cuánta gente» only when it counts people,
 * «Cuántos euros», «Cuántos días»…, and «Cuántos» while `what` is unknown.
 * @param {string} what label or key ("fiesta", "lottery")
 * @param {string} lang
 * @param {{amount: string, amountOf: string, amountAny: string}} text strings.js
 * @returns {string}
 */
export function amountLabel(what, lang, text) {
  const key = whatKey(what);
  const unit = key ? unitOf(key, lang) : '';
  if (!unit) return text.amountAny;
  if (unit === unitOf('party', lang)) return text.amount;
  return text.amountOf.replace('{unit}', unit);
}

/** Names of the public places (the vocabulary of `where`). */
export function publicPlaces(header) {
  return (header.places ?? []).filter((p) => p.kind === 'public').map((p) => p.name);
}

/** Names of every place (recipients can be anywhere, quarters too). */
export function allPlaces(header) {
  return (header.places ?? []).map((p) => p.name);
}

/** Names of the neighbors. */
export function neighborNames(header) {
  return (header.neighbors ?? []).map((n) => n.name);
}

/** Every half hour of a day: "00:00" … "23:30". */
export function halfHours() {
  const out = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Text of `when` for the engine ("hoy 21:00"), or '' when incomplete.
 * @param {string} lang
 * @param {'today'|'tomorrow'|''} day
 * @param {string} time
 */
export function whenText(lang, day, time) {
  if (!day || !time) return '';
  return `${DAY_WORDS[lang === 'es' ? 'es' : 'en'][day]} ${time}`;
}

/**
 * Reads a `when` text ("hoy 21:00", "tomorrow 9:30") in either language.
 * @param {string} text
 * @returns {{day: 'today'|'tomorrow', time: string}|null}
 */
export function parseWhen(text) {
  const m = /^\s*(\S+)\s+(\d{1,2}):(\d{2})\s*$/.exec(text ?? '');
  if (!m) return null;
  const word = m[1].toLowerCase();
  let day = null;
  for (const words of Object.values(DAY_WORDS)) {
    if (word === words.today) day = 'today';
    else if (word === words.tomorrow) day = 'tomorrow';
  }
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (!day || h > 23 || min > 59) return null;
  return { day, time: `${String(h).padStart(2, '0')}:${m[3]}` };
}

/**
 * Body of POST inject from the structured fields.
 * @param {Fields} fields
 * @param {string} lang
 * @param {{dryRun?: boolean}} [opts]
 * @returns {{fact: object, to: {place: string}, dryRun?: true}}
 * @throws {Error} 'what' or 'to' when that field is empty
 */
export function injectBody(fields, lang, { dryRun = false } = {}) {
  const what = (fields.what ?? '').trim();
  const to = (fields.to ?? '').trim();
  if (!what) throw new Error('what');
  if (!to) throw new Error('to');
  const fact = { what };
  const who = (fields.who ?? '').trim();
  if (who) fact.who = who;
  const where = (fields.where ?? '').trim();
  if (where) fact.where = where;
  const when = whenText(lang, fields.day ?? '', fields.time ?? '');
  if (when) fact.when = when;
  const amount = String(fields.amount ?? '').trim();
  if (amount !== '') {
    const n = Number(amount);
    fact.amount = Number.isInteger(n) && n >= 0 ? n : amount; // the engine says what is wrong
  }
  const body = { fact, to: { place: to } };
  if (dryRun) body.dryRun = true;
  return body;
}

/**
 * Body of POST inject for a fact understood by POST extract.
 * @param {object} fact the `fact` of the extract answer (nulls allowed)
 * @param {string} text the original sentence
 * @param {string} to place that receives it
 */
export function extractedBody(fact, text, to) {
  const out = {};
  for (const k of ['what', ...SLOTS]) if (fact?.[k] !== null && fact?.[k] !== undefined) out[k] = fact[k];
  const body = { fact: out, to: { place: to } };
  if (text) body.text = text;
  return body;
}

/**
 * Reads the `draft` parameter. With the extractor it is the sentence; without
 * it, "what|where|when|to" ("fiesta|plaza|hoy 21:00|bar"), any part may be empty.
 * @param {string|null} draft
 * @param {boolean} extract
 * @returns {{text: string}|Fields|null}
 */
export function parseDraft(draft, extract) {
  if (draft === null || draft === undefined || draft === '') return null;
  if (extract) return { text: draft };
  const [what = '', where = '', when = '', to = ''] = draft.split('|').map((s) => s.trim());
  const w = parseWhen(when);
  return { what, where, day: w?.day ?? '', time: w?.time ?? '', who: '', amount: '', to };
}

/**
 * Place with most of the given neighbors (the ones in view), by name; ties go
 * to the first place of the header. Without any, the first public place.
 * @param {object} header
 * @param {import('../core/reduce.js').State} state
 * @param {string[]} ids
 * @returns {string}
 */
export function busiestPlace(header, state, ids) {
  const count = new Map();
  for (const id of ids ?? []) {
    const place = state?.neighbors?.get(id)?.place;
    if (place) count.set(place, (count.get(place) ?? 0) + 1);
  }
  let best = null;
  let most = 0;
  for (const p of header.places ?? []) {
    const c = count.get(p.id) ?? 0;
    if (c > most) {
      best = p;
      most = c;
    }
  }
  return (best ?? (header.places ?? []).find((p) => p.kind === 'public') ?? header.places?.[0])?.name ?? '';
}

/**
 * How many neighbors are at the place named `name` (name, key or id) and not
 * on a trip: the ones an injection by place reaches now. With none, the engine
 * keeps it waiting until somebody is there.
 * @param {object} header
 * @param {import('../core/reduce.js').State} state
 * @param {string} name
 * @returns {number|null} null when the place is not in the header
 */
export function presentAt(header, state, name) {
  const w = String(name ?? '').trim().toLocaleLowerCase();
  const place = (header.places ?? []).find(
    (p) => p.name.toLocaleLowerCase() === w || p.id === w || String(p.key ?? '').toLocaleLowerCase() === w,
  );
  if (!place) return null;
  let n = 0;
  for (const nb of state?.neighbors?.values() ?? []) if (nb.place === place.id && !nb.trip) n++;
  return n;
}

/**
 * Lines that explain an answer of dryRun or extract: the slots left empty and
 * the names not recognised, in the language of the run.
 * @param {{empty?: string[], unknown?: object}} answer
 * @param {{empty: string, unknown: string, slots: object, amountAny: string}} text strings.js
 * @param {string} [amount] name of the amount slot (amountLabel); default «cuántos»
 * @returns {string[]}
 */
export function answerNotes(answer, text, amount = text.amountAny) {
  const name = (s) => (s === 'amount' ? amount.toLocaleLowerCase() : (text.slots[s] ?? s));
  const notes = [];
  const unknown = answer?.unknown ?? {};
  const empty = (answer?.empty ?? []).filter((s) => !(s in unknown));
  if (empty.length) notes.push(`${text.empty}: ${empty.map(name).join(', ')}`);
  const odd = Object.entries(unknown);
  if (odd.length) notes.push(`${text.unknown}: ${odd.map(([s, v]) => `${name(s)} «${v}»`).join(', ')}`);
  return notes;
}
