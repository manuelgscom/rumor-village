import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusOf, spacePauses } from './keys.js';

test('space pauses on the map, the page and the bar', () => {
  assert.equal(spacePauses(null), true);
  assert.equal(spacePauses({ tag: 'BODY' }), true);
  assert.equal(spacePauses({ tag: 'CANVAS' }), true);
  assert.equal(spacePauses({ tag: 'DIV', role: 'slider', inBar: true }), true);
  assert.equal(spacePauses({ tag: 'BUTTON', inBar: true }), true);
  assert.equal(spacePauses({ tag: 'DIV', role: 'region' }), true);
  assert.equal(spacePauses({ tag: 'A' }), true); // no href: not a link
});

test('space keeps its meaning on any other control', () => {
  assert.equal(spacePauses({ tag: 'BUTTON' }), false);
  assert.equal(spacePauses({ tag: 'button' }), false);
  assert.equal(spacePauses({ tag: 'SUMMARY' }), false);
  assert.equal(spacePauses({ tag: 'A', href: true }), false);
  assert.equal(spacePauses({ tag: 'DIV', role: 'button' }), false);
  assert.equal(spacePauses({ tag: 'SPAN', role: 'checkbox' }), false);
  assert.equal(spacePauses({ tag: 'SELECT' }), false);
});

test('never while typing, not even in the bar', () => {
  assert.equal(spacePauses({ tag: 'INPUT', inBar: true }), false);
  assert.equal(spacePauses({ tag: 'TEXTAREA' }), false);
  assert.equal(spacePauses({ tag: 'DIV', editable: true, inBar: true }), false);
});

test('focusOf reads an element', () => {
  assert.equal(focusOf(null), null);
  const attrs = { role: 'button' };
  const fake = {
    tagName: 'DIV',
    isContentEditable: false,
    getAttribute: (k) => attrs[k] ?? null,
    hasAttribute: (k) => k in attrs,
    closest: (sel) => (sel === '.rp' ? {} : null),
  };
  assert.deepEqual(focusOf(fake), { tag: 'DIV', role: 'button', href: false, editable: false, inBar: true });
  assert.equal(spacePauses(focusOf(fake)), true);
});
