// Layout of the 3D village (pure, no three.js, no DOM): which landmark stands
// for each place and where, the quarters, the houses lining the streets, the
// fields, the river and everything small. The same header always gives the
// same village (no randomness from the run seed), so both sides of the split
// screen match.
//
// A landmark stands behind (north of) its place point and faces south, the
// side the camera looks from; the people of the place gather in front of it:
//
//            ┌───────────┐
//            │  landmark │   lot: lots.js (may step back or slide aside)
//            └─────●─────┘   ● place point
//             · · · · · ·    crowd: top row at place.y + CROWD_GAP
//             · · · · · ·
//
// Open places (the square, the river bank) and the quarters keep their crowd
// centred on the point. Ground is taken in order of importance, and nothing
// goes on roads, crowds or other things (space.js):
//
//   roads, crowds, patios, square, river → landmarks → lamps → square houses
//   → quarters → street houses → fields → forest → flowers and stones
//
// Units are world units (header coordinates); the kit is built of 1×1 cells
// scaled by CELL.

import { gridLayout, homeBounds, isRow, spacingFor } from '../../render/layout.js';
import { layAroundSquare, layFields, layLamps, layRiverside, layScatter, layStreets, layTrees, riverOf } from './fill.js';
import { fitLot } from './lots.js';
import { CELL, CROWD_GAP, GROUND_MARGIN, hash, random, ROAD_WIDTH, SQUARE_RADIUS } from './measures.js';
import { layQuarter, patioOf } from './quarters.js';
import { recipeOf } from './recipes.js';
import { rowStage } from './row.js';
import { createSpace, obb, segmentBox } from './space.js';

export { CELL, CHAR_SCALE, CROWD_GAP, FRONT_GAP, GROUND_MARGIN, HEAD, hash, random, ROAD_WIDTH, SQUARE_RADIUS } from './measures.js';
export { RECIPES, recipeOf } from './recipes.js';

/** People a crowd in front of a landmark keeps room for. */
export const CROWD_ROOM = 32;
/** People the open places keep room for. */
const OPEN_ROOM = { square: 100, river: 40 };
/** Roads leave this much free around a place point (the doorstep). */
const DOORSTEP = 9;

/**
 * Road segments of a header, each once: [ax, ay, bx, by].
 * @param {object} header
 * @returns {number[][]}
 */
export function roadSegments(header) {
  const seen = new Set();
  const out = [];
  for (const r of header.routes ?? []) {
    const p = r.path ?? [];
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1];
      const b = p[i];
      const key = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return out;
}

/**
 * Half size of the grid of n people (gridLayout of render/layout.js).
 * @param {number} n
 */
export function crowdHalf(n) {
  const g = gridLayout(new Array(Math.max(1, n)).fill(1), spacingFor(n));
  return { hw: g.halfW, hh: g.halfH };
}

/**
 * Box kept free for the people of a place (world units, axis-aligned).
 * @param {{x: number, y: number}} place
 * @param {'front'|'centre'} crowd
 * @param {number} n people
 * @returns {{x: number, y: number, w: number, d: number}}
 */
export function crowdBox(place, crowd, n) {
  const { hw, hh } = crowdHalf(n);
  if (crowd === 'front') return { x: place.x, y: place.y + CROWD_GAP + hh, w: 2 * hw + 10, d: 2 * hh + 10 };
  return { x: place.x, y: place.y, w: 2 * hw + 10, d: 2 * hh + 10 };
}

/**
 * @typedef {object} Building
 * @property {string} place place id
 * @property {string} key
 * @property {object} recipe
 * @property {number} x centre of the lot
 * @property {number} y
 * @property {number} w width of the lot (world units)
 * @property {number} d depth of the lot (world units)
 * @property {number} top height of the highest point (world units)
 * @property {{x: number, w: number, d: number}} main main body: centre x, cells
 * @property {{x: number, w: number, side: number}|null} annex
 * @property {{x: number, y: number}} door
 * @property {{x: number, y: number, w: number, d: number}} court paved front
 */

/**
 * @typedef {object} TownPlan
 * @property {boolean} row telephone row instead of a village
 * @property {{minX: number, minY: number, maxX: number, maxY: number}} ground
 * @property {number[][]} roads segments
 * @property {Building[]} buildings
 * @property {{place: string, x: number, y: number, r: number}|null} square
 * @property {{y: number, width: number, path: number[][]}|null} river
 * @property {object[]} houses {place, x, y, rot, w, d (cells), floors, walls, roof, chimney, seed}; rot 0 = facing south
 * @property {{x: number, y: number, kind: string, scale: number, rot: number}[]} trees
 * @property {{x: number, y: number}[]} lamps
 * @property {object[]} gardens {x, y, w, d, rot, kind, seed, field?}
 * @property {object[]} props {kind, x, y, rot, scale, small?}
 * @property {object[]} lanes dirt paths {x, y, w, d, rot}
 * @property {object[]} paved {x, y, w, d, rot, kind}
 * @property {object[]} patios {place, x, y, hw, hh, gw, gh}
 * @property {object[]} bridges {x, y, len, width}
 * @property {Map<string, 'front'|'centre'>} crowd where the people of each place stand
 */

function emptyPlan(row, ground) {
  return {
    row,
    ground,
    roads: [],
    buildings: [],
    square: null,
    river: null,
    houses: [],
    trees: [],
    lamps: [],
    gardens: [],
    props: [],
    lanes: [],
    paved: [],
    patios: [],
    bridges: [],
    crowd: new Map(),
  };
}

/**
 * The village of a header.
 * @param {object} header
 * @returns {TownPlan}
 */
export function townPlan(header) {
  const home = homeBounds(header);
  const ground = {
    minX: home.minX - GROUND_MARGIN,
    minY: home.minY - GROUND_MARGIN,
    maxX: home.maxX + GROUND_MARGIN,
    maxY: home.maxY + GROUND_MARGIN,
  };
  if (isRow(header)) return { ...emptyPlan(true, ground), ...rowStage(header, ground) };

  const plan = emptyPlan(false, ground);
  const places = header.places ?? [];
  const roads = roadSegments(header);
  plan.roads = roads;
  const space = createSpace();
  const rand = random(hash(places.map((p) => `${p.id}${p.x}${p.y}`).join('|')));
  const onGround = (b) => {
    const ex = b.hw * Math.abs(b.ux) + b.hd * Math.abs(b.vx);
    const ey = b.hw * Math.abs(b.uy) + b.hd * Math.abs(b.vy);
    return b.x - ex > ground.minX + 4 && b.x + ex < ground.maxX - 4 && b.y - ey > ground.minY + 4 && b.y + ey < ground.maxY - 4;
  };

  // Roads, trimmed at the place points so that landmarks can reach them.
  const isPoint = (x, y) => places.some((p) => p.x === x && p.y === y);
  for (const [ax, ay, bx, by] of roads) {
    const len = Math.hypot(bx - ax, by - ay);
    const ta = isPoint(ax, ay) ? Math.min(DOORSTEP, len / 2) / len : 0;
    const tb = isPoint(bx, by) ? Math.min(DOORSTEP, len / 2) / len : 0;
    const [sx, sy] = [ax + (bx - ax) * ta, ay + (by - ay) * ta];
    const [ex, ey] = [bx - (bx - ax) * tb, by - (by - ay) * tb];
    space.add(segmentBox(sx, sy, ex, ey, ROAD_WIDTH), 'road');
  }

  // People: doorsteps, crowds in front of landmarks, open places, patios.
  const residents = new Map();
  for (const n of header.neighbors ?? []) residents.set(n.home, (residents.get(n.home) ?? 0) + 1);
  for (const p of places) {
    const recipe = recipeOf(p);
    plan.crowd.set(p.id, recipe.crowd);
    space.add(obb(p.x, p.y, ROAD_WIDTH + 5, ROAD_WIDTH + 5), `step:${p.id}`);
    if (recipe.type === 'quarter') {
      const patio = patioOf(residents.get(p.id) ?? 0);
      plan.patios.push({ place: p.id, x: p.x, y: p.y, ...patio });
      space.add(obb(p.x, p.y, patio.hw * 2, patio.hh * 2), 'patio');
      continue;
    }
    const c = crowdBox(p, recipe.crowd, OPEN_ROOM[recipe.type] ?? CROWD_ROOM);
    space.add(obb(c.x, c.y, c.w, c.d), 'crowd');
    if (recipe.crowd === 'front') plan.paved.push({ ...c, rot: 0, kind: 'plaza' });
    if (recipe.type === 'square') {
      plan.square = { place: p.id, x: p.x, y: p.y, r: Math.max(SQUARE_RADIUS, Math.hypot(c.w, c.d) / 2 - 4) };
      space.add(obb(p.x, p.y, plan.square.r * 2 + 4, plan.square.r * 2 + 4, Math.PI / 4), 'square');
      space.add(obb(p.x, p.y, plan.square.r * 2 + 4, plan.square.r * 2 + 4), 'square');
    } else if (recipe.type === 'river') {
      plan.river = riverOf(p, c.d / 2, ground, rand);
      const path = plan.river.path;
      for (let i = 1; i < path.length; i++) {
        space.add(segmentBox(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1], plan.river.width + 4), 'river');
      }
    }
  }

  // Landmarks, grandest first.
  const publics = places
    .map((p) => ({ p, recipe: recipeOf(p) }))
    .filter(({ recipe }) => recipe.lots)
    .sort((a, b) => b.recipe.lots[0][0] * b.recipe.lots[0][1] - a.recipe.lots[0][0] * a.recipe.lots[0][1] || (a.p.id < b.p.id ? -1 : 1));
  for (const { p, recipe } of publics) {
    const lean = hash(p.id) % 2 ? 1 : -1;
    const b = fitLot(p, recipe, space, ground, lean);
    space.add(obb(b.x, b.y, b.w, b.d), 'lot');
    space.add(obb(b.court.x, b.court.y, b.court.w, b.court.d), 'court');
    plan.paved.push({ ...b.court, rot: 0, kind: 'court' });
    plan.buildings.push(b);
  }
  plan.buildings.sort((a, b) => (a.place < b.place ? -1 : 1));
  // Lamps on the far corners of each plaza.
  for (const p of places) {
    if (plan.crowd.get(p.id) !== 'front') continue;
    const c = crowdBox(p, 'front', CROWD_ROOM);
    for (const sx of [-1, 1]) {
      const box = obb(p.x + (sx * c.w) / 2, c.y + c.d / 2, 1.6, 1.6);
      if (space.hits(box, 0.6, (o) => o.tag === 'crowd' || o.tag.startsWith('step'))) continue;
      space.add(box, 'lamp');
      plan.lamps.push({ x: box.x, y: box.y });
    }
  }

  // The river's bridge and lanes come before anything else takes the banks.
  if (plan.river) {
    const rp = places.find((x) => recipeOf(x).type === 'river');
    layRiverside(plan.river, rp, space, rand, plan);
    for (const br of plan.bridges) {
      const top = br.y - br.len / 2;
      const bottom = br.y + br.len / 2;
      for (const [y0, y1] of [
        [top - 34, top],
        [bottom, ground.maxY - 6],
      ]) {
        const box = obb(br.x, (y0 + y1) / 2, 6, y1 - y0);
        plan.lanes.push({ x: br.x, y: (y0 + y1) / 2, w: 6, d: y1 - y0, rot: 0 });
        space.add(box, 'lane');
      }
    }
  }

  layLamps(roads, plan.square, space, plan);
  if (plan.square) layAroundSquare(plan.square, space, rand, onGround, plan);
  for (const p of places) {
    if (recipeOf(p).type !== 'quarter') continue;
    const patio = plan.patios.find((x) => x.place === p.id);
    layQuarter(p, patio, space, rand, onGround, plan);
    // Wells and lamps on the patio corners, outside the residents' grid.
    const cx = patio.gw + 6;
    const cy = patio.gh + 6;
    plan.props.push({ kind: 'well', x: p.x - cx, y: p.y - cy, rot: 0, scale: 1 });
    plan.props.push({ kind: 'well', x: p.x + cx, y: p.y + cy, rot: 0, scale: 1 });
    plan.lamps.push({ x: p.x + cx, y: p.y - cy }, { x: p.x - cx, y: p.y + cy });
  }
  const core = plan.square ?? { x: (home.minX + home.maxX) / 2, y: (home.minY + home.maxY) / 2 };
  layStreets(roads, core, space, rand, onGround, plan, 0);
  layStreets(roads, core, space, rand, onGround, plan, 1);
  layFields(ground, space, rand, plan);
  layTrees(ground, space, rand, plan);
  layScatter(ground, space, rand, plan);
  return plan;
}
