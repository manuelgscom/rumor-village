// Post-processing of the scene, in this order:
//
//   RenderPass ─► GTAO (only 'high': contact shade in corners and under eaves)
//              ─► bloom (only the lamps' bulbs glow at night, not the tokens)
//              ─► tilt-shift (the village reads as a model on a table)
//              ─► grade (vignette, warm at dusk, cold at night) ─► OutputPass
//
// The tilt-shift blur leaves a wide band in the middle sharp, so that the
// colour discs of the neighbors stay crisp from far away; up close the band
// narrows:
//
//   ░░░░░░░░░░░░░░  blur grows towards the edge
//   ──────────────  ┐
//      sharp band   │ 2 × band (screen height)
//   ──────────────  ┘
//   ░░░░░░░░░░░░░░
//
// Off with ?fx=0 and in the 'low' tier: the scene then draws without composer,
// so without vignette and grade either (accepted: 'low' is for weak machines).
// The tier sets the MSAA samples and the GTAO (scene/index.js makes a new fx,
// and disposes the old, when the tier changes). Nothing here is random: the
// GTAO noise comes from a seeded generator, so captures repeat.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { random } from './world/measures.js';

/** Tilt-shift: blur (CSS px at the edges of the view) and half height of the sharp band, far and near. */
const TILT = { far: { blur: 2.6, band: 0.36 }, near: { blur: 1.6, band: 0.18 } };

/** One direction of a tilt-shift blur with a sharp band around the line r. */
const TiltShader = {
  name: 'BandTiltShiftShader',
  uniforms: { tDiffuse: { value: null }, step: { value: new THREE.Vector2() }, r: { value: 0.5 }, band: { value: 0.3 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 step;
    uniform float r;
    uniform float band;
    varying vec2 vUv;
    void main() {
      float k = max(0.0, abs(r - vUv.y) - band) / max(0.01, 0.5 - band);
      vec2 d = step * k;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.1633;
      sum += (texture2D(tDiffuse, vUv - d) + texture2D(tDiffuse, vUv + d)) * 0.1531;
      sum += (texture2D(tDiffuse, vUv - 2.0 * d) + texture2D(tDiffuse, vUv + 2.0 * d)) * 0.12245;
      sum += (texture2D(tDiffuse, vUv - 3.0 * d) + texture2D(tDiffuse, vUv + 3.0 * d)) * 0.0918;
      sum += (texture2D(tDiffuse, vUv - 4.0 * d) + texture2D(tDiffuse, vUv + 4.0 * d)) * 0.051;
      gl_FragColor = sum;
    }`,
};

/**
 * Colour grade and vignette, before the OutputPass (linear HDR colour): a
 * multiplicative tint (warm at dusk, cold at night, none by day) and a
 * darkening towards the corners that grows after dark.
 */
const GradeShader = {
  name: 'VillageGradeShader',
  uniforms: { tDiffuse: { value: null }, tint: { value: new THREE.Vector3(1, 1, 1) }, vignette: { value: 0.15 } },
  vertexShader: TiltShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 tint;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float r = length(vUv - 0.5) * 1.41421; // 0 in the centre, 1 in the corners
      float v = 1.0 - vignette * smoothstep(0.4, 1.0, r);
      gl_FragColor = vec4(c.rgb * tint * v, c.a);
    }`,
};

/** Grade by time of day: tints (multipliers, linear) and vignette amounts. */
const GRADE = { warm: [1.07, 1.0, 0.88], cold: [0.9, 0.96, 1.1], vignette: { day: 0.14, dusk: 0.26, night: 0.34 } };

/**
 * Tint and vignette for a daylight value (pure).
 * @param {number} light daylight 0..1 (sky.js skyAt)
 * @returns {{tint: number[], vignette: number}}
 */
export function gradeAt(light) {
  const warm = 1 - Math.abs(2 * light - 1); // 1 in the middle of the twilight
  const night = Math.max(0, 1 - 2 * light); // 1 at full night
  const tint = [0, 1, 2].map((i) => (1 + (GRADE.warm[i] - 1) * warm) * (1 + (GRADE.cold[i] - 1) * night));
  const vignette = GRADE.vignette.day + (GRADE.vignette.dusk - GRADE.vignette.day) * warm + (GRADE.vignette.night - GRADE.vignette.day) * night;
  return { tint, vignette };
}

/**
 * Bloom by time of day: by day almost nothing passes the threshold; at night
 * only what is brighter than white (the HDR bulbs) glows, so a crowd of
 * tokens on the square does not melt into a white blot.
 * @param {number} light daylight 0..1
 * @returns {{threshold: number, strength: number}}
 */
export function bloomAt(light) {
  return { threshold: light > 0.5 ? 0.95 : 0.9, strength: 0.2 + 0.4 * (1 - light) };
}

/** GTAO tuned to the village (world units: CELL = 10, a neighbor is ~8 tall). */
const AO = { radius: 4, thickness: 3, distanceExponent: 2, distanceFallOff: 1, scale: 1, samples: 16, blend: 0.85 };
/** Seed of the GTAO denoise noise (the vendor pass would use Math.random). */
const AO_SEED = 8202;

/**
 * GTAOPass made cheaper and repeatable:
 *   - no second render of the scene for normals and depth: it reads the depth
 *     of the scene target (the RenderPass just drew it, `readBuffer`) and
 *     rebuilds the normals from it. Transparent glows, trails and markers do not
 *     write depth, so they cast no shade;
 *   - AO and denoise at half resolution (a quarter of the pixels);
 *   - the denoise noise comes from a seeded generator (the vendor pass uses
 *     Math.random through SimplexNoise); its other noise, the magic square, is
 *     already fixed.
 */
class VillageAO extends GTAOPass {
  constructor(scene, camera, params) {
    super(scene, camera, 1, 1, undefined, params);
    this._renderGBuffer = false;
    for (const m of [this.gtaoMaterial, this.pdMaterial]) {
      m.defines.NORMAL_VECTOR_TYPE = 0;
      m.defines.DEPTH_SWIZZLING = 'x';
      m.uniforms.tNormal.value = null;
      m.needsUpdate = true;
    }
  }

  setSize(width, height) {
    super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
    this.normalRenderTarget.setSize(1, 1); // unused: the depth is the scene's
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    this.gtaoMaterial.uniforms.tDepth.value = readBuffer.depthTexture;
    this.pdMaterial.uniforms.tDepth.value = readBuffer.depthTexture;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  _generateNoise(size = 64) {
    const simplex = new SimplexNoise({ random: random(AO_SEED) });
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const k = (i * size + j) * 4;
        data[k] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
        data[k + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
        data[k + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255;
        data[k + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {{samples?: number, ao?: boolean}} [opt]  MSAA samples of the scene target and
 *   GTAO on or off (TIERS[tier].samples and .ao)
 */
export function createFx(renderer, scene, camera, { samples = 4, ao = false } = {}) {
  // With GTAO the scene target keeps its depth in a texture, for the AO to read.
  const depthTexture = ao ? new THREE.DepthTexture(1, 1) : null;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthTexture });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  if (ao) {
    const { blend, ...params } = AO;
    const gtao = new VillageAO(scene, camera, params);
    gtao.blendIntensity = blend;
    composer.addPass(gtao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 0.92);
  composer.addPass(bloom);
  const hblur = new ShaderPass(TiltShader);
  const vblur = new ShaderPass(TiltShader);
  composer.addPass(hblur);
  composer.addPass(vblur);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  let w = 1;
  let h = 1;
  return {
    setSize(width, height, dpr) {
      w = width;
      h = height;
      composer.setPixelRatio(dpr);
      composer.setSize(width, height);
    },
    /**
     * @param {number} zoom camera zoom factor (1 = whole village)
     * @param {number} light daylight 0..1
     */
    render(zoom, light) {
      const k = Math.min(1, Math.max(0, (zoom - 1) / 4));
      const blur = (TILT.far.blur + (TILT.near.blur - TILT.far.blur) * k) * 0.5;
      const band = TILT.far.band + (TILT.near.band - TILT.far.band) * k;
      hblur.uniforms.step.value.set(blur / w, 0);
      vblur.uniforms.step.value.set(0, blur / h);
      hblur.uniforms.band.value = band;
      vblur.uniforms.band.value = band;
      Object.assign(bloom, bloomAt(light));
      const g = gradeAt(light);
      grade.uniforms.tint.value.fromArray(g.tint);
      grade.uniforms.vignette.value = g.vignette;
      composer.render();
    },
    /** Frees the render targets of the composer and its passes. */
    dispose() {
      for (const pass of composer.passes) pass.dispose?.();
      composer.dispose();
    },
  };
}
