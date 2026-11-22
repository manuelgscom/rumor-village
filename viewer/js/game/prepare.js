// «Preparar la partida» without DOM: the settings, the rumors, the bets, the
// race and the locks of a challenge, as the draft the engine keeps
// (docs/arquitectura.md, «Formatos»; docs/juego.md, «Preparar la partida").
//
//   draft = {settings, rumors: [rumor…], challenge: id|null, bets: {…}|null, race: {…}|null}
//   rumor = {fact: {what, who, where, when, amount}, text, to: {place}|{neighbors: […]}, at}
//
// Inside the draft neighbors go by id ("n006") and places by key ("square"):
// they survive a change of language. `when` is the engine's text ("hoy 21:00")
// in the language of the settings; relang() rewrites it when that changes.

import { unitOf, WHAT, WHAT_A, WHO_JOIN, whatName } from '../core/names.js';
import { neighborProfile, peopleAt, placeAt, sortProfiles } from '../core/neighbors.js';
import { DAY_WORDS, halfHours, parseWhen, whatKey, whenText } from '../live/inject.js';
import { fill } from '../rumor/strings.js';
import { STRINGS as STORY } from '../story/strings.js';

/** The seven `what` keys the game offers (data/vocab, key "what"). */
export const WHATS = Object.keys(WHAT.en);
export const TYPES = ['village', 'telephone'];
/** The sizes of a village (the engine's scenarios party-N); 25 is the default and the only one measured. */
export const NEIGHBORS = [10, 25, 50, 70, 100];
export const TRAIT_MIX = [-2, -1, 0, 1, 2];
export const DISTORTIONS = ['low', 'normal', 'high'];
export const MODES = ['ai', 'rules'];
export const LANGS = ['es', 'en'];
/** Rumors in a free game of the village type (Teléfono and challenges: one). */
export const MAX_RUMORS = 4;
/** The neighbors of a telephone game. */
export const TELEPHONE_NEIGHBORS = 20;

/** Settings of a new game (docs/arquitectura.md, «Ajustes»). */
export const DEFAULT_SETTINGS = Object.freeze({
  type: 'village',
  neighbors: 25,
  town: 1,
  lang: 'es',
  trait_mix: 0,
  distortion: 'normal',
  mode: 'ai',
  until: null,
});

/** The buttons of «Vecinos»: one per size of village. */
export function neighborsOptions() {
  return NEIGHBORS.map((n) => ({ value: n, label: String(n) }));
}

/** The hint under «Vecinos»: bigger villages take longer (null for 25 or fewer, and in a row). */
export function neighborsHint(settings, t) {
  return settings?.type !== 'telephone' && settings?.neighbors > DEFAULT_SETTINGS.neighbors ? t.neighborsMore : null;
}

/**
 * The size of the village of a header: N of its scenario party-N, else the
 * count of its neighbors; null when it is not one of NEIGHBORS (a row of
 * Teléfono, an unknown scenario).
 * @param {object|null} header
 * @returns {number|null}
 */
export function villageSizeOf(header) {
  const m = /^party-(\d+)$/.exec(header?.scenario ?? '');
  const n = m ? Number(m[1]) : Array.isArray(header?.neighbors) ? header.neighbors.length : null;
  return NEIGHBORS.includes(n) ? n : null;
}

/** A town number at random ("Pueblo n.º"), 1–9999. */
export function randomTown(rand = Math.random) {
  return 1 + Math.floor(rand() * 9999);
}

const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[03]0$/.test(v);

/**
 * Valid settings: every key with an allowed value, defaults for the rest.
 * Without the model the mode is «Sin IA» whatever was asked.
 * @param {object|null|undefined} s
 * @param {{aiAvailable?: boolean, lang?: string}} [ctx]
 */
export function normalizeSettings(s, { aiAvailable = true, lang } = {}) {
  const src = s && typeof s === 'object' ? s : {};
  const out = { ...DEFAULT_SETTINGS };
  if (LANGS.includes(lang)) out.lang = lang;
  if (TYPES.includes(src.type)) out.type = src.type;
  if (NEIGHBORS.includes(Number(src.neighbors))) out.neighbors = Number(src.neighbors);
  const town = Number(src.town);
  if (Number.isInteger(town) && town >= 0) out.town = town;
  if (LANGS.includes(src.lang)) out.lang = src.lang;
  if (TRAIT_MIX.includes(Number(src.trait_mix))) out.trait_mix = Number(src.trait_mix);
  if (DISTORTIONS.includes(src.distortion)) out.distortion = src.distortion;
  out.mode = aiAvailable ? (MODES.includes(src.mode) ? src.mode : 'ai') : 'rules';
  out.until = isTime(src.until) ? src.until : null;
  return out;
}

/**
 * Keys of the settings with a value the engine does not take.
 * @param {object} s
 * @returns {string[]}
 */
export function settingsErrors(s) {
  const bad = [];
  if (!TYPES.includes(s?.type)) bad.push('type');
  if (!NEIGHBORS.includes(s?.neighbors)) bad.push('neighbors');
  if (!Number.isInteger(s?.town) || s.town < 0) bad.push('town');
  if (!LANGS.includes(s?.lang)) bad.push('lang');
  if (!TRAIT_MIX.includes(s?.trait_mix)) bad.push('trait_mix');
  if (!DISTORTIONS.includes(s?.distortion)) bad.push('distortion');
  if (!MODES.includes(s?.mode)) bad.push('mode');
  if (s?.until !== null && s?.until !== undefined && !isTime(s.until)) bad.push('until');
  return bad;
}

/** A rumor with nothing chosen yet; whom to tell starts as a list of neighbors («¿Quién lo sabrá primero?»). */
export function emptyRumor() {
  return { fact: { what: null, who: null, where: null, when: null, amount: null }, text: null, to: { neighbors: [] }, at: 'start' };
}

/** A draft with nothing in it but the settings. */
export function newDraft(settings) {
  return { settings: { ...settings }, rumors: [], challenge: null, bets: null, race: null };
}

/** Whether a draft is still empty: no rumor and no challenge (the boot screen shows then). */
export function isEmptyDraft(draft) {
  return !draft || (!draft.challenge && !(Array.isArray(draft.rumors) && draft.rumors.length));
}

/**
 * The first neighbor of the row in a telephone game: the one at the start of
 * the chain of relations (the only `a` that is never a `b`), else the first.
 * @param {object} header
 * @returns {string|null} id
 */
export function firstOfRow(header) {
  const ids = (header?.neighbors ?? []).map((n) => n.id);
  const rel = header?.relations ?? [];
  if (rel.length) {
    const bs = new Set(rel.map((r) => r.b));
    const start = rel.map((r) => r.a).find((a) => !bs.has(a));
    if (start && ids.includes(start)) return start;
  }
  return ids[0] ?? null;
}

/** Whether `to` names somebody: a place or at least one neighbor. */
export function hasTo(to) {
  if (!to || typeof to !== 'object') return false;
  if (typeof to.place === 'string' && to.place) return true;
  return Array.isArray(to.neighbors) && to.neighbors.length > 0;
}

/**
 * What a rumor still needs: 'what' (one of the seven types), 'to', and an
 * `at` that is «start» or a half hour; with `window` (atWindow), a half hour
 * inside the game too. In Teléfono `to` is the first of the row, so it never lacks.
 * @param {object} rumor
 * @param {{type?: string}} [settings]
 * @param {{from: number, to: number}|null} [window]
 * @returns {string[]}
 */
export function rumorIssues(rumor, settings = {}, window = null) {
  const out = [];
  if (!WHATS.includes(rumor?.fact?.what)) out.push('what');
  if (settings.type !== 'telephone' && !hasTo(rumor?.to)) out.push('to');
  if (rumor?.at !== 'start' && (!isTime(rumor?.at) || (window && settings.type !== 'telephone' && atOutside(rumor.at, window)))) out.push('at');
  return out;
}

/** How many rumors the draft takes: one in Teléfono and in a challenge. */
export function maxRumors(draft) {
  return draft?.settings?.type === 'telephone' || draft?.challenge ? 1 : MAX_RUMORS;
}

/** Whether another rumor can be added. */
export function canAddRumor(draft) {
  return (draft?.rumors?.length ?? 0) < maxRumors(draft);
}

/** The race is possible with exactly two rumors in the village type. */
export function raceAvailable(draft) {
  return draft?.settings?.type === 'village' && (draft?.rumors?.length ?? 0) === 2;
}

/**
 * Rewrites the `when` of every rumor and bet in the language of the settings
 * ("today 21:00" → "hoy 21:00").
 */
function relang(draft) {
  const lang = draft.settings.lang;
  const fix = (w) => {
    const p = parseWhen(w);
    return p ? whenText(lang, p.day, p.time) : null;
  };
  draft.rumors = draft.rumors.map((r) => ({ ...r, fact: { ...r.fact, when: r.fact.when ? fix(r.fact.when) : null } }));
  if (draft.bets?.half) draft.bets = { ...draft.bets, half: fix(draft.bets.half) };
  if (draft.race?.at) draft.race = { ...draft.race, at: fix(draft.race.at) };
  return draft;
}

/**
 * Bets as the engine keeps them, or null when none is made.
 * @param {{attend?: any, half?: any, last?: any}|null} bets
 */
export function normalizeBets(bets) {
  if (!bets || typeof bets !== 'object') return null;
  const n = Number(bets.attend);
  const attend = bets.attend === '' || bets.attend === null || bets.attend === undefined || !Number.isInteger(n) || n < 0 ? null : n;
  const half = parseWhen(bets.half) ? bets.half : null;
  const last = typeof bets.last === 'string' && bets.last ? bets.last : null;
  return attend === null && half === null && last === null ? null : { attend, half, last };
}

/**
 * A draft the engine takes: valid settings; in Teléfono one rumor, to the
 * first of the row, at the start; the race only with two rumors; bets
 * normalized; with a challenge, its fixed parts (enforceChallenge).
 * @param {object} draft
 * @param {{aiAvailable?: boolean, header?: object, challenge?: object|null, lang?: string}} [ctx]
 */
export function normalizeDraft(draft, { aiAvailable = true, header = null, challenge = null, lang } = {}) {
  const src = draft && typeof draft === 'object' ? draft : {};
  let out = {
    settings: normalizeSettings(src.settings, { aiAvailable, lang }),
    // A rumor without `to` (a challenge skeleton) starts with an empty list of neighbors.
    rumors: (Array.isArray(src.rumors) ? src.rumors : []).map((r) => ({
      ...emptyRumor(),
      ...r,
      fact: { ...emptyRumor().fact, ...r?.fact },
      to: r?.to && typeof r.to === 'object' ? r.to : emptyRumor().to,
    })),
    challenge: typeof src.challenge === 'string' && src.challenge ? src.challenge : null,
    bets: normalizeBets(src.bets),
    race: src.race && typeof src.race === 'object' ? { at: src.race.at ?? null, pick: src.race.pick === 1 ? 1 : 0 } : null,
  };
  // The fixed parts of a challenge go as its file writes them (checkDraft of
  // score/ compares them as they are), so they are put back after relang.
  out = relang(out);
  if (challenge && out.challenge === challenge.id) out = enforceChallenge(out, challenge, { aiAvailable });
  out.rumors = out.rumors.slice(0, maxRumors(out));
  if (out.settings.type === 'telephone') {
    const first = firstOfRow(header);
    out.rumors = out.rumors.map((r) => ({ ...r, to: first ? { neighbors: [first] } : r.to, at: 'start' }));
  }
  if (!raceAvailable(out) || !parseWhen(out.race?.at)) out.race = null;
  // The attendance can only be watched at a place and an hour (score/bets.js).
  if (out.bets?.attend !== null && out.bets?.attend !== undefined && !attendOf(out)) out.bets = normalizeBets({ ...out.bets, attend: null });
  return out;
}

/**
 * What a challenge leaves locked: settings with a value in the challenge and
 * not in `open`; rumor slots, `to` and `at` not in `open`.
 * @param {object|null} challenge a file of data/challenges/
 */
export function challengeLocks(challenge) {
  if (!challenge) return { settings: new Set(), slots: new Set(), to: false, at: false, maxTo: null, toPlace: true };
  const open = new Set(challenge.open ?? []);
  const settings = new Set(Object.keys(challenge.settings ?? {}).filter((k) => !open.has(k)));
  if (!open.has('mode')) settings.add('mode');
  const slots = new Set(['what', 'who', 'where', 'when', 'amount'].filter((k) => !open.has(k)));
  return {
    settings,
    slots,
    to: !open.has('to'),
    at: !open.has('at'),
    maxTo: Number.isInteger(challenge.max_to) && challenge.max_to > 0 ? challenge.max_to : null,
    toPlace: challenge.to_place !== false,
  };
}

/**
 * Puts the fixed parts of a challenge back into a draft: its settings, its
 * single rumor's locked slots, `to` and `at`, and the limits of `to`.
 * @param {object} draft normalized
 * @param {object} challenge
 */
export function enforceChallenge(draft, challenge, { aiAvailable = true } = {}) {
  const locks = challengeLocks(challenge);
  const settings = { ...draft.settings };
  for (const k of locks.settings) if (k in (challenge.settings ?? {})) settings[k] = challenge.settings[k];
  if (!aiAvailable) settings.mode = 'rules';
  const fixed = challenge.rumor ?? {};
  const rumors = draft.rumors.slice(0, 1).map((r) => {
    const fact = { ...r.fact };
    for (const k of locks.slots) fact[k] = fixed.fact?.[k] ?? null;
    let to = locks.to && fixed.to ? fixed.to : r.to;
    if (!locks.toPlace && to?.place) to = { neighbors: [] };
    if (locks.maxTo && Array.isArray(to?.neighbors)) to = { neighbors: to.neighbors.slice(0, locks.maxTo) };
    const at = locks.at && fixed.at ? fixed.at : r.at;
    return { ...r, fact, to, at };
  });
  return { ...draft, settings: normalizeSettings(settings, { aiAvailable, lang: settings.lang }), rumors, challenge: challenge.id };
}

/**
 * The single rumor of a challenge as it starts: its fixed parts, the rest empty.
 * @param {object} challenge
 */
export function challengeRumor(challenge) {
  const r = emptyRumor();
  const fixed = challenge?.rumor ?? {};
  for (const k of Object.keys(r.fact)) if (fixed.fact?.[k] !== undefined) r.fact[k] = fixed.fact[k];
  if (fixed.to) r.to = fixed.to;
  else if (challenge?.to_place === false) r.to = { neighbors: [] };
  if (fixed.at) r.at = fixed.at;
  return r;
}

/**
 * Why «Empezar» is disabled, in order; empty when it can start.
 *   noRumor · incomplete (a rumor lacks what/to/at) · at (a rumor is told
 *   at an hour outside the game; with `window`) · pending (Con IA: text not
 *   read yet, or being read; textPending) · check (the hardware check is
 *   running) · noAi (Con IA without the model) · challenge (the checks of
 *   the challenge fail) · busy (a request is on its way)
 * @param {object} draft normalized
 * @param {{checkRunning?: boolean, aiAvailable?: boolean, violations?: any[], busy?: boolean,
 *   window?: {from: number, to: number}|null, pending?: 'pending'|'busy'|null}} [ctx]
 * @returns {string[]}
 */
export function startBlockers(draft, { checkRunning = false, aiAvailable = true, violations = [], busy = false, window = null, pending = null } = {}) {
  const out = [];
  const rumors = draft?.rumors ?? [];
  if (!rumors.length) out.push('noRumor');
  else if (rumors.some((r) => rumorIssues(r, draft.settings).length)) out.push('incomplete');
  if (window && draft?.settings?.type !== 'telephone' && rumors.some((r) => isTime(r?.at) && atOutside(r.at, window))) out.push('at');
  if (pending) out.push('pending');
  if (checkRunning) out.push('check');
  if (draft?.settings?.mode === 'ai' && !aiAvailable) out.push('noAi');
  if (violations?.length) out.push('challenge');
  if (busy) out.push('busy');
  return out;
}

/** Whether «Empezar» is enabled. */
export function canStart(draft, ctx) {
  return startBlockers(draft, ctx).length === 0;
}

/**
 * Blockers about the content of the rumors: «Empezar» stays enabled with
 * them, and pressing it says what is missing next to the field.
 */
export const CONTENT_BLOCKERS = Object.freeze(['noRumor', 'incomplete', 'at', 'pending']);

/** The blockers that disable «Empezar»: check, noAi, challenge, busy. */
export function hardBlockers(blockers) {
  return (blockers ?? []).filter((b) => !CONTENT_BLOCKERS.includes(b));
}

// --- What «Empezar» would start ---------------------------------------------------
//
//   editing = {index: number|null, rumor, text?} the rumor open in the editor
//             (index null: a new one, added at the end)

/**
 * The effective draft: the draft with the rumor open in the editor in its
 * place (or added at the end). It is what «Empezar» starts and what the guide
 * reads. Not normalized: index.js normalizes it as it does the draft.
 * @param {object} draft
 * @param {{index: number|null, rumor: object}|null} editing
 */
export function effectiveDraft(draft, editing) {
  if (!draft || !editing?.rumor) return draft;
  const rumors = Array.isArray(draft.rumors) ? [...draft.rumors] : [];
  const i = editing.index;
  if (Number.isInteger(i) && i >= 0 && i < rumors.length) rumors[i] = editing.rumor;
  else rumors.push(editing.rumor);
  return { ...draft, rumors };
}

/**
 * What the map previews while preparing (phase 9-4; scene/labels.js): the
 * rumor open in the editor, else the first of the draft. Ids and keys as in
 * the draft; nothing is checked against the header here.
 *
 *   first: neighbors who will know it first ([] when it goes to a place)
 *   drop:  the place where it is told (to.place), or null
 *   place: the place the rumor talks about (fact.where), or null
 *   what:  the fact's `what`, or null;  at: 'start' or "HH:MM"
 *
 * @param {object|null} draft
 * @param {{rumor?: object}|object|null} [editing] the editor ({index, rumor}) or the rumor itself
 * @returns {{first: string[], drop: string|null, place: string|null, what: string|null, at: string}|null}
 *   null without a rumor
 */
export function previewOf(draft, editing = null) {
  const rumor = editing?.rumor ?? (editing?.fact ? editing : null) ?? (Array.isArray(draft?.rumors) ? draft.rumors[0] : null) ?? null;
  if (!rumor || typeof rumor !== 'object') return null;
  const to = rumor.to ?? {};
  const first = Array.isArray(to.neighbors) ? to.neighbors.filter((x) => typeof x === 'string') : [];
  return {
    first,
    drop: typeof to.place === 'string' ? to.place : null,
    place: rumor.fact?.where ?? null,
    what: rumor.fact?.what ?? null,
    at: rumor.at ?? 'start',
  };
}

/**
 * The editor's index after the rumor `k` is removed from the list: one less
 * when it was below, -1 when the edited rumor itself was removed, the same
 * otherwise (null, a new rumor, stays null).
 * @param {number|null} index
 * @param {number} k
 */
export function indexAfterRemove(index, k) {
  if (index === null || index === undefined) return null;
  if (index === k) return -1;
  return k < index ? index - 1 : index;
}

// --- The example rumor --------------------------------------------------------------

/**
 * The examples, in order: the first is the one of a new free game; a second
 * rumor gets another kind and another place, so a race is never «Fiesta
 * contra Fiesta» (phase 9-5).
 */
const EXAMPLES = [
  { what: 'party', where: 'square', time: '12:00' },
  { what: 'wedding', where: 'church', time: '18:00' },
  { what: 'concert', where: 'bar', time: '21:00' },
  { what: 'works', where: 'school', time: '10:00' },
];

/** A public place of the header by key, or the first public one. */
function examplePlace(header, key = 'square') {
  const pub = (header?.places ?? []).filter((p) => p.kind === 'public');
  const p = pub.find((x) => x.key === key) ?? pub[0];
  return p ? (p.key ?? p.id) : null;
}

/**
 * The fact of the example: a party in the square, today at 12:00; with
 * `taken` (the rumors already in the draft), the first example whose kind
 * none of them has: a wedding in the church at 18:00, a concert in the bar…
 * @param {object} header
 * @param {string} lang language of the settings
 * @param {object[]} [taken]
 */
export function exampleFact(header, lang, taken = []) {
  const used = new Set((taken ?? []).map((r) => r?.fact?.what).filter(Boolean));
  const ex = EXAMPLES.find((e) => !used.has(e.what)) ?? EXAMPLES[0];
  return { what: ex.what, who: null, where: examplePlace(header, ex.where), when: whenText(lang, 'today', ex.time), amount: null };
}

/**
 * The example rumor of a new free game: exampleFact, told at the start to the
 * first neighbor by name. Valid as it is.
 * @param {object} header
 * @param {string} lang
 */
export function exampleRumor(header, lang, to = null) {
  const first = to && (header?.neighbors ?? []).some((n) => n.id === to) ? to : firstByName(header);
  return { fact: exampleFact(header, lang), text: null, to: first ? { neighbors: [first] } : { place: examplePlace(header) }, at: 'start' };
}

/** The id of the first neighbor by name (the one of the example), or null. */
export function firstByName(header) {
  return [...(header?.neighbors ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name)))[0]?.id ?? null;
}

/**
 * «Rumor 1 · Fiesta» for the rumor at k (from 0) of a draft, or «Rumor 1»
 * without a type: the options of the race (the same names as the legend).
 * @param {{rumorN: string, rumorWhat: string}} t
 */
export function rumorTitle(t, lang, k, rumor) {
  const what = WHATS.includes(rumor?.fact?.what) ? whatName(rumor.fact.what, lang === 'es' ? 'es' : 'en') : null;
  if (!what) return fill(t.rumorN, { n: k + 1 });
  return fill(t.rumorWhat, { n: k + 1, what: what.charAt(0).toLocaleUpperCase() + what.slice(1) });
}

// --- The live summary of a rumor ---------------------------------------------------

/** Names shown in full; a longer list says the first two and how many more. */
const MAX_NAMES = 3;

/**
 * «Elena», «Elena y Luis», «Elena, Luis y Rosa»; longer, «Elena, Luis y 5
 * más» (t.namesMore; without it, every name).
 * @param {string[]} names
 * @param {{and: string, namesMore?: string}} t
 */
export function nameList(names, t) {
  if (names.length < 2) return names[0] ?? '';
  if (names.length > MAX_NAMES && t.namesMore) return fill(t.namesMore, { names: names.slice(0, 2).join(', '), n: names.length - 2 });
  return `${names.slice(0, -1).join(', ')}${t.and}${names[names.length - 1]}`;
}

/**
 * The place with its article: «la plaza», «el bar», «the square».
 * @param {object} header
 * @param {string} key
 * @param {string} lang
 */
export function placeWithArticle(header, key, lang) {
  const p = (header?.places ?? []).find((x) => x.key === key || x.id === key);
  const story = STORY[lang === 'es' ? 'es' : 'en'];
  const art = (p?.key && story.placeThe?.[p.key]) || story.placeDefault;
  return `${art} ${p?.name ?? key}`;
}

/**
 * The fact as a line: «Fiesta en la plaza, hoy 12:00, 50 personas», or null
 * without a type.
 * @param {object} fact
 * @param {{header?: object, lang: string, t: object}} o
 */
export function factSummary(fact, { header = null, lang, t }) {
  const f = fact ?? {};
  if (!WHATS.includes(f.what)) return null;
  const name = whatName(f.what, lang);
  let s = name.charAt(0).toUpperCase() + name.slice(1);
  if (f.who) s = fill(t.factWho, { what: s, who: (header?.neighbors ?? []).find((n) => n.id === f.who)?.name ?? f.who });
  if (f.where) s = fill(t.factWhere, { fact: s, place: placeWithArticle(header, f.where, lang) });
  if (f.when) s += `, ${f.when}`;
  if (f.amount !== null && f.amount !== undefined) s += `, ${[f.amount, unitOf(f.what, lang)].filter((x) => x !== '').join(' ')}`;
  return s;
}

/** Words of the sentence of a rumor (factSentence), by language. */
const SENTENCE = {
  es: { at: 'en', time: '{day} a las {time}', today: 'hoy', tomorrow: 'mañana' },
  en: { at: 'at', time: '{day} at {time}', today: 'today', tomorrow: 'tomorrow' },
};

/**
 * The rumor as a sentence, in the language of the interface (phase 9-5): «Una
 * fiesta de Manuel en la plaza, hoy a las 12:00, 50 personas»; null without a
 * valid type. The hour is read in any language («today 12:00» too) and written
 * in `lang`. The editor builds the same sentence with controls.
 * @param {object} fact {what, who, where, when, amount}
 * @param {{header?: object, lang: string}} o
 * @returns {string|null}
 */
export function factSentence(fact, { header = null, lang }) {
  const f = fact ?? {};
  if (!WHATS.includes(f.what)) return null;
  const L = lang === 'es' ? 'es' : 'en';
  const w = SENTENCE[L];
  let s = WHAT_A[L][f.what];
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (f.who) s += ` ${WHO_JOIN[L][f.what]} ${(header?.neighbors ?? []).find((n) => n.id === f.who)?.name ?? f.who}`;
  if (f.where) s += ` ${w.at} ${placeWithArticle(header, f.where, L)}`;
  const when = parseWhen(f.when);
  if (when) s += `, ${fill(w.time, { day: w[when.day], time: when.time })}`;
  if (f.amount !== null && f.amount !== undefined && f.amount !== '') s += `, ${[f.amount, unitOf(f.what, L)].filter((x) => x !== '').join(' ')}`;
  return s;
}

/**
 * The sentence that says what will happen at «Empezar» (docs/juego.md,
 * «Preparar la partida»): «Lo sabrá primero Elena nada más empezar. Una
 * fiesta en la plaza, hoy a las 12:00.» The rumor goes normalized (Teléfono: to the first of the row).
 * @param {object} rumor
 * @param {{header?: object, lang: string, t: object}} o t: the game strings of the page
 * @returns {string}
 */
export function rumorSummary(rumor, { header = null, lang, t }) {
  const at = rumor?.at === 'start' || !rumor?.at ? t.summaryAtStart : fill(t.summaryAt, { time: rumor.at });
  const to = rumor?.to;
  let who;
  if (typeof to?.place === 'string' && to.place) who = fill(t.summaryPlace, { place: placeWithArticle(header, to.place, lang), at });
  else if (Array.isArray(to?.neighbors) && to.neighbors.length) {
    const names = to.neighbors.map((id) => (header?.neighbors ?? []).find((n) => n.id === id)?.name ?? id);
    who = fill(names.length > 1 ? t.summaryMany : t.summaryOne, { to: nameList(names, t), at });
  } else who = t.summaryNoTo;
  const fact = factSentence(rumor?.fact, { header, lang });
  return `${who} ${fact ? `${fact}.` : t.summaryNoWhat}`;
}

// --- Village ↔ Telephone, and the reloads of a new town ------------------------------
//
// Teléfono keeps one rumor, to the first of the row, at the start, and no race
// (normalizeDraft). What it sets aside of a village game is kept in a stash
// {rumors, race, editor} and comes back with Pueblo; the editor open when the
// page reloads (a change of town) goes with it in sessionStorage as the carry
// {village: stash|null, editor: editing|null, example: boolean} (index.js).

/**
 * What Teléfono sets aside of a village draft.
 * @param {object} draft the village draft
 * @param {{index: number|null, rumor: object, text?: string}|null} editing
 */
export function stashVillage(draft, editing = null) {
  return {
    rumors: structuredClone(Array.isArray(draft?.rumors) ? draft.rumors : []),
    race: draft?.race ? { ...draft.race } : null,
    editor: editing?.rumor ? structuredClone({ index: editing.index ?? null, rumor: editing.rumor, text: editing.text ?? '' }) : null,
  };
}

/**
 * Back to Pueblo: the stashed rumors and race; the first rumor keeps the fact
 * (and the text) edited in Teléfono.
 * @param {object} draft the draft with type 'village', coming from Teléfono
 * @param {{rumors: object[], race: object|null}} stash
 */
export function restoreVillage(draft, stash) {
  if (!stash || !Array.isArray(stash.rumors)) return draft;
  const rumors = structuredClone(stash.rumors);
  const cur = draft?.rumors?.[0];
  if (cur) rumors[0] = rumors[0] ? { ...rumors[0], fact: { ...cur.fact }, text: cur.text ?? null } : cur;
  return { ...draft, rumors, race: stash.race ? { ...stash.race } : (draft?.race ?? null) };
}

/**
 * A rumor without the neighbors and places the town does not have (a new
 * town after a reload): those slots become empty.
 * @param {object} rumor
 * @param {object} header
 */
export function fitRumor(rumor, header) {
  if (!rumor || !header) return rumor;
  const ids = new Set((header.neighbors ?? []).map((n) => n.id));
  const keys = new Set((header.places ?? []).flatMap((p) => [p.key, p.id].filter(Boolean)));
  const fact = { ...rumor.fact };
  if (fact.who && !ids.has(fact.who)) fact.who = null;
  if (fact.where && !keys.has(fact.where)) fact.where = null;
  let to = rumor.to;
  if (Array.isArray(to?.neighbors)) to = { neighbors: to.neighbors.filter((id) => ids.has(id)) };
  else if (to?.place && !keys.has(to.place)) to = { place: null };
  return { ...rumor, fact, to };
}

/** A draft fitted to the town of `header` (fitRumor on each rumor, and the bet on the last). */
export function fitToHeader(draft, header) {
  if (!draft || !header) return draft;
  const ids = new Set((header.neighbors ?? []).map((n) => n.id));
  const bets = draft.bets?.last && !ids.has(draft.bets.last) ? { ...draft.bets, last: null } : draft.bets;
  return { ...draft, rumors: (draft.rumors ?? []).map((r) => fitRumor(r, header)), bets };
}

/**
 * The editor to open again in a draft: null when its place is gone (a row that
 * no longer exists, or no room for a new rumor).
 * @param {{index: number|null, rumor: object, text?: string}|null} editing
 * @param {object} draft normalized
 */
export function editorFits(editing, draft) {
  if (!editing?.rumor) return null;
  const n = draft?.rumors?.length ?? 0;
  if (editing.index === null) return canAddRumor(draft) ? editing : null;
  return Number.isInteger(editing.index) && editing.index >= 0 && editing.index < n ? editing : null;
}

const isEditing = (e) =>
  !!e && typeof e === 'object' && e.rumor && typeof e.rumor === 'object' && (e.index === null || (Number.isInteger(e.index) && e.index >= 0));

/** A map of strings to strings ({id: name}), or null. */
const nameMap = (m) =>
  m && typeof m === 'object' && !Array.isArray(m) ? Object.fromEntries(Object.entries(m).filter(([k, v]) => typeof k === 'string' && typeof v === 'string')) : null;

/**
 * The carry read back from sessionStorage, checked: anything odd is dropped.
 * @param {any} raw the parsed JSON
 * @returns {{village: {rumors: object[], race: object|null, editor: object|null}|null, editor: object|null, example: boolean, focus: 'to'|null,
 *   names: Object<string, string>|null, last: {name: string, n: number, total: number}|null,
 *   race: {race: object, pair: string[]}|null, intro: boolean}|null}
 *   focus: the field of the editor to bring into view and focus («Probar con otro vecino»);
 *   names: the names of the town before the reload (townChanges);
 *   last: whom the game before was told to and how many it reached (lastTryText);
 *   race: the race set aside (raceStashOf);
 *   intro: the tutorial was chosen and its first part («Cómo funciona») has not been shown yet
 */
export function parseCarry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ed = (e) => (isEditing(e) ? { index: e.index, rumor: { ...emptyRumor(), ...e.rumor, fact: { ...emptyRumor().fact, ...e.rumor.fact } }, text: typeof e.text === 'string' ? e.text : '' } : null);
  const v = raw.village;
  const village =
    v && typeof v === 'object' && Array.isArray(v.rumors)
      ? { rumors: v.rumors.filter((r) => r && typeof r === 'object'), race: v.race && typeof v.race === 'object' ? v.race : null, editor: ed(v.editor) }
      : null;
  const l = raw.last;
  const count = (x) => Number.isInteger(x) && x >= 0;
  const last = l && typeof l === 'object' && typeof l.name === 'string' && l.name && count(l.n) && count(l.total) ? { name: l.name, n: l.n, total: l.total } : null;
  const rs = raw.race;
  const race =
    rs && typeof rs === 'object' && rs.race && typeof rs.race === 'object' && Array.isArray(rs.pair) && rs.pair.length === 2 && rs.pair.every((x) => typeof x === 'string')
      ? { race: { at: rs.race.at ?? null, pick: rs.race.pick === 1 ? 1 : 0 }, pair: [...rs.pair] }
      : null;
  return { village, editor: ed(raw.editor), example: raw.example === true, focus: raw.focus === 'to' ? 'to' : null, names: nameMap(raw.names), last, race, intro: raw.intro === true };
}

/**
 * «Probar con otro vecino» (phase 9-3): the carry that brings back the same
 * town and rumor with the editor open on whom to tell first, emptied. Only
 * for a Village game with one rumor (Teléfono has no choice of recipient;
 * with several rumors it would not be clear which one). With the header and
 * the neighbors who knew some rumor at the end (score/ informedEnd), it says
 * too whom it was told to and how far it went (phase 9-4, lastTryText).
 * @param {object} draft the draft of the game that ended
 * @param {{header?: object, informed?: number|null, lang?: string, t?: object}} [o]
 * @returns {{village: null, editor: {index: 0, rumor: object, text: string}, example: false, focus: 'to',
 *   last: {name: string, n: number, total: number}|null}|null}
 */
export function retryCarry(draft, { header = null, informed = null, lang = 'es', t = null } = {}) {
  const rumors = Array.isArray(draft?.rumors) ? draft.rumors : [];
  if (draft?.settings?.type !== 'village' || rumors.length !== 1 || !rumors[0]?.fact) return null;
  const r = structuredClone(rumors[0]);
  const total = (header?.neighbors ?? []).length;
  const name = t && header ? toText(r.to, { header, lang, t }) : null;
  const last = name && Number.isInteger(informed) && total ? { name, n: informed, total } : null;
  return { village: null, editor: { index: 0, rumor: { ...r, to: { neighbors: [] } }, text: typeof r.text === 'string' ? r.text : '' }, example: false, focus: 'to', last };
}

/**
 * Whom a rumor is told to, as words: «Elena», «Elena y Luis», «la plaza»;
 * '' when nobody is chosen.
 * @param {object} to
 * @param {{header?: object, lang: string, t: object}} o
 */
export function toText(to, { header = null, lang, t }) {
  if (typeof to?.place === 'string' && to.place) return placeWithArticle(header, to.place, lang);
  const ids = Array.isArray(to?.neighbors) ? to.neighbors : [];
  return nameList(
    ids.map((id) => (header?.neighbors ?? []).find((n) => n.id === id)?.name ?? id),
    t,
  );
}

/** «La otra vez se lo contaste a Elena y llegó a 12 de 25.», or null without a last try. */
export function lastTryText(last, t) {
  return last ? fill(t.lastTry, { name: last.name, n: last.n, total: last.total }) : null;
}

/**
 * The rumor fields of a fact understood by POST extract (names of the run's
 * language) for the form. Only the seven types are offered: any other `what`
 * («incendio») leaves the type empty, and the player picks one of the seven.
 * @param {{what?: any, who?: any, where?: any, when?: any, amount?: any}|null} fact
 * @param {object} header
 * @param {string} lang language of the settings
 * @returns {{fact: object, outside: string|null}} outside: the `what` that was dropped
 */
export function extractedFact(fact, header, lang) {
  const f = fact ?? {};
  const key = whatKey(f.what);
  const what = WHATS.includes(key) ? key : null;
  const outside = !what && typeof f.what === 'string' && f.what.trim() ? f.what.trim() : null;
  const fold = (v) => String(v ?? '').trim().toLocaleLowerCase();
  const who = f.who ? ((header?.neighbors ?? []).find((n) => fold(n.name) === fold(f.who) || n.id === f.who)?.id ?? null) : null;
  const where = f.where
    ? ((header?.places ?? []).find((p) => p.kind === 'public' && (fold(p.name) === fold(f.where) || p.key === f.where || p.id === f.where))?.key ?? null)
    : null;
  const w = parseWhen(f.when);
  const when = w ? whenText(lang, w.day, w.time) : null;
  const n = Number(f.amount);
  const amount = f.amount !== null && f.amount !== undefined && f.amount !== '' && Number.isInteger(n) && n >= 0 ? n : null;
  return { fact: { what, who, where, when, amount }, outside };
}

/**
 * «Con IA» or «Sin IA» of a run, from its header (policy "baseline" is the rules).
 * @param {{policy?: string}|null} header
 * @returns {'ai'|'rules'}
 */
export function modeOfHeader(header) {
  return header?.policy === 'baseline' ? 'rules' : 'ai';
}

/**
 * The label of a mode in the glossary words.
 * @param {'ai'|'rules'} mode
 * @param {{modeAi: string, modeRules: string}} text
 */
export function modeLabel(mode, text) {
  return mode === 'rules' ? text.modeRules : text.modeAi;
}

/** The day words of a language, for the selects of `when`. */
export function dayWords(lang) {
  return DAY_WORDS[lang === 'es' ? 'es' : 'en'];
}

// --- Phase 9-4: the first experience -------------------------------------------------
//
//   readyCard ─────────────── «Rumor listo»: the free game's first screen, no editor
//   atWindow · atHours ────── the hours at which a rumor can be told (not the
//                             hour of the fact: that one keeps its own rules)
//   switchTo · switchAt ──── a second press keeps the choice; going back to an
//                             option recovers its last choice while it is valid
//   pickRecipient ─────────── one recipient replaces, several add up
//   textPending ───────────── Con IA: text written and not read yet
//   raceStashOf · restoreRace  the race set aside while there are not two rumors
//   townChanges ───────────── what a new census took away, as lines
//   betRumor · attendOf ───── the attendance bet needs a place and an hour
//   yourPartText ──────────── the head of a challenge

const MINUTES_PER_DAY = 24 * 60;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "07:00" for a tick in minutes (day 0; 1440 is "00:00"). */
export function clockText(tick) {
  const m = ((Math.trunc(Number(tick) || 0) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * The hours of day 0 at which a rumor can start to spread («A una hora»):
 * from the start of the game to its end or to `until`, whichever comes
 * first (the engine's rule, engine/src/server/game_draft.cpp).
 *
 *   07:00 ───────────── 24:00   party-25: start_tick 420, end_tick 1440
 *   07:00 ─── 13:00             with until 13:00 (the tutorial)
 *
 * @param {object|null} header start_tick and params.end_tick, in minutes
 * @param {{until?: string|null}} [settings]
 * @returns {{from: number, to: number}} minutes of day 0, `to` excluded
 */
export function atWindow(header, settings = {}) {
  const from = Number.isInteger(header?.start_tick) ? header.start_tick : 0;
  let to = MINUTES_PER_DAY;
  const end = header?.params?.end_tick;
  if (Number.isInteger(end)) to = Math.min(to, end);
  if (isTime(settings?.until)) to = Math.min(to, minutesOf(settings.until));
  return { from, to: Math.max(to, from) };
}

/** Whether an hour "HH:MM" falls outside the window (false for 'start' or without a window). */
export function atOutside(at, window) {
  if (!window || !isTime(at)) return false;
  const m = minutesOf(at);
  return m < window.from || m >= window.to;
}

/** The half hours inside the window, in order (every one without a window). */
export function atHours(window) {
  return halfHours().filter((h) => !atOutside(h, window));
}

/**
 * «Esta partida va de las 07:00 a las 24:00»: the window as two clock texts.
 * The end of the day reads «24:00», not «00:00», which looks like the start.
 */
export function windowText(window) {
  const to = window?.to ?? MINUTES_PER_DAY;
  return { from: clockText(window?.from ?? 0), to: to === MINUTES_PER_DAY ? '24:00' : clockText(to) };
}

/**
 * «Vecinos concretos» ↔ «Un lugar»: the `to` of the option pressed and the
 * memo of the other. Pressing the option already on keeps `to` as it is;
 * going back recovers the last choice of that option while the town still
 * has it.
 * @param {object} to the current `to`
 * @param {'neighbors'|'place'} mode the option pressed
 * @param {{neighbors?: string[], place?: string|null}} [memo]
 * @param {{header?: object|null, max?: number|null}} [o]
 * @returns {{to: object, memo: {neighbors?: string[], place?: string|null}}}
 */
export function switchTo(to, mode, memo = {}, { header = null, max = null } = {}) {
  const byPlace = !Array.isArray(to?.neighbors);
  if ((mode === 'place') === byPlace) return { to, memo };
  if (mode === 'place') {
    const keys = new Set((header?.places ?? []).flatMap((p) => [p.key, p.id].filter(Boolean)));
    const place = memo.place && (!header || keys.has(memo.place)) ? memo.place : null;
    return { to: { place }, memo: { ...memo, neighbors: [...(to?.neighbors ?? [])] } };
  }
  const ids = new Set((header?.neighbors ?? []).map((n) => n.id));
  let list = (memo.neighbors ?? []).filter((id) => !header || ids.has(id));
  if (max) list = list.slice(0, max);
  return { to: { neighbors: list }, memo: { ...memo, place: to?.place || memo.place || null } };
}

/**
 * «Al empezar» ↔ «A una hora»: the same for `at`. Back to «A una hora»
 * comes the last hour chosen while it is inside the window, else the first
 * hour of the window (09:00 without one).
 * @param {string} at
 * @param {'start'|'hour'} mode
 * @param {{hour?: string|null}} [memo]
 * @param {{from: number, to: number}|null} [window]
 * @returns {{at: string, memo: {hour?: string|null}}}
 */
export function switchAt(at, mode, memo = {}, window = null) {
  const hour = at !== 'start';
  if ((mode === 'hour') === hour) return { at, memo };
  if (mode === 'start') return { at: 'start', memo: { ...memo, hour: isTime(at) ? at : (memo.hour ?? null) } };
  if (isTime(memo.hour) && !atOutside(memo.hour, window)) return { at: memo.hour, memo };
  return { at: (window ? atHours(window)[0] : null) ?? '09:00', memo };
}

/**
 * A recipient ticked or unticked. With one at most, ticking another replaces
 * it; with more, choices add up and, past the limit, the oldest goes.
 * @param {string[]} list
 * @param {string} id
 * @param {boolean} on
 * @param {number|null} [max]
 * @returns {string[]}
 */
export function pickRecipient(list, id, on, max = null) {
  const rest = (list ?? []).filter((x) => x !== id);
  if (!on) return rest;
  if (max === 1) return [id];
  const out = [...rest, id];
  return max && out.length > max ? out.slice(out.length - max) : out;
}

/**
 * Con IA: the free text against what was read. 'busy' while POST extract is
 * on its way; 'pending' when the text differs from the last one read (the
 * rumor's `text`); null otherwise. «Empezar» never starts the fact before:
 * with 'pending' it reads first, with 'busy' it waits (startBlockers).
 * @param {{text?: string, read?: string|null, busy?: boolean}} o
 * @returns {'busy'|'pending'|null}
 */
export function textPending({ text = '', read = null, busy = false } = {}) {
  if (busy) return 'busy';
  const now = String(text ?? '').trim();
  return now && now !== String(read ?? '').trim() ? 'pending' : null;
}

/**
 * A rumor's print for the race: what it says and whom it is told to (in a
 * fixed order: the order of the keys or of the ticks does not count), not
 * its place in the list.
 */
export function rumorPrint(rumor) {
  const f = rumor?.fact ?? {};
  const to = rumor?.to ?? {};
  const fact = ['what', 'who', 'where', 'when', 'amount'].map((k) => f[k] ?? null);
  return JSON.stringify([fact, typeof to.place === 'string' ? to.place : null, [...(to.neighbors ?? [])].sort()]);
}

/**
 * The race of a draft set aside, with the pair it was for; null without a
 * race of two rumors.
 * @param {object} draft
 * @returns {{race: {at: string, pick: 0|1}, pair: string[]}|null}
 */
export function raceStashOf(draft) {
  if (!draft?.race || (draft.rumors?.length ?? 0) !== 2) return null;
  return { race: { ...draft.race }, pair: draft.rumors.map(rumorPrint) };
}

/**
 * The race back when the same pair of rumors is there again, in any order:
 * its hour, and the bet on the same rumor (never on the one in its place).
 * Otherwise the draft as it is.
 * @param {object} draft
 * @param {{race: object, pair: string[]}|null} stash
 */
export function restoreRace(draft, stash) {
  if (!stash?.race || draft?.race || !raceAvailable(draft)) return draft;
  const now = draft.rumors.map(rumorPrint);
  const [a, b] = stash.pair;
  if (!((now[0] === a && now[1] === b) || (now[0] === b && now[1] === a))) return draft;
  const pick = a === b ? stash.race.pick : now.indexOf(stash.pair[stash.race.pick === 1 ? 1 : 0]);
  return { ...draft, race: { ...stash.race, pick: pick === 1 ? 1 : 0 } };
}

/**
 * What a new census took away (fitToHeader, after a change of town or of
 * neighbors), one line per loss: a recipient, whom or where the rumor talked
 * about (or the place it was told at), the bet on the last. Rumors are
 * numbered by their place in the list.
 * @param {object} before the draft before fitting
 * @param {object} after the same draft fitted
 * @param {{names?: Object<string, string>|null, t: object}} o names: ids → names of the town before
 * @returns {string[]} empty when nothing was lost
 */
export function townChanges(before, after, { names = null, t }) {
  const out = [];
  (before?.rumors ?? []).forEach((r, i) => {
    const a = after?.rumors?.[i];
    if (!a) return;
    const n = i + 1;
    const kept = new Set(a.to?.neighbors ?? []);
    for (const id of r.to?.neighbors ?? []) if (!kept.has(id)) out.push(fill(t.townLostTo, { n, names: names?.[id] ?? id }));
    if (r.fact?.who && !a.fact?.who) out.push(fill(t.townLostWho, { n }));
    if ((r.fact?.where && !a.fact?.where) || (r.to?.place && !a.to?.place)) out.push(fill(t.townLostWhere, { n }));
  });
  if (before?.bets?.last && !after?.bets?.last) out.push(t.townLostLast);
  return out;
}

/** The names of the neighbors a draft points at (recipients, `who`, the bet on the last): ids → names. */
export function namesOf(draft, header) {
  const ids = new Set();
  for (const r of draft?.rumors ?? []) {
    for (const id of r?.to?.neighbors ?? []) ids.add(id);
    if (r?.fact?.who) ids.add(r.fact.who);
  }
  if (draft?.bets?.last) ids.add(draft.bets.last);
  const out = {};
  for (const n of header?.neighbors ?? []) if (ids.has(n.id)) out[n.id] = n.name;
  return out;
}

/**
 * The rumor the bets are about (score/bets.js: the first injected): the
 * first told, «al empezar» before any hour, the first of the list on a tie.
 * @param {object} draft
 * @returns {object|null}
 */
export function betRumor(draft) {
  const tick = (r) => (r?.at === 'start' || !isTime(r?.at) ? -1 : minutesOf(r.at));
  let best = null;
  for (const r of draft?.rumors ?? []) if (!best || tick(r) < tick(best)) best = r;
  return best;
}

/**
 * Where and when «¿Cuántos acudirán?» looks: the place and the hour of the
 * fact of betRumor, or null without both (then there is nothing to watch,
 * and the bet is not offered nor kept).
 * @returns {{place: string, when: string}|null}
 */
export function attendOf(draft) {
  const f = betRumor(draft)?.fact;
  return f?.where && f?.when ? { place: f.where, when: f.when } : null;
}

/** «Entra 1 rumor.» / «Entran 3 rumores.» */
export function countText(t, n) {
  return fill(n === 1 ? t.summaryCount.one : t.summaryCount.many, { n });
}

/**
 * «Rumor listo»: the free game's first screen, when the draft has its rumors
 * ready and no editor is open. It tells the first rumor and counts the rest.
 *
 *   news   «Una fiesta en la plaza, hoy a las 12:00.» (factSentence)
 *   tell   «Se lo contarás a Ana nada más empezar, a las 07:00.»
 *   propose  with the neighbor of the example (the first by name): «Propuesta: es la
 *          primera por orden alfabético. Elige tú mirando las fichas →»
 *   about  «Ana: costurera, sociable (lo cuenta a menudo), familia y amigos:
 *          Carmen, Luis…, pasa el día en el mercado.» (one neighbor only; phase 9-5)
 *   count  «Sueltas 2 rumores.» (null with one)
 *   start  the label of «Empezar» (startLabel)
 *
 * @param {object} draft normalized (Teléfono: to the first of the row)
 * @param {{header?: object|null, lang: string, t: object, window?: {from: number, to: number}|null, timetable?: object|null,
 *   proposal?: {id: string, kind: 'tip'|'best'|'first', reasons?: object}|null}} o
 *   proposal: whom the example was told to and why (index.js); without it, the first by name
 * @returns {{news: string, tell: string, about: string|null, propose: string|null, count: string|null, start: string, rumor: object}|null}
 *   null in a challenge, without rumors, or with one half done
 */
export function readyCard(draft, { header = null, lang, t, window = null, timetable = null, proposal = null }) {
  const rumors = draft?.rumors ?? [];
  if (!rumors.length || draft.challenge || rumors.some((r) => rumorIssues(r, draft.settings, window).length)) return null;
  const r = rumors[0];
  const at = r.at === 'start' ? fill(t.readyAtStart, { time: clockText(header?.start_tick ?? 0) }) : fill(t.summaryAt, { time: r.at });
  const place = typeof r.to?.place === 'string' && r.to.place ? r.to.place : null;
  const ids = place ? [] : (r.to?.neighbors ?? []);
  const tell = place ? fill(t.readyTellPlace, { place: placeWithArticle(header, place, lang), at }) : fill(t.readyTell, { to: toText(r.to, { header, lang, t }), at });
  const p = ids.length === 1 ? neighborProfile(header, timetable, ids[0], lang) : null;
  const about = p ? endSentence(fill(t.readyAbout, { name: p.name, profile: profileLine(p, t, { header, lang }) })) : null;
  // The neighbor of the example is only a proposal: said, with why, so the player chooses.
  const propose = p ? proposeText(p, proposal ?? { id: firstByName(header), kind: 'first' }, { header, lang, t }) : null;
  return {
    news: `${factSentence(r.fact, { header, lang })}.`,
    tell,
    about,
    propose,
    count: rumors.length > 1 ? countText(t, rumors.length) : null,
    start: startLabel(draft, { header, lang, t }),
    rumor: r,
  };
}

/** Settings a challenge may leave to the player or fix, in the order they are said. */
const CHALLENGE_SETTINGS = ['type', 'neighbors', 'town', 'trait_mix', 'distortion'];

/**
 * «Tú decides: el rumor, a quién se lo cuentas y cuándo se lo cuentas.»: what
 * a challenge leaves to the player (challengeLocks), in words of its own
 * (t.decideWords), the mode apart (it is labelled already); null when nothing is.
 * @param {object|null} challenge
 * @param {object} t
 */
export function yourPartText(challenge, t) {
  if (!challenge) return null;
  const locks = challengeLocks(challenge);
  const w = t.decideWords ?? {};
  const parts = [];
  if (!locks.slots.has('what')) parts.push(w.what);
  else for (const k of ['who', 'where', 'when', 'amount']) if (!locks.slots.has(k)) parts.push(w[k]);
  if (!locks.to) parts.push(w.to);
  if (!locks.at) parts.push(w.at);
  for (const k of CHALLENGE_SETTINGS) if ((challenge.open ?? []).includes(k)) parts.push(w[k]);
  const real = parts.filter(Boolean);
  return real.length ? fill(t.yourPart, { what: nameList(real, { and: t.and }) }) : null;
}

/**
 * «El reto fija el rumor («Una fiesta en la plaza, hoy a las 21:00»), el
 * pueblo y la hora de final (14:00).»: what a challenge fixes, in plain
 * words; the rest of its locks are seen in «Más opciones» (🔒). null in the
 * tutorial and when nothing is fixed.
 * @param {object|null} challenge
 * @param {{header?: object|null, lang: string, t: object}} o
 */
export function fixedPartText(challenge, { header = null, lang, t }) {
  if (!challenge || challenge.tutorial) return null;
  const locks = challengeLocks(challenge);
  const parts = [];
  const fact = challenge.rumor?.fact ?? {};
  const sentence = factSentence(
    Object.fromEntries(['what', 'who', 'where', 'when', 'amount'].map((k) => [k, locks.slots.has(k) ? (fact[k] ?? null) : null])),
    { header, lang },
  );
  if (sentence) parts.push(fill(locks.slots.size === 5 ? t.fixedRumor : t.fixedSome, { fact: sentence }));
  if (locks.settings.has('town')) parts.push(t.fixedTown);
  if (isTime(challenge.settings?.until)) parts.push(fill(t.fixedUntil, { time: challenge.settings.until }));
  return parts.length ? fill(t.fixedPart, { what: nameList(parts, { and: t.and }) }) : null;
}

/**
 * «La partida acaba a las 13:00: a las 21:00 ya no verás a nadie ir»: the
 * rumor says where and an hour the game does not reach (after its end, or
 * tomorrow in a game with an end hour). Only a warning: it is not forbidden.
 * Tomorrow without an end hour the game grows instead (t.tomorrowWarn).
 * @param {object} fact
 * @param {{from: number, to: number}} window atWindow of the game
 * @param {{until?: string|null}} settings
 * @param {object} t
 * @returns {string|null}
 */
export function lateWarning(fact, window, settings, t) {
  const w = parseWhen(fact?.when);
  if (!fact?.where || !w || !window) return null;
  const late = w.day === 'tomorrow' ? isTime(settings?.until) : minutesOf(w.time) >= window.to;
  if (!late) return null;
  const time = w.day === 'tomorrow' ? fill(t.lateTomorrow, { time: w.time }) : fill(t.lateToday, { time: w.time });
  return fill(t.lateWarn, { end: clockText(window.to), time });
}

/**
 * The hour a «cuándo pasa» gets when only its day is chosen: 21:00, or, in a
 * game that ends before (the tutorial, until 13:00), the last half hour an
 * hour before its end (12:00), so the example of the map can be seen.
 * @param {{from: number, to: number}|null} window
 */
export function defaultWhenTime(window) {
  if (!window || minutesOf('21:00') < window.to) return '21:00';
  const m = Math.max(window.from, Math.floor((window.to - 60) / 30) * 30);
  return clockText(m);
}

// --- Phase 9-5: the game understood at first sight ----------------------------------
//
//   startLabel ───────────── the one main button: «Soltar 3 rumores y empezar»,
//                             «Empezar · Ana lo oirá a las 10:00»
//   isBlankRumor ─────────── a new rumor still untouched (it does not stop «Empezar»)
//   toLimit · MAX_TO ─────── «Elegidos n de 3»
//   starsText · goalLines ── the head: the stars with their unit, goal, hours, duration
//   challengeSubject · subjectText  the priest or the guest of honour and their circle
//   profileLine · cardLines  what a neighbor is like, from core/neighbors.js
//   blockerLines · fieldErrorText  why «Empezar» cannot start, said plainly

/** Neighbors a rumor can be told to at most in a free game («Elegidos n de 3»). */
export const MAX_TO = 3;

/** The most neighbors a rumor can be told to: the challenge's limit, else MAX_TO. */
export function toLimit(locks) {
  return Number.isInteger(locks?.maxTo) && locks.maxTo > 0 ? locks.maxTo : MAX_TO;
}

/** Whether a rumor is still untouched: nothing chosen in the fact nor whom to tell. */
export function isBlankRumor(rumor) {
  const f = rumor?.fact ?? {};
  const empty = (v) => v === null || v === undefined || v === '';
  return ['what', 'who', 'where', 'when', 'amount'].every((k) => empty(f[k])) && !hasTo(rumor?.to) && !String(rumor?.text ?? '').trim();
}

/**
 * The label of the one main button, from the draft «Empezar» would start:
 *   several rumors                «Soltar 3 rumores y empezar»
 *   one neighbor, at the start    «Contárselo a Ana y empezar»
 *   one neighbor, at an hour      «Empezar · Ana lo oirá a las 10:00»
 *   several neighbors             «Empezar · se lo cuentas a Ana y Luis» / «… lo oirán a las 10:00»
 *   a place                       «Soltarlo en la plaza y empezar» / «Empezar · se soltará en la plaza a las 10:00»
 *   a rumor half done             «Empezar»
 * @param {object} draft normalized
 * @param {{header?: object|null, lang: string, t: object}} o
 */
export function startLabel(draft, { header = null, lang, t }) {
  const rumors = draft?.rumors ?? [];
  if (rumors.length > 1) return fill(t.startMany, { n: rumors.length });
  const r = rumors[0];
  if (!r || rumorIssues(r, draft.settings).length) return t.start;
  const hour = r.at !== 'start' && isTime(r.at) ? r.at : null;
  if (typeof r.to?.place === 'string' && r.to.place) {
    const place = placeWithArticle(header, r.to.place, lang);
    return hour ? fill(t.startDropAt, { place, time: hour }) : fill(t.startDropIn, { place });
  }
  const names = toText(r.to, { header, lang, t });
  const many = (r.to?.neighbors ?? []).length > 1;
  if (hour) return fill(many ? t.startTellAtMany : t.startTellAt, { name: names, names, time: hour });
  return fill(many ? t.startTellMany : t.startTell, { name: names, names });
}

/**
 * The targets of a challenge in a mode, one per star, with their unit: «Metas
 * (Sin IA): ★ con 6 · ★★ con 10 · ★★★ con 16 o más vecinos al sitio y a la
 * hora.»; null without stars (the tutorial).
 * @param {object|null} challenge
 * @param {'ai'|'rules'} mode
 * @param {object} t
 */
export function starsText(challenge, mode, t) {
  const s = challenge?.stars?.[mode];
  if (!Array.isArray(s) || s.length !== 3 || !s.every(Number.isFinite)) return null;
  const stars = (i) => '★'.repeat(i + 1);
  let list;
  if (MARGIN_MEASURES.includes(challenge.measure) && isTime(challenge.deadline)) {
    // Minutes before the deadline: «★ si llega antes de las 14:00 · ★★ 20 minutos antes».
    list = s.map((v, i) => `${stars(i)} ${v > 0 ? fill(t.starMinutes, { n: v }) : fill(t.starBefore, { time: challenge.deadline })}`).join(' · ');
  } else {
    const unit = measureUnit(challenge, t);
    const last = s.length - 1;
    list = s.map((v, i) => `${stars(i)} ${fill(i === last ? t.starWithLast : t.starWith, { n: v })}`).join(' · ');
    if (unit) list += ` ${unit}`;
  }
  return fill(t.starsLine, { mode: modeLabel(mode, t), list });
}

/**
 * The unit of the measure of a challenge (free play: the reach), with its
 * deadline filled in: «enterados», «minutos antes de las 14:00».
 * @param {object|null} challenge
 * @param {object} t
 */
export function measureUnit(challenge, t) {
  const unit = t.units?.[challenge?.measure ?? 'informed_end'] ?? '';
  return fill(unit, { deadline: challenge?.deadline ?? '' }).trim();
}

/** Measures in minutes of margin before the challenge's deadline. */
const MARGIN_MEASURES = ['half_tick', 'subject_tick'];

/** A sentence with its full stop, unless it already ends in one or in «…». */
export function endSentence(s) {
  const x = String(s ?? '').trim();
  return !x || /[.…!?]$/.test(x) ? x : `${x}.`;
}

/**
 * The warning about the subject of a challenge, said in their card and when
 * they are chosen: telling the priest yourself does not score; the guest of
 * honour hearing it gives zero stars. null without one.
 * @param {object|null} challenge
 * @param {object|null} header
 * @returns {{id: string, text: string}|null}
 */
export function subjectWarning(challenge, header, t) {
  const id = challengeSubject(challenge, header);
  if (!id) return null;
  if (challenge.zero_if === 'told_directly') return { id, text: t.warnToldDirectly };
  if (challenge.zero_if === 'subject_informed') return { id, text: t.warnInformed };
  return null;
}

/**
 * The head of «Preparar la partida»: the goal, the hours of the game and how
 * long it lasts. The figure of the duration is said only where it was
 * measured: a village of 25 neighbors.
 * @param {object} draft
 * @param {{challenge?: object|null, header?: object|null, t: object}} o
 * @returns {{goal: string, hours: string, duration: string}}
 */
export function goalLines(draft, { challenge = null, header = null, t }) {
  const measure = challenge?.measure ?? 'informed_end';
  const goal = fill(t.headGoal, { goal: t.prepGoal?.[measure] ?? t.prepGoal.informed_end });
  const hours = fill(t.headWindow, windowText(atWindow(header, draft?.settings ?? {})));
  const s = draft?.settings ?? {};
  // Measured only for the whole day (171 s, phase 9): a challenge or the tutorial
  // that ends earlier (`until`) is shorter, and no figure is given for it.
  const measured = s.type === 'village' && s.neighbors === 25 && !s.until;
  const duration = measured ? `${t.headDuration} ${t.headWatch}` : t.headWatch;
  return { goal, hours, duration };
}

/**
 * The neighbor a challenge is about (`subject`): the priest of the village,
 * or the «who» of its rumor (the guest of honour of the surprise party).
 * @param {object|null} challenge
 * @param {object|null} header
 * @returns {string|null} id
 */
export function challengeSubject(challenge, header) {
  if (challenge?.subject === 'priest') return (header?.neighbors ?? []).find((n) => n.job === 'priest')?.id ?? null;
  if (challenge?.subject === 'who') {
    const id = challenge.rumor?.fact?.who ?? null;
    return (header?.neighbors ?? []).some((n) => n.id === id) ? id : null;
  }
  return null;
}

/** «Carmen, Luis, Rosa…»: the first `max` names, and «…» when there are more. */
export function shortNames(names, max = 3) {
  const list = names ?? [];
  return list.length > max ? `${list.slice(0, max).join(', ')}…` : list.join(', ');
}

/**
 * «El cura es Francisco. Familia y amigos: Ana, Luis…»: the subject of a
 * challenge and the people close to them; null without one.
 * @param {object|null} challenge
 * @param {{header?: object|null, timetable?: object|null, lang: string, t: object}} o
 */
export function subjectText(challenge, { header = null, timetable = null, lang, t }) {
  const id = challengeSubject(challenge, header);
  const p = id ? neighborProfile(header, timetable, id, lang) : null;
  if (!p) return null;
  const who = fill(challenge.subject === 'priest' ? t.headPriest : t.headGuest, { name: p.name });
  const close = [...p.family, ...p.friends].sort((a, b) => a.localeCompare(b));
  return `${who} ${close.length ? endSentence(fill(t.headTies, { names: shortNames(close) })) : t.headNoTies}`;
}

/**
 * What a neighbor is like, in one line (for «Rumor listo»): «costurera,
 * sociable (lo cuenta a menudo), familia y amigos: Carmen, Luis…, pasa el
 * día en el mercado».
 * @param {object} p core/neighbors.js neighborProfile
 * @param {object} t
 * @param {{header?: object|null, lang?: string}} [o] with the header, places go with their article
 */
export function profileLine(p, t, { header = null, lang = 'es' } = {}) {
  if (!p) return '';
  const close = [...p.family, ...p.friends].sort((a, b) => a.localeCompare(b));
  const parts = [p.job, fill(t.profileTrait, { trait: p.traitName, phrase: p.traitPhrase })];
  if (close.length) parts.push(fill(t.profileTies, { names: shortNames(close) }));
  if (p.usual?.name) parts.push(fill(t.profileUsual, { place: header ? placeWithArticle(header, p.usual.key, lang) : p.usual.name }));
  else if (p.usual?.roaming) parts.push(t.profileRoam);
  return parts.filter(Boolean).join(', ');
}

/** The hour (0–23) a rumor is told at: its `at`, or the start of the game. */
export function tellHour(rumor, header) {
  if (isTime(rumor?.at)) return Number(rumor.at.slice(0, 2));
  return Math.floor((Number.isInteger(header?.start_tick) ? header.start_tick : 0) / 60) % 24;
}

/**
 * The lines of the card of a neighbor in the list of whom to tell:
 *   trait  «sociable: lo cuenta a menudo»
 *   signs  three short signs: «🗣 cotilla», «👪 5», «mucha gente»
 *   ties   «Familia y amigos (2): Carmen, Luis · Rivales: Pedro»
 *   home   «Vive en el barrio alto»
 *   usual  «Pasa el día en el bar, de 11:00 a 22:00» / «Va de un sitio a otro: plaza, ermita…»
 *   now    with `at` an hour: «A las 10:00 está en el mercado» / «… está en casa»
 * @param {object} p neighborProfile
 * @param {{header?: object|null, timetable?: object|null, at?: string, lang: string, t: object}} o
 */
export function cardLines(p, { header = null, timetable = null, at = 'start', lang, t }) {
  const close = [...p.family, ...p.friends].sort((a, b) => a.localeCompare(b));
  const ties = [close.length ? fill(t.cardTies, { n: close.length, names: shortNames(close) }) : t.cardNoTies];
  if (p.rivals.length) ties.push(fill(t.cardRivals, { names: shortNames(p.rivals) }));
  const hh = (h) => `${String(h % 24).padStart(2, '0')}:00`;
  let usual = null;
  // How busy the place of the day usually is, at the middle of its hours: a hint of whom to tell.
  let crowd = null;
  if (p.usual?.name) {
    usual = fill(t.cardUsual, { place: placeWithArticle(header, p.usual.key, lang), from: hh(p.usual.from), to: hh(p.usual.to) });
    if (timetable) {
      // The middle one of the hours the job is really there (a lunch at home does not count).
      const there = [];
      for (let h = p.usual.from; h < p.usual.to; h += 1) if (placeAt(timetable, p.jobKey, h) === p.usual.key) there.push(h);
      const hour = there[Math.floor(there.length / 2)] ?? Math.floor((p.usual.from + p.usual.to) / 2);
      const n = peopleAt(header, timetable, p.usual.key, hour).length;
      crowd = n >= 5 ? 'many' : n >= 3 ? 'some' : 'few';
    }
    // In the line only when it says something: lots or few.
    if (crowd === 'many' || crowd === 'few') usual = `${usual} · ${t.crowd[crowd]}`;
  } else if (p.usual?.roaming) usual = fill(t.cardRoam, { places: shortNames(p.usual.roaming, 2) });
  let now = null;
  if (isTime(at)) {
    const k = placeAt(timetable, p.jobKey, Number(at.slice(0, 2)));
    if (k === 'home') now = fill(t.cardAtHome, { time: at });
    else if (k) now = fill(t.cardAtPlace, { time: at, place: placeWithArticle(header, k, lang) });
  }
  return {
    // Three short signs for the head of the card, always there: how much they tell, how
    // many family and friends, how busy their place is («—» when it is not known).
    signs: [
      `${p.traitIcon} ${p.traitName}`,
      fill(t.signClose, { n: close.length }),
      p.usual?.name ? fill(t.signPlace, { place: p.usual.name, crowd: crowd ? t.crowd[crowd] : t.crowdUnknown }) : fill(t.signNoPlace, { crowd: p.usual?.roaming ? t.crowdRoam : t.crowdUnknown }),
    ],
    trait: `${p.traitName}: ${p.traitPhrase}`,
    ties: ties.join(' · '),
    home: p.home ? fill(t.cardHome, { place: placeWithArticle(header, p.home.key ?? p.home.id, lang) }) : null,
    usual,
    now,
  };
}

/**
 * Why «Empezar» cannot start, one line per blocker (startBlockers), saying
 * which rumor and what it lacks: «Falta elegir a quién se lo cuentas.»,
 * «Al rumor 2 le falta elegir qué ha pasado.». The checks of a challenge
 * are said apart (violations).
 * @param {object} draft the effective draft, normalized
 * @param {string[]} blockers
 * @param {{t: object, window?: object|null, pending?: 'pending'|'busy'|null}} o
 * @returns {string[]}
 */
export function blockerLines(draft, blockers, { t, window = null, pending = null }) {
  const rumors = draft?.rumors ?? [];
  return (blockers ?? [])
    .filter((b) => b !== 'challenge')
    .map((b) => {
      if (b === 'incomplete' || b === 'at') {
        const i = rumors.findIndex((r) => rumorIssues(r, draft.settings, window).length);
        if (i < 0) return t.blockers[b];
        const words = rumorIssues(rumors[i], draft.settings, window).map((k) => t.lackWords[k]);
        const what = nameList(words, { and: t.and });
        return rumors.length > 1 ? fill(t.lacksN, { n: i + 1, what }) : fill(t.lacks, { what });
      }
      if (b === 'pending' && pending === 'busy') return t.pendingBusy;
      return t.blockers[b];
    });
}

/**
 * An error of a field from the engine (POST start: {rumor, field, error}),
 * in words: «Rumor 1, dónde: no existe en este pueblo.»
 * @param {{rumor?: number|null, field?: string, error?: string}} e
 * @param {object} t
 */
export function fieldErrorText(e, t) {
  const field = t.fieldNames?.[e?.field] ?? t.fieldNames?.rumor;
  const error = t.errorCodes?.[e?.error] ?? t.errorCodes?.invalid;
  if (Number.isInteger(e?.rumor)) return fill(t.fieldError, { n: e.rumor + 1, field, error });
  return fill(t.fieldErrorAny, { field: field.charAt(0).toLocaleUpperCase() + field.slice(1), error });
}

/**
 * The village of the last game played in a village (games newest first, GET
 * games): a free game opens there, so the neighbors learnt stay the same
 * (phase 9-5). null without one. Teléfono games are skipped: their row is
 * another set of neighbors.
 * @param {object[]|null} games
 * @returns {{type: 'village', neighbors: number, town: number, trait_mix: number}|null}
 */
export function lastVillage(games) {
  const g = (games ?? []).find((x) => x?.settings && x.settings.type !== 'telephone' && Number.isInteger(x.settings.town));
  if (!g) return null;
  const s = g.settings;
  return {
    type: 'village',
    neighbors: NEIGHBORS.includes(s.neighbors) ? s.neighbors : 25,
    town: s.town,
    trait_mix: TRAIT_MIX.includes(s.trait_mix) ? s.trait_mix : 0,
  };
}

/**
 * «El mismo pueblo de tu última partida (n.º 7).» or «Pueblo nuevo (n.º 5272):
 * los nombres se repiten, pero cambian los oficios…»; null without a last
 * village.
 * @param {object} settings of the draft
 * @param {object|null} last lastVillage
 * @param {object} t
 */
export function villageNote(settings, last, t) {
  const same = sameVillage(settings, last);
  return same === null ? null : fill(same ? t.villageSame : t.villageNew, { town: settings.town });
}

/** Whether the settings are the village of the last game; null without one. */
export function sameVillage(settings, last) {
  if (!last || !settings) return null;
  return settings.type === 'village' && settings.neighbors === last.neighbors && settings.town === last.town && settings.trait_mix === last.trait_mix;
}

/**
 * The neighbor to propose: the one with the most strong reasons to spread a
 * rumor (`reasonsOf`, endview.js strongReasons: talkative, many family and
 * friends, a busy place), ties to more family and friends, then by name; the
 * same choice as the hint of the end card. null when nobody has one.
 * @param {object} header
 * @param {object|null} timetable
 * @param {string} lang
 * @param {(header: object, timetable: object|null, id: string, lang: string, closeTop: number) => object|null} reasonsOf
 * @param {string[]} [exclude] neighbors already told
 * @returns {{id: string, reasons: {trait: string|null, close: number|null, busy: string|null}}|null}
 */
export function suggestNeighbor(header, timetable, lang, reasonsOf, exclude = []) {
  const skip = new Set(exclude ?? []);
  const all = (header?.neighbors ?? []).map((n) => neighborProfile(header, timetable, n.id, lang)).filter(Boolean);
  const closes = all.map((p) => p.close).sort((a, b) => b - a);
  const closeTop = closes.length ? closes[Math.floor((closes.length - 1) / 4)] : Infinity;
  let pick = null;
  for (const p of all) {
    if (skip.has(p.id)) continue;
    const r = reasonsOf(header, timetable, p.id, lang, closeTop);
    if (!r) continue;
    const n = [r.trait, r.close, r.busy].filter((x) => x !== null && x !== undefined).length;
    const better = !pick || n > pick.n || (n === pick.n && (p.close > pick.p.close || (p.close === pick.p.close && p.name.localeCompare(pick.p.name) < 0)));
    if (better) pick = { p, r, n };
  }
  return pick ? { id: pick.p.id, reasons: pick.r } : null;
}

/**
 * «Propuesta: Pablo, como te sugerimos al acabar…», «Propuesta: Pablo, porque
 * es cotilla y tiene 6 de familia y amigos…», or «Propuesta: es la primera
 * por orden alfabético…»; null when the rumor goes to someone else.
 * @param {object} p neighborProfile of whom the rumor is told to
 * @param {{id: string, kind: string, reasons?: object}} proposal
 */
export function proposeText(p, proposal, { header = null, lang, t }) {
  if (!p || !proposal || p.id !== proposal.id) return null;
  if (proposal.kind === 'tip') return fill(t.proposeTip, { name: p.name });
  const r = proposal.reasons;
  if (proposal.kind === 'best' && r) {
    const reasons = [
      r.trait ? fill(t.reasonTrait?.[r.trait] ?? '', { trait: p.traitName }) : null,
      r.close ? fill(t.reasonClose, { n: r.close }) : null,
      r.busy ? fill(t.reasonBusy, { place: placeWithArticle(header, r.busy, lang) }) : null,
    ].filter(Boolean);
    if (reasons.length) return fill(t.proposeBest, { name: p.name, reasons: nameList(reasons, { and: t.and }) });
  }
  return p.gender === 'f' ? t.proposeF : t.proposeM;
}

/**
 * The cards of the neighbors in the order chosen: by name, most family and
 * friends first (core/neighbors.js sortProfiles), or the most talkative first.
 * @param {object[]} profiles
 * @param {'name'|'close'|'talk'} by
 */
export function sortCards(profiles, by = 'name') {
  if (by !== 'talk') return sortProfiles(profiles, by);
  return [...profiles].sort((a, b) => b.talk - a.talk || b.close - a.close || a.name.localeCompare(b.name));
}
