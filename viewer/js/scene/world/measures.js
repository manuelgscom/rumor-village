// Measures and small helpers shared by the pure layout of the village
// (plan.js re-exports the public ones). No three.js, no DOM.

/** World units per cell of the building kit. */
export const CELL = 10;
/** Scale of the character models (0.67 tall in the kit). */
export const CHAR_SCALE = 11;
/** Height (world units) above the ground of a neighbor's head. */
export const HEAD = 8;
/** Gap between a place point and the front of its building (at the least). */
export const FRONT_GAP = 2;
/** Gap between a place point and the first row of its crowd. */
export const CROWD_GAP = 5;
/** Radius of the paved square. */
export const SQUARE_RADIUS = 54;
/** Extra ground around the home view. */
export const GROUND_MARGIN = 80;
/** Width of a road. */
export const ROAD_WIDTH = 7;

/** Small deterministic random generator (mulberry32). */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of a string to an unsigned 32-bit number. */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One item of a list, by a random number in [0, 1). */
export function pickOf(list, r) {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

/** Distance from a point to a segment [ax, ay, bx, by]. */
export function segmentDistance(px, py, [ax, ay, bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
