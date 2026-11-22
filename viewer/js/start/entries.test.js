import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFile } from '../core/testing.js';
import { parseParams } from '../core/params.js';
import { backgroundOf, deciderOf, entriesOf, pathOf, servedByEngine } from './entries.js';

const BASE = 'http://127.0.0.1:8000/runs/samples/manifest.json';
const SAMPLES = JSON.parse(readRepoFile('runs/samples/manifest.json'));

const rec = (id, scenario, lang, extra = {}) => ({
  id,
  file: `${id}.jsonl`,
  scenario,
  lang,
  model: null,
  quant: null,
  finetuned: false,
  seed: 1,
  gpu: null,
  planes: [],
  ...extra,
});

/** A demo manifest: a base and a fine-tuned party in English, their twin, telephone. */
const DEMO = {
  recordings: [
    rec('party-100-en-rules', 'party-100', 'en', { seed: 3 }),
    rec('party-100-en-base', 'party-100', 'en', { seed: 2, model: 'gemma-4-e4b' }),
    rec('party-100-en-ft', 'party-100', 'en', { seed: 2, model: 'gemma-4-e4b', finetuned: true }),
    rec('party-100-en-ft-s9', 'party-100', 'en', { seed: 9, model: 'gemma-4-e4b', finetuned: true }),
    rec('telephone-20-en-ft', 'telephone-20', 'en', { model: 'gemma-4-e4b', finetuned: true }),
    rec('party-100-es-ft', 'party-100', 'es', { model: 'gemma-4-e4b', finetuned: true }),
  ],
};
const DEMO_BASE = 'http://127.0.0.1:8000/runs/demo/manifest.json';

const byId = (list) => Object.fromEntries(list.map((e) => [e.id, e]));

test('samples: tour, explore and telephone in each language, no split (all rules)', () => {
  for (const lang of ['es', 'en']) {
    const entries = entriesOf(SAMPLES, lang, BASE);
    assert.deepEqual(
      entries.map((e) => e.id),
      ['tour', 'explore', 'telephone'],
      lang,
    );
    for (const e of entries) for (const r of e.recordings) assert.equal(r.lang, lang);
  }
  const es = byId(entriesOf(SAMPLES, 'es', BASE));
  assert.equal(es.tour.query, '?log=/runs/samples/party-100-es-s2.jsonl&tour=1');
  assert.equal(es.explore.query, '?log=/runs/samples/party-100-es-s2.jsonl');
  assert.equal(es.telephone.query, '?log=/runs/samples/telephone-20-es-s5.jsonl');
  const en = byId(entriesOf(SAMPLES, 'en', BASE));
  assert.equal(en.tour.query, '?log=/runs/samples/party-25-en-s4.jsonl&tour=1');
});

test('the queries read back with parseParams', () => {
  const { tour } = byId(entriesOf(SAMPLES, 'en', BASE));
  const p = parseParams(tour.query);
  assert.equal(p.log, '/runs/samples/party-25-en-s4.jsonl');
  assert.equal(p.tour, true);
});

test('demo: the fine-tuned party is preferred and split pairs it with its base twin', () => {
  const entries = entriesOf(DEMO, 'en', DEMO_BASE);
  assert.deepEqual(
    entries.map((e) => e.id),
    ['tour', 'explore', 'split', 'telephone'],
  );
  const e = byId(entries);
  assert.equal(e.tour.query, '?log=/runs/demo/party-100-en-ft.jsonl&tour=1');
  assert.equal(e.split.query, '?left=/runs/demo/party-100-en-base.jsonl&right=/runs/demo/party-100-en-ft.jsonl&labels=base,ft');
  const p = parseParams(e.split.query);
  assert.equal(p.left, '/runs/demo/party-100-en-base.jsonl');
  assert.equal(p.right, '/runs/demo/party-100-en-ft.jsonl');
  assert.deepEqual(p.labels, ['base', 'ft']);
  assert.deepEqual(
    e.split.recordings.map((r) => r.id),
    ['party-100-en-base', 'party-100-en-ft'],
  );
});

test('an entry without a recording is left out', () => {
  // Spanish: a fine-tuned party without twin and no telephone.
  assert.deepEqual(
    entriesOf(DEMO, 'es', DEMO_BASE).map((e) => e.id),
    ['tour', 'explore'],
  );
  // Only telephone.
  const tel = { recordings: [rec('telephone-20-en-s5', 'telephone-20', 'en')] };
  assert.deepEqual(
    entriesOf(tel, 'en', BASE).map((e) => e.id),
    ['telephone'],
  );
  // Nothing in that language, or no manifest at all.
  assert.deepEqual(entriesOf(tel, 'es', BASE), []);
  assert.deepEqual(entriesOf(null, 'es', BASE), []);
  assert.deepEqual(entriesOf({ recordings: [{ id: 'x' }] }, 'es', BASE), []);
});

test('paths are relative to the manifest; another origin keeps the whole URL', () => {
  assert.equal(pathOf({ file: '../eval/a b.jsonl' }, DEMO_BASE), '/runs/eval/a%20b.jsonl');
  assert.equal(pathOf({ file: 'https://example.org/x.jsonl' }, DEMO_BASE), 'https://example.org/x.jsonl');
  const far = { recordings: [rec('telephone-20-en-s5', 'telephone-20', 'en', { file: 'https://example.org/t.jsonl' })] };
  assert.equal(parseParams(entriesOf(far, 'en', BASE)[0].query).log, 'https://example.org/t.jsonl');
});

test('the village behind: the tour recording, else one of the language, else any', () => {
  assert.equal(backgroundOf(SAMPLES, 'es', BASE).path, '/runs/samples/party-100-es-s2.jsonl');
  assert.equal(backgroundOf(DEMO, 'en', DEMO_BASE).path, '/runs/demo/party-100-en-ft.jsonl');
  const tel = { recordings: [rec('telephone-20-en-s5', 'telephone-20', 'en')] };
  assert.equal(backgroundOf(tel, 'en', BASE).recording.id, 'telephone-20-en-s5');
  assert.equal(backgroundOf(tel, 'es', BASE).recording.id, 'telephone-20-en-s5');
  assert.equal(backgroundOf({ recordings: [] }, 'es', BASE), null);
  assert.equal(backgroundOf(null, 'es', BASE), null);
});

test('who decides: rules without a model, the model and whether it is fine-tuned', () => {
  assert.deepEqual(deciderOf(SAMPLES.recordings[0]), { kind: 'rules' });
  assert.deepEqual(deciderOf(DEMO.recordings[1]), { kind: 'model', model: 'gemma-4-e4b', finetuned: false });
  assert.deepEqual(deciderOf(DEMO.recordings[2]), { kind: 'model', model: 'gemma-4-e4b', finetuned: true });
});

test('the engine serves the viewer at "/"; the repo server at /viewer/', () => {
  assert.ok(servedByEngine('/'));
  assert.ok(servedByEngine('/index.html'));
  assert.ok(!servedByEngine('/viewer/'));
  assert.ok(!servedByEngine('/viewer/index.html'));
});
