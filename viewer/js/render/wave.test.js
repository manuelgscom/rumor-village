import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE, loadStore } from '../core/testing.js';
import { recentTells, WAVE_TICKS } from './wave.js';

test('a wave lives WAVE_TICKS ticks after a tell, growing with pos', () => {
  const store = loadStore(FIXTURE, 1200);
  const tell = store.events.find((e) => e.type === 'turn' && e.act === 'tell' && e.reject === null);
  store.seek(tell.tick + 0.5);
  const early = recentTells(store.events, store.index, store.pos).find((w) => w.tick === tell.tick && w.listener === tell.to);
  assert.ok(early);
  assert.equal(early.speaker, tell.who);
  assert.equal(early.age, 0.5 / WAVE_TICKS);
  store.seek(tell.tick + 2);
  const later = recentTells(store.events, store.index, store.pos).find((w) => w.tick === tell.tick && w.listener === tell.to);
  assert.ok(later.age > early.age);
  store.seek(tell.tick + WAVE_TICKS + 0.01);
  assert.ok(!recentTells(store.events, store.index, store.pos).some((w) => w.tick === tell.tick));
  store.seek(tell.tick - 0.5);
  assert.ok(!recentTells(store.events, store.index, store.pos).some((w) => w.tick === tell.tick), 'not before the turn');
});

test('rejected turns and other acts make no wave', () => {
  const events = [
    { type: 'turn', tick: 10, act: 'greet', action: 'say', reject: null, fact: null, who: 'a', to: 'b' },
    { type: 'turn', tick: 10, act: null, action: 'none', reject: 'malformed', fact: null, who: 'a', to: 'b' },
    { type: 'turn', tick: 11, act: 'tell', action: 'say', reject: null, fact: 'f1', who: 'a', to: 'b' },
  ];
  const waves = recentTells(events, events.length, 11.5);
  assert.equal(waves.length, 1);
  assert.equal(waves[0].listener, 'b');
});
