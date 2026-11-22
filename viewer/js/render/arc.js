// Geometry of the rumor in the scene (pure, no three.js): the arc from the
// neighbor who tells to the one who listens, the ribbon that draws it facing
// the camera, and how a hop animates. Points are three.js style: [X, Y, Z] =
// [world x, height, world y].
//
//                 ╭── lift ──╮
//               ╱      ●──►    ╲        ● the spark travels with `head`
//   teller ● ╱  faint trail       ╲ ● listener      then a ring on the ground
//
// The arc also bulges sideways, to the right of the way it goes: a hop seen
// end-on still curves on screen, and A → B and B → A never overlap.
//
// A hop lives WAVE_TICKS ticks (render/wave.js) and its `age` (0..1) comes
// from the playback position, so the animation is a function of (state, pos).

import { HEAD } from '../scene/world/plan.js';

/** Shape of the arcs: segments, height of the ends, lift per unit of distance, its limits and the sideways bulge (share of the lift). */
export const ARC = { segments: 32, end: HEAD - 1.5, lift: 0.3, minLift: 3, maxLift: 150, side: 0.35 };

/**
 * Shape of the trail of the rumor (render/heat.js): a low arc that starts and
 * ends on the ground and clears the roofs of the houses in between.
 */
export const GROUND_ARC = { segments: 24, end: 0.8, lift: 0.16, minLift: 10, maxLift: 46, side: 0.18 };

/** Phases of a hop, in age (0..1): the spark travels, then the ring grows and everything fades. */
export const HOP = { travel: 0.45, fadeFrom: 0.6, trail: 0.22 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Lift (height above the ends) of the arc between two ground points.
 * @param {number} d ground distance
 * @param {number} [min] smallest lift (the scene passes one that reads on screen)
 * @param {{lift: number, maxLift: number}} [shape] ARC or GROUND_ARC
 */
export function liftOf(d, min = ARC.minLift, shape = ARC) {
  return Math.min(shape.maxLift, Math.max(min, d * shape.lift));
}

/**
 * Point of the arc at u (0 = a, 1 = b): a parabola over the straight line,
 * up and a little to the right of the way from a to b.
 * @param {{x: number, y: number}} a ground point
 * @param {{x: number, y: number}} b ground point
 * @param {number} u
 * @param {number} [min] smallest lift
 * @param {{end: number, lift: number, maxLift: number, side: number}} [shape] ARC or GROUND_ARC
 * @returns {[number, number, number]}
 */
export function arcPoint(a, b, u, min = ARC.minLift, shape = ARC) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const lift = liftOf(d, min, shape);
  const bump = 4 * u * (1 - u);
  const side = d > 1e-9 ? lift * shape.side * bump : 0;
  const rx = d > 1e-9 ? -dy / d : 0;
  const ry = d > 1e-9 ? dx / d : 0;
  return [a.x + dx * u + rx * side, shape.end + lift * bump, a.y + dy * u + ry * side];
}

/**
 * Points of the arc from u0 to u1 (default the whole arc).
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {object} [o]
 * @param {number} [o.n] segments
 * @param {number} [o.u0]
 * @param {number} [o.u1]
 * @param {number} [o.min] smallest lift
 * @param {object} [o.shape] ARC (default) or GROUND_ARC
 * @returns {[number, number, number][]} n + 1 points
 */
export function arcPoints(a, b, { n = ARC.segments, u0 = 0, u1 = 1, min = ARC.minLift, shape = ARC } = {}) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(arcPoint(a, b, u0 + ((u1 - u0) * i) / n, min, shape));
  return out;
}

/**
 * A flat strip along some points that faces the eye: two vertices per point,
 * `widths[i] / 2` to each side, across the direction of the line.
 * @param {[number, number, number][]} pts
 * @param {{x: number, y: number, z: number}} eye
 * @param {number[]} widths one per point
 * @param {Float32Array} [out] 6 numbers per point
 * @returns {Float32Array}
 */
export function ribbon(pts, eye, widths, out = new Float32Array(pts.length * 6)) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q0 = pts[Math.max(0, i - 1)];
    const q1 = pts[Math.min(n - 1, i + 1)];
    const t = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
    const v = [p[0] - eye.x, p[1] - eye.y, p[2] - eye.z];
    // side = t × v, across the line and across the view.
    let s = [t[1] * v[2] - t[2] * v[1], t[2] * v[0] - t[0] * v[2], t[0] * v[1] - t[1] * v[0]];
    const len = Math.hypot(s[0], s[1], s[2]);
    s = len > 1e-9 ? s.map((c) => c / len) : [1, 0, 0];
    const h = widths[i] / 2;
    out.set([p[0] - s[0] * h, p[1] - s[1] * h, p[2] - s[2] * h, p[0] + s[0] * h, p[1] + s[1] * h, p[2] + s[2] * h], i * 6);
  }
  return out;
}

/**
 * Where a hop is at an age: the spark's place on the arc (0..1), the
 * listener's ring (0 until it arrives, then 0..1) and the overall opacity.
 * @param {number} age 0..1
 * @returns {{head: number, ring: number, fade: number}}
 */
export function hopPhase(age) {
  const a = clamp01(age);
  return {
    head: smooth(0, HOP.travel, a),
    ring: a < HOP.travel * 0.8 ? 0 : clamp01((a - HOP.travel * 0.8) / (1 - HOP.travel * 0.8)),
    fade: 1 - smooth(HOP.fadeFrom, 1, a),
  };
}

/**
 * Opacity of the arc at u for a spark at `head`: nothing ahead of the spark,
 * bright right behind it and a faint trail back to the teller.
 * @param {number} u
 * @param {number} head
 */
export function trailAlpha(u, head) {
  if (u > head + 1e-9) return 0;
  return 0.45 + 0.55 * Math.exp(-(head - u) / HOP.trail);
}
