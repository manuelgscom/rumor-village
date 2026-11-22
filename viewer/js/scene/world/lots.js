// Where the landmark of each public place goes (pure). The lot stands north
// of the place point, facing south; it may step back (setback) and slide
// sideways (offset) to keep clear of roads, crowds and other lots, and it
// shrinks only when no grander lot fits.
//
//         ┌──────────lot──────────┐
//         │ annex │   main body   │
//         └───────┴───────────────┘  ← front = point.y - FRONT_GAP - setback
//            court (paved)  ●  point
//                         people

import { CELL, FRONT_GAP } from './measures.js';
import { topOf } from './recipes.js';
import { obb } from './space.js';

/** Setbacks tried, from the front gap (world units). */
const SETBACKS = [0, 3, 6, 9, 12, 16, 20, 25, 30, 36, 42, 50, 58];
/** Clearance from everything else (world units). */
const PAD = 3;

/** Offsets of the main body from the point, smallest first (world units). */
function offsets(w) {
  const out = [0];
  const max = (w * CELL) / 2 + CELL;
  for (let o = CELL / 2; o <= max; o += CELL / 2) out.push(-o, o);
  return out;
}

/**
 * Fits a lot for a place.
 * @param {{id: string, key: string, x: number, y: number}} place
 * @param {object} recipe
 * @param {ReturnType<import('./space.js').createSpace>} space
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} ground
 * @param {number} lean -1 or 1: the side the annex prefers
 * @returns {object} building: {place, key, recipe, x, y, w, d, top, main, annex, court, door, setback}
 */
export function fitLot(place, recipe, space, ground, lean) {
  const skip = (o) => o.tag === `step:${place.id}`;
  const onGround = (b) => b.x - b.hw > ground.minX + 8 && b.x + b.hw < ground.maxX - 8 && b.y - b.hd > ground.minY + 8;
  const lots = recipe.lots ?? [[2, 2, 0]];
  const make = ([w, d, a], s, off, side) => {
    const front = place.y - FRONT_GAP - s;
    const mainX = place.x + off;
    const lotW = (w + a) * CELL;
    const x = mainX + (side * a * CELL) / 2;
    const y = front - (d * CELL) / 2;
    return {
      place: place.id,
      key: place.key,
      recipe,
      x,
      y,
      w: lotW,
      d: d * CELL,
      top: topOf(recipe, place.key, { w, d }),
      main: { x: mainX, w, d },
      annex: a ? { x: mainX + (side * (w + a) * CELL) / 2, w: a, side } : null,
      door: { x: Math.min(mainX + ((w - 1) * CELL) / 2, Math.max(mainX - ((w - 1) * CELL) / 2, place.x)), y: front },
      setback: s,
    };
  };
  // Best candidate: big lots first, then close to the point.
  let best = null;
  let bestScore = -Infinity;
  lots.forEach((lot, li) => {
    for (const s of SETBACKS) {
      for (const off of offsets(lot[0])) {
        for (const side of lot[2] ? [lean, -lean] : [0]) {
          const score = (lot[0] + lot[2]) * lot[1] * 100 - s * 12 - Math.abs(off) * 6 - li * 40 - (side === lean ? 0 : 1);
          if (score <= bestScore) continue;
          const b = make(lot, s, off, side);
          const box = obb(b.x, b.y, b.w, b.d);
          if (!onGround(box) || space.hits(box, PAD, skip)) continue;
          best = b;
          bestScore = score;
        }
      }
    }
  });
  if (best) return snapDoor(best);
  // Nothing fits: the smallest lot right behind the point.
  const last = lots[lots.length - 1];
  return snapDoor(make([last[0], last[1], 0], 0, 0, 0));
}

/** The door sits on the cell of the main body nearest to the point. */
function snapDoor(b) {
  const first = b.main.x - ((b.main.w - 1) * CELL) / 2;
  const i = Math.round((b.door.x - first) / CELL);
  b.door = { x: first + Math.min(b.main.w - 1, Math.max(0, i)) * CELL, y: b.door.y };
  b.court = { x: b.door.x, y: (b.door.y + b.door.y + FRONT_GAP + b.setback) / 2, w: Math.max(CELL, b.main.w * CELL * 0.6), d: FRONT_GAP + b.setback };
  return b;
}
