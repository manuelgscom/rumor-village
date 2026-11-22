// The live source with a fake EventSource driven by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveSource } from './source.js';
import { readRepoFile } from '../core/testing.js';

const lines = readRepoFile('runs/samples/party-25-en-s4.jsonl').split('\n').filter(Boolean);

function harness({ control = { tick: null } } = {}) {
  const made = [];
  class FakeES {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      made.push(this);
    }
    close() {
      this.readyState = 2;
    }
    // test helpers
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    send(id, data) {
      this.onmessage?.({ lastEventId: String(id), data });
    }
    fail(closed = false) {
      this.readyState = closed ? 2 : 0;
      this.onerror?.();
    }
  }
  const frames = [];
  const states = [];
  let reloads = 0;
  const status = { value: 'connecting', set: (v) => states.push((status.value = v)) };
  const source = liveSource(
    { live: true },
    {
      url: 'http://127.0.0.1:9/events',
      EventSource: FakeES,
      fetch: async () => ({ ok: true, json: async () => control }),
      reload: () => reloads++,
      schedule: (fn) => frames.push(fn),
      status,
      warn: () => {},
    },
  );
  const got = { header: null, batches: [] };
  const done = source.start(
    (h) => (got.header = h),
    (events) => got.batches.push(events),
  );
  const tick = async () => {
    await new Promise((ok) => setTimeout(ok, 0));
    while (frames.length) frames.shift()();
  };
  return { made, frames, states, got, done, tick, reloads: () => reloads, control };
}

test('kind and the header, then the events in batches', async () => {
  const h = harness();
  assert.equal(h.made.length, 1);
  assert.equal(h.made[0].url, 'http://127.0.0.1:9/events');
  const es = h.made[0];
  es.open();
  assert.deepEqual(h.states, ['connected']);
  es.send(1, lines[0]);
  assert.equal(h.got.header.scenario, 'party-25');
  for (let i = 1; i <= 50; i++) es.send(i + 1, lines[i]);
  await h.tick();
  assert.equal(h.got.batches.length, 1, 'one batch for many messages');
  assert.equal(h.got.batches[0].length, 50);
  es.send(52, lines[51]);
  es.send(53, lines[52]);
  await h.tick();
  assert.equal(h.got.batches.length, 2);
  assert.equal(h.got.batches[1].length, 2);
});

test('the first batch comes even when there is no event yet', async () => {
  const h = harness();
  h.made[0].open();
  h.made[0].send(1, lines[0]);
  await h.tick();
  assert.deepEqual(h.got.batches, [[]]);
});

test('reconnection: repeated lines are skipped, a clean restart is followed', async () => {
  const h = harness();
  const es = h.made[0];
  es.open();
  for (let i = 0; i < 20; i++) es.send(i + 1, lines[i]);
  await h.tick();
  es.fail();
  assert.equal(h.states.at(-1), 'reconnecting');
  es.open(); // the browser reconnected with Last-Event-ID
  await h.tick();
  assert.equal(h.states.at(-1), 'connected');
  es.send(19, lines[18]); // repeated
  es.send(20, lines[19]);
  es.send(21, lines[20]);
  await h.tick();
  const all = h.got.batches.flat();
  assert.equal(all.length, 20, '19 + 1 new');
  assert.equal(h.reloads(), 0);

  // Closed for good: a new EventSource after a pause, which gets line 1 again.
  es.fail(true);
  await new Promise((ok) => setTimeout(ok, 2100));
  assert.equal(h.made.length, 2);
  const es2 = h.made[1];
  es2.open();
  for (let i = 0; i < 25; i++) es2.send(i + 1, lines[i]);
  await h.tick();
  assert.equal(h.got.batches.flat().length, 24);
  assert.equal(h.reloads(), 0);
});

test('another run after reconnecting reloads the page', async () => {
  const other = readRepoFile('runs/samples/telephone-20-en-s5.jsonl').split('\n')[0];
  const h = harness();
  const es = h.made[0];
  es.open();
  for (let i = 0; i < 10; i++) es.send(i + 1, lines[i]);
  es.send(1, other);
  assert.equal(h.reloads(), 1);
  await h.done; // resolved: this page is going away
});

test('a restarted engine seen by its clock reloads the page', async () => {
  const h = harness({ control: { tick: 400 } });
  const es = h.made[0];
  es.open();
  for (let i = 0; i < 30; i++) es.send(i + 1, lines[i]);
  es.fail();
  es.open();
  await h.tick();
  assert.equal(h.reloads(), 1);
});

test('the end event: state ended, the promise resolves, the stream closes', async () => {
  const h = harness();
  const es = h.made[0];
  es.open();
  lines.forEach((l, i) => es.send(i + 1, l));
  await h.done;
  await h.tick();
  assert.equal(h.states.at(-1), 'ended');
  assert.equal(es.readyState, 2);
  assert.equal(h.got.batches.flat().length, lines.length - 1);
  assert.equal(h.got.batches.flat().at(-1).type, 'end');
});

test('a bad header rejects', async () => {
  const h = harness();
  h.made[0].open();
  h.made[0].send(1, '{"type":"header","format":2}');
  await assert.rejects(h.done, /format 2/);
});

test('another run further on, after reconnecting, is told by its run id', async () => {
  const h = harness({ control: { tick: 500, run: 'a1' } });
  const es = h.made[0];
  es.open();
  for (let i = 0; i < 30; i++) es.send(i + 1, lines[i]);
  await h.tick();
  h.control.run = 'b2';
  h.control.tick = 1439; // ahead of the page: the clock alone would not tell
  es.fail();
  es.open();
  // Lines of the other run, up to its end, before the check answers.
  for (let i = 30; i < lines.length; i++) es.send(i + 1, lines[i]);
  await h.done;
  await h.tick();
  assert.equal(h.reloads(), 1);
});

test('the same run after reconnecting does not reload, even after its end', async () => {
  const h = harness({ control: { tick: 500, run: 'a1' } });
  const es = h.made[0];
  es.open();
  for (let i = 0; i < 30; i++) es.send(i + 1, lines[i]);
  await h.tick();
  es.fail();
  es.open();
  h.control.tick = 1439;
  for (let i = 30; i < lines.length; i++) es.send(i + 1, lines[i]);
  await h.done;
  await h.tick();
  assert.equal(h.reloads(), 0);
});
