// Sky and light of the village by time of day (clock.daylight and sun.js): a
// gradient background with a warm glow on the side of a low sun and stars at
// night, a sun that crosses the sky (long warm shadows at the golden hours)
// and turns into a cold moon at night, exposure and a soft horizon fog from
// the palette, and lamps that light up one after another at dusk. Pure
// function of the playback position.
//
//   update(pos) ──► palette {colors, light, exposure, dir, life, shadowKey}
//                   background repainted only when its rounded key changes
//                   shadow camera refitted only when shadowKey changes

import * as THREE from 'three';
import { daylight } from '../core/clock.js';
import { lightAt, sunAt } from './sun.js';
import { random } from './world/measures.js';

/** Palettes: full day, the warm middle of dusk and dawn, and night. */
const DAY = { top: '#4f9fe0', bottom: '#cfe8fa', hemiSky: '#d8eeff', hemiGround: '#7e9b5c', hemi: 1.15, sun: '#fff1d6', sunI: 2.6, exposure: 1 };
const DUSK = { top: '#4a5aa0', bottom: '#f9a46a', hemiSky: '#f6c49c', hemiGround: '#6b5a4a', hemi: 1.05, sun: '#ff9550', sunI: 2.2, exposure: 1.12 };
const NIGHT = { top: '#0a1230', bottom: '#33427a', hemiSky: '#8a9bd6', hemiGround: '#363a52', hemi: 1.1, sun: '#b9c9ff', sunI: 1.0, exposure: 1.2 };
/** Moonlight (the shadow light while the sun is down). */
const MOON = { color: '#a9bcff', intensity: 0.9 };
/** Highest point of the village for the shadow camera (spires, mill). */
const TOP = 80;

const ca = new THREE.Color();
const cb = new THREE.Color();

function mixColor(a, b, t) {
  return ca.set(a).lerp(cb.set(b), t).getStyle();
}

function mixPalette(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) out[k] = typeof a[k] === 'number' ? a[k] + (b[k] - a[k]) * t : mixColor(a[k], b[k], t);
  return out;
}

function smooth(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Palette at a playback position.
 * @param {number} pos
 * @returns {typeof DAY & {light: number, warm: number, golden: number, side: number}}
 *   golden: 0..1, how low the sun is while up; side: +1 sun east, -1 west
 */
export function skyAt(pos) {
  const light = daylight(pos);
  const s = sunAt(pos);
  const twilight = 1 - Math.abs(2 * light - 1); // 1 in the middle of the twilight
  const golden = s.sunUp ? 1 - smooth((s.elevation - 4) / 18) : 0; // low sun: golden hour
  const warm = Math.max(twilight, golden * 0.55);
  const base = mixPalette(NIGHT, DAY, light);
  return { ...mixPalette(base, DUSK, warm * 0.85), light, warm, golden, side: Math.sign(s.sun.x) || 1 };
}

/**
 * Creates sky, sun, ambient light, fog and lamp glows.
 * @param {THREE.Scene} scene
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} ground
 * @param {{life?: () => boolean}} [opts] life: whether the decorative life
 *   (water, wind, clouds, fireflies) moves; the scene passes the `life` of its
 *   quality tier (app.quality.spec, off in calidad baja and with fx=0)
 */
export function createSky(scene, ground, { life = () => true } = {}) {
  const cx = (ground.minX + ground.maxX) / 2;
  const cz = (ground.minY + ground.maxY) / 2;
  const size = Math.max(ground.maxX - ground.minX, ground.maxY - ground.minY);

  // Background: a vertical gradient (and stars after dark) drawn into a canvas.
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  // Stars: fixed points in the upper part of the sky, shown after dark.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const stars = Array.from({ length: 140 }, () => ({ x: rnd() * 512, y: rnd() ** 1.6 * 300, r: 0.5 + rnd() * 0.9, a: 0.4 + rnd() * 0.6 }));
  const g2 = canvas.getContext('2d');
  const background = new THREE.CanvasTexture(canvas);
  background.colorSpace = THREE.SRGBColorSpace;
  scene.background = background;
  // Haze of the horizon colour: only the far side of the far view fades a little.
  scene.fog = new THREE.Fog('#cfe8fa', size * 1.7, size * 4.5);
  // Exposure of the palette: set on the renderer each time it draws the scene
  // (the output pass of fx.js reads it after the scene pass).
  let exposure = 1;
  scene.onBeforeRender = (renderer) => {
    renderer.toneMappingExposure = exposure;
  };

  const hemi = new THREE.HemisphereLight('#ffffff', '#666666', 1);
  const sun = new THREE.DirectionalLight('#ffffff', 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 3;
  scene.add(hemi, sun, sun.target);

  // The shadow camera fits the village box (ground × 0..TOP) seen from the light.
  const corners = [];
  for (const x of [ground.minX, ground.maxX]) for (const y of [-1, TOP]) for (const z of [ground.minY, ground.maxY]) corners.push(new THREE.Vector3(x, y, z));
  const v = new THREE.Vector3();
  function aim(dir) {
    const far = size * 2;
    sun.position.set(cx + dir.x * far, dir.y * far, cz + dir.z * far);
    sun.target.position.set(cx, 0, cz);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.position.copy(sun.position);
    cam.lookAt(sun.target.position);
    cam.updateMatrixWorld();
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let d0 = Infinity;
    let d1 = -Infinity;
    for (const c of corners) {
      v.copy(c).applyMatrix4(cam.matrixWorldInverse);
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
      d0 = Math.min(d0, -v.z);
      d1 = Math.max(d1, -v.z);
    }
    const m = 4;
    Object.assign(cam, { left: x0 - m, right: x1 + m, bottom: y0 - m, top: y1 + m, near: Math.max(0.5, d0 - 20), far: d1 + 20 });
    cam.updateProjectionMatrix();
  }

  // Lamp glows: a bright bulb (picked up by the bloom) and a pool of warm
  // light on the ground. Each lamp comes on at its own moment of the dusk
  // (a seeded delay), by the colour of its instance (both are additive:
  // black is off).
  const poolTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,210,130,0.9)');
    grad.addColorStop(0.4, 'rgba(255,180,90,0.35)');
    grad.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  let bulbs = null;
  let pools = null;
  let onAt = []; // per pool (lamps first): darkness at which it starts to light
  let bulbCount = 0;
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75, fog: false });
  // Above 1 on purpose: the bulbs stay over the bloom threshold.
  const BULB = new THREE.Color('#ffd68a').multiplyScalar(2.2);
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const tint = new THREE.Color();

  /** Adds the glows of the lamps (world points of each bulb) and other warm spots. */
  function setLamps(points, spots = []) {
    const pg = new THREE.PlaneGeometry(1, 1);
    pg.rotateX(-Math.PI / 2);
    const all = [...points.map((p) => ({ x: p.x, z: p.z, r: 15 })), ...spots];
    pools = new THREE.InstancedMesh(pg, poolMat, all.length);
    const m = new THREE.Matrix4();
    all.forEach((p, i) => {
      pools.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, 0.5, p.z), new THREE.Quaternion(), new THREE.Vector3(p.r, 1, p.r)));
      pools.setColorAt(i, tint.setScalar(0));
    });
    pools.renderOrder = 3;
    bulbCount = points.length;
    bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 10, 8), bulbMat, Math.max(1, points.length));
    bulbs.count = points.length;
    points.forEach((p, i) => {
      bulbs.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
      bulbs.setColorAt(i, tint.setScalar(0));
    });
    // From the first lamp on (darkness 0.12) to the last (0.6): the dusk ramp, 20:40 to 21:05.
    const rand = random(97);
    onAt = all.map(() => 0.12 + rand() * 0.48);
    lastDark = -1;
    scene.add(pools, bulbs);
  }

  let lastDark = -1;
  function lamps(dark) {
    if (!pools || Math.abs(dark - lastDark) < 0.002) return;
    lastDark = dark;
    onAt.forEach((at, i) => {
      const k = smooth((dark - at) / 0.07);
      pools.setColorAt(i, tint.setScalar(k));
      if (i < bulbCount) bulbs.setColorAt(i, tint.copy(BULB).multiplyScalar(k));
    });
    pools.instanceColor.needsUpdate = true;
    if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  }

  function paint(p) {
    const grad = g2.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, p.top);
    grad.addColorStop(1, p.bottom);
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 512, 512);
    // A low sun warms the horizon on its side (east is right: the camera looks north).
    if (p.golden > 0.02) {
      const x = p.side > 0 ? 512 : 0;
      const glow = g2.createRadialGradient(x, 512, 0, x, 512, 420);
      glow.addColorStop(0, `rgba(255,190,120,${(0.55 * p.golden).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(255,190,120,0)');
      g2.fillStyle = glow;
      g2.fillRect(0, 0, 512, 512);
    }
    const night = Math.max(0, 1 - p.light * 2.5);
    if (night > 0) {
      for (const st of stars) {
        g2.fillStyle = `rgba(255,255,240,${(st.a * night).toFixed(3)})`;
        g2.beginPath();
        g2.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        g2.fill();
      }
    }
    background.needsUpdate = true;
  }

  let lastSky = '';
  let lastShadow = '';
  /**
   * Sets everything for a playback position; returns the palette, with
   * `shadowKey` (it changes when the light has moved enough for the static
   * shadow map to be redrawn, scene/index.js), `dir` (unit vector towards the
   * shadow light), `exposure` and `life` (decorative movement on or off).
   */
  function update(pos) {
    const p = skyAt(pos);
    // The background is repainted only when it would look different.
    const key = `${Math.round(p.light * 40)}|${Math.round(p.warm * 40)}|${Math.round(p.golden * 20)}|${p.side}`;
    if (key !== lastSky) {
      lastSky = key;
      paint(p);
    }
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    hemi.intensity = p.hemi;
    scene.fog.color.set(p.bottom);
    exposure = p.exposure;

    const l = lightAt(pos);
    if (l.key !== lastShadow) {
      lastShadow = l.key;
      aim(l.dir);
    }
    if (l.body === 'sun') {
      // A low sun lights the ground at a grazing angle: lift it a little so
      // the golden hour stays bright (the walls facing it glow).
      const lift = Math.min(1.6, Math.max(1, Math.sqrt(0.5 / Math.max(l.dir.y, 0.1))));
      sun.color.set(p.sun);
      sun.intensity = p.sunI * l.k * lift;
    } else {
      sun.color.set(MOON.color);
      sun.intensity = MOON.intensity * l.k;
    }
    lamps(1 - p.light);
    p.shadowKey = l.key;
    p.dir = l.dir;
    p.life = life();
    return p;
  }

  return { update, setLamps, sun };
}
