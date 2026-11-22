// Stage of the telephone row (pure): the twenty neighbors stand on y = 0, one
// every ROW_GAP (render/layout.js). They get a cobbled street with a row of
// tall house fronts behind them, lamps between them and gardens in front,
// all kept low on the camera side so that nobody is hidden.
//
//   ♣ ♣ ♣ ♣ ♣ ♣ ♣ ♣ ♣ ♣ ♣ ♣ ♣ ♣ ♣ ♣      trees behind
//   ⌂⌂⌂ ⌂⌂ ⌂⌂⌂ ⌂⌂ ⌂⌂⌂ ⌂⌂ ⌂⌂⌂ ⌂⌂        fronts, y ≤ -20
//   ══●══╪══●══╪══●══╪══●══╪══●══      street, lamps between people
//   ▒▒▒   ▒▒▒   ▒▒▒   ▒▒▒   ▒▒▒        low flower beds, y ≥ 24

import { ROW_GAP } from '../../render/layout.js';
import { CELL, hash, pickOf, random } from './measures.js';
import { makeHouse, ROOFS } from './quarters.js';
import { createSpace, obb } from './space.js';
import { layScatter, layTrees } from './fill.js';

/** Half width of the street of the row. */
export const STREET = 16;

/**
 * The stage of a telephone row.
 * @param {object} header
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} ground
 * @returns {object} parts of a TownPlan
 */
export function rowStage(header, ground) {
  const n = Math.max(1, header.neighbors?.length ?? 1);
  const rand = random(hash(`row|${n}`));
  const out = { houses: [], trees: [], lamps: [], props: [], gardens: [], lanes: [], paved: [] };
  const space = createSpace();
  const x0 = ground.minX + 20;
  const x1 = ground.maxX - 20;
  // The street, the people on it, and a pavement in front of the houses.
  out.paved.push({ x: (x0 + x1) / 2, y: 0, w: x1 - x0, d: STREET * 2, rot: 0, kind: 'street' });
  space.add(obb((x0 + x1) / 2, 0, x1 - x0 + 40, STREET * 2 + 4), 'street');
  // House fronts behind, shoulder to shoulder, on the north side.
  let x = x0;
  while (x < x1 - CELL) {
    const w = 1 + Math.floor(rand() * 3);
    const d = 2;
    const len = Math.min(w * CELL, x1 - x);
    if (len < CELL) break;
    const wc = Math.round(len / CELL);
    const h = makeHouse('', x + (wc * CELL) / 2, -STREET - 3 - CELL, 0, [wc, d, 2, 3], rand, ROOFS);
    h.arcade = rand() < 0.3;
    out.houses.push(h);
    space.add(obb(h.x, h.y, wc * CELL, d * CELL), 'house');
    x += wc * CELL + (rand() < 0.25 ? 4 : 0.6);
  }
  // A second row of taller houses behind, whose roofs rise over the first.
  x = x0 + 6;
  while (x < x1 - CELL) {
    const w = 1 + Math.floor(rand() * 3);
    const wc = Math.min(w, Math.floor((x1 - x) / CELL));
    if (wc < 1) break;
    const y = -STREET - 3 - 2 * CELL - 10 - CELL;
    if (rand() < 0.8) {
      const h = makeHouse('', x + (wc * CELL) / 2, y, 0, [wc, 2, 3, 4], rand, ROOFS);
      out.houses.push(h);
      space.add(obb(h.x, h.y, wc * CELL, 2 * CELL), 'house');
    }
    x += wc * CELL + 3 + rand() * 8;
  }
  // Lamps half way between neighbors, at the kerb on the camera side.
  for (let i = 0; i < n - 1; i++) {
    const lx = i * ROW_GAP + ROW_GAP / 2;
    out.lamps.push({ x: lx, y: STREET - 2 });
    space.add(obb(lx, STREET - 2, 2, 2), 'lamp');
  }
  // Low flower beds and benches in front.
  for (let i = 0; i < n; i++) {
    const cx = i * ROW_GAP;
    out.gardens.push({ x: cx, y: STREET + 12, w: 34, d: 10, rot: 0, kind: 'flowers', seed: Math.floor(rand() * 1e6), low: true });
    space.add(obb(cx, STREET + 12, 34, 10), 'garden');
    out.props.push({ kind: pickOf(['stall-bench', 'pot_large', 'barrel'], rand()), x: cx + ROW_GAP / 2, y: STREET + 9, rot: Math.PI / 2, scale: 1 });
  }
  // Low fields beyond the flower beds (nothing tall on the camera side).
  for (let fx = x0 + 30; fx < x1 - 30; fx += 56) {
    for (let fy = STREET + 40; fy < ground.maxY - 50; fy += 36) {
      const w = 40 + Math.floor(rand() * 10);
      const d = 24 + Math.floor(rand() * 6);
      const box = obb(fx + (rand() - 0.5) * 6, fy, w, d);
      const kind = pickOf(['wheat', 'leafs', 'meadow', 'carrot', 'wheat'], rand());
      const seed = Math.floor(rand() * 1e6);
      if (space.hits(box, 3)) continue;
      space.add(box, 'field');
      out.gardens.push({ x: box.x, y: box.y, w, d, rot: 0, kind, seed, field: true, low: true });
    }
  }
  // No trees on the camera side, close to the people.
  layTrees(ground, space, rand, out, (_, ty) => ty < -STREET || ty > ground.maxY - 40);
  layScatter(ground, space, rand, out);
  return out;
}
