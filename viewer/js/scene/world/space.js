// Occupancy of the ground while the village is laid out (pure, no three.js).
// Everything that takes room is an oriented box (OBB) in world units; a new
// piece goes in only where it hits nothing. Boxes sit in coarse buckets so
// that thousands of checks stay cheap.
//
//        v (front, rot 0 = +y, south)
//        ▲
//   ┌────┼────┐      rot: radians about the vertical, as in three.js:
//   │    ●────┼─► u     u = (cos rot, -sin rot), v = (sin rot, cos rot)
//   └─────────┘

/** Bucket size (world units). */
const BUCKET = 40;

/**
 * An oriented box.
 * @param {number} x centre
 * @param {number} y
 * @param {number} w size along u (local x)
 * @param {number} d size along v (local z, the front)
 * @param {number} [rot]
 */
export function obb(x, y, w, d, rot = 0) {
  return { x, y, hw: w / 2, hd: d / 2, ux: Math.cos(rot), uy: -Math.sin(rot), vx: Math.sin(rot), vy: Math.cos(rot) };
}

/** Box covering a segment of some width (round ends included). */
export function segmentBox(ax, ay, bx, by, width) {
  const len = Math.hypot(bx - ax, by - ay);
  return obb((ax + bx) / 2, (ay + by) / 2, len + width, width, Math.atan2(-(by - ay), bx - ax));
}

function radiusOn(b, ax, ay) {
  return b.hw * Math.abs(b.ux * ax + b.uy * ay) + b.hd * Math.abs(b.vx * ax + b.vy * ay);
}

/** Whether two boxes come closer than `pad` (separating axis test). */
export function overlaps(a, b, pad = 0) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [ax, ay] of [
    [a.ux, a.uy],
    [a.vx, a.vy],
    [b.ux, b.uy],
    [b.vx, b.vy],
  ]) {
    if (Math.abs(dx * ax + dy * ay) > radiusOn(a, ax, ay) + radiusOn(b, ax, ay) + pad) return false;
  }
  return true;
}

/** Axis-aligned extent of a box. */
export function extent(b) {
  const ex = b.hw * Math.abs(b.ux) + b.hd * Math.abs(b.vx);
  const ey = b.hw * Math.abs(b.uy) + b.hd * Math.abs(b.vy);
  return { minX: b.x - ex, maxX: b.x + ex, minY: b.y - ey, maxY: b.y + ey };
}

/** Whether a point lies inside a box (grown by pad). */
export function inside(b, x, y, pad = 0) {
  const dx = x - b.x;
  const dy = y - b.y;
  return Math.abs(dx * b.ux + dy * b.uy) <= b.hw + pad && Math.abs(dx * b.vx + dy * b.vy) <= b.hd + pad;
}

/**
 * The ground taken so far.
 * @returns {{add: (b: object, tag?: string) => object, hits: (b: object, pad?: number, skip?: (b: object) => boolean) => boolean, all: () => object[]}}
 */
export function createSpace() {
  const buckets = new Map();
  const items = [];
  const keys = (b, pad) => {
    const e = extent(b);
    const out = [];
    for (let i = Math.floor((e.minX - pad) / BUCKET); i <= Math.floor((e.maxX + pad) / BUCKET); i++) {
      for (let j = Math.floor((e.minY - pad) / BUCKET); j <= Math.floor((e.maxY + pad) / BUCKET); j++) out.push(`${i},${j}`);
    }
    return out;
  };
  return {
    add(b, tag = '') {
      b.tag = tag;
      items.push(b);
      for (const k of keys(b, 0)) {
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(b);
      }
      return b;
    },
    hits(b, pad = 0, skip = null) {
      const seen = new Set();
      for (const k of keys(b, pad)) {
        for (const o of buckets.get(k) ?? []) {
          if (seen.has(o)) continue;
          seen.add(o);
          if (skip && skip(o)) continue;
          if (overlaps(b, o, pad)) return true;
        }
      }
      return false;
    },
    all: () => items,
  };
}
