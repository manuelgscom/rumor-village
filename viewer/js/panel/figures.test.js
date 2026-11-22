import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { FIXTURE, loadLog, loadStore, repoPath, SAMPLES } from '../core/testing.js';
import {
  addPerf,
  createPerfIndex,
  figuresAt,
  formatNumber,
  perfAt,
  sampleTickAt,
  samplesUntil,
  sparkPoints,
} from './figures.js';
import { addEvents, createBatchIndex } from './lanes.js';

const REAL = 'runs/phase2/gemma4-e4b/party-100-es/seed-1.jsonl';

function figures(store, perfIndex) {
  const batchIndex = createBatchIndex();
  addEvents(batchIndex, store.events);
  const { sample } = perfAt(store.state, perfIndex, batchIndex, store.pos);
  return figuresAt({ header: store.header, state: store.state, fact: store.firstFact, sample, perfIndex, live: false });
}

test('hand log: the figures are those of the last perf sample at each position', () => {
  const store = loadStore(FIXTURE);
  const ix = createPerfIndex();
  addPerf(ix, store.events);
  assert.deepEqual(ix.ticks, [1210, 1212, 1214, 1218, 1229, 1237]);
  const perfs = store.events.filter((e) => e.type === 'perf');

  for (const pos of [1210, 1210.5, 1211.5, 1212, 1213.9, 1214, 1217, 1218.2, 1228.99, 1229, 1236, 1237.5, 1440]) {
    store.seek(pos);
    const f = figures(store, ix);
    const last = perfs.filter((p) => p.tick <= Math.floor(pos)).at(-1);
    assert.equal(f.status, 'ok', `pos ${pos}`);
    assert.deepEqual(
      f.perf,
      {
        tick: last.tick,
        batch: last.batch,
        tokensPerS: last.tokens_per_s,
        decisionsPerS: last.decisions_per_s_milli / 1000,
        vramMb: last.vram_mb,
      },
      `pos ${pos}`,
    );
    assert.equal(samplesUntil(ix, Math.floor(pos)), perfs.indexOf(last) + 1);
  }
  store.seek(1211.5);
  assert.deepEqual(figures(store, ix).perf, { tick: 1210, batch: 3, tokensPerS: 214, decisionsPerS: 5.9, vramMb: 5230 });

  store.seek(1209.9);
  const before = figures(store, ix);
  assert.equal(before.status, 'pending');
  assert.equal(before.perf, null);
});

test('hand log: neighbors and informed of the chosen fact', () => {
  const store = loadStore(FIXTURE);
  const ix = createPerfIndex();
  addPerf(ix, store.events);
  const at = (pos) => {
    store.seek(pos);
    return figures(store, ix);
  };
  assert.equal(at(1205).neighbors, 7);
  assert.equal(at(1205).informed, null, 'not injected yet at this position');
  assert.equal(at(1210).informed, 1);
  assert.equal(at(1213).informed, 2);
  assert.equal(at(1217).informed, 3);
  assert.equal(at(1440).informed, 5);
  assert.equal(at(1440).fact, 'f1');
});

test('samples (baseline): the status says baseline instead of zeros', () => {
  for (const rel of SAMPLES) {
    const store = loadStore(rel);
    const ix = createPerfIndex();
    assert.equal(addPerf(ix, store.events), false);
    const f = figures(store, ix);
    assert.equal(f.status, 'baseline', rel);
    assert.equal(f.perf, null);
    assert.equal(f.neighbors, store.header.neighbors.length);
    assert.ok(f.informed > 0, `${rel}: someone knows the fact at the end`);
    assert.equal(f.informed, store.events.at(-1).informed, `${rel}: same as the end event`);
  }
});

test('a model recording without samples and a live run waiting for them', () => {
  const { header } = loadLog(FIXTURE);
  const state = { neighbors: new Map(), perf: null };
  const empty = createPerfIndex();
  assert.equal(figuresAt({ header, state, fact: null, sample: null, perfIndex: empty, live: false }).status, 'none');
  assert.equal(figuresAt({ header, state, fact: null, sample: null, perfIndex: empty, live: true }).status, 'pending');
});

test('series points and the nearest sample', () => {
  const store = loadStore(FIXTURE);
  const ix = createPerfIndex();
  addPerf(ix, store.events);
  assert.deepEqual(sparkPoints(ix, 0, 100, 30), []);
  const pts = sparkPoints(ix, 3, 100, 30, 0);
  assert.equal(pts.length, 3);
  assert.equal(pts[0].x, 0);
  assert.equal(pts[1].x, (2 / 27) * 100);
  assert.equal(pts[1].y, 0, '1212 has the max of the log');
  assert.ok(pts[1].y >= 0 && pts[0].y <= 30);
  const all = sparkPoints(ix, 99, 100, 30, 0);
  assert.equal(all.length, 6);
  assert.equal(all.at(-1).x, 100);
  assert.equal(Math.min(...all.map((p) => p.y)), 0, 'the max touches the top');
  assert.equal(sampleTickAt(ix, 0, 100, 0), 1210);
  assert.equal(sampleTickAt(ix, 100, 100, 0), 1237);
  assert.equal(sampleTickAt(ix, (7 / 27) * 100, 100, 0), 1218);
});

test('numbers in the language of the run', () => {
  assert.equal(formatNumber(5.9, 'es', 1), '5,9');
  assert.equal(formatNumber(5.9, 'en', 1), '5.9');
  assert.equal(formatNumber(214, 'es'), '214');
});

test('real run (if present locally): the sample of the batch run on screen', { skip: !existsSync(repoPath(REAL)) }, () => {
  const store = loadStore(REAL);
  const perfIndex = createPerfIndex();
  addPerf(perfIndex, store.events);
  const batchIndex = createBatchIndex();
  addEvents(batchIndex, store.events);
  assert.equal(perfIndex.ticks.length, 899);
  // Tick 1117 has two runs: 16 sequences from t0 363615, then 3 from 364646.
  const at = (pos) => {
    store.seek(pos);
    return perfAt(store.state, perfIndex, batchIndex, pos);
  };
  const first = at(1117.4);
  assert.equal(first.sample.batch, 16);
  assert.equal(first.count, samplesUntil(perfIndex, 1117) - 1);
  const second = at(1117.95);
  assert.equal(second.sample.batch, 3);
  assert.equal(second.sample, store.state.perf, 'the last run is the last sample of the tick');
  assert.equal(second.count, samplesUntil(perfIndex, 1117));
  // A tick with a single sample: always the state one.
  assert.equal(at(1116.2).sample, store.state.perf);
});
