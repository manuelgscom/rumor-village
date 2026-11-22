// Scoreboard of one recording up to a position, with the engine's definitions
// (engine/src/metrics/metrics.cpp). No DOM here.
//
//   decisions      `turn` and `plan` events, all of them (count_decision)
//   rejected       those with reject !== null (count_decision)
//   contradictions slots with verdict `contradiction` ┐ in turns and plans not
//   invented       slots with verdict `invented`      ├ rejected and with a
//   hardened       slots with verdict `hardened_doubt`┘ claim (count_claim)
//   maxTurns       `conv_end` with reason `max_turns` (courtesy.max_turns)
//
// `total` stays the failures of phase 6: contradictions + invented.

/** Keys of the scoreboard, in display order. */
export const SCORE_KEYS = ['decisions', 'maxTurns', 'rejected', 'invented', 'contradictions', 'hardened'];

const VERDICTS = { contradiction: 'contradictions', invented: 'invented', hardened_doubt: 'hardened' };

/**
 * Precomputes running sums by event position.
 * @param {object[]} events the events of the recording, in log order
 * @returns {{at: (count: number) => {contradictions: number, invented: number, total: number, decisions: number, rejected: number, hardened: number, maxTurns: number}}}
 *   count: number of events applied (store.index, or store.countUntil(Math.floor(pos)))
 */
export function createFails(events) {
  const n = events.length;
  const sums = Object.fromEntries(SCORE_KEYS.map((k) => [k, new Int32Array(n + 1)]));
  for (let i = 0; i < n; i++) {
    const e = events[i];
    const add = Object.fromEntries(SCORE_KEYS.map((k) => [k, 0]));
    if (e.type === 'turn' || e.type === 'plan') {
      add.decisions = 1;
      if (e.reject !== null && e.reject !== undefined) add.rejected = 1;
      else if (e.claim && e.verdict) {
        for (const v of Object.values(e.verdict)) if (VERDICTS[v]) add[VERDICTS[v]]++;
      }
    } else if (e.type === 'conv_end' && e.reason === 'max_turns') {
      add.maxTurns = 1;
    }
    for (const k of SCORE_KEYS) sums[k][i + 1] = sums[k][i] + add[k];
  }
  return {
    at(count) {
      const k = Math.max(0, Math.min(n, Math.floor(Number(count) || 0)));
      const out = Object.fromEntries(SCORE_KEYS.map((key) => [key, sums[key][k]]));
      out.total = out.contradictions + out.invented;
      return out;
    },
  };
}

/**
 * Bars of the two sides, each figure over the larger of the two, so the
 * lengths compare across the screen.
 * @param {ReturnType<ReturnType<typeof createFails>['at']>[]} sides
 * @returns {{key: string, n: number, share: number}[][]} share in [0, 1]
 */
export function scoreBars(sides) {
  return sides.map((f) =>
    SCORE_KEYS.map((key) => {
      const max = Math.max(...sides.map((x) => x[key]));
      return { key, n: f[key], share: max > 0 ? f[key] / max : 0 };
    }),
  );
}
