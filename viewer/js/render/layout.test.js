import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera } from '../core/camera.js';
import { spreadHeader } from '../core/position.js';
import { initState } from '../core/reduce.js';
import { createStore } from '../core/store.js';
import { FIXTURE, loadLog, loadStore, SAMPLES } from '../core/testing.js';
import { createView, ROW_STRIP_PX } from './view.js';
import {
  busiestPlace,
  focusTarget,
  glide,
  gridLayout,
  homeBounds,
  isRow,
  nearestHit,
  placeLayout,
  pointAlong,
  routeIndex,
  rowLayout,
  SETTLE_TICKS,
  settleWeight,
  spacingFor,
  tripPath,
  tripPoint,
} from './layout.js';

const PARTY = SAMPLES[0];
const TELEPHONE = 'runs/samples/telephone-20-es-s5.jsonl';
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('point along a path by length', () => {
  const path = [
    [0, 0],
    [10, 0],
    [10, 30],
  ];
  assert.deepEqual(pointAlong(path, 0), { x: 0, y: 0 });
  assert.deepEqual(pointAlong(path, 1), { x: 10, y: 30 });
  assert.deepEqual(pointAlong(path, 0.25), { x: 10, y: 0 });
  assert.deepEqual(pointAlong(path, 0.5), { x: 10, y: 10 });
  assert.deepEqual(pointAlong(path, 2), { x: 10, y: 30 });
  assert.deepEqual(pointAlong([[3, 4]], 0.5), { x: 3, y: 4 });
});

test('routes are followed backwards when from > to', () => {
  const { header } = loadLog(PARTY);
  const index = routeIndex(header);
  const r = header.routes.find((x) => x.path.length > 3);
  assert.deepEqual(tripPath(header, index, r.from, r.to), r.path);
  assert.deepEqual(tripPath(header, index, r.to, r.from), [...r.path].reverse());
  // A trip starts at its origin and ends at its destination, by time.
  const trip = { from: r.to, to: r.from, start: 100, arrive: 100 + r.ticks };
  const a = tripPoint(header, index, trip, 100);
  const b = tripPoint(header, index, trip, 100 + r.ticks);
  assert.deepEqual([a.x, a.y], r.path[r.path.length - 1]);
  assert.deepEqual([b.x, b.y], r.path[0]);
  // Halfway in time is halfway along the path, which is on the route.
  const mid = tripPoint(header, index, trip, 100 + r.ticks / 2);
  assert.ok(Number.isFinite(mid.x) && Number.isFinite(mid.y));
});

test('every move of the samples has a route', () => {
  for (const rel of SAMPLES) {
    const { header, events } = loadLog(rel);
    const index = routeIndex(header);
    for (const e of events) if (e.type === 'move') assert.ok(index.has(`${e.from}|${e.to}`), `${rel}: ${e.from}→${e.to}`);
  }
});

test('grid: centred, no two cells on the same spot, pairs side by side', () => {
  const sizes = [1, 2, 1, 1, 2, 2, 1];
  const s = 12;
  const g = gridLayout(sizes, s);
  const cells = g.cells.flat();
  assert.equal(cells.length, 10);
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) assert.ok(dist(cells[i], cells[j]) >= s - 1e-9);
  for (const [i, size] of sizes.entries()) {
    if (size === 2) {
      assert.equal(g.cells[i][0].y, g.cells[i][1].y);
      assert.equal(Math.abs(g.cells[i][0].x - g.cells[i][1].x), s);
    }
  }
  const ys = cells.map((c) => c.y);
  assert.ok(Math.abs(Math.min(...ys) + Math.max(...ys)) < 1e-9, 'centred vertically');
  assert.ok(spacingFor(100) < spacingFor(10));
});

/** Checks the layout of a store: no overlaps, pairs together. */
function checkLayout(store) {
  const { header, state } = store;
  const { pos, blocks, placeOf } = placeLayout(header, state, store.firstPlace);
  const byPlace = new Map();
  for (const [id, p] of pos) {
    const place = placeOf.get(id);
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(p);
  }
  for (const [place, ps] of byPlace) {
    const s = spacingFor(ps.length);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(dist(ps[i], ps[j]) >= s - 1e-9, `${place} at ${state.tick}`);
    assert.equal(blocks.get(place).count, ps.length);
  }
  for (const c of state.convs.values()) {
    if (!pos.has(c.a) || !pos.has(c.b) || placeOf.get(c.a) !== placeOf.get(c.b)) continue;
    const s = spacingFor(blocks.get(placeOf.get(c.a)).count);
    assert.ok(Math.abs(dist(pos.get(c.a), pos.get(c.b)) - s) < 1e-9, `pair ${c.id} side by side`);
  }
  return { pos, blocks, placeOf };
}

test('hundred neighbors fit in the four quarters at night, without overlaps', () => {
  const store = loadStore(PARTY, 1439);
  const { pos, blocks } = checkLayout(store);
  assert.equal(pos.size + [...store.state.neighbors.values()].filter((n) => n.trip).length, 100);
  const quarters = store.header.places.filter((p) => p.kind === 'home').map((p) => p.id);
  const atHome = quarters.reduce((n, q) => n + (blocks.get(q)?.count ?? 0), 0);
  assert.ok(atHome >= 90, `${atHome} at home`);
  for (const q of quarters) {
    const b = blocks.get(q);
    if (b) assert.ok(b.halfW <= 50 && b.halfH <= 40, `${q} block ${b.halfW}x${b.halfH}`);
  }
});

test('layout of the samples at many ticks: no overlaps, pairs together', () => {
  const store = loadStore(PARTY, 420);
  for (let t = 420; t <= 1440; t += 37) {
    store.seek(t + 0.5);
    checkLayout(store);
  }
  const fixture = loadStore(FIXTURE, 1213);
  checkLayout(fixture);
});

test('stable: a conversation elsewhere does not move people here', () => {
  const store = loadStore(PARTY, 1000);
  const before = placeLayout(store.header, store.state, store.firstPlace);
  const state = structuredClone(store.state);
  // Start a fake conversation between two people of another place.
  const [p1, p2] = [...before.blocks.keys()];
  const at = (p) => [...before.placeOf].filter(([, q]) => q === p).map(([id]) => id);
  const [a, b] = at(p2).filter((id) => !state.neighbors.get(id).conv);
  if (!b) return;
  state.convs.set('cx', { id: 'cx', a, b, place: p2, start: 1000, turns: [] });
  state.neighbors.get(a).conv = 'cx';
  state.neighbors.get(b).conv = 'cx';
  const after = placeLayout(store.header, state, store.firstPlace);
  for (const id of at(p1)) assert.deepEqual(after.pos.get(id), before.pos.get(id));
  assert.equal(Math.abs(dist(after.pos.get(a), after.pos.get(b)) - spacingFor(at(p2).length)) < 1e-9, true);
  // The same state gives the same layout.
  assert.deepEqual(placeLayout(store.header, state, store.firstPlace).pos, after.pos);
});

test('initial place: first place seen, else home', () => {
  const { header } = loadLog(PARTY);
  const state = initState(header);
  const { pos } = placeLayout(header, state, () => undefined);
  const n = header.neighbors[0];
  const home = header.places.find((p) => p.id === n.home);
  assert.ok(dist(pos.get(n.id), home) < 60);
  const first = header.places[0];
  const { pos: pos2 } = placeLayout(header, state, (id) => (id === n.id ? first.id : undefined));
  assert.ok(dist(pos2.get(n.id), first) < 1e-9, 'alone at its first place');
});

test('telephone row: by id, one line, room for bubbles', () => {
  const { header } = loadLog(TELEPHONE);
  assert.ok(isRow(header));
  assert.ok(!isRow(loadLog(PARTY).header));
  const row = rowLayout(header);
  const ids = header.neighbors.map((n) => n.id).sort();
  assert.equal(row.size, 20);
  ids.forEach((id, i) => {
    assert.equal(row.get(id).y, 0);
    if (i) assert.ok(row.get(id).x > row.get(ids[i - 1]).x);
  });
  const b = homeBounds(header);
  assert.ok(b.minY <= -150, 'room above the row');
  assert.ok(b.minX < row.get(ids[0]).x && b.maxX > row.get(ids[19]).x);
});

test('focus names a neighbor or a place', () => {
  const { header } = loadLog(PARTY);
  assert.deepEqual(focusTarget(header, 'p01'), { kind: 'place', id: 'p01' });
  assert.deepEqual(focusTarget(header, 'square'), { kind: 'place', id: 'p01' });
  assert.deepEqual(focusTarget(header, 'Plaza'), { kind: 'place', id: 'p01' });
  assert.deepEqual(focusTarget(header, 'n003'), { kind: 'neighbor', id: 'n003' });
  assert.equal(focusTarget(header, 'nowhere'), null);
  assert.equal(focusTarget(header, null), null);
  const store = loadStore(FIXTURE, 1213);
  assert.equal(busiestPlace(store.state), 'p02');
});

test('hit test picks the nearest point inside the radius', () => {
  const pts = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 10, y: 0 },
  ];
  assert.equal(nearestHit(pts, 7, 1, 16), 'b');
  assert.equal(nearestHit(pts, 2, 1, 16), 'a');
  assert.equal(nearestHit(pts, 100, 100, 16), null);
});

/** A view over a store, as render/index.js makes it (spread header, no DOM). */
function viewOf(store) {
  return createView({ header: store.header, store, lang: 'es', hooks: { neighborColor: () => '#999' } });
}

/** A store of a log with its header spread, as the viewer opens it. */
function spreadStore(rel, upTo = Infinity) {
  const { header, events } = loadLog(rel);
  const store = createStore(spreadHeader(header));
  store.append(events.filter((e) => e.tick <= upTo));
  return { store, events };
}

test('glide: smooth weight, the same trip is never slowed', () => {
  assert.equal(settleWeight(10), 0);
  assert.equal(settleWeight(10 + SETTLE_TICKS), 1);
  assert.equal(settleWeight(10.99), 1);
  assert.ok(settleWeight(10.2) > 0 && settleWeight(10.2) < settleWeight(10.4));
  const a = { x: 0, y: 0, trip: null };
  const b = { x: 10, y: 20, trip: null };
  assert.deepEqual(glide(a, b, 7), { x: 0, y: 0 });
  assert.deepEqual(glide(a, b, 7.9), { x: 10, y: 20 });
  assert.deepEqual(glide(null, b, 7.1), { x: 10, y: 20 });
  const trip = { from: 'p1', to: 'p2', start: 3, arrive: 9 };
  assert.deepEqual(glide({ x: 0, y: 0, trip }, { x: 4, y: 0, trip: { ...trip } }, 7.1), { x: 4, y: 0 });
});

test('positions are continuous in pos: nobody jumps when a grid changes', () => {
  const { store } = spreadStore(PARTY);
  const view = viewOf(store);
  let jumps = 0;
  let moved = 0;
  for (let t = 1180; t <= 1300; t++) {
    store.seek(t - 1e-6);
    const a = new Map(view.positionsAt(store.state, store.pos));
    store.seek(t);
    const b = view.positionsAt(store.state, store.pos);
    store.seek(t + SETTLE_TICKS);
    const c = view.positionsAt(store.state, store.pos);
    for (const [id, p] of a) {
      if (dist(p, b.get(id)) > 1e-3) jumps++;
      if (dist(p, c.get(id)) > 1) moved++;
    }
  }
  assert.equal(jumps, 0, 'a jump at the start of a tick');
  assert.ok(moved > 100, `people moved (${moved})`);
});

test('the same pos gives the same positions, played, jumped or with the log growing', () => {
  const { store: played, events } = spreadStore(PARTY);
  const { store: jumped } = spreadStore(PARTY);
  const growing = spreadStore(PARTY, 1100).store;
  const vp = viewOf(played);
  const vj = viewOf(jumped);
  const vg = viewOf(growing);
  let n = 0;
  let next = growing.events.length;
  for (let pos = 1100; pos < 1290; pos += 0.37) {
    played.seek(pos);
    // Jump from far away each time.
    jumped.seek(pos > 1200 ? 500 : 1440);
    jumped.seek(pos);
    // Live-like: only the events up to this tick are known.
    const more = [];
    while (next < events.length && events[next].tick <= Math.floor(pos)) more.push(events[next++]);
    if (more.length) growing.append(more);
    growing.seek(pos);
    const a = vp.positionsAt(played.state, played.pos);
    const b = vj.positionsAt(jumped.state, jumped.pos);
    const c = vg.positionsAt(growing.state, growing.pos);
    for (const [id, p] of a) {
      assert.deepEqual(b.get(id), p, `${id} at ${pos}: jumped`);
      // The first place seen of somebody without events yet can differ.
      if (growing.firstPlace(id) === played.firstPlace(id)) assert.deepEqual(c.get(id), p, `${id} at ${pos}: growing`);
      n++;
    }
  }
  assert.ok(n > 10000);
});

test('telephone home view: the row fills the width with room for the strip below', () => {
  const store = loadStore(TELEPHONE, 1210.5);
  const view = viewOf(store);
  const cam = createCamera();
  cam.resize(1600, 900);
  // The side columns do not narrow it: the row takes the whole width.
  view.setInsets({ l: 316, r: 372, t: 64, b: 90 });
  const home = view.homeView(cam);
  cam.base = home.scale;
  cam.reset(home);
  const b = view.bounds;
  const left = cam.toScreen(b.minX, b.maxY);
  const right = cam.toScreen(b.maxX, b.maxY);
  assert.ok(left.x >= 0 && left.x < 30 && right.x <= 1600 && right.x > 1570, `row ${left.x}…${right.x}`);
  // Its box rests on the strip, which sits on the bar, and starts under the banner.
  const bottom = cam.toScreen(home.x, b.maxY).y;
  const top = cam.toScreen(home.x, b.minY).y;
  assert.ok(Math.abs(bottom - (900 - 90 - ROW_STRIP_PX - 12)) < 0.5, `bottom ${bottom}`);
  assert.ok(top >= 64, `top ${top}`);
  // A short canvas: the height rules and the row is narrower.
  cam.resize(1600, 520);
  const low = view.homeView(cam);
  cam.base = low.scale;
  cam.reset(low);
  assert.ok(cam.toScreen(low.x, b.minY).y >= 64 + 11.5, 'bubbles under the banner');
});
