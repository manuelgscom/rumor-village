// Adaptive quality of the 3D scene (fase 8-2, 2.1). Pure: no DOM, no three.
//
//   frame ms ──► push(ms) ──► [window of the last N frames] ──► median > budget?
//                                                                   │ yes
//                                    null ◄── no ───────────────────┤
//                          lower tier ◄─────────────────────────────┘
//                          (then wait `cooldown` frames, window emptied)
//
// It only steps down, never up, so it does not oscillate; at 'low' it stops.
// scene/index.js feeds it only when app.quality.auto (never in a capture).

import { lowerTier } from '../core/quality.js';

/**
 * The p-th percentile (0..1) of some numbers: the value at floor(n·p) once
 * sorted (the upper middle for the median of an even count). NaN when empty.
 * @param {number[]} values
 * @param {number} p
 */
export function percentile(values, p) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
}

/**
 * @param {object} [opt]
 * @param {number} [opt.budgetMs]  median frame time above which the tier drops
 * @param {number} [opt.window]    frames in the median
 * @param {number} [opt.cooldown]  frames ignored at the start and after each change
 * @param {string} [opt.tier]      starting tier
 */
export function createGovernor({ budgetMs = 24, window = 60, cooldown = 90, tier = 'high' } = {}) {
  let current = tier;
  let wait = cooldown;
  const samples = [];
  return {
    /** Tier the governor believes is on. */
    get tier() {
      return current;
    },
    /**
     * One frame time; returns the new tier when it steps down, else null.
     * @param {number} ms
     * @returns {string|null}
     */
    push(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return null;
      const next = lowerTier(current);
      if (!next) return null;
      if (wait > 0) {
        wait--;
        return null;
      }
      samples.push(ms);
      if (samples.length > window) samples.shift();
      if (samples.length < window || percentile(samples, 0.5) <= budgetMs) return null;
      current = next;
      samples.length = 0;
      wait = cooldown;
      return current;
    },
  };
}
