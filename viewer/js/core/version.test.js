import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionOf } from './version.js';
import { FIXTURE, loadStore } from './testing.js';

// Reach of the fact, from `scripts/rumor.sh metrics <log>` ("reach"), run on
// the logs as they are in the repo (phase 3, package 0):
//   final   {informed, correct, incomplete, wrong} at the end
//   points  [tick, informed, correct] from reach.timeline; the engine takes the
//           sample of tick T before the first event after T: the state at T
const REACH = {
  'runs/samples/party-100-es-s2.jsonl': {
    final: [50, 30, 12, 8],
    points: [
      [600, 8, 6],
      [900, 23, 16],
      [1200, 49, 31],
      [1380, 50, 31],
    ],
  },
  'runs/samples/party-25-en-s4.jsonl': {
    final: [21, 6, 6, 9],
    points: [
      [600, 9, 6],
      [900, 17, 5],
      [1140, 21, 9],
    ],
  },
  'runs/samples/telephone-20-en-s5.jsonl': {
    final: [20, 0, 10, 10],
    points: [
      [690, 4, 0],
      [1050, 12, 0],
      [1260, 19, 0],
    ],
  },
  'runs/samples/telephone-20-es-s5.jsonl': {
    final: [20, 0, 10, 10],
    points: [
      [690, 4, 0],
      [1050, 12, 0],
      [1260, 19, 0],
    ],
  },
  [FIXTURE]: {
    final: [5, 1, 2, 2],
    points: [
      [1230, 4, 1],
      [1260, 5, 1],
    ],
  },
};

function reach(store) {
  const fact = store.firstFact;
  const original = store.state.facts.get(fact)?.slots;
  const count = { informed: 0, correct: 0, incomplete: 0, wrong: 0 };
  for (const n of store.state.neighbors.values()) {
    const v = versionOf(n.memory[fact], original);
    if (v === null) continue;
    count.informed++;
    count[v]++;
  }
  return count;
}

for (const [rel, want] of Object.entries(REACH)) {
  test(`versions of ${rel} match the engine's reach`, () => {
    const store = loadStore(rel);
    const [informed, correct, incomplete, wrong] = want.final;
    assert.deepEqual(reach(store), { informed, correct, incomplete, wrong });
    for (const [tick, inf, corr] of want.points) {
      store.seek(tick);
      const r = reach(store);
      assert.deepEqual([tick, r.informed, r.correct], [tick, inf, corr]);
    }
  });
}

test('versionOf follows version_of of the engine', () => {
  const original = { who: 'n006', where: 'p01', when: 44, amount: 50 };
  const sure = (value) => ({ state: 'sure', value });
  assert.equal(versionOf(undefined, original), null);
  assert.equal(versionOf({}, original), 'incomplete');
  const all = { who: sure('n006'), where: sure('p01'), when: sure(44), amount: sure(50) };
  assert.equal(versionOf(all, original), 'correct');
  assert.equal(versionOf({ ...all, when: { state: 'doubt', value: 44 } }, original), 'correct');
  assert.equal(versionOf({ ...all, when: { state: 'doubt', value: 46 } }, original), 'wrong');
  assert.equal(versionOf({ ...all, when: { state: 'forgotten', value: null } }, original), 'incomplete');
  // A held value where the original has none is wrong too.
  assert.equal(versionOf({ ...all, amount: sure(3) }, { ...original, amount: null }), 'wrong');
  // Wrong wins over incomplete.
  assert.equal(versionOf({ who: sure('n001') }, original), 'wrong');
});
