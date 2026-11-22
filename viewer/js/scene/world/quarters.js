// The quarters (places of kind "home"), pure. The residents gather on a patio
// in the middle; around it, rows of houses of every size face the patio and
// a lane, with kitchen gardens behind them. Roads, landmarks and crowds cut
// through the rows wherever they pass.
//
//   gardens ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
//   row C   ⌂⌂ ⌂ ⌂⌂⌂  ⌂ ⌂⌂     facing the lane
//   lane    ─────────────────
//   row B   ⌂ ⌂⌂ ⌂⌂ ⌂⌂⌂ ⌂      facing the lane
//   gardens ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
//   row A   ⌂⌂ ⌂ ⌂⌂ ⌂⌂ ⌂⌂      facing the patio
//           ┌─────────────┐
//           │ ·  ·  ·  ·  │ patio: the residents' grid, kept free
//           └─────────────┘

import { gridLayout, spacingFor } from '../../render/layout.js';
import { CELL, pickOf } from './measures.js';
import { obb } from './space.js';

/** Extra people a patio keeps room for (visitors). */
const VISITORS = 6;
/** Patio margin around the residents' grid. */
export const PATIO_MARGIN = 9;

/** Rows around the patio: offset of the front line from the patio edge and facing. */
const ROWS = [
  { name: 'A', line: 3, face: 'in', gardens: 36 },
  { name: 'B', line: 62, face: 'out', gardens: 40 },
  { name: 'C', line: 74, face: 'in', gardens: 106 },
];
/** Lane between rows B and C (offset of its centre line, width). */
const LANE = { line: 68, width: 6 };

/** House shapes [w, d, floors min, floors max] and their weights. */
const SHAPES = [
  [[1, 1, 1, 2], 3],
  [[2, 1, 1, 2], 3],
  [[1, 2, 1, 2], 2],
  [[2, 2, 2, 3], 2],
  [[3, 2, 2, 2], 1],
];
const SHAPE_TOTAL = SHAPES.reduce((a, [, k]) => a + k, 0);

function shapeOf(r) {
  let t = r * SHAPE_TOTAL;
  for (const [s, k] of SHAPES) {
    if ((t -= k) < 0) return s;
  }
  return SHAPES[0][0];
}

/** Garden kinds behind houses. */
const GARDENS = ['crops', 'crops', 'flowers', 'orchard', 'crops', 'yard'];
/** Roof colors: each quarter leans on one of them. */
export const ROOFS = ['red', 'green', 'blue', 'slate'];

/**
 * Half size of the patio of a quarter with n residents.
 * @param {number} n
 * @returns {{hw: number, hh: number, gw: number, gh: number}} patio and grid half sizes
 */
export function patioOf(n) {
  const m = n + VISITORS;
  const grid = gridLayout(new Array(m).fill(1), spacingFor(m));
  return { hw: grid.halfW + PATIO_MARGIN, hh: grid.halfH + PATIO_MARGIN, gw: grid.halfW, gh: grid.halfH };
}

/**
 * A house record.
 * @returns {{place: string, x: number, y: number, rot: number, w: number, d: number, floors: number, walls: string, roof: string, chimney: boolean, seed: number}}
 */
export function makeHouse(place, x, y, rot, [w, d, f0, f1], rand, roofs) {
  const floors = f0 + Math.floor(rand() * (f1 - f0 + 1));
  const k = rand();
  const walls = floors > 1 && k < 0.4 ? 'mixed' : k < 0.68 ? 'stone' : 'wood';
  return { place, x, y, rot, w, d, floors, walls, roof: pickOf(roofs, rand()), chimney: rand() < 0.45, seed: Math.floor(rand() * 1e6) };
}

/** Rotation that turns the front (+v) towards (fx, fy). */
export const facing = (fx, fy) => Math.atan2(fx, fy);

/**
 * Lays out one quarter.
 * @param {{id: string, x: number, y: number}} place
 * @param {{hw: number, hh: number}} patio
 * @param {ReturnType<import('./space.js').createSpace>} space
 * @param {() => number} rand
 * @param {(b: object) => boolean} onGround
 * @param {object} out plan collections: houses, gardens, fences, lanes
 */
export function layQuarter(place, patio, space, rand, onGround, out) {
  const roofs = [pickOf(ROOFS, rand())];
  roofs.push(roofs[0], roofs[0], pickOf(ROOFS, rand()));
  // The four sides of a ring: outward normal (nx, ny) and tangent (tx, ty).
  const sides = [
    { nx: 0, ny: -1, tx: 1, ty: 0, n: patio.hh, t: patio.hw },
    { nx: 0, ny: 1, tx: -1, ty: 0, n: patio.hh, t: patio.hw },
    { nx: 1, ny: 0, tx: 0, ty: 1, n: patio.hw, t: patio.hh },
    { nx: -1, ny: 0, tx: 0, ty: -1, n: patio.hw, t: patio.hh },
  ];
  const lay = (row) => {
    for (const s of sides) {
      const reach = s.n + row.line;
      const half = s.t + row.line + (row.face === 'in' ? -2 : -14);
      let t = -half;
      while (t < half) {
        const shape = shapeOf(rand());
        const [w, d] = shape;
        const len = w * CELL;
        if (t + len > half) {
          t += 4;
          continue;
        }
        const along = t + len / 2;
        const depth = row.face === 'in' ? reach + (d * CELL) / 2 : reach - (d * CELL) / 2;
        const x = place.x + s.nx * depth + s.tx * along;
        const y = place.y + s.ny * depth + s.ty * along;
        const rot = row.face === 'in' ? facing(-s.nx, -s.ny) : facing(s.nx, s.ny);
        const box = obb(x, y, len, d * CELL, rot);
        if (!onGround(box) || space.hits(box, 1.5)) {
          t += 4;
          continue;
        }
        space.add(box, 'house');
        const h = makeHouse(place.id, x, y, rot, shape, rand, roofs);
        out.houses.push(h);
        // Kitchen garden behind it, up to the row's garden line.
        const back = row.face === 'in' ? reach + d * CELL : reach - d * CELL;
        const far = row.face === 'in' ? s.n + row.gardens : s.n + ROWS[0].gardens + 2;
        const gd = row.face === 'in' ? far - back : back - far;
        if (gd >= 7 && rand() < 0.85) {
          const gmid = (back + far) / 2;
          const gx = place.x + s.nx * gmid + s.tx * along;
          const gy = place.y + s.ny * gmid + s.ty * along;
          const gbox = obb(gx, gy, len - 1, gd - 1.5, rot);
          if (onGround(gbox) && !space.hits(gbox, 0.5)) {
            space.add(gbox, 'garden');
            out.gardens.push({ x: gx, y: gy, w: len - 1, d: gd - 1.5, rot, kind: pickOf(GARDENS, rand()), seed: Math.floor(rand() * 1e6) });
          }
        }
        t += len + 2 + rand() * 4;
      }
    }
  };
  lay(ROWS[0]);
  lay(ROWS[1]);
  // The lane, in short pieces that keep off what is already there.
  for (const s of sides) {
    const reach = s.n + LANE.line;
    const half = s.t + LANE.line;
    for (let t = -half; t < half; t += 10) {
      const along = Math.min(half, t + 10);
      const mid = (t + along) / 2;
      const x = place.x + s.nx * reach + s.tx * mid;
      const y = place.y + s.ny * reach + s.ty * mid;
      const box = obb(x, y, along - t + LANE.width, LANE.width, facing(s.nx, s.ny));
      if (!onGround(box) || space.hits(box, 0.5, (o) => o.tag === 'road' || o.tag === 'lane' || o.tag === 'step')) continue;
      space.add(box, 'lane');
      out.lanes.push({ x, y, w: along - t + LANE.width, d: LANE.width, rot: facing(s.nx, s.ny) });
    }
  }
  lay(ROWS[2]);
}
