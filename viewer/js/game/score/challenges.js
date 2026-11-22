// The challenges (docs/juego.md, «Retos» and «Un reto como fichero»): the
// format of data/challenges/<id>.json, its stars, the draft a challenge starts
// from and the check of a draft against what the challenge fixes.
//
//   challenge ──challengeDraft──► draft skeleton ──(the player fills the open parts)──► draft
//                                                       checkDraft(challenge, draft) ──► violations
//   challenge + log ──scoreChallenge──► {measure, value, stars, zero, scored}

import {
  attendOk,
  endTick,
  halfTick,
  informedEnd,
  injectOf,
  telephonePoints,
  modeOf,
  priestOf,
  subjectTick,
  tickOfTime,
  toldDirectly,
} from './measures.js';
import { NEIGHBORS } from '../prepare.js';

/** Version of the challenge file format. */
export const CHALLENGE_FORMAT = 1;

/** The closed list of measures (all "higher is better"). */
export const MEASURES = ['informed_end', 'attend_ok', 'half_tick', 'telephone_points', 'subject_tick'];

/** What the player may touch. */
export const OPEN_FIELDS = ['what', 'who', 'where', 'when', 'amount', 'to', 'at', 'trait_mix', 'mode'];

/** Values of `zero_if` and `subject`. */
export const ZERO_IF = [null, 'subject_informed', 'told_directly'];
export const SUBJECTS = [null, 'priest', 'who'];

/** Keys of a challenge file (`tutorial` is optional). */
export const CHALLENGE_KEYS = [
  'format',
  'id',
  'order',
  'title',
  'intro',
  'settings',
  'rumor',
  'open',
  'max_to',
  'to_place',
  'measure',
  'zero_if',
  'subject',
  'deadline',
  'stars',
];

/** Keys of the settings of a game (docs/arquitectura.md, «Formatos»). */
export const SETTINGS_KEYS = ['type', 'neighbors', 'town', 'lang', 'trait_mix', 'distortion', 'mode', 'until'];

/** The slots of a rumor's fact, `what` first. */
export const FACT_KEYS = ['what', 'who', 'where', 'when', 'amount'];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MODES = ['ai', 'rules'];

/**
 * Problems of a challenge file against the format; empty when it is right.
 * @param {object} c a parsed challenge file
 * @returns {string[]}
 */
export function checkChallenge(c) {
  const out = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['not an object'];
  for (const k of CHALLENGE_KEYS) if (!(k in c)) out.push(`missing ${k}`);
  for (const k of Object.keys(c)) if (!CHALLENGE_KEYS.includes(k) && k !== 'tutorial') out.push(`unknown key ${k}`);
  if (c.format !== CHALLENGE_FORMAT) out.push('format is not 1');
  if (typeof c.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id)) out.push('bad id');
  if (!Number.isInteger(c.order) || c.order < 0) out.push('bad order');
  for (const k of ['title', 'intro']) {
    const t = c[k];
    if (!t || typeof t.es !== 'string' || typeof t.en !== 'string' || !t.es || !t.en) out.push(`${k} needs es and en`);
  }
  if ('tutorial' in c && typeof c.tutorial !== 'boolean') out.push('tutorial is not a boolean');

  const s = c.settings;
  if (!s || typeof s !== 'object') out.push('bad settings');
  else {
    for (const k of Object.keys(s)) if (!SETTINGS_KEYS.includes(k)) out.push(`unknown setting ${k}`);
    if (!Number.isInteger(s.town)) out.push('settings must fix town');
    if ('type' in s && !['village', 'telephone'].includes(s.type)) out.push('bad settings.type');
    if ('neighbors' in s && !NEIGHBORS.includes(s.neighbors)) out.push('bad settings.neighbors');
    if ('trait_mix' in s && !(Number.isInteger(s.trait_mix) && Math.abs(s.trait_mix) <= 2)) out.push('bad settings.trait_mix');
    if ('distortion' in s && !['low', 'normal', 'high'].includes(s.distortion)) out.push('bad settings.distortion');
    if ('mode' in s && !MODES.includes(s.mode)) out.push('bad settings.mode');
    if ('until' in s && s.until !== null && !HHMM.test(s.until)) out.push('bad settings.until');
  }

  const r = c.rumor;
  if (!r || typeof r !== 'object' || !r.fact || typeof r.fact !== 'object') out.push('bad rumor');
  else {
    for (const k of Object.keys(r)) if (!['fact', 'to', 'at'].includes(k)) out.push(`unknown rumor key ${k}`);
    for (const k of FACT_KEYS) if (!(k in r.fact)) out.push(`rumor.fact misses ${k}`);
    for (const k of Object.keys(r.fact)) if (!FACT_KEYS.includes(k)) out.push(`unknown rumor.fact key ${k}`);
    for (const k of FACT_KEYS) {
      if ((c.open ?? []).includes(k) && r.fact[k] !== null) out.push(`rumor.fact.${k} is open but not null`);
    }
  }

  if (!Array.isArray(c.open)) out.push('open is not a list');
  else for (const k of c.open) if (!OPEN_FIELDS.includes(k)) out.push(`unknown open field ${k}`);
  if (!Number.isInteger(c.max_to) || c.max_to < 1) out.push('bad max_to');
  if (typeof c.to_place !== 'boolean') out.push('bad to_place');
  if (!MEASURES.includes(c.measure)) out.push(`unknown measure ${c.measure}`);
  if (!ZERO_IF.includes(c.zero_if)) out.push(`unknown zero_if ${c.zero_if}`);
  if (!SUBJECTS.includes(c.subject)) out.push(`unknown subject ${c.subject}`);
  if ((c.zero_if !== null || c.measure === 'subject_tick') && c.subject === null) out.push('needs a subject');
  if (c.deadline !== null && (typeof c.deadline !== 'string' || !HHMM.test(c.deadline))) out.push('bad deadline');
  if (c.measure === 'half_tick' && c.deadline === null) out.push('half_tick needs a deadline');
  if (c.deadline !== null && s && s.until !== undefined && s.until !== c.deadline) out.push('settings.until differs from deadline');

  // stars: thresholds per mode, or null for a challenge without stars (the tutorial).
  const st = c.stars;
  if (st === null) {
    // no stars
  } else if (!st || typeof st !== 'object') out.push('bad stars');
  else {
    for (const m of MODES) {
      const t = st[m];
      if (!Array.isArray(t) || t.length !== 3 || !t.every(Number.isFinite)) out.push(`stars.${m} needs three numbers`);
      else if (!(t[0] <= t[1] && t[1] <= t[2])) out.push(`stars.${m} must not go down`);
    }
    for (const k of Object.keys(st)) if (!MODES.includes(k)) out.push(`unknown stars key ${k}`);
  }
  return out;
}

/** Tick of the deadline ("HH:MM" of day 0), or null. */
function deadlineTick(challenge) {
  return challenge.deadline ? tickOfTime(challenge.deadline) : null;
}

/**
 * The subject of a challenge in a recording: the priest of the header, or the
 * `who` of the rumor as the engine injected it.
 * @param {object} challenge
 * @param {import('./measures.js').Log} log
 * @returns {string|null} neighbor id
 */
export function subjectOf(challenge, log) {
  if (challenge.subject === 'priest') return priestOf(log.header);
  if (challenge.subject === 'who') return injectOf(log)?.slots?.who ?? null;
  return null;
}

/**
 * Value of a challenge's measure on a recording (docs/juego.md, the table of
 * `measure`). half_tick and subject_tick are minutes of margin before the
 * deadline (without deadline: before the end of the recording).
 * @param {object} challenge
 * @param {import('./measures.js').Log} log
 * @returns {number|null} null: not scored
 */
export function measureValue(challenge, log) {
  const limit = deadlineTick(challenge) ?? endTick(log);
  switch (challenge.measure) {
    case 'informed_end':
      return informedEnd(log).size;
    case 'attend_ok':
      return attendOk(log);
    case 'half_tick': {
      const t = halfTick(log);
      return t === null || t > limit ? null : limit - t;
    }
    case 'telephone_points':
      return telephonePoints(log);
    case 'subject_tick': {
      const who = subjectOf(challenge, log);
      const t = who === null ? null : subjectTick(log, who);
      return t === null || t > limit ? null : limit - t;
    }
    default:
      throw new Error(`unknown measure: ${challenge.measure}`);
  }
}

/**
 * Stars of a value against three thresholds: how many it reaches. A value
 * not scored (null) gets 0.
 * @param {number|null} value
 * @param {number[]} thresholds [★, ★★, ★★★]
 * @returns {0|1|2|3}
 */
export function starsOf(value, thresholds) {
  if (value === null || value === undefined) return 0;
  return /** @type {0|1|2|3} */ ((thresholds ?? []).filter((t) => value >= t).length);
}

/**
 * What is missing for the next star: the first threshold the value does not
 * reach, and how much is left (measures are "higher is better").
 * @param {number|null} value
 * @param {number[]|null|undefined} thresholds [★, ★★, ★★★]
 * @returns {{stars: 1|2|3, gap: number}|null} null without thresholds, without
 *   value, or with the three stars
 */
export function nextStar(value, thresholds) {
  if (value === null || value === undefined || !Array.isArray(thresholds)) return null;
  const k = thresholds.findIndex((t) => value < t);
  return k < 0 ? null : { stars: /** @type {1|2|3} */ (k + 1), gap: thresholds[k] - value };
}

/**
 * Score of a challenge on a recording.
 * @param {object} challenge a challenge file
 * @param {import('./measures.js').Log} log
 * @param {'ai'|'rules'} [mode] default the recording's (header.policy model ↔ ai, baseline ↔ rules)
 * @returns {{measure: string, value: number|null, stars: 0|1|2|3|null,
 *   zero: null|'subject_informed'|'told_directly', scored: boolean,
 *   next: {stars: 1|2|3, gap: number}|null}}
 *   stars: null for a challenge without stars (`stars: null`, the tutorial);
 *   zero: why the stars are 0 although the measure has a value;
 *   next: what is missing for the next star (null when zero or without stars)
 */
export function scoreChallenge(challenge, log, mode) {
  const m = mode ?? modeOf(log.header);
  const value = measureValue(challenge, log);
  let zero = null;
  const who = subjectOf(challenge, log);
  if (challenge.zero_if === 'subject_informed' && who !== null && informedEnd(log).has(who)) zero = 'subject_informed';
  if (challenge.zero_if === 'told_directly' && who !== null && toldDirectly(log, who)) zero = 'told_directly';
  const thresholds = challenge.stars ? challenge.stars[m] : null;
  const stars = !thresholds ? null : zero ? 0 : starsOf(value, thresholds);
  const next = stars === null || zero ? null : nextStar(value, thresholds);
  return { measure: challenge.measure, value, stars, zero, scored: value !== null, next };
}

/**
 * The draft a challenge starts from (docs/arquitectura.md, «Borrador»): its
 * settings with `until` (the deadline, when it has one) and `mode`, and its
 * one rumor with the fixed parts and null in the open ones. The player fills
 * the rest.
 * @param {object} challenge
 * @param {'ai'|'rules'} mode
 * @returns {{settings: object, rumors: object[], challenge: string, bets: null, race: null}}
 */
export function challengeDraft(challenge, mode) {
  const settings = { ...challenge.settings, mode, until: challenge.settings?.until ?? challenge.deadline ?? null };
  const fact = {};
  for (const k of FACT_KEYS) fact[k] = challenge.rumor?.fact?.[k] ?? null;
  const rumor = { fact, text: null, to: challenge.rumor?.to ?? null, at: challenge.rumor?.at ?? 'start' };
  return { settings, rumors: [rumor], challenge: challenge.id, bets: null, race: null };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What a draft breaks of a challenge.
 *   fixed       a field the challenge fixes was changed
 *   count       not exactly one rumor
 *   too_many    more neighbors in `to` than max_to
 *   place_not_allowed  `to` is a place and the challenge does not allow it
 *   missing     no `to` in a village game
 * @param {object} challenge
 * @param {object} draft
 * @returns {{field: string, error: string}[]} empty when the draft is fine
 */
export function checkDraft(challenge, draft) {
  const out = [];
  const open = new Set(challenge.open ?? []);
  const fixed = challenge.settings ?? {};
  const settings = draft?.settings ?? {};
  for (const [k, v] of Object.entries(fixed)) {
    if (k === 'trait_mix' && open.has('trait_mix')) continue;
    if (k === 'mode' && open.has('mode')) continue;
    if (!same(settings[k], v)) out.push({ field: `settings.${k}`, error: 'fixed' });
  }
  const until = fixed.until ?? challenge.deadline ?? null;
  if (until !== null && !('until' in fixed) && !same(settings.until, until)) out.push({ field: 'settings.until', error: 'fixed' });

  const rumors = draft?.rumors ?? [];
  if (rumors.length !== 1) {
    out.push({ field: 'rumors', error: 'count' });
    if (!rumors.length) return out;
  }
  const r = rumors[0];
  for (const k of FACT_KEYS) {
    if (open.has(k)) continue;
    if (!same(r.fact?.[k], challenge.rumor?.fact?.[k])) out.push({ field: `rumor.${k}`, error: 'fixed' });
  }
  const telephone = (settings.type ?? fixed.type) === 'telephone';
  if (!telephone) {
    if (!open.has('to')) {
      if ('to' in (challenge.rumor ?? {}) && !same(r.to, challenge.rumor.to)) out.push({ field: 'to', error: 'fixed' });
    } else if (!r.to) {
      out.push({ field: 'to', error: 'missing' });
    } else if (r.to.place !== undefined) {
      if (!challenge.to_place) out.push({ field: 'to', error: 'place_not_allowed' });
    } else if (Array.isArray(r.to.neighbors)) {
      if (new Set(r.to.neighbors).size > challenge.max_to) out.push({ field: 'to', error: 'too_many' });
    }
    if (!open.has('at') && 'at' in (challenge.rumor ?? {}) && !same(r.at ?? 'start', challenge.rumor.at)) {
      out.push({ field: 'at', error: 'fixed' });
    }
  }
  return out;
}
