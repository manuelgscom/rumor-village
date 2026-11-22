import assert from 'node:assert/strict';
import test from 'node:test';

import { loadLog, loadStore, SAMPLES } from '../../core/testing.js';
import {
  ACCESSORIES,
  accessoriesOf,
  ACTOR_FILES,
  activityOf,
  CHARACTERS,
  GESTURE_FADE,
  gestureAt,
  GLYPH_INK,
  GLYPH_STROKES,
  GLYPH_WIDTH,
  headingTo,
  ICON_KINDS,
  ICON_TICKS,
  iconLook,
  iconsAt,
  looksOf,
  modelsOf,
  OUTFITS,
  REACT_TICKS,
  reactionAt,
  reactionClips,
  recolor,
  restHeading,
  sparkAt,
  tellPulse,
  versionOfColor,
  WORKER,
} from './look.js';
import { VERSION_COLORS } from '../../core/theme.js';

/** Clip lengths of the Mini Characters (seconds). */
const DURATIONS = { idle: 1.33, walk: 0.67, 'interact-right': 0.67, 'interact-left': 0.67, 'emote-yes': 0.67, 'emote-no': 0.67, 'pick-up': 0.33, jump: 0.5 };

test('every neighbor gets a model of its gender, the same every time', () => {
  const { header } = loadLog(SAMPLES[0]);
  const a = modelsOf(header);
  const b = modelsOf(header);
  assert.deepEqual([...a], [...b]);
  for (const n of header.neighbors) assert.ok(CHARACTERS[n.gender === 'f' ? 'f' : 'm'].includes(a.get(n.id)), n.id);
});

test('models are spread inside each home', () => {
  const { header } = loadLog(SAMPLES[0]);
  const models = modelsOf(header);
  const byHome = new Map();
  for (const n of header.neighbors) {
    const key = `${n.home}|${n.gender}`;
    if (!byHome.has(key)) byHome.set(key, new Map());
    const m = byHome.get(key);
    m.set(models.get(n.id), (m.get(models.get(n.id)) ?? 0) + 1);
  }
  for (const counts of byHome.values()) {
    const v = [...counts.values()];
    assert.ok(Math.max(...v) - Math.min(...v) <= 1);
  }
});

test('looks: stable, hard hat only on men of some trades, accessories by job', () => {
  const { header } = loadLog(SAMPLES[0]);
  const a = looksOf(header);
  assert.deepEqual([...a], [...looksOf(header)]);
  const byId = new Map(header.neighbors.map((n) => [n.id, n]));
  let glasses = 0;
  for (const [id, look] of a) {
    const n = byId.get(id);
    if (look.model === WORKER) {
      assert.notEqual(n.gender, 'f', id);
      assert.ok(['carpenter', 'miller', 'farmer'].includes(n.job), id);
    }
    assert.ok(look.scale >= 0.9 && look.scale <= 1.06, id);
    assert.ok(look.outfit >= 0 && look.outfit < OUTFITS.length, id);
    for (const k of look.accessories) assert.ok(ACCESSORIES[k], k);
    assert.ok(!(look.accessories.includes('glasses') && look.accessories.includes('sunglasses')), id);
    if (['clerk', 'teacher', 'pharmacist'].includes(n.job)) assert.ok(look.accessories.includes('glasses'), id);
    if (n.job === 'merchant') assert.ok(look.accessories.includes('luggage'), id);
    if (look.accessories.includes('cane')) assert.equal(n.job, 'retired', id);
    if (look.accessories.includes('glasses')) glasses++;
  }
  // Some variety, not a village of spectacles.
  assert.ok(glasses > 5 && glasses < 50, `${glasses} with glasses`);
  // Every file a look needs is loaded.
  for (const look of a.values()) assert.ok(ACTOR_FILES.includes(`character-${look.model}`), look.model);
  for (const spec of Object.values(ACCESSORIES)) assert.ok(ACTOR_FILES.includes(spec.file), spec.file);
  assert.deepEqual(accessoriesOf({ id: 'x', job: 'teacher' }), accessoriesOf({ id: 'x', job: 'teacher' }));
});

test('outfits turn cool clothes only: skin, hair and greys stay', () => {
  const keep = [
    [242, 191, 153], // skin
    [176, 96, 65], // dark skin
    [56, 56, 61], // dark hair
    [255, 126, 68], // orange
    [255, 192, 68], // yellow
    [255, 255, 255],
    [245, 200, 240], // pale pink
  ];
  for (const turn of OUTFITS) for (const c of keep) assert.deepEqual(recolor(...c, turn), c, `${c} @${turn}`);
  assert.deepEqual(recolor(103, 148, 217, 0), [103, 148, 217]);
  const blue = recolor(103, 148, 217, 115);
  assert.notDeepEqual(blue, [103, 148, 217]);
  // Brightness (max channel) is kept.
  assert.ok(Math.abs(Math.max(...blue) - 217) <= 1);
});

test('activity: walking, talking, listening, idle', () => {
  const state = {
    tick: 10,
    neighbors: new Map([
      ['a', { trip: { from: 'p1', to: 'p2', start: 5, arrive: 20 }, conv: null }],
      ['b', { trip: null, conv: 'c1' }],
      ['c', { trip: null, conv: 'c1' }],
      ['d', { trip: null, conv: null }],
    ]),
    convs: new Map([['c1', { a: 'b', b: 'c', turns: [{ who: 'c' }] }]]),
  };
  assert.deepEqual(activityOf(state, 'a'), { action: 'walk', partner: null });
  assert.deepEqual(activityOf(state, 'b'), { action: 'listen', partner: 'c' });
  assert.deepEqual(activityOf(state, 'c'), { action: 'talk', partner: 'b' });
  assert.deepEqual(activityOf(state, 'd'), { action: 'idle', partner: null });
});

test('gestures: pure in time, valid clips, talking alternates hands, listening nods', () => {
  for (const action of ['talk', 'listen', 'idle']) {
    const seen = new Set();
    for (let t = 0; t < 30; t += 0.05) {
      const g = gestureAt(action, 'n007', 'farmer', t, DURATIONS);
      assert.deepEqual(g, gestureAt(action, 'n007', 'farmer', t, DURATIONS));
      assert.ok(DURATIONS[g.clip] > 0, g.clip);
      assert.ok(g.time >= 0 && g.time < DURATIONS[g.clip], `${g.clip} ${g.time}`);
      assert.ok(g.blend > 0 && g.blend <= 1);
      if (g.prev) {
        assert.notEqual(g.prev.clip, g.clip);
        assert.ok(g.blend < 1);
      }
      seen.add(g.clip);
    }
    if (action === 'talk') assert.ok(seen.has('interact-right') && seen.has('interact-left'));
    if (action === 'listen') assert.ok(seen.has('emote-yes') && seen.has('idle'));
    if (action === 'idle') assert.ok(seen.has('idle') && seen.has('pick-up'));
  }
  // Neighbors are out of step with each other.
  const clips = new Set(['n001', 'n002', 'n003', 'n004', 'n005'].map((id) => gestureAt('talk', id, 'clerk', 3, DURATIONS).clip));
  assert.ok(clips.size > 1);
  // Missing clips fall back to idle.
  assert.equal(gestureAt('talk', 'n001', 'clerk', 1, {}).clip, 'idle');
  assert.ok(GESTURE_FADE > 0 && GESTURE_FADE < 0.5);
});

test('headings: 0 faces +Z (the camera), resting stays near it', () => {
  assert.equal(headingTo({ x: 0, y: 0 }, { x: 0, y: 5 }), 0);
  assert.ok(Math.abs(headingTo({ x: 0, y: 0 }, { x: 5, y: 0 }) - Math.PI / 2) < 1e-9);
  assert.equal(headingTo({ x: 1, y: 1 }, { x: 1, y: 1 }), null);
  assert.ok(Math.abs(restHeading('n001')) <= 0.45);
  assert.equal(restHeading('n001'), restHeading('n001'));
});

test('contagion pulse: pops, spreads and fades out with age', () => {
  const start = tellPulse(0);
  const end = tellPulse(1);
  assert.equal(start.pop, 1);
  assert.ok(tellPulse(0.12).pop > 1.3);
  assert.equal(end.pop, 1);
  assert.equal(end.ringAlpha, 0);
  assert.equal(end.flash, 0);
  assert.equal(end.beam, 0);
  assert.equal(end.hop, 0);
  assert.ok(tellPulse(0.1).hop > 0 && tellPulse(0.1).hop < 1);
  let last = 0;
  for (let a = 0; a <= 1; a += 0.05) {
    const p = tellPulse(a);
    assert.ok(p.ring >= last - 1e-9, 'ring grows');
    last = p.ring;
    for (const k of ['ringAlpha', 'flash', 'beam']) assert.ok(p[k] >= 0 && p[k] <= 1, k);
  }
  // Ages outside 0 … 1 are clamped.
  assert.deepEqual(tellPulse(-1), tellPulse(0));
  assert.deepEqual(tellPulse(2), tellPulse(1));
});

test('sparks: start near the disc, rise and come back, vanish at the end', () => {
  for (let i = 0; i < 10; i++) {
    const s0 = sparkAt(i, 10, 0, 'n001');
    const mid = sparkAt(i, 10, 0.5, 'n001');
    const s1 = sparkAt(i, 10, 1, 'n001');
    assert.ok(mid.y > s0.y && mid.y > s1.y);
    assert.equal(s1.size, 0);
    assert.deepEqual(mid, sparkAt(i, 10, 0.5, 'n001'));
  }
});

test('the token of each version has its own shape, inside the face', () => {
  assert.equal(versionOfColor(VERSION_COLORS.correct), 'correct');
  assert.equal(versionOfColor(VERSION_COLORS.incomplete.toUpperCase()), 'incomplete');
  assert.equal(versionOfColor(VERSION_COLORS.wrong), 'wrong');
  assert.equal(versionOfColor(VERSION_COLORS.unknown), null);
  assert.equal(versionOfColor('#123456'), null);
  const shapes = new Set();
  for (const v of ['correct', 'incomplete', 'wrong']) {
    const strokes = GLYPH_STROKES[v];
    assert.ok(strokes.length >= 1, v);
    assert.ok(GLYPH_INK[v], v);
    for (const line of strokes) {
      assert.ok(line.length >= 2, v);
      for (const [x, y] of line) assert.ok(Math.hypot(x, y) + GLYPH_WIDTH / 2 < 0.78, `${v}: ${x},${y} off the face`);
    }
    shapes.add(JSON.stringify(strokes));
  }
  assert.equal(shapes.size, 3, 'three different shapes');
  // ✓ ends high on the right; ✗ is two crossing strokes; ~ goes up and then down.
  const check = GLYPH_STROKES.correct[0];
  assert.ok(check.at(-1)[1] < check[0][1] && check.at(-1)[0] > 0);
  assert.equal(GLYPH_STROKES.wrong.length, 2);
  const wave = GLYPH_STROKES.incomplete[0].map((p) => p[1]);
  assert.ok(Math.min(...wave.slice(0, 6)) < 0 && Math.max(...wave.slice(6)) > 0);
});

test('icons over the heads: from the memory events of the last ticks, a function of pos', () => {
  const store = loadStore(SAMPLES[0], 1440);
  const { events } = store;
  const fact = store.firstFact;
  const kinds = new Set();
  let shown = 0;
  for (let pos = 430; pos < 1440; pos += 3.3) {
    const index = store.countUntil(Math.floor(pos));
    const icons = iconsAt(events, index, pos, fact);
    for (const [who, ic] of icons) {
      assert.ok(ICON_KINDS.includes(ic.kind));
      assert.ok(ic.tick <= pos && ic.tick > pos - ICON_TICKS && ic.age >= 0 && ic.age < 1);
      // It is the youngest of its memory events up to pos.
      const later = events.slice(0, index).filter((e) => e.type === 'memory' && e.who === who && e.fact === fact && e.tick > ic.tick);
      assert.equal(later.length, 0);
      kinds.add(ic.kind);
      shown++;
    }
  }
  assert.ok(shown > 50, `${shown} icons`);
  assert.deepEqual([...kinds].sort(), [...ICON_KINDS].sort());
  // Nothing after the last applied event, nothing older than ICON_TICKS.
  assert.equal(iconsAt(events, 0, 1000, fact).size, 0);
  // It pops in, stays and fades out.
  assert.ok(iconLook(0).alpha === 0 && iconLook(0.3).alpha === 1 && iconLook(0.99).alpha < 0.05);
  assert.ok(iconLook(0.5).rise > iconLook(0.1).rise);
});

test('arriving: cheer at the original place and hour, puzzled elsewhere, continuous in pos', () => {
  const store = loadStore(SAMPLES[0], 1440);
  const fact = store.firstFact;
  const count = { cheer: 0, puzzled: 0 };
  const arrivals = store.events.filter((e) => e.type === 'arrive' && e.fact === fact);
  const firsts = new Map();
  for (const a of arrivals) if (!firsts.has(a.who)) firsts.set(a.who, a);
  for (const a of firsts.values()) {
    store.seek(a.tick + 1);
    const r = reactionAt(store.state, fact, a.who, store.pos);
    assert.ok(r && r.since === 1);
    count[r.kind]++;
    store.seek(a.tick + REACT_TICKS + 0.01);
    assert.equal(reactionAt(store.state, fact, a.who, store.pos), null);
  }
  // rumor.test.js: 33 at the right place and hour, 6 others in this sample.
  assert.deepEqual(count, { cheer: 33, puzzled: 6 });
  // The clips follow pos: small steps of since give small steps of time.
  for (const kind of ['cheer', 'puzzled']) {
    let prev = reactionClips(kind, 0, DURATIONS);
    for (let s = 0.02; s < REACT_TICKS; s += 0.02) {
      const r = reactionClips(kind, s, DURATIONS);
      assert.ok(r.weight >= 0 && r.weight <= 1 && r.hop >= 0 && r.hop <= 1);
      assert.ok(Math.abs(r.weight - prev.weight) < 0.06);
      prev = r;
    }
    assert.ok(reactionClips(kind, REACT_TICKS, DURATIONS).weight === 0);
  }
  assert.equal(reactionClips('cheer', 0.75, DURATIONS).entries[0].clip, 'jump');
  assert.equal(reactionClips('puzzled', 1, DURATIONS).entries[0].clip, 'emote-no');
});
