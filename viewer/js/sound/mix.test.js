import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, SAMPLES } from '../core/testing.js';
import { hitKind, hitsBetween, MAX_HITS_PER_SECOND, MAX_STEP_SECONDS, mixAt, openConversations } from './mix.js';

const PARTY = SAMPLES[0];

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const tell = (tick, verdict, extra = {}) => ({
  type: 'turn',
  tick,
  action: 'say',
  act: 'tell',
  fact: 'f1',
  reject: null,
  verdict,
  ...extra,
});
const FAITHFUL = { who: 'faithful', where: 'faithful', when: 'faithful', amount: 'faithful' };

test('mixAt is pure: same input, same output, events untouched', () => {
  const store = loadStore(PARTY);
  const events = deepFreeze(store.events.slice());
  const tick = events.find((e) => e.type === 'arrive').tick;
  store.seek(tick + 0.5);
  const a = mixAt(events, store.index, store.pos, 60);
  const b = mixAt(events, store.index, store.pos, 60);
  assert.deepEqual(a, b);
  assert.ok(a.murmur >= 0 && a.murmur <= 1);
  assert.ok(a.hits.length > 0, 'arrivals sound at the party');
  assert.equal(JSON.stringify(Object.keys(a).sort()), JSON.stringify(['hits', 'murmur']));
});

test('the murmur follows the open conversations', () => {
  const events = [
    { type: 'conv_start', tick: 10, conv: 'c1' },
    { type: 'conv_start', tick: 11, conv: 'c2' },
    { type: 'conv_start', tick: 11, conv: 'c3' },
    { type: 'conv_end', tick: 13, conv: 'c2' },
    { type: 'conv_end', tick: 15, conv: 'c1' },
    { type: 'conv_end', tick: 15, conv: 'c3' },
  ];
  const at = (pos) => mixAt(events, events.filter((e) => e.tick <= Math.floor(pos)).length, pos, 2).murmur;
  assert.equal(at(9), 0);
  assert.ok(at(10.5) > 0);
  assert.ok(at(11.5) > at(10.5), 'more open, louder');
  assert.ok(at(13.2) < at(11.5), 'one ended, softer');
  assert.equal(at(15), 0, 'all ended');
  assert.equal(openConversations(events, 3), 3);
});

test('on the party sample the murmur rises and falls with the conversations', () => {
  const store = loadStore(PARTY);
  const ev = store.events;
  let max = 0;
  for (let i = 0; i <= ev.length; i += 97) max = Math.max(max, openConversations(ev, i));
  assert.ok(max > 0);
  assert.equal(openConversations(ev, 0), 0);
  assert.ok(mixAt(ev, 0, store.header.start_tick, 2).murmur === 0);
});

test('tells: faithful or changed by the verdict; rejected and other acts are silent', () => {
  assert.equal(hitKind(tell(1, FAITHFUL)), 'faithful');
  assert.equal(hitKind(tell(1, { ...FAITHFUL, when: 'contradiction' })), 'changed');
  assert.equal(hitKind(tell(1, { ...FAITHFUL, amount: 'omitted' })), 'changed');
  assert.equal(hitKind(tell(1, { ...FAITHFUL, where: 'declared_guess' })), 'changed');
  assert.equal(hitKind(tell(1, FAITHFUL, { reject: 'malformed' })), null);
  assert.equal(hitKind(tell(1, FAITHFUL, { act: 'greet', fact: null })), null);
  assert.equal(hitKind({ type: 'arrive', tick: 1 }), 'arrive');
  assert.equal(hitKind({ type: 'move', tick: 1 }), null);
});

test('a tap sounds once whatever the frames, at slow speed every one', () => {
  const events = [tell(10, FAITHFUL), tell(10, { ...FAITHFUL, who: 'invented' }), { type: 'arrive', tick: 11 }];
  // A step of playback is at most max(1 tick, half a second): two steps here.
  const all = [...hitsBetween(events, 9.9, 10.9, 2, 6), ...hitsBetween(events, 10.9, 11.5, 2, 6)];
  assert.deepEqual(
    all.map((h) => h.kind),
    ['faithful', 'changed', 'arrive'],
  );
  // The same stretch in small frames gives the same taps.
  const steps = [];
  for (let p = 9.9; p < 11.5 - 1e-9; p += 1 / 30) steps.push(...hitsBetween(events, p, Math.min(11.5, p + 1 / 30), 2, 6));
  assert.deepEqual(steps, all);
});

test('at high speed the cap per real second holds', () => {
  const store = loadStore(PARTY);
  const ev = store.events;
  const speed = 60;
  const fps = 60;
  const start = ev[0].tick;
  const end = ev[ev.length - 1].tick;
  const played = [];
  for (let p = start; p < end; p += speed / fps) played.push(...hitsBetween(ev, p, p + speed / fps, speed));
  assert.ok(played.length > 0);
  // Every window of one real second (speed ticks) holds at most the cap (+1 for the edge).
  for (let i = 0; i < played.length; i++) {
    let n = 0;
    for (let j = i; j < played.length && played[j].at < played[i].at + speed; j++) n++;
    assert.ok(n <= MAX_HITS_PER_SECOND + 1, `${n} taps in one second from tick ${played[i].tick}`);
  }
  // Without a cap there would be many more: the cap does something here.
  let raw = 0;
  for (const e of ev) if (hitKind(e)) raw++;
  assert.ok(played.length < raw);
});

test('the cap keeps the changed tap over the others in its slot', () => {
  const events = [{ type: 'arrive', tick: 20 }, tell(21, FAITHFUL), tell(22, { ...FAITHFUL, when: 'contradiction' }), { type: 'arrive', tick: 23 }];
  const hits = hitsBetween(events, 19.5, 25, 60, 6); // one slot = 10 ticks
  assert.deepEqual(
    hits.map((h) => h.kind),
    ['changed'],
  );
});

test('going backwards or jumping far lets loose no avalanche', () => {
  const store = loadStore(PARTY);
  const ev = store.events;
  const start = ev[0].tick;
  const end = ev[ev.length - 1].tick;
  assert.deepEqual(hitsBetween(ev, end, start, 2), [], 'backwards');
  assert.deepEqual(hitsBetween(ev, start, end, 60), [], 'far forwards');
  assert.deepEqual(hitsBetween(ev, 1200, 1200, 2), [], 'standing still');
  // The longest step that still plays stays under the cap.
  for (const speed of [2, 8, 60]) {
    const step = Math.max(1, speed * MAX_STEP_SECONDS);
    for (let p = start; p < end; p += step) {
      const n = hitsBetween(ev, p, p + step, speed).length;
      assert.ok(n <= Math.ceil((step / speed) * MAX_HITS_PER_SECOND) + 1, `${n} taps in one step at ${speed} t/s`);
    }
  }
});
