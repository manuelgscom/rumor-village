// The line of the computer on the mode card (screens.js computerLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computerLine } from './screens.js';
import { STRINGS } from './strings.js';

for (const lang of ['es', 'en']) {
  const t = STRINGS[lang];
  const line = (check, aiAvailable = true) => computerLine({ t, aiAvailable, state: { check } });

  test(`computerLine (${lang}): «va lento» only when the advice is Sin IA`, () => {
    assert.equal(line({ state: 'done', decisions_per_s: 1.5, advice: 'rules' }), t.pcSlow);
    assert.equal(line({ state: 'done', decisions_per_s: 11.8, advice: 'neighbors25' }), t.pc25);
    assert.equal(line({ state: 'done', decisions_per_s: 13.6, advice: null }), t.pcFast);
    assert.equal(line({ state: 'running' }), t.pcChecking);
    assert.equal(line({ state: 'skipped' }, false), null);
    assert.notEqual(t.pc25, t.pcSlow);
  });
}
