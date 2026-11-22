// Decorative life of the village (fase 8-2, 2.5): ripples and glints on the
// river, wind in the tree crowns and the banners, a few low clouds with their
// shadow on the ground, and fireflies by the water at night. Everything moves
// with the decorative clock (frame.now, fixed with ?clock=) and stops when the
// quality tier turns life off (palette.life false). Seeded: no Math.random.
//
//   wind     vertex shader of the merged kit meshes: offset by the `sway`
//            attribute (0 on walls, growing with height in crowns and banners)
//   water    ripples as a sum of waves along the river (normal in the shader)
//   clouds   one instanced mesh, one for their shadows (soft discs on the
//            ground, cast along the light direction)
//   flies    one Points mesh, additive, only after dark

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { random } from './measures.js';

/** Height of the cloud shadows: over most roofs (the tallest towers poke through). */
const SHADE_Y = 36;

function smooth(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Shared uniforms of the animated materials. */
const shared = { time: { value: 0 }, wind: { value: 1 } };

const patched = new WeakMap();

/**
 * Wind: a copy of a kit material whose vertices move by their `sway`
 * attribute (world units of the swing). Shadows stay still (the map is static).
 * @param {THREE.Material} material
 */
export function windMaterial(material) {
  if (patched.has(material)) return patched.get(material);
  const m = material.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLifeTime = shared.time;
    shader.uniforms.uWind = shared.wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uLifeTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          // Phase by place, slow across one crown: neighbours sway out of step.
          float ph = dot(transformed.xz, vec2(0.05, 0.04));
          float s = sway * uWind;
          transformed.x += s * (sin(uLifeTime * 1.3 + ph) + 0.35 * sin(uLifeTime * 3.1 + ph * 2.0));
          transformed.z += s * 0.5 * sin(uLifeTime * 1.05 + ph * 1.6 + 1.3);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'village-wind';
  patched.set(material, m);
  return m;
}

/** Swaps the material of every merged mesh that carries some sway for its windy copy. */
export function addWind(group) {
  group.traverse((o) => {
    const sway = o.isMesh && o.geometry.attributes.sway;
    if (!sway) return;
    if (sway.array.some((x) => x !== 0)) o.material = windMaterial(o.material);
    else o.geometry.deleteAttribute('sway');
  });
}

/** Value noise for the water shader (hash of the cell corners, smoothed). */
const NOISE = `
float lifeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lifeNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lifeHash(i), lifeHash(i + vec2(1.0, 0.0)), u.x), mix(lifeHash(i + vec2(0.0, 1.0)), lifeHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

/**
 * Water of the river: slow bands of colour and small ripples that run
 * downstream (the `river` attribute is distance along and across, `flow` the
 * direction of the stream), foam along the banks and a few glints. Ripples
 * change the normal only: the surface stays flat. Glints and the finest
 * ripples fade out when a pixel covers too much water (far view), so they do
 * not shimmer.
 * @param {string} color
 * @param {number} width of the river
 */
export function waterMaterial(color, width) {
  const glint = { value: 1 };
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.15, metalness: 0.15, emissive: '#1b4a6a', emissiveIntensity: 0.15 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLifeTime = shared.time;
    shader.uniforms.uGlint = glint;
    shader.uniforms.uHalf = { value: width / 2 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 river;\nattribute vec2 flow;\nvarying vec2 vRiver;\nvarying vec2 vFlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiver = river;\nvFlow = flow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uLifeTime;\nuniform float uGlint;\nuniform float uHalf;\nvarying vec2 vRiver;\nvarying vec2 vFlow;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float lifeFine = 1.0 - smoothstep(0.25, 1.1, fwidth(vRiver.x));
        {
          vec2 r = vRiver;
          float t = uLifeTime;
          diffuseColor.rgb *= 0.88 + 0.24 * lifeNoise(vec2(r.x * 0.05 - t * 0.3, r.y * 0.16));
          float edge = smoothstep(uHalf - 3.0, uHalf - 0.3, abs(r.y)) * (0.55 + 0.45 * lifeNoise(vec2(r.x * 0.4 - t * 0.6, r.y)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.95, 1.0), edge * 0.6);
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Gradient of a sum of waves in (along, across), then to world xz.
          vec2 r = vRiver;
          float t = uLifeTime;
          vec2 g = vec2(0.0);
          vec2 d;
          float ph;
          d = vec2(0.96, 0.28); ph = 0.45 * dot(d, r) - 1.5 * t; g += 0.3 * 0.45 * cos(ph) * d;
          d = vec2(0.85, -0.53); ph = 0.8 * dot(d, r) - 2.1 * t; g += 0.16 * 0.8 * cos(ph) * d;
          d = vec2(0.6, 0.8); ph = 1.5 * dot(d, r) - 2.7 * t; g += lifeFine * 0.06 * 1.5 * cos(ph) * d;
          vec2 tg = normalize(vFlow + vec2(1e-5, 0.0));
          vec2 gw = g.x * tg + g.y * vec2(-tg.y, tg.x);
          normal = normalize(mat3(viewMatrix) * normalize(vec3(-gw.x, 1.0, -gw.y)));
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // Sparse glints, stretched along the stream, drifting down it.
          vec2 r = vRiver;
          float t = uLifeTime;
          float a = lifeNoise(vec2(r.x * 0.3 - t * 1.2, r.y * 1.1 + t * 0.2));
          float b = lifeNoise(vec2(r.x * 0.7 + t * 0.7, r.y * 0.6 - t * 0.4) + 17.0);
          totalEmissiveRadiance += vec3(1.0, 0.96, 0.85) * smoothstep(0.8, 0.95, a) * smoothstep(0.55, 0.85, b) * uGlint * lifeFine * 1.4;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'village-water';
  m.userData.glint = glint;
  return m;
}

/** A soft dark disc (cloud shadow). */
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** A cloud: a flat base of puffs and a few on top, merged (about 5 × 2.5 units). */
function cloudGeometry(rand) {
  const puffs = [];
  const puff = (r, x, y, z) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1.25, 0.55, 1);
    g.translate(x, y, z);
    puffs.push(g);
  };
  for (let i = 0; i < 6; i++) puff(0.55 + rand() * 0.3, -2 + i * 0.8, 0, (rand() - 0.5) * 1.1);
  for (let i = 0; i < 3; i++) puff(0.6 + rand() * 0.35, -0.9 + i * 0.9 + (rand() - 0.5) * 0.4, 0.3 + rand() * 0.2, (rand() - 0.5) * 0.6);
  return mergeGeometries(puffs, false);
}

/**
 * Clouds, their shadows and the fireflies.
 * @param {import('./plan.js').TownPlan} plan
 */
export function createLife(plan) {
  const group = new THREE.Group();
  const g = plan.ground;
  const rand = random(4021);

  // Clouds drift east; they grow out of nothing at one end and melt at the other.
  const N = 4;
  const pad = 200;
  const span = g.maxX - g.minX + 2 * pad;
  const clouds = Array.from({ length: N }, (_, i) => ({
    x: (i + rand() * 0.6) / N,
    z: g.minY + (0.1 + rand() * 0.8) * (g.maxY - g.minY),
    y: 150 + rand() * 50,
    s: 20 + rand() * 12,
    rot: rand() * Math.PI,
    speed: 3 + rand() * 2,
  }));
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#f4f7fb', roughness: 1, flatShading: true, transparent: true, opacity: 0.9 });
  const cloudMesh = new THREE.InstancedMesh(cloudGeometry(rand), cloudMat, N);
  cloudMesh.frustumCulled = false;
  const shadePlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadeMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), color: '#000000', transparent: true, opacity: 0.2, depthWrite: false, fog: false });
  const shades = new THREE.InstancedMesh(shadePlane, shadeMat, N);
  shades.frustumCulled = false;
  shades.renderOrder = 2;
  group.add(cloudMesh, shades);

  // Fireflies: along the river banks and around some trees near it.
  const pts = [];
  const river = plan.river;
  if (river) {
    for (let i = 0; i < 110; i++) {
      const [ax, az] = river.path[Math.floor(rand() * (river.path.length - 1))];
      const side = rand() < 0.5 ? -1 : 1;
      pts.push(ax + rand() * 16, 1.5 + rand() * 4, az + side * (river.width / 2 + rand() * 14));
    }
  }
  const near = plan.trees.filter((t) => !river || Math.abs(t.y - river.y) < 160);
  for (let i = 0; i < 70 && near.length; i++) {
    const t = near[Math.floor(rand() * near.length)];
    pts.push(t.x + (rand() - 0.5) * 20, 2 + rand() * 6, t.y + (rand() - 0.5) * 20);
  }
  const flyGeo = new THREE.BufferGeometry();
  flyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  flyGeo.setAttribute('phase', new THREE.Float32BufferAttribute(Array.from({ length: pts.length / 3 }, () => rand()), 1));
  const flyMat = new THREE.ShaderMaterial({
    uniforms: { uLifeTime: shared.time, uAlpha: { value: 0 }, uScale: { value: 500 } },
    vertexShader: `
      attribute float phase;
      uniform float uLifeTime;
      uniform float uScale;
      varying float vBlink;
      void main() {
        float t = uLifeTime;
        float a = phase * 6.2832;
        vec3 p = position + vec3(sin(t * 0.7 + a) * 1.8, sin(t * 1.3 + a * 2.0) * 0.9, cos(t * 0.6 + a * 3.0) * 1.8);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(3.0, 2.0 * uScale / -mv.z);
        vBlink = 0.35 + 0.65 * smoothstep(-0.2, 0.9, sin(t * 2.3 + a * 7.0));
      }`,
    fragmentShader: `
      uniform float uAlpha;
      varying float vBlink;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.0, 0.5, d)) * vBlink * uAlpha;
        gl_FragColor = vec4(vec3(0.9, 1.0, 0.45) * 3.0 * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flies = new THREE.Points(flyGeo, flyMat);
  flies.frustumCulled = false;
  flies.visible = false;
  group.add(flies);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  /** Fade near the ends of the drift (clouds form and melt). */
  const edge = (x) => smooth(Math.min(x - (g.minX - pad), g.maxX + pad - x) / 120);
  const onGround = (x, z) => smooth(Math.min(x - g.minX, g.maxX - x, z - g.minY, g.maxY - z) / 40);

  /**
   * @param {{now: number, h: number, dpr: number, camera: {view: () => object}}} frame
   * @param {{light?: number, life?: boolean, dir?: {x: number, y: number, z: number}}} palette
   */
  function update(frame, palette) {
    const life = palette?.life ?? true;
    const t = life ? frame.now / 1000 : 0;
    shared.time.value = t;
    shared.wind.value = life ? 1 : 0;
    const light = palette?.light ?? 1;

    // Clouds only when the camera is well above them, and not in calidad baja
    // nor over the telephone row (its camera sits among them).
    const v = frame.camera?.view?.();
    const high = v ? smooth((v.eye.y - 700) / 400) : 1;
    cloudMesh.visible = shades.visible = life && high > 0 && !plan.row;
    if (cloudMesh.visible) {
      const dir = palette?.dir ?? { x: 0.3, y: 0.8, z: 0.5 };
      // Faint at night: a cloud in the moonlight is barely there.
      shadeMat.opacity = 0.5 * light;
      cloudMat.opacity = 0.2 + 0.7 * light;
      clouds.forEach((c, i) => {
        const x = g.minX - pad + ((((c.x * span + t * c.speed) % span) + span) % span);
        const k = edge(x) * high;
        q.setFromAxisAngle(up, c.rot);
        cloudMesh.setMatrixAt(i, m.compose(p.set(x, c.y, c.z), q, sc.set(c.s * k, c.s * k, c.s * k)));
        // The shadow: where the ray from the light through the cloud meets
        // the ground, drawn a little above the roofs so it darkens them too.
        const sx = x - (dir.x / dir.y) * (c.y - SHADE_Y);
        const sz = c.z - (dir.z / dir.y) * (c.y - SHADE_Y);
        const ks = k * onGround(sx, sz) * c.s;
        shades.setMatrixAt(i, m.compose(p.set(sx, SHADE_Y, sz), q, sc.set(ks * 5.4, 1, ks * 2.8)));
      });
      cloudMesh.instanceMatrix.needsUpdate = true;
      shades.instanceMatrix.needsUpdate = true;
    }

    // Fireflies after dark.
    const night = smooth((0.55 - light) / 0.35);
    flies.visible = life && night > 0;
    if (flies.visible) {
      flyMat.uniforms.uAlpha.value = night;
      const fov = (v?.fov ?? 30) * (Math.PI / 180);
      flyMat.uniforms.uScale.value = (frame.h * Math.min(frame.dpr ?? 1, 2)) / (2 * Math.tan(fov / 2));
    }
  }

  return { group, update };
}

export { shared as lifeUniforms };
