// The four entries of the start screen, chosen from a manifest of recordings
// (phase 8-1, package A). Pure: no DOM.
//
//   manifest = {recordings: [{id, file, scenario, lang, model, quant, finetuned, seed, gpu, planes}]}
//   entriesOf(manifest, lang, base) → [{id: 'tour'|'explore'|'split'|'telephone', query, recordings}]
//     tour       ?log=…&tour=1   first party-* of the language, the fine-tuned one if any
//     explore    ?log=…          the same recording
//     split      ?left=…&right=…&labels=base,ft   it (fine-tuned, right) and its
//                                base twin (left): same scenario, seed and language
//     telephone  ?log=…          first telephone-* of the language
//   An entry without a recording is left out.
//   backgroundOf(manifest, lang, base) → {path, recording}|null: the village
//     behind the start screen (the tour's recording, else any of the language)
//   servedByEngine(pathname): the page is the engine's (viewer at "/"), so the
//     live mode may be there
//
// Paths in the manifest are relative to it (`base`, its absolute URL); in the
// queries they are the path of the server when the manifest is on it.

import { queryOf } from './link.js';

/** Recordings of a manifest with what an entry needs. */
function recordingsOf(manifest) {
  const list = Array.isArray(manifest?.recordings) ? manifest.recordings : [];
  return list.filter((r) => r && typeof r.file === 'string' && r.file && typeof r.scenario === 'string');
}

const isParty = (r) => r.scenario.startsWith('party-');
const isTelephone = (r) => r.scenario.startsWith('telephone-');

/** The first recording that passes, the fine-tuned one if `preferFt`. */
function firstOf(list, test, preferFt) {
  const found = list.filter(test);
  return (preferFt && found.find((r) => r.finetuned === true)) || found[0] || null;
}

/**
 * Where a recording of the manifest is, for a query: the server path when it
 * is on the manifest's origin, else the whole URL.
 * @param {{file: string}} rec
 * @param {string} base absolute URL of the manifest
 * @returns {string}
 */
export function pathOf(rec, base) {
  const u = new URL(rec.file, base);
  return u.origin === new URL(base).origin ? u.pathname + u.search : u.href;
}

/**
 * @param {object} manifest
 * @param {'es'|'en'} lang
 * @param {string} base absolute URL of the manifest (paths in it are relative to it)
 * @returns {{id: string, query: string, recordings: object[]}[]}
 */
export function entriesOf(manifest, lang, base) {
  const list = recordingsOf(manifest).filter((r) => r.lang === lang);
  const out = [];
  const party = firstOf(list, isParty, true);
  if (party) {
    const log = pathOf(party, base);
    out.push({ id: 'tour', query: queryOf([['log', log], ['tour', 1]]), recordings: [party] });
    out.push({ id: 'explore', query: queryOf([['log', log]]), recordings: [party] });
    const twin =
      party.finetuned === true
        ? list.find((r) => r !== party && r.finetuned !== true && r.scenario === party.scenario && r.seed === party.seed)
        : null;
    if (twin)
      out.push({
        id: 'split',
        query: queryOf([['left', pathOf(twin, base)], ['right', log], ['labels', 'base,ft']]),
        recordings: [twin, party],
      });
  }
  const tel = firstOf(list, isTelephone, false);
  if (tel) out.push({ id: 'telephone', query: queryOf([['log', pathOf(tel, base)]]), recordings: [tel] });
  return out;
}

/**
 * The recording that plays behind the start screen.
 * @param {object} manifest
 * @param {'es'|'en'} lang
 * @param {string} base
 * @returns {{path: string, recording: object}|null}
 */
export function backgroundOf(manifest, lang, base) {
  const all = recordingsOf(manifest);
  const same = all.filter((r) => r.lang === lang);
  const rec = firstOf(same, isParty, true) ?? same[0] ?? firstOf(all, isParty, true) ?? all[0] ?? null;
  return rec ? { path: pathOf(rec, base), recording: rec } : null;
}

/**
 * Who decides in a recording of the manifest.
 * @param {{model?: string|null, finetuned?: boolean}} rec
 * @returns {{kind: 'rules'}|{kind: 'model', model: string, finetuned: boolean}}
 */
export function deciderOf(rec) {
  return rec?.model ? { kind: 'model', model: String(rec.model), finetuned: rec.finetuned === true } : { kind: 'rules' };
}

/**
 * Whether the page is served by the engine, which mounts the viewer at "/"
 * (the static server of the repo serves it at /viewer/).
 * @param {string} pathname
 * @returns {boolean}
 */
export function servedByEngine(pathname) {
  return /^\/(index\.html)?$/.test(pathname);
}
