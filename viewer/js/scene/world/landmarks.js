// The landmark of each public place, drawn on the lot that plan.js chose
// (lots.js): main body, towers, porches and everything around it, plus its
// annex (terrace, graveyard, yard…). Local frame: lot centre, front +Z.
//
//      annex          main body             z
//   ┌─────────┬───────────────────────┐   ─┼─ -d/2
//   │ terrace │  walls · roof · tower │    │
//   └─────────┴──────────⌂────────────┘   ─┼─ +d/2 (front)
//                 court: steps, flags      │

import * as THREE from 'three';
import { CELL, FRONT_GAP, random } from './plan.js';
import { SAILS, SPIRE } from './recipes.js';
import { addBody, addGableRoof, addWalls, at, barrel, COLORS, crate, fence, hedge, inside, roofColor, sack, stoneWall, terraceTable } from './parts.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Frame of a landmark: lot matrix, main body, annex, door cell. */
function frameOf(b) {
  const m = at(b.x, b.y);
  const mx = b.main.x - b.x;
  const w = b.main.w;
  const d = b.main.d;
  const door = Math.round((b.door.x - (b.main.x - ((w - 1) * CELL) / 2)) / CELL);
  const annex = b.annex ? { x: b.annex.x - b.x, w: b.annex.w * CELL, side: b.annex.side } : null;
  const court = FRONT_GAP + b.setback;
  return { m, mx, w, d, door, annex, hd: b.d / 2, court, mm: inside(m, mx, 0) };
}

/** Wide steps in front of a door (local x of the door cell). */
function steps(ctx, m, x, z, width, n = 3) {
  for (let i = 0; i < n; i++) ctx.box(COLORS.stone, m, x, z + 0.6 + i * 1.2, width + i * 1.2, (n - i) * 0.5, 1.2);
}

/** A flag pole with a banner. */
function flag(ctx, m, x, z, color, h = 16) {
  ctx.cyl(COLORS.white, m, x, z, 0.25, h, 0, true);
  ctx.ball(COLORS.gold, m, x, z, 0.5, h, true);
  ctx.box(color, m, x + 2.4, z, 4.6, 3, 0.2, h - 3.6, 0, true);
}

/** A spire (kit roof-high-point) on a tower cell. */
function spire(ctx, m, x, z, base, [sw, sh]) {
  ctx.piece('roof-high-point', inside(m, x, z, 0, V(CELL * sw, CELL * sh, CELL * sw), base));
}

/** Trees of the kit, scaled. */
function tree(ctx, m, x, z, kind = 'tree', s = 0.8, rot = 0, narrow = 1) {
  ctx.piece(kind, inside(m, x, z, rot, V(CELL * s * narrow, CELL * s, CELL * s * narrow)));
}

const BUILDERS = {
  church(ctx, b, f, rand) {
    const { mm, w, d, door, annex } = f;
    const floors = b.recipe.floors ?? 2;
    addBody(ctx, mm, {
      w, d, floors, walls: 'stone', roof: b.recipe.roof, door, rand, lit: 0.7,
      pick: (fl, side, i, set) => (side === 'east' || side === 'west' ? (i % 2 ? 'wall-window-round' : set.plain) : side === 'front' && fl > 0 ? 'wall-window-round' : null),
    });
    // Rose window on the front gable.
    ctx.disc(null, mm, 0, floors * CELL + 4.5, (d * CELL) / 2 + 0.15, 2.8, true);
    ctx.disc(COLORS.stone, mm, 0, floors * CELL + 4.5, (d * CELL) / 2 + 0.1, 3.4);
    // Bell tower on the front corner away from the annex, rising from the roof line.
    const side = annex ? -annex.side : -1;
    const tx = side * ((w - 1) / 2) * CELL;
    const tz = ((d - 1) / 2) * CELL;
    const tm = inside(mm, tx, tz);
    const tower = b.recipe.tower ?? 5;
    addWalls(ctx, tm, { w: 1, d: 1, floors: tower, from: floors, walls: 'stone', door: -1, rand, pick: (fl) => (fl === tower - 1 ? 'wall-window-round' : fl % 2 ? 'wall-window-small' : 'wall') });
    ctx.box(COLORS.stoneDark, tm, 0, 0, CELL * 1.12, 0.8, CELL * 1.12, tower * CELL);
    spire(ctx, tm, 0, 0, tower * CELL + 0.8, SPIRE.church);
    ctx.ball(COLORS.gold, tm, 0, 0, 0.9, tower * CELL + 0.8 + SPIRE.church[1] * CELL - 0.6, true);
    // Bell under the top arch.
    ctx.cone(COLORS.gold, tm, 0, 0, 1.6, 2.6, (tower - 1) * CELL + 3.5, true);
    steps(ctx, mm, (door - (w - 1) / 2) * CELL, (d * CELL) / 2, CELL * 1.2);
    // Apse (a lower round end) at the back.
    ctx.cyl(COLORS.gableStone, mm, 0, -(d * CELL) / 2, CELL * 1.1, floors * CELL * 0.75, 0, false, true);
    ctx.cone(roofColor(b.recipe.roof), mm, 0, -(d * CELL) / 2, CELL * 1.25, CELL * 0.9, floors * CELL * 0.75);
    if (annex) graveyard(ctx, f, rand);
  },

  chapel(ctx, b, f, rand) {
    const { mm, w, d, door, annex } = f;
    addBody(ctx, mm, { w, d, floors: 1, walls: 'stone', roof: b.recipe.roof, door, rand, lit: 0.8, alongX: false, pick: (fl, side, i, set) => (side === 'east' || side === 'west' ? (i % 2 ? 'wall-window-round' : set.plain) : null) });
    const side = annex ? -annex.side : 1;
    const tm = inside(mm, side * ((w - 1) / 2) * CELL, ((d - 1) / 2) * CELL);
    const tower = b.recipe.tower ?? 3;
    addWalls(ctx, tm, { w: 1, d: 1, floors: tower, from: 1, walls: 'stone', door: -1, rand, pick: (fl) => (fl === tower - 1 ? 'wall-window-round' : 'wall-window-small') });
    spire(ctx, tm, 0, 0, tower * CELL, SPIRE.chapel);
    ctx.cone(COLORS.gold, tm, 0, 0, 1.3, 2.2, (tower - 1) * CELL + 3.5, true);
    ctx.ball(COLORS.gold, tm, 0, 0, 0.7, tower * CELL + SPIRE.chapel[1] * CELL - 0.4, true);
    steps(ctx, mm, (door - (w - 1) / 2) * CELL, (d * CELL) / 2, CELL, 2);
    if (annex) {
      // A walled yard of cypresses.
      const { x, w: aw } = annex;
      const z0 = -f.hd + 1;
      const z1 = f.hd - 1;
      const x0 = x - aw / 2 + 1;
      const x1 = x + aw / 2 - 1;
      stoneWall(ctx, f.m, x0, z0, x1, z0);
      stoneWall(ctx, f.m, x0, z0, x0, z1);
      stoneWall(ctx, f.m, x1, z0, x1, z1);
      stoneWall(ctx, f.m, x0, z1, x - 3, z1);
      stoneWall(ctx, f.m, x + 3, z1, x1, z1);
      for (let i = 0; i < 4; i++) tree(ctx, f.m, x0 + 4 + (i % 2) * (aw - 10), z0 + 5 + Math.floor(i / 2) * (f.hd * 2 - 12), 'tree-high', 0.75, rand() * 6, 0.55);
      ctx.piece('stall-bench', inside(f.m, x, 0, Math.PI / 2, CELL), true);
    }
  },

  town_hall(ctx, b, f, rand) {
    const { mm, w, d, door, annex } = f;
    const floors = b.recipe.floors ?? 2;
    const dx = (door - (w - 1) / 2) * CELL;
    addBody(ctx, mm, {
      w, d, floors, walls: 'stone', roof: b.recipe.roof, door, rand, lit: 0.8,
      skip: (fl, side, i) => fl > 0 && side === 'front' && i === door,
      pick: (fl, side, i, set) => (side === 'front' ? (fl === 0 && i !== door ? set.window : fl > 0 ? (Math.abs(i - door) === 1 ? 'balcony-wall' : set.window) : null) : null),
    });
    // Central pavilion: the door column rises two floors above the roof, with a clock and a spire.
    const pm = inside(mm, dx, ((d - 1) / 2) * CELL + 2);
    const top = floors + 2;
    addWalls(ctx, pm, { w: 1, d: 1, floors: top, from: 1, walls: 'stone', door: -1, rand, lit: 0.9, pick: (fl, side) => (side === 'front' && fl === 1 ? 'balcony-wall' : fl === top - 1 ? 'wall-window-round' : 'wall-window-small') });
    ctx.box(COLORS.stoneDark, pm, 0, 0, CELL * 1.15, 0.9, CELL * 1.15, top * CELL);
    spire(ctx, pm, 0, 0, top * CELL + 0.9, SPIRE.town_hall);
    ctx.disc(COLORS.white, pm, 0, (top - 1) * CELL + 5, CELL / 2 + 0.2, 2.6);
    ctx.box(COLORS.dark, pm, 0, CELL / 2 + 0.35, 0.35, 2.2, 0.1, (top - 1) * CELL + 5, 0, true);
    ctx.box(COLORS.dark, pm, 0.8, CELL / 2 + 0.35, 1.7, 0.35, 0.1, (top - 1) * CELL + 5, 0, true);
    // Balcony slab over the door.
    ctx.box(COLORS.stoneDark, pm, 0, CELL / 2 + 1.2, CELL * 1.1, 0.6, 3, CELL);
    // Banners on the front wall, both sides of the door.
    for (let i = 0; i < w; i++) {
      if (i === door || Math.abs(i - door) > 2) continue;
      ctx.piece(i % 2 ? 'banner-green' : 'banner-red', inside(mm, (i - (w - 1) / 2) * CELL, (d * CELL) / 2 - CELL * 0.38 + 0.4, -Math.PI / 2, CELL, CELL * 1.05));
    }
    steps(ctx, mm, dx, (d * CELL) / 2 + 2, CELL * 1.8, 3);
    // Flags at the front corners of the court.
    const fz = f.hd + Math.min(f.court - 1, 6);
    for (const s of [-1, 1]) flag(ctx, f.m, f.mx + s * ((w * CELL) / 2 - 2), fz, s < 0 ? COLORS.red : COLORS.gold, 18);
    if (annex) {
      // A formal garden: hedges, a statue and flower beds.
      const { x, w: aw } = annex;
      hedge(ctx, f.m, x - aw / 2 + 1, -f.hd + 1, x + aw / 2 - 1, -f.hd + 1);
      hedge(ctx, f.m, x + (annex.side * aw) / 2 - annex.side, -f.hd + 1, x + (annex.side * aw) / 2 - annex.side, f.hd - 1);
      ctx.cyl(COLORS.stone, f.m, x, 0, 2.4, 1.6, 0, false, true);
      ctx.piece('statue_obelisk', inside(f.m, x, 0, 0, CELL * 1.4, 1.6));
      for (const s of [-1, 1]) for (const t of [-1, 1]) flowerBed(ctx, f.m, x + s * aw * 0.25, t * f.hd * 0.55, aw * 0.3, 5, rand);
    }
  },

  school(ctx, b, f, rand) {
    const { mm, w, d, door, annex } = f;
    const floors = b.recipe.floors ?? 2;
    addBody(ctx, mm, { w, d, floors, walls: 'stone', roof: b.recipe.roof, door, rand, lit: 0.5, pick: (fl, side, i, set) => (side === 'front' && i !== door ? (fl === 0 ? set.window : 'wall-window-shutters') : null) });
    // Bell turret on the ridge.
    const rise = (Math.min(w, d) * CELL) * 0.55;
    const base = floors * CELL + rise - 1;
    ctx.box(COLORS.white, mm, 0, 0, 3.6, 4.5, 3.6, base);
    ctx.cone(COLORS.gold, mm, 0, 0, 1.1, 1.8, base + 1.6, true);
    ctx.piece('roof-point', inside(mm, 0, 0, Math.PI / 4, V(5.2, 6, 5.2), base + 4.5));
    // Porch over the door.
    const dx = (door - (w - 1) / 2) * CELL;
    porch(ctx, mm, dx, (d * CELL) / 2, CELL * 1.3, CELL, roofColor(b.recipe.roof));
    if (annex) {
      // Fenced playground: tree, benches, a sandbox and a seesaw.
      const { x, w: aw } = annex;
      const x0 = x - aw / 2 + 1;
      const x1 = x + aw / 2 - 1;
      const z0 = -f.hd + 1;
      const z1 = f.hd - 1;
      ctx.box(COLORS.court, f.m, x, 0, aw - 2, 0.25, f.hd * 2 - 2, 0, 0, true);
      fence(ctx, f.m, x0, z0, x1, z0);
      fence(ctx, f.m, x0, z0, x0, z1);
      fence(ctx, f.m, x1, z0, x1, z1);
      fence(ctx, f.m, x0, z1, x - 3, z1);
      fence(ctx, f.m, x + 3, z1, x1, z1);
      tree(ctx, f.m, x - aw * 0.25, -f.hd * 0.4, 'tree-high-round', 0.8, rand() * 6);
      ctx.box(COLORS.woodLight, f.m, x + aw * 0.2, f.hd * 0.3, 8, 0.8, 6, 0, 0, true);
      ctx.box(COLORS.wheat, f.m, x + aw * 0.2, f.hd * 0.3, 7, 0.9, 5, 0, 0, true);
      ctx.box(COLORS.red, f.m, x - aw * 0.15, f.hd * 0.45, 9, 0.5, 1, 1.6, 0.25, true);
      ctx.box(COLORS.dark, f.m, x - aw * 0.15, f.hd * 0.45, 1, 1.6, 1, 0, 0, true);
      ctx.piece('stall-bench', inside(f.m, x0 + 2, f.hd * 0.2, 0, CELL), true);
    }
  },

  bar(ctx, b, f, rand) {
    const { mm, w, d, door, annex } = f;
    const floors = b.recipe.floors ?? 2;
    addBody(ctx, mm, { w, d, floors, walls: 'mixed', roof: b.recipe.roof, door, rand, lit: 0.9, balcony: true, chimney: true });
    // Awning over the ground floor front and a hanging sign.
    const z = (d * CELL) / 2;
    ctx.box(COLORS.red, mm, 0, z + 1.6, w * CELL - 1, 0.35, 3.2, CELL * 0.82, 0, true);
    ctx.box(COLORS.white, mm, 0, z + 3.1, w * CELL - 1, 0.6, 0.25, CELL * 0.62, 0, true);
    ctx.box(COLORS.woodLight, mm, (w * CELL) / 2 - 1, z + 1.4, 0.3, 3, 4, CELL * 1.05, 0, true);
    barrel(ctx, mm, -(w * CELL) / 2 + 2, z + 2);
    barrel(ctx, mm, -(w * CELL) / 2 + 4.6, z + 2.2, 0.9);
    if (annex) {
      // Wooden terrace with tables, stools and parasols.
      const { x, w: aw } = annex;
      ctx.box(COLORS.woodLight, f.m, x, 0, aw - 1, 0.6, f.hd * 2 - 1, 0, 0, true);
      const cols = Math.max(1, Math.floor((aw - 2) / 10));
      const rows = Math.max(1, Math.floor((f.hd * 2 - 2) / 10));
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const tx = x - aw / 2 + 1 + ((i + 0.5) * (aw - 2)) / cols;
          const tz = -f.hd + 1 + ((j + 0.5) * (f.hd * 2 - 2)) / rows;
          terraceTable(ctx, inside(f.m, 0, 0, 0, 1, 0.6), tx, tz, (i + j) % 2 ? COLORS.red : COLORS.white);
        }
      }
      fence(ctx, f.m, x - aw / 2 + 0.5, f.hd - 0.5, x + aw / 2 - 0.5, f.hd - 0.5, COLORS.wood, 2);
    }
  },

  bakery(ctx, b, f, rand) {
    const { mm, w, d, door, annex } = f;
    const floors = b.recipe.floors ?? 2;
    addBody(ctx, mm, { w, d, floors, walls: 'mixed', roof: b.recipe.roof, door, rand, lit: 0.9 });
    // Tall chimney with smoke.
    const cx = (w * CELL) / 4;
    ctx.piece('chimney', inside(mm, cx - CELL * 0.32, 0, 0, V(CELL, CELL * 1.6, CELL), floors * CELL - 1));
    ctx.smoke.push(new THREE.Vector3().setFromMatrixPosition(inside(mm, cx, 0, 0, 1, floors * CELL + CELL * 1.6)));
    // Bread stall by the door, with an awning.
    const z = (d * CELL) / 2;
    ctx.box(COLORS.roofGreen, mm, 0, z + 1.5, w * CELL - 2, 0.35, 3, CELL * 0.8, 0, true);
    ctx.box(COLORS.woodLight, mm, (w * CELL) / 2 - 4, z + 2.4, 5, 2.2, 2.4, 0, 0, true);
    for (let i = 0; i < 3; i++) ctx.ball(COLORS.orange, mm, (w * CELL) / 2 - 5.5 + i * 1.5, z + 2.4, 0.7, 2.2, true);
    if (annex) {
      // The wood-fired oven: a dome, a stack of logs and flour sacks.
      const { x, w: aw } = annex;
      ctx.box(COLORS.court, f.m, x, 0, aw - 1, 0.25, f.hd * 2 - 1, 0, 0, true);
      ctx.cyl(COLORS.stone, f.m, x, -2, Math.min(aw, 14) * 0.3, 2.5, 0, false, true);
      ctx.ball(COLORS.soil, f.m, x, -2, Math.min(aw, 14) * 0.3, 1.6, false);
      ctx.piece('log_stack', inside(f.m, x - aw / 2 + 3, f.hd - 4, Math.PI / 2, CELL * 1.2), true);
      for (let i = 0; i < 4; i++) sack(ctx, f.m, x + aw / 2 - 3 - (i % 2) * 2, f.hd - 3 - Math.floor(i / 2) * 2.2, 0.9);
    }
  },

  pharmacy(ctx, b, f, rand) {
    const { mm, w, d, door, annex } = f;
    const floors = b.recipe.floors ?? 2;
    addBody(ctx, mm, { w, d, floors, walls: 'stone', roof: b.recipe.roof, door, rand, lit: 0.85, balcony: true });
    // Green cross sign on a bracket, at the front corner.
    const z = (d * CELL) / 2 + 2.2;
    const x = (w * CELL) / 2 - 1.5;
    ctx.box(COLORS.dark, mm, x, z - 1.2, 0.3, 0.3, 2.6, CELL * 1.25, 0, true);
    for (const [sx, sy] of [
      [3.6, 1.2],
      [1.2, 3.6],
    ]) {
      const mmx = new THREE.Matrix4().multiplyMatrices(mm, at(x, z, 0, V(sx, sy, 0.5), CELL * 1.25 - sy / 2 + 0.2));
      ctx.small.add('cross', ctx.crossMat, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mmx);
    }
    // Planters by the door.
    const dx = (door - (w - 1) / 2) * CELL;
    for (const s of [-1, 1]) ctx.piece('pot_large', inside(mm, dx + s * 4, (d * CELL) / 2 + 1.6, 0, CELL * 0.9), true);
    if (annex) {
      const { x: ax, w: aw } = annex;
      ctx.box(COLORS.tilled, f.m, ax, 0, aw - 2, 0.35, f.hd * 2 - 2, 0, 0, true);
      hedge(ctx, f.m, ax - aw / 2 + 1, f.hd - 1, ax + aw / 2 - 1, f.hd - 1, 0.8);
      for (let i = 0; i < 6; i++) ctx.piece(['flower_purpleA', 'flower_yellowB', 'plant_bush', 'flower_redA'][i % 4], inside(f.m, ax - aw / 2 + 3 + (i % 2) * (aw - 6), -f.hd + 3 + Math.floor(i / 2) * (f.hd * 0.7), rand() * 6, CELL * 1.1), true);
      ctx.piece('pot_large', inside(f.m, ax, 0, 0, CELL * 1.2), true);
    }
  },

  market(ctx, b, f, rand) {
    const { m, mx, w, d, annex } = f;
    // Paved floor, then rows of stalls facing south with goods on top.
    ctx.box(COLORS.court, m, mx, 0, w * CELL, 0.3, d * CELL, 0, 0, true);
    const rows = Math.max(1, Math.min(2, d - 1 || 1));
    const per = w;
    const goods = [COLORS.red, COLORS.orange, COLORS.corn, COLORS.wheat, COLORS.roofBlue];
    for (let r = 0; r < rows; r++) {
      const z = rows === 1 ? 0 : -((d * CELL) / 2) + CELL + r * (d * CELL - 2 * CELL);
      for (let i = 0; i < per; i++) {
        const x = mx + (i - (per - 1) / 2) * CELL;
        const kind = ['stall-red', 'stall-green', 'stall'][(i + r) % 3];
        ctx.piece(kind, inside(m, x, z, 0, CELL * 0.95));
        for (let k = 0; k < 3; k++) ctx.box(goods[(i * 3 + k + r) % goods.length], m, x - 2.6 + k * 2.6, z + 2.2, 2, 0.9, 1.8, CELL * 0.37 + 0.1, 0, true);
      }
    }
    // Crates and barrels between the rows.
    for (let i = 0; i < w; i++) {
      const x = mx + (i - (w - 1) / 2) * CELL + 4;
      if (rand() < 0.6) crate(ctx, m, x, (rand() - 0.5) * 4, 0.9, rand());
      if (rand() < 0.4) barrel(ctx, m, x - 2.5, (rand() - 0.5) * 4, 0.9);
    }
    // Bunting along the front.
    for (const sgn of [-1, 1]) ctx.cyl(COLORS.wood, m, mx + (sgn * (w * CELL)) / 2, (d * CELL) / 2 + 0.5, 0.3, 14.5, 0, true);
    ctx.box(COLORS.white, m, mx, (d * CELL) / 2 + 0.5, w * CELL, 0.12, 0.12, 14.3, 0, true);
    for (let i = 0; i < w * 2; i++) {
      ctx.box(i % 2 ? COLORS.gold : COLORS.red, m, mx - (w * CELL) / 2 + 2.5 + i * 5, (d * CELL) / 2 + 0.5, 1.6, 1.5, 0.15, 12.8, 0, true);
    }
    if (annex) {
      const { x, w: aw } = annex;
      ctx.piece('cart', inside(m, x, -f.hd * 0.35, 0.4, CELL));
      ctx.piece('cart-high', inside(m, x, f.hd * 0.45, -0.3, CELL * 0.9));
      for (let i = 0; i < 5; i++) crate(ctx, m, x - aw / 2 + 2.5 + (i % 3) * 2.6, -f.hd + 3 + Math.floor(i / 3) * 2.6, 1, rand() * 0.5);
      for (let i = 0; i < 3; i++) sack(ctx, m, x + aw / 2 - 3 - i * 2, f.hd - 3);
      ctx.cyl(COLORS.hay, m, x + aw / 2 - 4, -f.hd + 4, 2.2, 2.6, 0, false);
    }
  },

  fountain(ctx, b, f, rand) {
    const { m, mx } = f;
    const r = (Math.min(b.main.w, b.main.d) * CELL) / 2;
    // Paved round, the kit fountain scaled up, a central column and four trees.
    ctx.cyl(COLORS.squareEdge, m, mx, 0, r, 0.5, 0, true);
    ctx.cyl(COLORS.square, m, mx, 0, r - 1.2, 0.6, 0, true);
    const fs = (r * 0.62) / 1;
    ctx.piece('fountain-round-detail', inside(m, mx, 0, 0, fs, 0.4));
    ctx.cyl(COLORS.stone, m, mx, 0, 1.1, 7, 0.4, false, true);
    ctx.cyl(COLORS.stone, m, mx, 0, 2.6, 0.7, 6.2, false);
    ctx.ball(COLORS.white, m, mx, 0, 1.3, 7.2, true);
    ctx.water.push({ x: b.x + mx, z: b.y, y: 8.4, r: 2.2 });
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const tx = mx + sx * (r - 3.2);
      const tz = sz * (r - 3.2);
      ctx.box(COLORS.stone, m, tx, tz, 4.4, 1.2, 4.4);
      tree(ctx, m, tx, tz, 'tree-high-round', 0.55, rand() * 6);
    }
    for (const [sx, sz, rot] of [
      [0, -1, Math.PI / 2],
      [-1, 0, 0],
      [1, 0, 0],
    ]) {
      ctx.piece('stall-bench', inside(m, mx + sx * (r - 3), sz * (r - 3), rot, CELL), true);
    }
  },

  mill(ctx, b, f, rand) {
    const { mm, w, d, door, annex, hd } = f;
    const floors = b.recipe.floors ?? 3;
    addBody(ctx, mm, { w, d, floors, walls: 'mixed', door, rand, lit: 0.5, roofStyle: 'none' });
    ctx.box(COLORS.stoneDark, mm, 0, 0, w * CELL + 1.2, 0.8, d * CELL + 1.2, floors * CELL);
    ctx.piece('roof-high-point', inside(mm, 0, 0, 0, V(CELL * 1.05 * w, CELL * 1.6, CELL * 1.05 * d), floors * CELL + 0.8));
    // Sails on the front, turning (decorative, wall clock).
    const sail = ctx.kit.get('windmill').scene.clone();
    sail.scale.setScalar(SAILS.radius / 1.56);
    sail.rotation.order = 'YXZ';
    sail.rotation.y = -Math.PI / 2;
    sail.position.setFromMatrixPosition(inside(mm, 0, (d * CELL) / 2 + 2, 0, 1, floors * CELL * SAILS.hub));
    sail.traverse((o) => {
      if (o.isMesh) o.castShadow = false;
    });
    ctx.sails.push(sail);
    // Wooden stair and a gallery on the first floor.
    ctx.box(COLORS.wood, mm, 0, (d * CELL) / 2 + 1.5, w * CELL + 2, 0.5, 3, CELL);
    if (annex) {
      // Barn with hay, sacks and a cart.
      const { x, w: aw } = annex;
      const bm = inside(f.m, x, -hd * 0.25);
      const bw = Math.max(1, Math.round(aw / CELL));
      const bd = Math.max(1, d - 1);
      addBody(ctx, bm, { w: bw, d: bd, floors: 1, walls: 'wood', roof: 'brown', door: Math.floor((bw - 1) / 2), rand, lit: 0.3 });
      for (let i = 0; i < 3; i++) ctx.cyl(COLORS.hay, f.m, x - aw / 2 + 3 + i * 3.2, hd - 2.5, 1.5, 2.2, 0, false);
      for (let i = 0; i < 4; i++) sack(ctx, f.m, x + aw / 2 - 2.5 - (i % 2) * 2, hd - 3 - Math.floor(i / 2) * 2);
    }
    ctx.piece('cart', inside(f.m, f.mx - (w * CELL) / 2 - 3, hd + 2, 0.5, CELL * 0.9), true);
  },
};

/** A small porch with posts and a pitched roof over a door. */
function porch(ctx, m, x, z, width, depth, roof) {
  for (const s of [-1, 1]) ctx.box(COLORS.woodLight, m, x + (s * width) / 2 - s * 0.5, z + depth - 0.6, 0.7, CELL * 0.9, 0.7, 0, 0, true);
  addGableRoof(ctx, inside(m, x, z + depth / 2), width + 1, depth, CELL * 0.9, roof, COLORS.gableStone, false);
}

/** A bed of flowers (local to m). */
export function flowerBed(ctx, m, x, z, w, d, rand) {
  ctx.box(COLORS.soilDark, m, x, z, w, 0.4, d, 0, 0, true);
  const kinds = ['flower_redA', 'flower_yellowA', 'flower_purpleA', 'flower_redB', 'flower_yellowB'];
  const n = Math.max(2, Math.round((w * d) / 14));
  for (let i = 0; i < n; i++) {
    ctx.piece(kinds[Math.floor(rand() * kinds.length)], inside(m, x + (rand() - 0.5) * (w - 1.5), z + (rand() - 0.5) * (d - 1.5), rand() * 6, CELL * (1 + rand() * 0.4), 0.3), true);
  }
}

/** A graveyard in the annex of a church: wall, cypresses, graves. */
function graveyard(ctx, f, rand) {
  const { x, w: aw } = f.annex;
  const x0 = x - aw / 2 + 1;
  const x1 = x + aw / 2 - 1;
  const z0 = -f.hd + 1;
  const z1 = f.hd - 1;
  ctx.box(COLORS.leafs, f.m, x, 0, aw - 2, 0.2, f.hd * 2 - 2, 0, 0, true);
  stoneWall(ctx, f.m, x0, z0, x1, z0);
  stoneWall(ctx, f.m, x0, z0, x0, z1);
  stoneWall(ctx, f.m, x1, z0, x1, z1);
  stoneWall(ctx, f.m, x0, z1, x - 3, z1);
  stoneWall(ctx, f.m, x + 3, z1, x1, z1);
  for (let i = 0; i < 3; i++) tree(ctx, f.m, x0 + 3.5, z0 + 6 + i * ((z1 - z0 - 12) / 2), 'tree-high', 0.8, rand() * 6, 0.5);
  for (let gz = z0 + 5; gz < z1 - 4; gz += 6) {
    for (let gx = x0 + 9; gx < x1 - 2; gx += 4.5) {
      ctx.box(COLORS.stone, f.m, gx, gz, 1.8, 2.2 + rand() * 0.8, 0.5, 0, 0, true);
      ctx.box(COLORS.leafs, f.m, gx, gz + 1.6, 1.8, 0.3, 2.6, 0, 0, true);
    }
  }
}

/** A generic public building (keys without a recipe of their own). */
function generic(ctx, b, f, rand) {
  addBody(ctx, f.mm, { w: f.w, d: f.d, floors: b.recipe.floors ?? 1, walls: b.recipe.walls ?? 'wood', roof: b.recipe.roof ?? 'red', door: f.door, rand });
}

/**
 * Draws the landmark of a building record of the plan.
 * @param {object} ctx parts.js context
 * @param {import('./plan.js').Building} b
 */
export function addLandmark(ctx, b) {
  const f = frameOf(b);
  const rand = random(Math.round(b.x * 31 + b.y * 17) >>> 0);
  (BUILDERS[b.key] ?? generic)(ctx, b, f, rand);
}
