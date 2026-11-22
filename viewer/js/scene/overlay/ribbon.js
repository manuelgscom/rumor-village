// three.js pieces of the rumor overlay: a ribbon (a strip that faces the
// camera, with a color and opacity per point), a flat ring on the ground, a
// flat disc and a slice of a ring (the tint of a place), a beam of light, a
// spark and an arrowhead. The geometry is render/arc.js; these only hold the
// buffers and materials, reused frame after frame.

import * as THREE from 'three';
import { ribbon } from '../../render/arc.js';

/** Draw order: the tint of the places and the trail under everything, then rings, beams, chains and the hops on top. */
export const ORDER = { tint: 1, trail: 3, ring: 4, beam: 8, chain: 15, hop: 20 };

/**
 * @param {number} maxPoints
 * @param {number} order renderOrder
 * @param {{depthTest?: boolean}} [o] depthTest: hidden behind buildings (the trail)
 */
export function createRibbon(maxPoints, order, { depthTest = false } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(maxPoints * 6);
  const col = new Float32Array(maxPoints * 8);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  const index = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    const a = 2 * i;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(index);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.visible = false;
  return {
    mesh,
    /**
     * @param {[number, number, number][]} pts
     * @param {{x: number, y: number, z: number}} eye
     * @param {number[]} widths
     * @param {THREE.Color} color
     * @param {number[]} alphas one per point
     */
    set(pts, eye, widths, color, alphas) {
      const n = Math.min(pts.length, maxPoints);
      ribbon(pts.slice(0, n), eye, widths, pos);
      for (let i = 0; i < n; i++) {
        for (const k of [0, 4]) col.set([color.r, color.g, color.b, alphas[i]], i * 8 + k);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.setDrawRange(0, (n - 1) * 6);
      mesh.visible = true;
    },
  };
}

const ringGeo = new THREE.RingGeometry(0.78, 1, 48).rotateX(-Math.PI / 2);

/** A flat ring on the ground, radius 1 (scale it); depth tested on request. */
export function createRing(order = ORDER.ring, { depthTest = false } = {}) {
  const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest, toneMapped: false });
  const mesh = new THREE.Mesh(ringGeo, mat);
  mesh.renderOrder = order;
  mesh.visible = false;
  return mesh;
}

const discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);

/**
 * A flat disc on the ground, radius 1 (scale it). It is depth tested, so the
 * people standing on it hide it, and lifted a little over the paving.
 */
export function createDisc(order = ORDER.tint) {
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(discGeo, mat);
  mesh.renderOrder = order;
  mesh.visible = false;
  return mesh;
}

/** Steps of a whole slice ring; a slice of k steps is k/SLICE_STEPS of the circle. */
export const SLICE_STEPS = 72;
const sliceGeos = new Map();
const sliceGeo = (k) => {
  let g = sliceGeos.get(k);
  if (!g) {
    g = new THREE.RingGeometry(0.8, 1, k, 1, 0, (2 * Math.PI * k) / SLICE_STEPS).rotateX(-Math.PI / 2);
    sliceGeos.set(k, g);
  }
  return g;
};

/**
 * A slice of a flat ring, radius 1: set(steps, start) shows `steps` of
 * SLICE_STEPS from step `start`, counterclockwise seen from above.
 */
export function createSlice(order = ORDER.tint + 1) {
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const mesh = new THREE.Mesh(sliceGeo(1), mat);
  mesh.renderOrder = order;
  mesh.visible = false;
  return {
    mesh,
    /**
     * @param {number} steps 1..SLICE_STEPS
     * @param {number} start step where it begins
     */
    set(steps, start) {
      mesh.geometry = sliceGeo(Math.max(1, Math.min(SLICE_STEPS, Math.round(steps))));
      mesh.rotation.set(0, (2 * Math.PI * start) / SLICE_STEPS, 0);
      mesh.visible = true;
    },
  };
}

// An open cylinder, height 1 from the ground up, radius 1 at the bottom and
// less at the top, bright at the foot and fading to nothing at the top.
const beamGeo = (() => {
  const g = new THREE.CylinderGeometry(0.7, 1, 1, 24, 6, true).translate(0, 0.5, 0);
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i);
    c.set([1, 1, 1, Math.pow(1 - t, 0.6)], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 4));
  return g;
})();

/**
 * A beam of light (not tone mapped), radius 1 and height 1 (scale it), that
 * fades upwards: additive (a glow, its color scaled by the strength) or plain
 * (its color reads on a light ground too; set the opacity).
 * @param {number} [order]
 * @param {{additive?: boolean}} [o]
 */
export function createBeam(order = ORDER.beam, { additive = true } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(beamGeo, mat);
  mesh.renderOrder = order;
  mesh.visible = false;
  return mesh;
}

const sparkGeo = new THREE.SphereGeometry(1, 16, 12);

/** A small glowing ball, radius 1 (scale it), with a soft halo. */
export function createSpark() {
  const core = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, toneMapped: false }));
  const halo = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, toneMapped: false }));
  halo.scale.setScalar(2.1);
  core.renderOrder = ORDER.hop + 2;
  halo.renderOrder = ORDER.hop + 1;
  const group = new THREE.Group();
  group.add(halo, core);
  group.visible = false;
  return { group, core, halo };
}

// A cone whose tip is at the origin, pointing up (+Y), height 1, radius 0.5.
const coneGeo = new THREE.ConeGeometry(0.5, 1, 14).translate(0, -0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();

/** An arrowhead: point(tip, along, size, color). */
export function createArrow(order = ORDER.chain + 1) {
  const mesh = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, toneMapped: false }));
  mesh.renderOrder = order;
  mesh.visible = false;
  return {
    mesh,
    /**
     * @param {[number, number, number]} tip
     * @param {[number, number, number]} along direction it points to
     * @param {number} size length
     * @param {THREE.Color} color
     */
    point(tip, along, size, color) {
      mesh.position.set(tip[0], tip[1], tip[2]);
      dir.set(along[0], along[1], along[2]).normalize();
      mesh.quaternion.setFromUnitVectors(UP, dir);
      mesh.scale.set(size * 0.75, size, size * 0.75);
      mesh.material.color.copy(color);
      mesh.visible = true;
    },
  };
}

/**
 * A pool that grows on demand; `begin` hides everything, `next` hands out the
 * next free item (made visible by whoever sets it).
 * @template T
 * @param {() => T} make
 * @param {(item: T) => THREE.Object3D} objectOf
 * @param {THREE.Group} parent
 */
export function pool(make, objectOf, parent) {
  const items = [];
  let used = 0;
  return {
    begin() {
      for (const it of items) objectOf(it).visible = false;
      used = 0;
    },
    next() {
      if (used === items.length) {
        const it = make();
        items.push(it);
        parent.add(objectOf(it));
      }
      return items[used++];
    },
  };
}
