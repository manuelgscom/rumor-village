import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewportSender, normalIds } from './throttle.js';

// A fake clock and timer.
function clock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const timer = { at: t + ms, fn };
      timers.push(timer);
      return timer;
    },
    async advance(ms) {
      t += ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > t) break;
        await timers.shift().fn();
      }
      await new Promise((ok) => setImmediate(ok));
    },
    pending: () => timers.length,
  };
}

test('normal form of a list', () => {
  assert.deepEqual(normalIds(['n003', 'n001', 'n003']), ['n001', 'n003']);
  assert.deepEqual(normalIds(null), []);
});

test('at most one send per interval, the newest list wins, repeats are dropped', async () => {
  const c = clock();
  const sent = [];
  const s = createViewportSender({ send: (ids) => (sent.push(ids), true), interval: 500, now: c.now, setTimer: c.setTimer });
  s.update(['n002', 'n001']);
  await c.advance(0);
  assert.deepEqual(sent, [['n001', 'n002']]);

  s.update(['n003']);
  s.update(['n004']);
  s.update(['n005', 'n004']);
  await c.advance(100);
  assert.equal(sent.length, 1, 'waits for the interval');
  await c.advance(400);
  assert.deepEqual(sent.at(-1), ['n004', 'n005']);
  assert.equal(sent.length, 2);

  s.update(['n005', 'n004', 'n004']); // the same list
  await c.advance(1000);
  assert.equal(sent.length, 2);
  assert.deepEqual(s.sent, ['n004', 'n005']);

  // After a quiet moment the next change goes at once.
  s.update([]);
  await c.advance(0);
  assert.deepEqual(sent.at(-1), []);
  assert.deepEqual(s.sent, []);
});

test('a burst of updates over two seconds sends about four times', async () => {
  const c = clock();
  let count = 0;
  const s = createViewportSender({ send: () => (count++, true), interval: 500, now: c.now, setTimer: c.setTimer });
  for (let i = 0; i < 120; i++) {
    s.update([`n${String(i).padStart(3, '0')}`]);
    await c.advance(16);
  }
  await c.advance(1000);
  assert.ok(count >= 4 && count <= 5, `sent ${count} times`);
});

test('going back to the list already sent cancels the pending send', async () => {
  const c = clock();
  const sent = [];
  const s = createViewportSender({ send: (ids) => (sent.push(ids), true), interval: 500, now: c.now, setTimer: c.setTimer });
  s.update(['n001']);
  await c.advance(0);
  s.update(['n002']);
  s.update(['n001']);
  await c.advance(600);
  assert.deepEqual(sent, [['n001']]);
});

test('a failed send is retried at the next update, not in a loop', async () => {
  const c = clock();
  let ok = false;
  const sent = [];
  const s = createViewportSender({ send: async (ids) => (sent.push(ids), ok), interval: 500, now: c.now, setTimer: c.setTimer });
  s.update(['n001']);
  await c.advance(0);
  await c.advance(5000);
  assert.equal(sent.length, 1);
  assert.equal(s.sent, null);
  ok = true;
  s.update(['n001']);
  await c.advance(0);
  assert.equal(sent.length, 2);
  assert.deepEqual(s.sent, ['n001']);
});
