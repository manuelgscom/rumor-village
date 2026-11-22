// Builds the static village from the plan (plan.js): ground slab, roads and
// paving, the square, the river with its bridge, the landmarks
// (landmarks.js), houses, gardens and fields, trees, lamps and small things.
// Everything static is merged into a few meshes (one per material, parts.js),
// so the whole village costs a handful of draw calls; small things cast no
// shadow. update() lights the windows at night and moves the sails, the smoke
// and the fountain jets; the decorative life of life.js (river ripples, wind
// in crowns and banners, clouds, fireflies) moves there too.

import * as THREE from 'three';
import { addLandmark } from './landmarks.js';
import { addWind, createLife, waterMaterial } from './life.js';
import { addBody, at, barrel, COLORS, crate, createContext, fence, hedge, inside, sack, well } from './parts.js';
import { CELL, random, ROAD_WIDTH } from './plan.js';

export { COLORS } from './parts.js';

/** Kit pieces of the Fantasy Town Kit (Kenney, CC0) the village uses. */
const TOWN = [
  'wall',
  'wall-window-shutters',
  'wall-window-small',
  'wall-doorway-round',
  'wall-detail-cross',
  'wall-doorway-square-wide',
  'wall-window-round',
  'wall-wood',
  'wall-wood-window-shutters',
  'wall-wood-window-small',
  'wall-wood-door',
  'wall-wood-detail-cross',
  'wall-wood-doorway-square-wide',
  'balcony-wall',
  'roof-point',
  'roof-high-point',
  'tree',
  'tree-high',
  'tree-high-round',
  'tree-crooked',
  'tree-high-crooked',
  'lantern',
  'stall',
  'stall-red',
  'stall-green',
  'cart',
  'cart-high',
  'fountain-round-detail',
  'windmill',
  'banner-red',
  'banner-green',
  'stall-bench',
  'stall-stool',
  'chimney',
  'hedge',
];
/** Pieces of the Nature Kit (Kenney, CC0), copied as .glb next to the town ones. */
const NATURE = [
  'flower_redA',
  'flower_redB',
  'flower_yellowA',
  'flower_yellowB',
  'flower_purpleA',
  'plant_bush',
  'plant_bushLarge',
  'plant_bushSmall',
  'grass',
  'grass_large',
  'rock_smallA',
  'stump_round',
  'mushroom_red',
  'lily_large',
  'log_stack',
  'pot_large',
  'canoe',
  'crop_pumpkin',
  'crops_leafsStageB',
  'crops_cornStageB',
  'statue_obelisk',
];

/** Kit pieces the village uses (loaded from viewer/assets/town/<name>.glb). */
export const PIECES = [...TOWN, ...NATURE];

/** Generated props (no kit piece). */
const GENERATED = new Set(['well', 'pier', 'barrel', 'crate', 'sack']);

/** Height of the water surface. */
const WATER_Y = 0.35;

/** Grass texture: soft lighter and darker patches. */
function grassTexture(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = COLORS.grass;
  g.fillRect(0, 0, 512, 512);
  const rand = random(seed);
  for (let i = 0; i < 160; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const r = 10 + rand() * 46;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = rand() < 0.5 ? 'rgba(111,178,78,' : 'rgba(156,214,104,';
    grad.addColorStop(0, `${tone}0.55)`);
    grad.addColorStop(1, `${tone}0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A ribbon (flat strip) along a path of [x, y] points, at a height. With
 * `stream`, also the attributes of the water shader (life.js): `river`
 * (distance along the path, signed distance across) and `flow` (direction).
 */
function ribbon(path, width, y, stream = false) {
  const pos = [];
  const idx = [];
  const river = [];
  const flow = [];
  let along = 0;
  path.forEach(([x, z], i) => {
    if (i > 0) along += Math.hypot(x - path[i - 1][0], z - path[i - 1][1]);
    const [px, pz] = path[Math.max(0, i - 1)];
    const [nx, nz] = path[Math.min(path.length - 1, i + 1)];
    const dx = nx - px;
    const dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1;
    const ox = (-dz / len) * (width / 2);
    const oz = (dx / len) * (width / 2);
    pos.push(x - ox, y, z - oz, x + ox, y, z + oz);
    river.push(along, -width / 2, along, width / 2);
    flow.push(dx / len, dz / len, dx / len, dz / len);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (stream) {
    g.setAttribute('river', new THREE.Float32BufferAttribute(river, 2));
    g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  }
  // Face up whatever the winding.
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) {
    g.setIndex(idx.map((_, i) => idx[i - (i % 3) + [0, 2, 1][i % 3]]));
    g.computeVertexNormals();
  }
  return g;
}

/** Flat box of the paving (w × d, thin) at a height. */
function slabGeo(x, z, w, d, rot, y, h = 0.3) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(rot);
  g.translate(x, y - h / 2, z);
  return g;
}

/** Flat slab with rounded corners (axis-aligned), top at a height. */
function roundSlab(x, z, w, d, r, y, h = 0.3) {
  const sh = new THREE.Shape();
  const hw = w / 2;
  const hd = d / 2;
  sh.moveTo(-hw + r, -hd);
  sh.lineTo(hw - r, -hd);
  sh.quadraticCurveTo(hw, -hd, hw, -hd + r);
  sh.lineTo(hw, hd - r);
  sh.quadraticCurveTo(hw, hd, hw - r, hd);
  sh.lineTo(-hw + r, hd);
  sh.quadraticCurveTo(-hw, hd, -hw, hd - r);
  sh.lineTo(-hw, -hd + r);
  sh.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** A house of the plan. */
function addHouse(ctx, h) {
  const m = at(h.x, h.y, h.rot);
  const rand = random(h.seed);
  const single = h.w === 1 && h.d === 1;
  const r = rand();
  const roofStyle = single && r < 0.55 ? (r < 0.3 ? 'high' : 'point') : 'gable';
  addBody(ctx, m, {
    w: h.w,
    d: h.d,
    floors: h.floors,
    walls: h.walls,
    roof: h.roof,
    roofStyle,
    chimney: h.chimney && roofStyle === 'gable',
    rand,
    lit: 0.5,
    arcade: !!h.arcade,
    balcony: h.floors > 1 && rand() < 0.35,
  });
}

/** Rows of a field or a kitchen garden: ridges along the longer side. */
function cropRows(ctx, m, w, d, color, height, gap, extra) {
  const along = w >= d;
  const len = (along ? w : d) - 2;
  const span = (along ? d : w) - 2;
  const n = Math.max(1, Math.floor(span / gap));
  for (let i = 0; i < n; i++) {
    const o = -span / 2 + (i + 0.5) * (span / n);
    const [x, z] = along ? [0, o] : [o, 0];
    ctx.ridge(color, m, x, z, gap * 0.62, height, len, along ? Math.PI / 2 : 0);
    if (extra) extra(x, z, len, along);
  }
}

/** A garden, field, orchard or yard of the plan. */
function addGarden(ctx, g) {
  const m = at(g.x, g.y, g.rot);
  const rand = random(g.seed);
  const { w, d } = g;
  const soil = (color = COLORS.tilled) => ctx.box(color, m, 0, 0, w - 0.6, 0.35, d - 0.6, 0, 0, true);
  const flowers = (n) => {
    const kinds = ['flower_redA', 'flower_yellowA', 'flower_purpleA', 'flower_redB', 'flower_yellowB', 'plant_bushSmall'];
    for (let i = 0; i < n; i++) ctx.piece(kinds[Math.floor(rand() * kinds.length)], inside(m, (rand() - 0.5) * (w - 2), (rand() - 0.5) * (d - 2), rand() * 6, CELL * (0.9 + rand() * 0.5), 0.3), true);
  };
  switch (g.kind) {
    case 'wheat':
      soil(COLORS.soil);
      cropRows(ctx, m, w, d, COLORS.wheat, 2.6, 2.4);
      break;
    case 'corn':
      soil(COLORS.soil);
      cropRows(ctx, m, w, d, COLORS.corn, 4.2, 3.2);
      break;
    case 'leafs':
    case 'carrot':
      soil();
      cropRows(ctx, m, w, d, COLORS.leafs, 1.3, 2.6);
      break;
    case 'pumpkin':
      soil();
      cropRows(ctx, m, w, d, COLORS.leafs, 0.9, 4, (x, z, len, along) => {
        for (let k = 0; k < len / 6; k++) {
          const t = -len / 2 + 3 + k * 6 + rand() * 2;
          ctx.ball(COLORS.orange, m, along ? t : x, along ? z : t, 1.0, 0.3);
        }
      });
      break;
    case 'crops':
      soil();
      cropRows(ctx, m, w, d, rand() < 0.5 ? COLORS.leafs : COLORS.corn, 1.2 + rand() * 1.5, 2.6);
      ctx.piece(rand() < 0.5 ? 'crop_pumpkin' : 'crops_leafsStageB', inside(m, (rand() - 0.5) * (w - 3), (rand() - 0.5) * (d - 3), rand() * 6, CELL * 1.2, 0.3), true);
      break;
    case 'flowers':
      soil(COLORS.soilDark);
      flowers(Math.max(3, Math.round((w * d) / (g.low ? 14 : 24))));
      break;
    case 'orchard': {
      ctx.box(COLORS.leafs, m, 0, 0, w - 0.6, 0.2, d - 0.6, 0, 0, true);
      const nx = Math.max(1, Math.floor(w / 9));
      const nz = Math.max(1, Math.floor(d / 9));
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const kind = rand() < 0.6 ? 'tree-high-round' : 'tree';
          ctx.piece(kind, inside(m, -w / 2 + ((i + 0.5) * w) / nx, -d / 2 + ((j + 0.5) * d) / nz, rand() * 6, CELL * (0.45 + rand() * 0.15)));
        }
      }
      break;
    }
    case 'meadow':
      flowers(Math.max(3, Math.round((w * d) / 70)));
      break;
    case 'yard':
    default:
      soil(COLORS.lane);
      ctx.piece('log_stack', inside(m, -w / 4, -d / 5, Math.PI / 2, CELL * 1.1), true);
      barrel(ctx, m, w / 4, -d / 5);
      crate(ctx, m, w / 4 + 2.6, -d / 5 + 0.5, 0.9, 0.4);
      if (rand() < 0.5) sack(ctx, m, 0, d / 5);
      break;
  }
  // Borders: a fence on three sides (the fourth touches the house), a
  // hedge for flower beds, and some fields fenced all round.
  const x0 = -w / 2 + 0.3;
  const x1 = w / 2 - 0.3;
  const z0 = -d / 2 + 0.3;
  const z1 = d / 2 - 0.3;
  if (g.low) return;
  if (g.field) {
    if (rand() < 0.3) {
      fence(ctx, m, x0, z0, x1, z0);
      fence(ctx, m, x0, z1, x1, z1);
      fence(ctx, m, x0, z0, x0, z1);
      fence(ctx, m, x1, z0, x1, z1);
    }
  } else if (g.kind === 'flowers') {
    hedge(ctx, m, x0, z0, x1, z0, 0.9);
    hedge(ctx, m, x0, z0, x0, z1, 0.9);
    hedge(ctx, m, x1, z0, x1, z1, 0.9);
  } else {
    fence(ctx, m, x0, z0, x1, z0);
    fence(ctx, m, x0, z0, x0, z1);
    fence(ctx, m, x1, z0, x1, z1);
  }
}

/** A prop of the plan: a kit piece, or a generated one. */
function addProp(ctx, p) {
  const m = at(p.x, p.y, p.rot, 1, p.float ? WATER_Y + 0.05 : 0);
  if (GENERATED.has(p.kind)) {
    if (p.kind === 'well') well(ctx, m, 0, 0);
    else if (p.kind === 'barrel') barrel(ctx, m, 0, 0);
    else if (p.kind === 'crate') crate(ctx, m, 0, 0);
    else if (p.kind === 'sack') sack(ctx, m, 0, 0);
    else if (p.kind === 'pier') {
      ctx.box(COLORS.woodLight, m, 0, 4, 7, 0.6, 14, 1.2);
      for (const sx of [-3, 3]) for (const sz of [-2, 4, 10]) ctx.box(COLORS.wood, m, sx, sz, 0.8, 1.6, 0.8, -0.2, 0, true);
    }
    return;
  }
  const big = p.kind === 'canoe' ? 1.6 : 1;
  ctx.piece(p.kind, new THREE.Matrix4().multiplyMatrices(m, at(0, 0, 0, CELL * 0.9 * p.scale * big)), !!p.small);
}

/**
 * Builds the static village.
 * @param {import('./plan.js').TownPlan} plan
 * @param {Map<string, object>} kit loaded glTF by piece name
 * @returns {{group: THREE.Group, lamps: THREE.Vector3[], glows: {x: number, z: number, r: number}[], update: (frame: object, palette: object) => void}}
 *   glows: warm light pools at night besides the lamps; update: per frame (windows, sails, smoke, jets, and the life of life.js)
 */
export function buildVillage(plan, kit) {
  const group = new THREE.Group();
  const ctx = createContext(kit);
  const { batch, small } = ctx;
  const mat = ctx.mat;
  const id = new THREE.Matrix4();

  // Ground: a thick slab with rounded corners, textured grass on top, soil on the sides.
  const g = plan.ground;
  const gw = g.maxX - g.minX;
  const gh = g.maxY - g.minY;
  const corner = Math.min(60, gw / 6, gh / 6);
  const shape = new THREE.Shape();
  const x0 = -gw / 2;
  const y0 = -gh / 2;
  shape.moveTo(x0 + corner, y0);
  shape.lineTo(x0 + gw - corner, y0);
  shape.quadraticCurveTo(x0 + gw, y0, x0 + gw, y0 + corner);
  shape.lineTo(x0 + gw, y0 + gh - corner);
  shape.quadraticCurveTo(x0 + gw, y0 + gh, x0 + gw - corner, y0 + gh);
  shape.lineTo(x0 + corner, y0 + gh);
  shape.quadraticCurveTo(x0, y0 + gh, x0, y0 + gh - corner);
  shape.lineTo(x0, y0 + corner);
  shape.quadraticCurveTo(x0, y0, x0 + corner, y0);
  const cx = (g.minX + g.maxX) / 2;
  const cz = (g.minY + g.maxY) / 2;
  const slab = (depth, top) => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
    geo.rotateX(Math.PI / 2);
    geo.translate(cx, top, cz);
    return geo;
  };
  const topGeo = new THREE.ShapeGeometry(shape, 10);
  topGeo.rotateX(-Math.PI / 2);
  // ShapeGeometry UVs are the shape coordinates: map them to 0..1 (y flips with the rotation).
  const uv = topGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - x0) / gw, (uv.getY(i) - y0) / gh);
  topGeo.translate(cx, 0, cz);
  const tex = grassTexture(Math.round(gw * 7 + gh));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(gw / 420, gh / 420);
  const grass = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, roughness: 0.95 }));
  grass.receiveShadow = true;
  const soil = new THREE.Mesh(slab(30, -0.05), mat(COLORS.soil));
  const soilBottom = new THREE.Mesh(slab(8, -30), mat(COLORS.soilDark));
  group.add(grass, soil, soilBottom);

  // Roads: strips with round joints and a darker kerb, a little above the grass.
  const roadMat = new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const kerbMat = new THREE.MeshStandardMaterial({ color: '#cdb486', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const [ax, ay, bx, by] of plan.roads) {
    const len = Math.hypot(bx - ax, by - ay);
    for (const [key, material, width, y] of [
      ['kerb', kerbMat, ROAD_WIDTH + 1.6, 0.1],
      ['road', roadMat, ROAD_WIDTH, 0.16],
    ]) {
      const geo = new THREE.PlaneGeometry(len, width);
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(-Math.atan2(by - ay, bx - ax));
      geo.translate((ax + bx) / 2, y, (ay + by) / 2);
      small.add(key, material, geo, id);
      for (const [x, z] of [
        [ax, ay],
        [bx, by],
      ]) {
        const disc = new THREE.CircleGeometry(width / 2, 16);
        disc.rotateX(-Math.PI / 2);
        disc.translate(x, y, z);
        small.add(key, material, disc, id);
      }
    }
  }
  // Lanes (dirt paths), plazas in front of the landmarks, courts, patios.
  for (const l of plan.lanes) small.add('lane', mat(COLORS.lane), slabGeo(l.x, l.y, l.w, l.d, l.rot, 0.12, 0.2), id);
  for (const p of plan.paved) {
    if (p.kind === 'street') {
      small.add('court', mat(COLORS.court), slabGeo(p.x, p.y, p.w, p.d, p.rot, 0.25), id);
      // Cobbles: lighter stripes across the street.
      for (let x = p.x - p.w / 2 + 3; x < p.x + p.w / 2; x += 6) small.add('plaza', mat(COLORS.plaza), slabGeo(x, p.y, 3, p.d - 2, 0, 0.28, 0.1), id);
      // Kerbs on both sides.
      for (const s of [-1, 1]) small.add(`c:${COLORS.stone}`, mat(COLORS.stone), slabGeo(p.x, p.y + s * (p.d / 2 + 0.6), p.w, 1.2, 0, 0.6, 0.6), id);
    } else {
      const color = p.kind === 'plaza' ? COLORS.plaza : COLORS.court;
      const y = p.kind === 'plaza' ? 0.2 : 0.26;
      small.add(`c:${COLORS.squareEdge}`, mat(COLORS.squareEdge), roundSlab(p.x, p.y, p.w + 1.6, p.d + 1.6, 4.8, y - 0.04), id);
      small.add(`c:${color}`, mat(color), roundSlab(p.x, p.y, p.w, p.d, 4, y), id);
    }
  }
  for (const p of plan.patios) {
    small.add(`c:${COLORS.squareEdge}`, mat(COLORS.squareEdge), slabGeo(p.x, p.y, p.hw * 2 + 2, p.hh * 2 + 2, 0, 0.22), id);
    small.add('plaza', mat(COLORS.plaza), slabGeo(p.x, p.y, p.hw * 2, p.hh * 2, 0, 0.26), id);
  }

  // The square: a paved disc with rings, benches and planters around.
  if (plan.square) {
    const s = plan.square;
    const disc = (r, y, color, h = 0.6) => {
      const geo = new THREE.CylinderGeometry(r, r, h, 56);
      geo.translate(s.x, y - h / 2, s.y);
      small.add(`c:${color}`, mat(color), geo, id);
    };
    disc(s.r + 2.5, 0.5, COLORS.squareEdge);
    disc(s.r, 0.6, COLORS.square);
    disc(s.r * 0.72, 0.64, COLORS.plaza);
    disc(s.r * 0.7, 0.66, COLORS.square);
    disc(s.r * 0.25, 0.7, COLORS.squareEdge);
    disc(s.r * 0.22, 0.72, COLORS.plaza);
  }

  // The river: water ribbon over sandy banks, a stone bridge.
  let water = null;
  if (plan.river) {
    const r = plan.river;
    small.add(`c:${COLORS.waterEdge}`, mat(COLORS.waterEdge), ribbon(r.path, r.width + 7, 0.12), id);
    small.add('c:#e2d2a4', mat('#e2d2a4'), ribbon(r.path, r.width + 3, 0.2), id);
    water = new THREE.Mesh(ribbon(r.path, r.width, WATER_Y, true), waterMaterial(COLORS.water, r.width));
    water.receiveShadow = true;
    group.add(water);
    for (const b of plan.bridges) {
      const m = at(b.x, b.y);
      ctx.box(COLORS.stone, m, 0, 0, b.width, 1.2, b.len, 2.2);
      for (const s of [-1, 1]) {
        ctx.box(COLORS.stoneDark, m, (s * (b.width - 1)) / 2, 0, 1, 2.2, b.len, 3.4);
        // Ramps down to the banks.
        const ramp = new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().compose(new THREE.Vector3(0, 1.4, (s * (b.len + 6)) / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s * 0.32), new THREE.Vector3(b.width, 1.2, 7)));
        batch.add(`c:${COLORS.stone}`, mat(COLORS.stone), new THREE.BoxGeometry(1, 1, 1), ramp);
      }
      for (const s of [-1, 1]) ctx.box(COLORS.stoneDark, m, 0, s * (b.len / 2 - 5), b.width - 2, 2.4, 3, 0);
    }
  }

  // Landmarks, houses, gardens, small things.
  for (const b of plan.buildings) addLandmark(ctx, b);
  for (const h of plan.houses) addHouse(ctx, h);
  for (const gd of plan.gardens) addGarden(ctx, gd);
  for (const p of plan.props) addProp(ctx, p);

  // Trees.
  for (const t of plan.trees) ctx.piece(t.kind, at(t.x, t.y, t.rot, CELL * 0.9 * t.scale));

  // Lamps (their light is added by the scene at night).
  const lamps = [];
  for (const l of plan.lamps) {
    ctx.piece('lantern', at(l.x, l.y, 0, CELL * 0.75));
    lamps.push(new THREE.Vector3(l.x, CELL * 0.75 * 1.45, l.y));
  }

  const merged = [batch.build(), small.build({ castShadow: false })];
  for (const m of merged) addWind(m);
  group.add(...merged);
  for (const s of ctx.sails) group.add(s);
  const life = createLife(plan);
  group.add(life.group);

  // Chimney smoke: a few puffs per chimney, rising (decorative, wall clock).
  const puffMat = new THREE.MeshStandardMaterial({ color: '#f2f0f5', transparent: true, opacity: 0.65, roughness: 1, flatShading: true });
  const puffGeo = new THREE.IcosahedronGeometry(1, 0);
  const puffs = [];
  for (const s of ctx.smoke) {
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(puffGeo, puffMat);
      p.userData = { base: s.clone(), phase: i / 4 };
      group.add(p);
      puffs.push(p);
    }
  }
  // Fountain jets.
  const jetMat = new THREE.MeshStandardMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.75, roughness: 0.1, emissive: '#3c8fc0', emissiveIntensity: 0.2 });
  const jets = ctx.water.map((w) => {
    const j = new THREE.Mesh(new THREE.ConeGeometry(w.r, 4, 10, 1, true).translate(0, 2, 0), jetMat);
    j.position.set(w.x, w.y, w.z);
    group.add(j);
    return j;
  });

  // Warm pools of light at night at the landmark doors.
  const glows = plan.buildings.filter((b) => b.recipe.type === 'building').map((b) => ({ x: b.door.x, z: b.door.y + 4, r: 12 }));
  let lastLight = -1;
  const update = (frame, palette) => {
    const now = frame.now / 1000; // decorative clock (app.now())
    for (const s of ctx.sails) s.rotation.x = now * 0.6;
    for (const p of puffs) {
      const k = (now * 0.25 + p.userData.phase) % 1;
      p.position.set(p.userData.base.x + k * 4, p.userData.base.y + k * 14, p.userData.base.z - k * 2);
      p.scale.setScalar(1 + k * 2.2);
    }
    for (const j of jets) j.scale.y = 0.9 + 0.12 * Math.sin(now * 5);
    const light = palette?.light ?? 1;
    if (Math.abs(light - lastLight) > 0.002) {
      lastLight = light;
      const dark = 1 - light;
      ctx.glass.lit.emissiveIntensity = Math.min(1, dark * 1.4) * 2.2;
      ctx.crossMat.emissiveIntensity = 0.35 + dark * 1.6;
      if (water) {
        water.material.emissiveIntensity = 0.15 + dark * 0.25;
        // Glints: bright by day, a faint moonlit shimmer at night.
        water.material.userData.glint.value = 0.25 + 0.75 * light;
      }
    }
    life.update(frame, palette);
  };
  return { group, lamps, glows, update };
}
