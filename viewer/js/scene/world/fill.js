// What fills the village between the places (pure): lamps along the roads,
// houses lining the streets and the square, fields and orchards further out,
// a forest on the rim and small things (flowers, bushes, stones) in the gaps.
// Each step only takes ground that is still free.
//
//   rim   ♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣♣
//   farm  ▒▒▒▒  ▓▓▓▓  ▒▒▒  ♣ ♣ ♣     fields, orchards, meadows
//   town  ⌂⌂ ⌂⌂ ═══════ ⌂⌂⌂ ⌂ ⌂⌂     houses face the streets

import { CELL, pickOf, ROAD_WIDTH } from './measures.js';
import { facing, makeHouse, ROOFS } from './quarters.js';
import { obb } from './space.js';

/** Depth of the forest on the rim of the ground. */
export const RIM = 62;

/**
 * Lamps along the roads (on alternate sides, at the road edge) and around
 * the square.
 */
export function layLamps(roads, square, space, out) {
  let side = 1;
  for (const [ax, ay, bx, by] of roads) {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.floor(len / 44);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      side = -side;
      const off = ROAD_WIDTH / 2 + 0.9;
      const x = ax + (bx - ax) * t + nx * side * off;
      const y = ay + (by - ay) * t + ny * side * off;
      const box = obb(x, y, 1.6, 1.6);
      if (space.hits(box, 0.5, (o) => o.tag === 'road' || o.tag === 'crowd')) continue;
      space.add(box, 'lamp');
      out.lamps.push({ x, y });
    }
  }
  if (square) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
      const x = square.x + Math.cos(a) * (square.r + 3);
      const y = square.y + Math.sin(a) * (square.r + 3);
      const box = obb(x, y, 1.6, 1.6);
      if (space.hits(box, 0.5, (o) => o.tag === 'square' || o.tag === 'crowd')) continue;
      space.add(box, 'lamp');
      out.lamps.push({ x, y });
    }
  }
}

/** Town houses facing the square, all around it. */
export function layAroundSquare(square, space, rand, onGround, out) {
  const front = square.r + 7;
  let a = rand() * Math.PI * 2;
  const end = a + Math.PI * 2 - 0.15;
  while (a < end) {
    const w = rand() < 0.5 ? 2 : 3;
    const d = 2;
    const len = w * CELL;
    const da = len / front;
    const mid = a + da / 2;
    const rr = front + (d * CELL) / 2;
    const x = square.x + Math.cos(mid) * rr;
    const y = square.y + Math.sin(mid) * rr;
    const rot = facing(-Math.cos(mid), -Math.sin(mid));
    const box = obb(x, y, len, d * CELL, rot);
    if (onGround(box) && !space.hits(box, 1.2)) {
      space.add(box, 'house');
      const h = makeHouse('', x, y, rot, [w, d, 2, 3], rand, ['red', 'red', 'slate', 'blue']);
      h.arcade = rand() < 0.5;
      out.houses.push(h);
      a += da + 1.5 / front;
    } else {
      a += 4 / front;
    }
  }
}

/** Houses lining both sides of the roads, denser near the middle. */
export function layStreets(roads, core, space, rand, onGround, out, back = 0) {
  for (const [ax, ay, bx, by] of roads) {
    const len = Math.hypot(bx - ax, by - ay);
    const dx = (bx - ax) / len;
    const dy = (by - ay) / len;
    for (const side of [-1, 1]) {
      const nx = -dy * side;
      const ny = dx * side;
      let t = 12;
      while (t < len - 12) {
        const x0 = ax + dx * t;
        const y0 = ay + dy * t;
        const far = Math.hypot(x0 - core.x, y0 - core.y);
        const dense = Math.max(back ? 0.2 : 0.7, Math.min(1, (back ? 1.2 : 1.6) - far / 420));
        const w = rand() < 0.55 ? 1 : 2;
        const d = rand() < 0.6 ? 1 : 2;
        const len2 = w * CELL;
        if (rand() > dense) {
          t += len2 + 6;
          continue;
        }
        const off = ROAD_WIDTH / 2 + 3 + back * 30 + (d * CELL) / 2;
        const along = t + len2 / 2;
        const x = ax + dx * along + nx * off;
        const y = ay + dy * along + ny * off;
        const rot = facing(-nx, -ny);
        const box = obb(x, y, len2, d * CELL, rot);
        if (back && rand() < 0.5) {
          t += 4;
          continue;
        }
        if (along + len2 / 2 > len - 8 || !onGround(box) || space.hits(box, 1.2)) {
          t += 3;
          continue;
        }
        space.add(box, 'house');
        out.houses.push(makeHouse('', x, y, rot, [w, d, 1, far < 260 ? 3 : 2], rand, ROOFS));
        // A garden behind some of them.
        if (rand() < 0.55) {
          const gd = 10 + Math.floor(rand() * 8);
          const goff = off + (d * CELL) / 2 + gd / 2 + 0.8;
          const gx = ax + dx * along + nx * goff;
          const gy = ay + dy * along + ny * goff;
          const gbox = obb(gx, gy, len2 - 1, gd, rot);
          if (onGround(gbox) && !space.hits(gbox, 0.8)) {
            space.add(gbox, 'garden');
            out.gardens.push({ x: gx, y: gy, w: len2 - 1, d: gd, rot, kind: pickOf(['crops', 'flowers', 'orchard', 'yard'], rand()), seed: Math.floor(rand() * 1e6) });
          }
        }
        t += len2 + 1.2 + rand() * 3;
      }
    }
  }
}

/** Fields, orchards and meadows on the free ground between town and forest. */
export function layFields(ground, space, rand, out) {
  const STEP_X = 44;
  const STEP_Y = 34;
  for (let y = ground.minY + RIM; y < ground.maxY - RIM; y += STEP_Y) {
    for (let x = ground.minX + RIM; x < ground.maxX - RIM; x += STEP_X) {
      for (let k = 0; k < 2; k++) {
        const w = 20 + Math.floor(rand() * 26);
        const d = 14 + Math.floor(rand() * 18);
        const cx = x + (rand() - 0.5) * 24;
        const cy = y + (rand() - 0.5) * 18;
        const kind = pickOf(['wheat', 'corn', 'wheat', 'pumpkin', 'orchard', 'meadow', 'leafs', 'carrot', 'orchard'], rand());
        const seed = Math.floor(rand() * 1e6);
        const box = obb(cx, cy, w, d);
        if (space.hits(box, 3)) continue;
        space.add(box, 'field');
        out.gardens.push({ x: cx, y: cy, w, d, rot: 0, kind, seed, field: true });
        break;
      }
    }
  }
}

/** Forest on the rim and a few trees inside. */
export function layTrees(ground, space, rand, out, allow = null) {
  const KINDS = ['tree', 'tree-high', 'tree-high-round', 'tree', 'tree-crooked', 'tree-high', 'tree-high-crooked'];
  const STEP = 11;
  for (let y = ground.minY + 5; y < ground.maxY - 5; y += STEP) {
    for (let x = ground.minX + 5; x < ground.maxX - 5; x += STEP) {
      const jx = x + (rand() - 0.5) * STEP * 0.8;
      const jy = y + (rand() - 0.5) * STEP * 0.8;
      const pick = rand();
      const rot = rand() * Math.PI * 2;
      const scale = 0.75 + rand() * 0.5;
      const keepR = rand();
      const edge = Math.min(jx - ground.minX, ground.maxX - jx, jy - ground.minY, ground.maxY - jy);
      const keep = edge < RIM ? 0.72 : 0.1;
      if (keepR > keep || (allow && !allow(jx, jy))) continue;
      const box = obb(jx, jy, 5 * scale, 5 * scale);
      if (space.hits(box, 2)) continue;
      space.add(box, 'tree');
      out.trees.push({ x: jx, y: jy, kind: pickOf(KINDS, pick), scale, rot });
    }
  }
}

/** Small things in the gaps: flowers, bushes, grass and stones. */
export function layScatter(ground, space, rand, out) {
  const KINDS = ['flower_redA', 'flower_purpleA', 'plant_bush', 'plant_bushLarge', 'flower_yellowA', 'rock_smallA', 'flower_redB', 'plant_bushSmall', 'plant_bush', 'stump_round', 'mushroom_red', 'flower_redA'];
  const STEP = 8;
  for (let y = ground.minY + 4; y < ground.maxY - 4; y += STEP) {
    for (let x = ground.minX + 4; x < ground.maxX - 4; x += STEP) {
      const jx = x + (rand() - 0.5) * STEP;
      const jy = y + (rand() - 0.5) * STEP;
      const kind = pickOf(KINDS, rand());
      const rot = rand() * Math.PI * 2;
      const scale = 0.8 + rand() * 0.6;
      if (rand() > 0.2) continue;
      const box = obb(jx, jy, 3, 3);
      if (space.hits(box, 0.6)) continue;
      space.add(box, 'scatter');
      out.props.push({ kind, x: jx, y: jy, rot, scale, small: true });
    }
  }
}

/**
 * The river: a gentle meander across the ground, south of its place, flat
 * in front of the place so that its people stand on the bank.
 * @returns {{y: number, width: number, path: number[][]}}
 */
export function riverOf(place, crowdDepth, ground, rand) {
  const width = 28;
  const y = place.y + crowdDepth + width / 2 + 5;
  const phase = rand() * Math.PI * 2;
  const path = [];
  for (let x = ground.minX - 4; x <= ground.maxX + 4; x += 16) {
    const calm = Math.min(1, Math.max(0, (Math.abs(x - place.x) - 70) / 120));
    path.push([x, y + calm * 9 * Math.sin(x / 85 + phase) + calm * 4]);
  }
  return { y, width, path };
}

/** Reeds, stones and lilies along the river, a pier and a bridge. */
export function layRiverside(river, place, space, rand, out) {
  const n = river.path.length;
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay] = river.path[i];
    const [bx, by] = river.path[i + 1];
    for (let k = 0; k < 4; k++) {
      const t = rand();
      const x = ax + (bx - ax) * t;
      const yc = ay + (by - ay) * t;
      const bank = rand() < 0.5 ? -1 : 1;
      const y = yc + bank * (river.width / 2 + 0.5 + rand() * 3);
      const kind = pickOf(['grass_large', 'grass_large', 'rock_smallA', 'plant_bush', 'grass', 'plant_bushLarge'], rand());
      const box = obb(x, y, 2.5, 2.5);
      if (space.hits(box, 0.3, (o) => o.tag === 'river')) continue;
      space.add(box, 'scatter');
      out.props.push({ kind, x, y, rot: rand() * 6.28, scale: 0.9 + rand() * 0.6, small: true });
    }
    if (rand() < 0.35) {
      const t = rand();
      out.props.push({ kind: 'lily_large', x: ax + (bx - ax) * t, y: ay + (by - ay) * t + (rand() - 0.5) * river.width * 0.6, rot: rand() * 6.28, scale: 1.2, small: true, float: true });
    }
  }
  // A stone bridge east of the bank, and a pier with a boat west of it.
  const bx = place.x + 95;
  out.bridges.push({ x: bx, y: riverYAt(river, bx), len: river.width + 12, width: 12 });
  const px = place.x - 70;
  out.props.push({ kind: 'pier', x: px, y: riverYAt(river, px) - river.width / 2 + 3, rot: 0, scale: 1 });
  out.props.push({ kind: 'canoe', x: px + 9, y: riverYAt(river, px) - river.width / 2 + 8, rot: 1.4, scale: 1, float: true });
}

/** Y of the river centre line at some x. */
export function riverYAt(river, x) {
  const p = river.path;
  for (let i = 1; i < p.length; i++) {
    if (p[i][0] >= x) {
      const t = (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
    }
  }
  return river.y;
}

