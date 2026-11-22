import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockOf, daylight, dayOf, isNight, slotTime } from './clock.js';
import { isCapture, parseParams } from './params.js';
import { createCamera } from './camera.js';
import { mix, paletteAt, DAY, NIGHT, versionColor, VERSION_COLORS } from './theme.js';

test('tick to weekday and hour', () => {
  // start_weekday 1 = Tuesday; tick 0 is 00:00 of day 0.
  assert.equal(clockOf(420, 1, 'es').text, 'martes 07:00');
  assert.equal(clockOf(1290.7, 1, 'es').text, 'martes 21:30');
  assert.equal(clockOf(1440 + 615, 1, 'en').text, 'Wednesday 10:15');
  assert.equal(clockOf(6 * 1440, 1, 'es').weekdayName, 'lunes');
  assert.equal(dayOf(1439), 0);
  assert.equal(dayOf(1440), 1);
  assert.equal(slotTime(42), '21:00');
  assert.equal(slotTime(48 + 19), '09:30');
});

test('night and daylight', () => {
  assert.equal(isNight(12 * 60), false);
  assert.equal(isNight(23 * 60), true);
  assert.equal(isNight(3 * 60), true);
  assert.equal(isNight(1440 + 7 * 60), false);
  assert.equal(daylight(12 * 60), 1);
  assert.equal(daylight(2 * 60), 0);
  // Smooth: small steps through dusk change little.
  for (let t = 20 * 60; t < 22 * 60; t += 0.5) assert.ok(Math.abs(daylight(t + 0.5) - daylight(t)) < 0.02);
});

test('url parameters', () => {
  const p = parseParams('?log=/runs/samples/a.jsonl&t=1320.5&zoom=far&focus=p01&select=n003&group=late&speed=4&paused=1&draft=hola');
  assert.deepEqual(p, {
    log: '/runs/samples/a.jsonl',
    live: false,
    t: 1320.5,
    zoom: 'far',
    focus: 'p01',
    select: 'n003',
    group: 'late',
    speed: 4,
    paused: true,
    draft: 'hola',
    left: null,
    right: null,
    embed: false,
    summary: false,
    fx: true,
    director: false,
    ui: null,
    tour: null,
    chapter: null,
    lang: null,
    labels: null,
    manifest: null,
    hold: false,
    hover: null,
    open: null,
    cam: null,
    q: 'auto',
    stats: false,
    clock: null,
    trail: true,
    photo: false,
    opening: null,
    play: false,
    game: null,
    code: null,
    screen: null,
  });
  // The game mode (phase 9): play implies live; screen is a capture.
  const g = parseParams('?play=1&code=RV1-abc&screen=MENU');
  assert.deepEqual([g.play, g.live, g.code, g.screen, g.game], [true, true, 'RV1-abc', 'menu', null]);
  assert.equal(isCapture(g), true);
  assert.equal(isCapture(parseParams('?play=1')), false);
  assert.equal(parseParams('?screen=nope').screen, null);
  const mine = parseParams('?log=games/x.jsonl&game=x');
  assert.deepEqual([mine.play, mine.live, mine.game], [false, false, 'x']);
  assert.deepEqual(parseParams('?cam=10,20.5,2').cam, { x: 10, y: 20.5, zoom: 2 });
  assert.equal(parseParams('?cam=1,2').cam, null);
  assert.equal(parseParams('?fx=0').fx, false);
  const n = parseParams('?ui=TECH&tour=1&chapter=3&lang=es&labels=base,ft&manifest=m.json&hold=1&hover=n003');
  assert.deepEqual(
    [n.ui, n.tour, n.chapter, n.lang, n.labels, n.manifest, n.hold, n.hover],
    ['tech', true, 3, 'es', ['base', 'ft'], 'm.json', true, 'n003'],
  );
  assert.deepEqual([parseParams('?ui=x').ui, parseParams('?tour=0').tour, parseParams('?chapter=0').chapter, parseParams('?labels=a').labels], [null, false, null, null]);
  assert.equal(isCapture(parseParams('?log=a')), false);
  for (const q of ['?t=1', '?paused=0', '?embed=1', '?summary=1', '?draft=']) assert.equal(isCapture(parseParams(q)), true, q);
  assert.equal(parseParams('?director').director, true);
  const q = parseParams('?live=1&speed=fast&paused=0&zoom=2.5&t=x');
  assert.equal(q.live, true);
  assert.equal(q.speed, 'fast');
  assert.equal(q.paused, false);
  assert.equal(q.zoom, 2.5);
  assert.equal(q.t, null);
  assert.equal(parseParams('').paused, null);
  assert.equal(parseParams('?live').live, true);
  const v = parseParams('?q=LOW&stats&clock=0&trail=0&photo=1&opening=1.5');
  assert.deepEqual([v.q, v.stats, v.clock, v.trail, v.photo, v.opening], ['low', true, 0, false, true, 1]);
  assert.deepEqual([parseParams('?q=ultra').q, parseParams('?clock=x').clock, parseParams('?opening=0.4').opening], ['auto', null, 0.4]);
  assert.equal(isCapture(parseParams('?log=a&clock=0')), true);
  assert.equal(isCapture(parseParams('?log=a&q=low&stats=1')), false);
  const s = parseParams('?left=/a.jsonl&right=/b.jsonl&embed=1&summary');
  assert.deepEqual([s.left, s.right, s.embed, s.summary], ['/a.jsonl', '/b.jsonl', true, true]);
});

test('camera round trip and fit', () => {
  let changes = 0;
  const cam = createCamera(() => changes++);
  cam.resize(800, 600);
  cam.fit({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 0);
  assert.equal(cam.scale, 0.8);
  const c = cam.toScreen(500, 250);
  assert.ok(Math.abs(c.x - 400) < 1e-9 && Math.abs(c.y - 300) < 1e-9);
  const w = cam.toWorld(123, 456);
  const s = cam.toScreen(w.x, w.y);
  assert.ok(Math.abs(s.x - 123) < 1e-9 && Math.abs(s.y - 456) < 1e-9);
  assert.equal(cam.moved, false);
  cam.set({ scale: 2 });
  assert.equal(cam.moved, true);
  assert.equal(changes, 2);
});

test('theme colors', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(paletteAt(1).ground, DAY.ground);
  assert.equal(paletteAt(0).ground, NIGHT.ground);
  assert.equal(versionColor(null), VERSION_COLORS.unknown);
  assert.equal(versionColor('wrong'), VERSION_COLORS.wrong);
});
