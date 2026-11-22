// Quality levels of the 3D scene (fase 8-2). Pure: no DOM, no three.
//
//   app.quality = {tier, auto, set(tier), on(fn(tier))}
//
// The URL picks the level with `q` (auto, high, mid, low). With `auto` the
// scene starts at `high` and scene/quality.js steps it down when frames are
// slow; it never steps up by itself, so it does not oscillate. In a capture
// (isCapture) `auto` stays at `high`, so two captures of a URL are equal.
// `fx=0` keeps working: the scene then draws as `low` whatever the tier.

/** What each level turns on. Starting values; package A tunes them with measurements. */
export const TIERS = {
  high: { dprCap: 2, samples: 4, bloom: true, ao: true, shadowMap: 2048, life: true },
  mid: { dprCap: 1.5, samples: 2, bloom: true, ao: false, shadowMap: 2048, life: true },
  low: { dprCap: 1, samples: 0, bloom: false, ao: false, shadowMap: 1024, life: false },
};

/** From best to worst. */
export const TIER_ORDER = ['high', 'mid', 'low'];

/**
 * The level one step below, or null at the bottom.
 * @param {string} tier
 * @returns {string|null}
 */
export function lowerTier(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}

/**
 * Creates the quality state from the URL parameter.
 * @param {'auto'|'high'|'mid'|'low'} q
 * @param {boolean} capture  a capture: auto stays at high
 */
export function createQuality(q = 'auto', capture = false) {
  let tier = q === 'auto' ? 'high' : q;
  const auto = q === 'auto' && !capture;
  const fns = [];
  return {
    /** Current level: 'high', 'mid' or 'low'. */
    get tier() {
      return tier;
    },
    /** Whether the scene may step the level down by itself. */
    auto,
    /** What the current level turns on (TIERS). */
    get spec() {
      return TIERS[tier];
    },
    set(t) {
      if (!TIERS[t] || t === tier) return;
      tier = t;
      for (const fn of fns) fn(tier);
    },
    on(fn) {
      fns.push(fn);
    },
  };
}
