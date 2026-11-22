// The skeleton of the game package: its texts and the state client.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS } from './strings.js';
import { loadState, phaseOf, screenOf } from './state.js';

/** Every text of a strings tree, with its path. */
function texts(v, path = '', out = []) {
  if (typeof v === 'string') out.push([path, v]);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) texts(x, `${path}.${k}`, out);
  else out.push([path, v]);
  return out;
}

test('strings: es and en have the same keys, all non-empty text', () => {
  assert.deepEqual(texts(STRINGS.es).map(([p]) => p), texts(STRINGS.en).map(([p]) => p));
  for (const lang of ['es', 'en']) for (const [p, v] of texts(STRINGS[lang])) assert.ok(typeof v === 'string' && v.trim(), `${lang}${p}`);
});

test('screenOf: the engine first, then ?screen=, the resume hash, the draft', () => {
  assert.equal(screenOf({ state: 'playing' }, { screen: 'menu' }), 'playing');
  assert.equal(screenOf({ state: 'ended' }), 'ended');
  assert.equal(screenOf({ state: 'waiting' }, { screen: 'games', resume: 'prepare' }), 'games');
  assert.equal(screenOf({ state: 'waiting' }, { resume: 'menu', emptyDraft: false }), 'menu');
  assert.equal(screenOf({ state: 'waiting' }, { resume: 'nonsense', emptyDraft: false }), 'prepare');
  // Opening the game goes straight to the menu (phase 9-5); «Con IA y Sin IA» is ?screen=boot.
  assert.equal(screenOf({ state: 'waiting' }, { emptyDraft: true }), 'menu');
  assert.equal(screenOf({ state: 'waiting' }, { screen: 'boot' }), 'boot');
  assert.equal(phaseOf('boot'), 'boot');
  for (const s of ['menu', 'challenges', 'friend', 'games']) assert.equal(phaseOf(s), 'menu');
  for (const s of ['prepare', 'tutorial']) assert.equal(phaseOf(s), 'prepare');
  assert.equal(phaseOf('playing'), 'playing');
  assert.equal(phaseOf('ended'), 'ended');
});

test('loadState: a known state, an error status, an unknown body, a throw', async () => {
  const body = { state: 'waiting', run: 'r1', game: null };
  assert.deepEqual(await loadState({ state: async () => ({ ok: true, status: 200, body, error: null }) }), {
    ok: true,
    state: body,
    error: null,
  });
  const down = await loadState({ state: async () => ({ ok: false, status: 0, body: null, error: 'refused' }) });
  assert.deepEqual(down, { ok: false, state: null, error: 'refused' });
  const odd = await loadState({ state: async () => ({ ok: true, status: 200, body: { state: 'sleeping' }, error: null }) });
  assert.equal(odd.ok, false);
  const thrown = await loadState({
    state: async () => {
      throw new Error('boom');
    },
  });
  assert.deepEqual(thrown, { ok: false, state: null, error: 'boom' });
});
