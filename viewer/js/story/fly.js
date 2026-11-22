// Smooth camera flights (pure math, no DOM). A flight goes from one view
// {x, y, scale} to another in a time that grows with the distance; x and y
// ease in and out, the scale moves in log space and, on long hops, dips out
// so the village stays readable on the way (a "hop" rather than a pan).
//
//   scale │ start            end
//         │   ●╲            ╱●
//         │      ╲________╱      ← dip when the hop is long
//         └──────────────────── t

/** Shortest and longest flight, in ms. */
export const FLY_MS = [900, 2200];

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Length of a hop in screen widths at the smaller of both scales.
 * @param {{x: number, y: number, scale: number}} a
 * @param {{x: number, y: number, scale: number}} b
 * @param {number} w canvas width (CSS px)
 */
export function hopLength(a, b, w) {
  return (Math.hypot(b.x - a.x, b.y - a.y) * Math.min(a.scale, b.scale)) / Math.max(1, w);
}

/**
 * Duration of a flight, in ms.
 * @param {{x: number, y: number, scale: number}} a
 * @param {{x: number, y: number, scale: number}} b
 * @param {number} w
 */
export function flightMs(a, b, w) {
  const hop = hopLength(a, b, w);
  const zoom = Math.abs(Math.log(b.scale / a.scale));
  const t = Math.min(1, Math.max(hop / 3, zoom / 2.5));
  return FLY_MS[0] + (FLY_MS[1] - FLY_MS[0]) * t;
}

/**
 * View at fraction t (0..1) of the flight from a to b.
 * @param {{x: number, y: number, scale: number}} a
 * @param {{x: number, y: number, scale: number}} b
 * @param {number} t
 * @param {number} w canvas width (CSS px)
 * @returns {{x: number, y: number, scale: number}}
 */
export function flightAt(a, b, t, w) {
  const k = Math.min(1, Math.max(0, t));
  const e = smooth(k);
  // Zoom out on the way by up to ~e^1.2 when the hop is more than a screen.
  const dip = Math.min(1.2, Math.max(0, Math.log(hopLength(a, b, w) / 0.8)));
  const ls = Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * e - dip * Math.sin(Math.PI * k);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, scale: Math.exp(ls) };
}

/**
 * One step of following a moving target after the flight: exponential
 * approach with time constant tauMs.
 * @param {{x: number, y: number, scale: number}} cur
 * @param {{x: number, y: number, scale: number}} target
 * @param {number} dtMs
 * @param {number} [tauMs]
 * @returns {{x: number, y: number, scale: number}}
 */
export function follow(cur, target, dtMs, tauMs = 300) {
  const a = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return {
    x: cur.x + (target.x - cur.x) * a,
    y: cur.y + (target.y - cur.y) * a,
    scale: Math.exp(Math.log(cur.scale) + (Math.log(target.scale) - Math.log(cur.scale)) * a),
  };
}

/**
 * The opening shot: from high above, the village small in the middle of the
 * screen with room around it, down to the home view. `zoom` is the starting
 * scale over the home one and `drift` a sideways offset of the start, in
 * screen widths, so the descent also glides a little.
 *
 *   scale │            ____● home
 *         │         _╱
 *         │ ●____╱            (smootherstep in log scale)
 *         └──────────────────── t   OPENING.ms
 */
export const OPENING = { ms: 3800, zoom: 0.36, drift: 0.08 };

const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Starting view of the opening shot over a home view.
 * @param {{x: number, y: number, scale: number}} home
 * @param {number} w canvas width (CSS px)
 * @returns {{x: number, y: number, scale: number}}
 */
export function openingStart(home, w) {
  const scale = home.scale * OPENING.zoom;
  return { x: home.x - (OPENING.drift * Math.max(1, w)) / scale, y: home.y, scale };
}

/**
 * View at fraction t (0..1) of the opening shot from `from` to `to`.
 * @param {{x: number, y: number, scale: number}} from
 * @param {{x: number, y: number, scale: number}} to
 * @param {number} t
 * @returns {{x: number, y: number, scale: number}}
 */
export function openingAt(from, to, t) {
  const e = smoother(Math.min(1, Math.max(0, t)));
  const ls = Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e;
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, scale: Math.exp(ls) };
}
