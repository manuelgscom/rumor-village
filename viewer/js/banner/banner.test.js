// The human banner: the model's name, who decides and the ⓘ rows.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadLog } from '../core/testing.js';
import { bannerText, gameBannerParts, gameBannerText, infoRows, modelName, runText } from './index.js';

const P100 = 'runs/samples/party-100-es-s2.jsonl';

test('modelName: the Gemma files of runs/eval, and anything else as is', () => {
  const m = (model, lang = 'es') => modelName({ policy: 'model', model }, lang);
  assert.equal(m('gemma-4-E4B-it-rumor-Q4_K_M.gguf'), 'Gemma 4 E4B afinado');
  assert.equal(m('gemma-4-E4B-it-rumor-Q4_K_M.gguf', 'en'), 'Gemma 4 E4B fine-tuned');
  assert.equal(m('gemma-4-E4B-it-Q4_K_M.gguf'), 'Gemma 4 E4B sin afinar');
  assert.equal(m('gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf', 'en'), 'Gemma 4 E4B not fine-tuned');
  assert.equal(m('gemma-4-e2b-it.gguf'), 'Gemma 4 E2B sin afinar');
  assert.equal(m('my-model.gguf'), 'my-model.gguf');
  assert.equal(m('gemma-4-E4B-itx.gguf'), 'gemma-4-E4B-itx.gguf');
  assert.equal(modelName({ policy: 'baseline', model: null }, 'es'), null);
  assert.equal(modelName({ policy: 'baseline', model: 'x.gguf' }, 'es'), null);
});

test('runText: the model "en local", or the rules', () => {
  assert.equal(runText({ policy: 'model', model: 'gemma-4-E4B-it-rumor-Q4_K_M.gguf' }, 'es'), 'Gemma 4 E4B afinado, en local');
  assert.equal(runText({ policy: 'model', model: 'gemma-4-E4B-it-rumor-Q4_K_M.gguf' }, 'en'), 'Gemma 4 E4B fine-tuned, running locally');
  assert.equal(runText({ policy: 'baseline', model: null }, 'es'), 'sin modelo: reglas');
  assert.equal(runText({ policy: 'baseline', model: null }, 'en'), 'no model: rules');
});

test('bannerText of a sample: no seed, scenario or language code', () => {
  const { header } = loadLog(P100);
  const text = bannerText(header, 'es');
  assert.equal(text, 'Rumor Village · 100 vecinos · sin modelo: reglas');
  assert.doesNotMatch(text, /semilla|party-100|\bes\b/);
  const ft = { ...header, policy: 'model', model: 'gemma-4-E4B-it-rumor-Q4_K_M.gguf' };
  assert.equal(bannerText(ft, 'en'), 'Rumor Village · 100 neighbors · Gemma 4 E4B fine-tuned, running locally');
});

test('infoRows: scenario, seed, language, model and file; empty ones left out', () => {
  const { header } = loadLog(P100);
  assert.deepEqual(infoRows(header, 'es', '/runs/samples/party-100-es-s2.jsonl'), [
    ['Escenario', 'party-100'],
    ['Semilla', '2'],
    ['Idioma', 'castellano'],
    ['Modelo', 'sin modelo: reglas'],
    ['Fichero', '/runs/samples/party-100-es-s2.jsonl'],
  ]);
  const live = infoRows({ ...header, policy: 'model', model: 'm.gguf' }, 'en', null);
  assert.deepEqual(live.map(([k]) => k), ['Scenario', 'Seed', 'Language', 'Model']);
  assert.deepEqual(live[3], ['Model', 'm.gguf']);
});

test('gameBannerText: town number, neighbors and the mode, no model nor run', () => {
  const { header } = loadLog(P100);
  assert.equal(gameBannerText({ ...header, seed: 4821 }, 'es'), 'Rumor Village · Pueblo n.º 4821 · 100 vecinos · Sin IA');
  const ai = { ...header, seed: 4821, policy: 'model', model: 'gemma-4-E4B-it-rumor-Q4_K_M.gguf' };
  assert.equal(gameBannerText(ai, 'es'), 'Rumor Village · Pueblo n.º 4821 · 100 vecinos · Con IA');
  assert.equal(gameBannerText(ai, 'en'), 'Rumor Village · Village no. 4821 · 100 neighbors · With AI');
  assert.equal(gameBannerText({ ...header, seed: undefined }, 'es'), 'Rumor Village · 100 vecinos · Sin IA');
});

test('gameBannerParts: in the menu only the name and the mode; the town once a game is prepared', () => {
  const { header } = loadLog(P100);
  const h = { ...header, seed: 7 };
  const text = (phase) => gameBannerParts(h, 'es', phase).map((p) => p.text).join(' · ');
  assert.equal(text('boot'), 'Rumor Village · Sin IA');
  assert.equal(text('menu'), 'Rumor Village · Sin IA');
  assert.equal(text(null), 'Rumor Village · Sin IA');
  assert.equal(text('prepare'), 'Rumor Village · Pueblo n.º 7 · 100 vecinos · Sin IA');
  assert.equal(text('playing'), text('prepare'));
  assert.equal(text(undefined), text('prepare'));
});
