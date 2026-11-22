// Figures panel logic (no DOM): the neighbors, how many know the chosen fact,
// and the last `perf` sample at the playback position, plus the tokens/s
// series of the samples up to there. Every figure comes from the log; when
// there is no sample the status says why instead of showing zeros.
//
// A tick can hold several samples, one per batch run (wave): the engine writes
// one `perf` per run, and the generations of a run share their t0. When the
// count of samples of the tick equals its count of distinct t0, the panel
// shows the sample of the run on screen at the batch clock (lanes.js), so the
// batch size agrees with the lanes; otherwise the last one of the tick.

import { informed } from '../core/version.js';
import { batchClock, lastAtMost } from './lanes.js';

/**
 * @typedef {object} PerfIndex
 * @property {number[]} ticks tick of each `perf` sample, in log order
 * @property {number[]} tokens tokens_per_s of each sample
 * @property {object[]} events the `perf` events
 * @property {number} max largest tokens_per_s
 */

/** @returns {PerfIndex} an empty index */
export function createPerfIndex() {
  return { ticks: [], tokens: [], events: [], max: 0 };
}

/**
 * Adds the `perf` events of events[from..to) (incrementally).
 * @param {PerfIndex} ix
 * @param {object[]} events
 * @param {number} [from]
 * @param {number} [to]
 * @returns {boolean} whether any sample was added
 */
export function addPerf(ix, events, from = 0, to = events.length) {
  let added = false;
  for (let i = from; i < to; i++) {
    const e = events[i];
    if (e.type !== 'perf') continue;
    ix.ticks.push(e.tick);
    ix.tokens.push(e.tokens_per_s);
    ix.events.push(e);
    if (e.tokens_per_s > ix.max) ix.max = e.tokens_per_s;
    added = true;
  }
  return added;
}

/**
 * Number of samples with tick <= tick (events are in tick order).
 * @param {PerfIndex} ix
 * @param {number} tick
 * @returns {number}
 */
export function samplesUntil(ix, tick) {
  let lo = 0;
  let hi = ix.ticks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ix.ticks[mid] <= tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The `perf` sample shown at a position, and how many samples of the series
 * are drawn up to it.
 * @param {import('../core/reduce.js').State} state its `perf` is the last sample of the tick
 * @param {PerfIndex} ix
 * @param {import('./lanes.js').BatchIndex} batchIndex
 * @param {number} pos ticks with decimals
 * @returns {{sample: object|null, count: number}}
 */
export function perfAt(state, ix, batchIndex, pos) {
  const tick = Math.floor(pos);
  const end = samplesUntil(ix, tick);
  const last = { sample: state.perf ?? null, count: end };
  if (!state.perf || state.perf.tick !== tick) return last;
  let start = end;
  while (start > 0 && ix.ticks[start - 1] === tick) start--;
  const entry = batchIndex.byTick.get(tick);
  if (end - start < 2 || !entry) return last;
  const starts = [...new Set(entry.items.map((it) => it.t0))].sort((a, b) => a - b);
  if (starts.length !== end - start) return last;
  const wave = Math.max(0, lastAtMost(starts, batchClock(batchIndex, pos)));
  return { sample: ix.events[start + wave], count: start + wave + 1 };
}

/**
 * @typedef {object} Figures
 * @property {number} neighbors neighbors of the header
 * @property {string|null} fact chosen fact id
 * @property {number|null} informed neighbors who know it (null without a fact or
 *   before its inject)
 * @property {'ok'|'baseline'|'none'|'pending'} status ok: there is a sample at this
 *   position; baseline: the run has no model; none: a recording without any sample;
 *   pending: no sample yet at this position
 * @property {{tick: number, batch: number, tokensPerS: number, decisionsPerS: number, vramMb: number}|null} perf
 */

/**
 * The figures at the current state.
 * @param {object} args
 * @param {object} args.header
 * @param {import('../core/reduce.js').State} args.state
 * @param {string|null} args.fact the chosen fact (app.factId())
 * @param {object|null} args.sample the `perf` sample to show (perfAt)
 * @param {PerfIndex} args.perfIndex samples seen so far
 * @param {boolean} args.live
 * @returns {Figures}
 */
export function figuresAt({ header, state, fact, sample, perfIndex, live }) {
  // Null until the fact is injected at this position: rewinding before the
  // inject shows no fact rather than "0 of a fact nobody has heard yet".
  let count = null;
  if (fact && state.facts?.has(fact)) {
    count = 0;
    for (const n of state.neighbors.values()) if (informed(n, fact)) count++;
  }
  const p = sample ?? null;
  let status = 'pending';
  if (p) status = 'ok';
  else if (header.policy === 'baseline') status = 'baseline';
  else if (!live && perfIndex.ticks.length === 0) status = 'none';
  return {
    neighbors: (header.neighbors ?? []).length,
    fact: fact ?? null,
    informed: count,
    status,
    perf: p
      ? {
          tick: p.tick,
          batch: p.batch,
          tokensPerS: p.tokens_per_s,
          decisionsPerS: p.decisions_per_s_milli / 1000,
          vramMb: p.vram_mb,
        }
      : null,
  };
}

/**
 * Points of the tokens/s series up to sample `count` (exclusive), in a box of
 * w x h. The x axis spans from the first to the last sample of the whole log
 * and the y axis from 0 to the largest value, so the scale does not move while
 * playing.
 * @param {PerfIndex} ix
 * @param {number} count samples to draw (samplesUntil)
 * @param {number} w
 * @param {number} h
 * @param {number} [pad] margin inside the box
 * @returns {{x: number, y: number, tick: number}[]}
 */
export function sparkPoints(ix, count, w, h, pad = 3) {
  const n = Math.min(count, ix.ticks.length);
  if (!n) return [];
  const first = ix.ticks[0];
  const span = Math.max(1, ix.ticks[ix.ticks.length - 1] - first);
  const top = Math.max(1, ix.max);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      x: pad + ((ix.ticks[i] - first) / span) * (w - 2 * pad),
      y: h - pad - (ix.tokens[i] / top) * (h - 2 * pad),
      tick: ix.ticks[i],
    };
  }
  return out;
}

/**
 * Tick of the sample nearest to an x coordinate of the series box.
 * @param {PerfIndex} ix
 * @param {number} x
 * @param {number} w
 * @param {number} [pad]
 * @returns {number|null}
 */
export function sampleTickAt(ix, x, w, pad = 3) {
  if (!ix.ticks.length) return null;
  const first = ix.ticks[0];
  const span = Math.max(1, ix.ticks[ix.ticks.length - 1] - first);
  const tick = first + ((x - pad) / Math.max(1, w - 2 * pad)) * span;
  const i = samplesUntil(ix, tick);
  const a = ix.ticks[Math.max(0, i - 1)];
  const b = ix.ticks[Math.min(ix.ticks.length - 1, i)];
  return Math.abs(tick - a) <= Math.abs(b - tick) ? a : b;
}

/**
 * Formats a number in the language of the run ("5,9" in es, "5.9" in en).
 * @param {number} value
 * @param {string} lang
 * @param {number} [digits] decimals
 * @returns {string}
 */
export function formatNumber(value, lang, digits = 0) {
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
