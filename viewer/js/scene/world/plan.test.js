import assert from 'node:assert/strict';
import test from 'node:test';

import { spreadHeader } from '../../core/position.js';
import { loadLog, SAMPLES } from '../../core/testing.js';
import { gridLayout, ROW_GAP, spacingFor } from '../../render/layout.js';
import { CELL, CROWD_GAP, CROWD_ROOM, crowdHalf, recipeOf, ROAD_WIDTH, roadSegments, townPlan } from './plan.js';
import { STREET } from './row.js';
import { createSpace, obb, overlaps, segmentBox } from './space.js';

// The viewer spreads the header before laying out the village (core/position.js).
const party = () => spreadHeader(loadLog(SAMPLES[0]).header);
const small = () => spreadHeader(loadLog(SAMPLES[1]).header);
const tel = () => spreadHeader(loadLog(SAMPLES[3]).header);

/** Every footprint of the plan that stands up (houses, lots, trees, gardens). */
function solids(plan) {
  return [
    ...plan.houses.map((h) => ({ what: 'house', box: obb(h.x, h.y, h.w * CELL, h.d * CELL, h.rot) })),
    ...plan.buildings.map((b) => ({ what: b.key, box: obb(b.x, b.y, b.w, b.d) })),
    ...plan.trees.map((t) => ({ what: 'tree', box: obb(t.x, t.y, 2, 2) })),
    ...plan.gardens.map((g) => ({ what: `garden ${g.kind}`, box: obb(g.x, g.y, g.w, g.d, g.rot) })),
  ];
}

/** Where people stand: the crowd of each landmark (CROWD_ROOM people), open places, patios. */
function peopleZones(header, plan) {
  const out = [];
  for (const p of header.places) {
    const patio = plan.patios.find((x) => x.place === p.id);
    if (patio) {
      out.push({ place: p.key, box: obb(p.x, p.y, patio.gw * 2, patio.gh * 2) });
      continue;
    }
    const { hw, hh } = crowdHalf(recipeOf(p).type === 'square' ? 100 : CROWD_ROOM);
    if (plan.crowd.get(p.id) === 'front') out.push({ place: p.key, box: obb(p.x, p.y + CROWD_GAP + hh, hw * 2, hh * 2) });
    else out.push({ place: p.key, box: obb(p.x, p.y, hw * 2, hh * 2) });
  }
  return out;
}

for (const [name, header] of [
  ['party-100', party],
  ['party-25', small],
]) {
  test(`${name}: the same header gives the same village`, () => {
    assert.deepEqual(townPlan(header()), townPlan(header()));
  });

  test(`${name}: one landmark per public place, north of its point, with its top`, () => {
    const h = header();
    const plan = townPlan(h);
    for (const p of h.places) {
      const r = recipeOf(p);
      const b = plan.buildings.find((x) => x.place === p.id);
      if (['building', 'mill', 'market', 'fountain'].includes(r.type)) {
        assert.ok(b, `${p.key} has a building`);
        assert.ok(b.y + b.d / 2 <= p.y, `${p.key} stands north of its point`);
        assert.ok(Number.isFinite(b.top) && b.top > 8, `${p.key} has a top`);
        assert.equal(plan.crowd.get(p.id), 'front');
      } else {
        assert.equal(b, undefined, `${p.key} is open`);
      }
    }
    assert.ok(plan.square && plan.river);
    assert.ok(plan.buildings.find((b) => b.key === 'church').top > plan.buildings.find((b) => b.key === 'bar').top, 'the church is the tallest');
  });

  test(`${name}: nothing stands on roads, on people or on anything else`, () => {
    const h = header();
    const plan = townPlan(h);
    const all = solids(plan);
    const roads = plan.roads.map((s) => segmentBox(...s, ROAD_WIDTH));
    // Landmarks may reach a road at their own doorstep (9 units from the point).
    const trimmed = plan.roads.map(([ax, ay, bx, by]) => {
      const len = Math.hypot(bx - ax, by - ay);
      const cut = (x, y) => (h.places.some((p) => p.x === x && p.y === y) ? Math.min(9, len / 2) / len : 0);
      const ta = cut(ax, ay);
      const tb = cut(bx, by);
      return segmentBox(ax + (bx - ax) * ta, ay + (by - ay) * ta, bx - (bx - ax) * tb, by - (by - ay) * tb, ROAD_WIDTH);
    });
    const landmarks = new Set(plan.buildings.map((b) => b.key));
    const people = peopleZones(h, plan);
    const space = createSpace();
    for (const { what, box } of all) {
      for (const r of landmarks.has(what) ? trimmed : roads) assert.ok(!overlaps(box, r, -0.5), `${what} on a road at ${box.x.toFixed(0)},${box.y.toFixed(0)}`);
      for (const z of people) assert.ok(!overlaps(box, z.box, -0.5), `${what} where the people of ${z.place} stand`);
      assert.ok(!space.hits(box, -0.5), `${what} on top of something else at ${box.x.toFixed(0)},${box.y.toFixed(0)}`);
      space.add(box);
    }
  });

  test(`${name}: everything stays on the ground`, () => {
    const plan = townPlan(header());
    const g = plan.ground;
    for (const { what, box } of solids(plan)) assert.ok(box.x > g.minX && box.x < g.maxX && box.y > g.minY && box.y < g.maxY, `${what} off the ground`);
  });

  test(`${name}: a full village (houses, gardens, trees, lamps)`, () => {
    const plan = townPlan(header());
    assert.ok(plan.houses.length > 150, `houses ${plan.houses.length}`);
    assert.ok(plan.gardens.length > 100 && plan.trees.length > 200 && plan.lamps.length > 30);
  });
}

test('the residents of a quarter keep their patio free', () => {
  const h = party();
  const plan = townPlan(h);
  for (const p of h.places.filter((x) => x.kind === 'home')) {
    const n = h.neighbors.filter((x) => x.home === p.id).length;
    const grid = gridLayout(new Array(n).fill(1), spacingFor(n));
    const zone = obb(p.x, p.y, grid.halfW * 2 + 8, grid.halfH * 2 + 8);
    for (const { what, box } of solids(plan)) assert.ok(!overlaps(zone, box), `${what} on the patio of ${p.key}`);
    for (const pr of plan.props.filter((x) => !x.small)) assert.ok(!overlaps(zone, obb(pr.x, pr.y, 5, 5)), `${pr.kind} on the patio of ${p.key}`);
  }
});

test('road segments are unique and come from the routes', () => {
  const header = party();
  const segs = roadSegments(header);
  const keys = new Set(segs.map((s) => s.join(',')));
  assert.equal(keys.size, segs.length);
  assert.ok(segs.length > 10 && CELL > 0);
});

test('the telephone row gets a street with house fronts behind, nothing in front of the people', () => {
  const h = tel();
  const plan = townPlan(h);
  assert.equal(plan.row, true);
  assert.equal(plan.buildings.length, 0);
  assert.ok(plan.houses.length > 20);
  const n = h.neighbors.length;
  for (const house of plan.houses) assert.ok(house.y + (house.d * CELL) / 2 < -STREET, 'houses stand behind the street');
  for (const t of plan.trees) {
    const inRow = t.x > -ROW_GAP && t.x < n * ROW_GAP;
    assert.ok(!inRow || t.y < -STREET || t.y > plan.ground.maxY - 40, `tree in front of the row at ${t.x.toFixed(0)},${t.y.toFixed(0)}`);
  }
  for (let i = 0; i < n; i++) {
    const spot = obb(i * ROW_GAP, 0, 10, 10);
    for (const { what, box } of solids(plan)) assert.ok(!overlaps(spot, box), `${what} on neighbor ${i}`);
  }
});
