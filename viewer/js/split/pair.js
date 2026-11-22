// Whether two recordings can go side by side: same scenario, seed, language
// and world. `model` and `policy` may differ (that is the point). And how each
// side is titled. No DOM here.

import { modelName } from '../banner/index.js';
import { pick } from '../core/lang.js';
import { STRINGS as CORE } from '../core/strings.js';
import { STRINGS } from './strings.js';

/** Header keys that must match, in the order they are checked. */
export const PAIR_KEYS = [
  'scenario',
  'seed',
  'lang',
  'start_tick',
  'start_weekday',
  'tick_seconds',
  'params',
  'places',
  'routes',
  'neighbors',
  'relations',
];

/**
 * Deep equality of plain JSON data (key order of objects does not matter).
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export function sameData(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !sameData(a[k], b[k])) return false;
  }
  return true;
}

const scalar = (v) => v === null || v === undefined || typeof v !== 'object';

/**
 * Compares the headers of two recordings.
 * @param {object} a header of the left recording
 * @param {object} b header of the right recording
 * @returns {{ok: true} | {ok: false, key: string, values: [any, any]|null, reason: string}}
 *   key: the first header key that differs ('header' if one is missing);
 *   values: both values when they are plain (null for lists and objects);
 *   reason: the same in English for the console, like "seed differs: 1 vs 2"
 */
export function checkPair(a, b) {
  if (!a || !b) return { ok: false, key: 'header', values: null, reason: 'header missing' };
  for (const key of PAIR_KEYS) {
    if (sameData(a[key] ?? null, b[key] ?? null)) continue;
    const both = scalar(a[key]) && scalar(b[key]);
    const values = both ? [a[key] ?? null, b[key] ?? null] : null;
    return { ok: false, key, values, reason: both ? `${key} differs: ${a[key] ?? 'none'} vs ${b[key] ?? 'none'}` : `${key} differs` };
  }
  return { ok: true };
}

/**
 * The detail of a refused pair in the reader's language, from the reasons of
 * core/strings.js (STRINGS.<lang>.mismatch): «la semilla es distinta (1 / 2)».
 * @param {{key: string, values: [any, any]|null}} pair a failed checkPair
 * @param {{header: string, other: string} & Object<string, string>} mismatch STRINGS.<lang>.mismatch
 * @returns {string}
 */
export function mismatchText(pair, mismatch) {
  const base = mismatch[pair.key] ?? mismatch.other.replace('{key}', pair.key);
  const [x, y] = pair.values ?? [];
  return pair.values ? `${base} (${x ?? '—'} / ${y ?? '—'})` : base;
}

/**
 * Titles of the two sides: each one its model («Gemma 4 E4B afinado», «sin
 * modelo: reglas»); with `labels` (?labels=base,ft) the label is the title
 * («Sin afinar», «Afinado», or the word as given) and the model goes below.
 * @param {[object, object]} headers left and right
 * @param {string[]|null} labels params.labels
 * @param {'es'|'en'} lang
 * @returns {{title: string, model: string}[]}
 */
export function sideTitles(headers, labels, lang) {
  const t = pick(STRINGS, lang);
  return headers.map((h, i) => {
    const model = modelName(h, lang) ?? pick(CORE, lang).baseline;
    if (!labels?.[i]) return { title: model.charAt(0).toUpperCase() + model.slice(1), model: '' };
    return { title: t.labels[labels[i]] ?? labels[i], model };
  });
}
