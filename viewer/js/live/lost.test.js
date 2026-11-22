import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectRestart, watchLost } from './lost.js';

function fakeStatus(value) {
  const fns = new Set();
  return {
    get value() {
      return value;
    },
    set(v) {
      value = v;
      for (const fn of fns) fn(v);
    },
    on(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}

function fakeTimers() {
  const list = new Map();
  let n = 0;
  return {
    setTimer: (fn) => (list.set(++n, fn), n),
    clearTimer: (k) => list.delete(k),
    fire: () => {
      const fns = [...list.values()];
      list.clear();
      for (const fn of fns) fn();
    },
    get size() {
      return list.size;
    },
  };
}

test('watchLost: down for a while shows the card; back, it goes', () => {
  const status = fakeStatus('connecting');
  const timers = fakeTimers();
  const log = [];
  watchLost(status, { show: () => log.push('show'), hide: () => log.push('hide'), ...timers });
  assert.equal(timers.size, 1);
  timers.fire();
  assert.deepEqual(log, ['show']);
  status.set('reconnecting');
  assert.equal(timers.size, 0, 'shown: no second timer');
  status.set('connected');
  assert.deepEqual(log, ['show', 'hide']);
  status.set('reconnecting');
  timers.fire();
  assert.deepEqual(log, ['show', 'hide', 'show']);
});

test('watchLost: a short drop says nothing; an ended game never shows it', () => {
  const status = fakeStatus('connected');
  const timers = fakeTimers();
  const log = [];
  const stop = watchLost(status, { show: () => log.push('show'), hide: () => log.push('hide'), ...timers });
  status.set('reconnecting');
  assert.equal(timers.size, 1);
  status.set('connected');
  assert.equal(timers.size, 0);
  status.set('ended');
  assert.equal(timers.size, 0);
  status.set('reconnecting');
  stop();
  assert.equal(timers.size, 0);
  assert.deepEqual(log, []);
});

test('watchLost: an expected restart («Activar Con IA») never shows the card; once over, it does', () => {
  const status = fakeStatus('connected');
  const timers = fakeTimers();
  const log = [];
  watchLost(status, { show: () => log.push('show'), hide: () => log.push('hide'), ...timers });
  expectRestart(true);
  try {
    status.set('reconnecting');
    timers.fire();
    timers.fire();
    assert.deepEqual(log, [], 'down while restarting: nothing');
    assert.equal(timers.size, 1, 'it keeps waiting');
    // The restart did not end well: the page stops expecting it, the card comes.
    expectRestart(false);
    timers.fire();
    assert.deepEqual(log, ['show']);
  } finally {
    expectRestart(false);
  }
});
