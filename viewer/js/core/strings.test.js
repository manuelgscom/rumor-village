// The texts of every package: es and en have the same keys, and no visible text
// uses a word that the glossary of phase 8-1 retired (docs/fases/fase-8.md,
// section 8-1, glossary). Phase 9 adds the words of the game (docs/juego.md):
// the game package says them exactly so (REQUIRED), and no package uses the
// phrases they replace (BANNED_PHRASES).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { repoPath } from './testing.js';

/** Words retired by the glossary, per language (whole words, any case). */
export const BANNED = {
  es: ['versión equivocada', 'hecho', 'hechos', 'hueco', 'olvido', 'suposición declarada', 'olvido de la duda', 'duda endurecida', 'recuerdo inventado', 'inyección', 'hecho inyectado', 'línea base'],
  en: ['twisted', 'rumour', 'rumours', 'baseline'],
};

/** Glossary words of the game, by package, language and key: the exact text. */
export const REQUIRED = {
  game: {
    es: { modeAi: 'Con IA', modeRules: 'Sin IA', score: 'marca' },
    en: { modeAi: 'With AI', modeRules: 'Without AI', score: 'score' },
  },
};

/** Phrases the glossary of the game replaces, per language (whole phrase, any case). */
export const BANNED_PHRASES = {
  // «pueblo honesto» became «Nadie lo cambió» (phase 9-5).
  es: ['modo IA', 'con la IA', 'sin la IA', 'pueblo honesto'],
  en: ['AI mode', 'Rules mode', 'No AI', 'honest village'],
};

/**
 * Words still allowed while their package is under way: {package: [words]}.
 * Each package of phase 8-1 empties its own row; at the close it is empty.
 */
const PENDING = {};

/** Keys whose es and en values may differ in shape (grammar of each language). */
const FREE_SHAPE = new Set(['placeThe']);

async function packages() {
  const dir = repoPath('viewer/js');
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const file = `${dir}/${name}/strings.js`;
    if (!existsSync(file)) continue;
    const mod = await import(file);
    if (mod.STRINGS) out.push({ name, strings: mod.STRINGS });
  }
  return out;
}

function shapeDiff(a, b, path, out) {
  if (FREE_SHAPE.has(path.split('.').pop())) return out;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) out.push(`${path}: array in one language only`);
    else if (a.length !== b.length) out.push(`${path}: ${a.length} items in es, ${b.length} in en`);
    else a.forEach((v, i) => shapeDiff(v, b[i], `${path}[${i}]`, out));
    return out;
  }
  if (isObj(a) || isObj(b)) {
    if (!isObj(a) || !isObj(b)) {
      out.push(`${path}: object in one language only`);
      return out;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${path}.${k}: missing in es`);
      else if (!(k in b)) out.push(`${path}.${k}: missing in en`);
      else shapeDiff(a[k], b[k], `${path}.${k}`, out);
    }
  }
  return out;
}

function texts(v, path, out) {
  if (typeof v === 'string') out.push({ path, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => texts(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) texts(x, `${path}.${k}`, out);
  return out;
}

function wordRe(word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}])${esc}($|[^\\p{L}])`, 'iu');
}

test('every strings.js has the same keys in es and en', async () => {
  const list = await packages();
  assert.ok(list.length >= 13, `only ${list.length} strings.js found`);
  const diffs = [];
  for (const { name, strings } of list) {
    assert.ok(strings.es && strings.en, `${name}: es and en`);
    shapeDiff(strings.es, strings.en, name, diffs);
  }
  assert.deepEqual(diffs, []);
});

test('no visible text uses a word retired by the glossary', async () => {
  const found = [];
  for (const { name, strings } of await packages()) {
    const allowed = new Set(PENDING[name] ?? []);
    for (const lang of ['es', 'en']) {
      for (const { path, text } of texts(strings[lang], `${name}.${lang}`, [])) {
        for (const word of BANNED[lang]) if (!allowed.has(word) && wordRe(word).test(text)) found.push(`${path}: «${word}» in «${text}»`);
      }
    }
  }
  assert.deepEqual(found, []);
});

test('the game says the glossary words exactly', async () => {
  const list = await packages();
  const wrong = [];
  for (const [name, langs] of Object.entries(REQUIRED)) {
    const strings = list.find((p) => p.name === name)?.strings;
    assert.ok(strings, `${name}/strings.js missing`);
    for (const [lang, keys] of Object.entries(langs))
      for (const [key, want] of Object.entries(keys))
        if (strings[lang]?.[key] !== want) wrong.push(`${name}.${lang}.${key}: «${strings[lang]?.[key]}», not «${want}»`);
  }
  assert.deepEqual(wrong, []);
});

test('no visible text uses a phrase the game glossary replaced', async () => {
  const found = [];
  for (const { name, strings } of await packages()) {
    for (const lang of ['es', 'en']) {
      for (const { path, text } of texts(strings[lang], `${name}.${lang}`, [])) {
        for (const phrase of BANNED_PHRASES[lang]) if (wordRe(phrase).test(text)) found.push(`${path}: «${phrase}» in «${text}»`);
      }
    }
  }
  assert.deepEqual(found, []);
});

test('the glossary check sees whole words only', () => {
  assert.ok(wordRe('modo IA').test('Juega en Modo IA'));
  assert.ok(!wordRe('No AI').test('Nothing about AI'));
  assert.ok(!wordRe('sin la IA').test('sin la IAx'));
  assert.ok(wordRe('olvido').test('un olvido'));
  assert.ok(!wordRe('olvido').test('lo olvidó'));
  assert.ok(wordRe('rumour').test('A new rumour…'));
  assert.ok(!wordRe('hecho').test('deshecho'));
});
