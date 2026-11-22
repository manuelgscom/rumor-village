// The neighbors in the scene. Each one is a character model with its own look
// (look.js: model, accessories, height), animated by what it is doing, on a
// soft shadow and a token in the color of the version of the rumor it knows
// (package C's hook). From far away the tokens are what counts: they grow to
// a minimum size on screen, so the rumor spreads as a wave of color, while
// the grey of those who know nothing stays small and faint.
//
//     selected:   ▼  marker above the name label (always on top)
//                 ┃  beam of light
//               ( ☺ ) white ring, turning
//     token:    ▄█✓█▄  rim + face in the version color, and a shape on it
//                      (✓ correct, ~ incomplete, ✗ distorted: not only color)
//     told:     ◯ ring spreading, flash, sparks, beam (function of pos)
//     icon:     (!) (?) (≈) by the head for a few ticks: hears, forgets,
//                takes a doubt as sure (look.js iconsAt)
//     arriving: a jump and a nod at the original place and hour, a shake of
//                the head elsewhere (look.js reactionAt)
//
// Positions, headings, the walk cycle, the contagion effect, the icons and
// the reactions are a function of (state, pos), like everything informative;
// the gestures (talking, nodding, idle) and the turning of the selection
// marker use the decorative clock (app.now()), since they say nothing, and
// stand still with app.reducedMotion(). While package C shows a chain or a
// group (rumorSpec().focus), the tokens of everybody else are dimmed.
//
// Portraits (portrait.js): app.hooks.portrait(id) gives a data URL of the
// neighbor's figure, drawn on demand, one per frame at most; null until then
// (and before the models load), and 'portrait' {id} on the bus when ready.
//
// Cost: tokens, grey discs, shadows, icons and each contagion part are one
// instanced mesh each. Characters off screen are hidden and not animated;
// characters only a few pixels tall keep their pose and lose their accessories.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { inGame } from '../../core/params.js';
import { VERSION_COLORS } from '../../core/theme.js';
import { routeIndex, tripPath } from '../../render/layout.js';
import { recentTells } from '../../render/wave.js';
import { ICON_PATHS } from '../../core/icons.js';
import { CHAR_SCALE, hash, HEAD } from '../world/plan.js';
import { createPortraits } from './portrait.js';
import {
  ACCESSORIES,
  activityOf,
  CHARACTERS,
  gestureAt,
  GLYPH_INK,
  GLYPH_STROKES,
  GLYPH_WIDTH,
  headingTo,
  ICON_KINDS,
  iconLook,
  iconsAt,
  looksOf,
  OUTFITS,
  reactionAt,
  reactionClips,
  recolor,
  restHeading,
  sparkAt,
  STRIDE,
  TELL_TICKS,
  tellPulse,
  versionOfColor,
} from './look.js';

/** Token under the feet: radius (world units) near and smallest on screen (CSS px). */
const TOKEN = { radius: 3.2, minPx: 8, height: 0.2 };
/** Inside the game the colour under the feet is the main reading of the map: bigger (phase 9-5). */
const TOKEN_GAME = 1.4;
/** Character height on screen (CSS px) over which the token's shape moves to its front edge. */
const GLYPH_FRONT_PX = [10, 30];
/** Smallest radius on screen (CSS px) of the contagion effects' base. */
const TELL_PX = 12;
/** Grey disc of those who know nothing: radius and smallest on screen. */
const GREY = { radius: 2.4, minPx: 2, opacity: 0.4 };
/** Below this height on screen (CSS px) a character keeps its pose and accessories hide. */
const TINY_PX = 7;
const ACCESSORY_PX = 16;
/** Ticks over which walking blends in after leaving and out after arriving. */
const STEP_BLEND = 0.35;
/** Height (world units) of the jump of who hears the rumor. */
const HOP = 2.6;
/** Sparks per contagion. */
const SPARKS = 10;
/**
 * Icons by the heads: size on screen (CSS px), the character heights (CSS
 * px) over which they fade in, and where: beside the head, to its right
 * (`side` icon sizes plus `gap` px) and a little under its top (`drop`),
 * clear of the name label and of the speech bubbles, which sit above it.
 */
const ICON = { px: 34, fade: [9, 16], max: 100, side: 0.6, gap: 6, drop: 0.2 };
/** Opacity of the tokens outside the focus of package C (a chain or a group shown). */
const DIM_ALPHA = 0.22;
/** Selection: ring and marker smallest on screen (CSS px), beam height (world units). */
const SELECT = { ringPx: 20, markerPx: 22, beamPx: 150, labelPx: 46, color: '#ffffff', edge: '#1d2733', marker: '#ffd84a' };

function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return total;
}

/** Paints a geometry's vertices with a gray level (or RGBA) from a function of the vertex. */
function paint(geo, fn, size = 3) {
  const p = geo.attributes.position;
  const c = new Float32Array(p.count * size);
  for (let i = 0; i < p.count; i++) {
    const v = typeof fn === 'function' ? fn(p.getX(i), p.getY(i), p.getZ(i)) : fn;
    for (let k = 0; k < size; k++) c[i * size + k] = Array.isArray(v) ? v[k] : v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, size));
  return geo;
}

/** A flat ring (or disc) lying on the ground, centered, radius 1. */
function flat(geo) {
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Board-game token of radius 1 and height h: darker side, raised bright rim,
 * slightly recessed face. Vertex colors multiply the instance color.
 */
function tokenGeometry(h) {
  const side = new THREE.CylinderGeometry(1, 1, h, 40, 1, true);
  side.translate(0, h / 2, 0);
  paint(side, (x, y) => (y > h / 2 ? 0.72 : 0.5));
  const rim = flat(new THREE.RingGeometry(0.78, 1, 40, 1));
  rim.translate(0, h, 0);
  paint(rim, (x, y, z) => (Math.hypot(x, z) > 0.9 ? 1.18 : 1.05));
  const face = flat(new THREE.CircleGeometry(0.78, 40));
  face.translate(0, h * 0.75, 0);
  paint(face, (x, y, z) => 0.86 + 0.08 * (1 - Math.hypot(x, z) / 0.78));
  const inner = new THREE.CylinderGeometry(0.78, 0.78, h * 0.25, 40, 1, true);
  inner.translate(0, h * 0.875, 0);
  paint(inner, 0.62);
  for (const g of [side, rim, face, inner]) g.deleteAttribute('uv');
  return mergeGeometries([side, rim, face, inner]);
}

/**
 * Flat glyph of strokes (look.js GLYPH_STROKES: x right, y down the screen,
 * that is +z), lying on the ground: a band per segment and a disc per point,
 * so that joints and ends are round.
 */
function glyphGeometry(strokes, width) {
  const parts = [];
  for (const line of strokes) {
    line.forEach(([x, z], i) => {
      parts.push(flat(new THREE.CircleGeometry(width / 2, 12)).translate(x, 0, z));
      if (i === 0) return;
      const [px, pz] = line[i - 1];
      const len = Math.hypot(x - px, z - pz);
      const band = flat(new THREE.PlaneGeometry(len, width));
      band.rotateY(Math.atan2(-(z - pz), x - px));
      parts.push(band.translate((x + px) / 2, 0, (z + pz) / 2));
    });
  }
  return mergeGeometries(parts);
}

/** A ring with `n` dashes, radius 1, lying on the ground. */
function dashedRing(inner, n) {
  const parts = [];
  const arc = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) parts.push(flat(new THREE.RingGeometry(inner, 1, 8, 1, i * arc, arc * 0.62)));
  return mergeGeometries(parts);
}

/**
 * Material of the effects: per-instance RGBA (attribute fxColor) times the
 * vertex color's red channel as alpha (gradients), unlit.
 */
function fxMaterial(extra = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 fxColor;
      attribute vec3 color;
      varying vec4 vColor;
      void main() {
        vColor = vec4(fxColor.rgb, fxColor.a * color.r);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vColor;
      void main() {
        if (vColor.a < 0.003) discard;
        gl_FragColor = vColor;
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    ...extra,
  });
}

/** Instanced mesh of the effects with room for `max` instances and an fxColor attribute. */
function fxMesh(geo, max, extra) {
  const g = geo.clone();
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  colors.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('fxColor', colors);
  const mesh = new THREE.InstancedMesh(g, fxMaterial(extra), max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 3;
  return mesh;
}

/**
 * Outline material for the selected character: the same skinned mesh drawn
 * from the back, a little larger around the body's middle.
 */
function outlineMaterial(color) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, toneMapped: false });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed = vec3(0.0, 0.36, 0.0) + (transformed - vec3(0.0, 0.36, 0.0)) * vec3(1.09, 1.05, 1.12);',
    );
  };
  return mat;
}

/**
 * Per-instance opacity for a mesh of a lit-less material (MeshBasicMaterial):
 * an `instAlpha` attribute multiplies the alpha. Returns the attribute and a
 * see-through twin of the material, swapped in only while something is dimmed
 * (the solid one draws exactly as before).
 */
function instanceAlpha(mesh, max) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(max).fill(1), 1);
  attr.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('instAlpha', attr);
  const patch = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instAlpha;\nvarying float vInstAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstAlpha = instAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstAlpha;')
      .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vInstAlpha;\n#include <alphatest_fragment>');
  };
  const solid = mesh.material;
  solid.onBeforeCompile = patch;
  solid.customProgramCacheKey = () => 'inst-alpha';
  const clear = solid.clone();
  clear.onBeforeCompile = patch;
  clear.customProgramCacheKey = () => 'inst-alpha';
  clear.transparent = true;
  return { attr, solid, clear };
}

/**
 * Atlas of the icons over the heads (look.js ICON_KINDS, one cell each): a
 * round badge with a tail, and the line icon of core/icons.js on it.
 */
function iconAtlas() {
  const cell = 128;
  const c = document.createElement('canvas');
  c.width = cell * ICON_KINDS.length;
  c.height = cell;
  const g = c.getContext('2d');
  const look = {
    learned: { fill: '#ffffff', ink: '#1d2a35', ring: '#1d2a35', paths: ['M8 3.2v6.2'], dots: [[8, 12.6, 0.9]] },
    forgot: { fill: '#5d6875', ink: '#ffffff', ring: '#ffffff', markup: ICON_PATHS.forgot },
    assumed: { fill: '#d98a1c', ink: '#ffffff', ring: '#ffffff', markup: ICON_PATHS.doubt },
  };
  ICON_KINDS.forEach((kind, i) => {
    const spec = look[kind];
    const x0 = i * cell;
    g.save();
    g.translate(x0, 0);
    // Badge with a small tail pointing down at the head.
    g.beginPath();
    g.arc(64, 56, 44, 0, Math.PI * 2);
    g.moveTo(52, 96);
    g.lineTo(64, 120);
    g.lineTo(76, 96);
    g.closePath();
    g.fillStyle = spec.fill;
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = spec.ring;
    g.stroke();
    g.fillStyle = spec.fill;
    g.beginPath();
    g.arc(64, 56, 40, 0, Math.PI * 2);
    g.fill();
    // The 16×16 icon, scaled into the badge.
    g.translate(64 - 8 * 4.2, 56 - 8 * 4.2);
    g.scale(4.2, 4.2);
    g.strokeStyle = spec.ink;
    g.fillStyle = spec.ink;
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const markup = spec.markup ?? '';
    const paths = [...(spec.paths ?? []), ...[...markup.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])];
    const dots = [...(spec.dots ?? []), ...[...markup.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map((m) => [+m[1], +m[2], +m[3] * 1.6])];
    for (const d of paths) g.stroke(new Path2D(d));
    for (const [cx, cy, r] of dots) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Instanced icons that always face the camera: each instance is a square of
 * the size of its matrix's scale at its matrix's position, showing one cell
 * of the atlas (attribute iconCell) with an opacity (iconAlpha).
 */
function iconMesh(max) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const cell = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  cell.setUsage(THREE.DynamicDrawUsage);
  alpha.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iconCell', cell);
  geo.setAttribute('iconAlpha', alpha);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: iconAtlas() }, cells: { value: ICON_KINDS.length } },
    vertexShader: /* glsl */ `
      attribute float iconCell;
      attribute float iconAlpha;
      uniform float cells;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float size = length(instanceMatrix[0].xyz);
        centre.xy += position.xy * size;
        vUv = vec2((uv.x + iconCell) / cells, uv.y);
        vAlpha = iconAlpha;
        gl_Position = projectionMatrix * centre;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 c = texture2D(map, vUv);
        c.a *= vAlpha;
        if (c.a < 0.01) discard;
        gl_FragColor = c;
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 9;
  return mesh;
}

/**
 * Outfit variants of a palette texture (OUTFITS): same sampling, cool
 * clothing swatches with their hue turned. Index 0 is the texture itself.
 * @param {THREE.Texture} tex
 * @returns {THREE.Texture[]}
 */
function outfitTextures(tex) {
  const img = tex?.image;
  if (!img?.width) return OUTFITS.map(() => tex);
  const base = document.createElement('canvas');
  base.width = img.width;
  base.height = img.height;
  const g = base.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const src = g.getImageData(0, 0, base.width, base.height);
  return OUTFITS.map((turn) => {
    if (!turn) return tex;
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    const d = out.data;
    const memo = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      let rgb = memo.get(key);
      if (!rgb) memo.set(key, (rgb = recolor(d[i], d[i + 1], d[i + 2], turn)));
      [d[i], d[i + 1], d[i + 2]] = rgb;
    }
    c.getContext('2d').putImageData(out, 0, 0);
    const t = tex.clone();
    t.source = new THREE.TextureSource(c);
    t.needsUpdate = true;
    return t;
  });
}

/**
 * Creates the actors once the models are loaded.
 * @param {object} app
 * @param {ReturnType<import('../../render/view.js').createView>} view
 * @param {Map<string, object>} models loaded glTF by file (ACTOR_FILES)
 * @returns {{group: THREE.Group, update: (frame: object) => void, selected: (id: string|null) => void}}
 */
export function createActors(app, view, models) {
  const { header, store } = app;
  const big = inGame(app.params) ? TOKEN_GAME : 1;
  const group = new THREE.Group();
  const routes = routeIndex(header);
  const looks = looksOf(header);
  const jobs = new Map((header.neighbors ?? []).map((n) => [n.id, n.job]));
  const ids = (header.neighbors ?? []).map((n) => n.id);
  const fallback = models.get(`character-${CHARACTERS.m[0]}`);
  const durations = Object.fromEntries(fallback.animations.map((c) => [c.name, c.duration]));

  // Outfits: every character shares the palette texture; one material per
  // (material, outfit), so a hundred actors still share a handful.
  let palette = null;
  fallback.scene.traverse((o) => {
    if (o.isMesh && o.material?.map && !palette) palette = o.material.map;
  });
  const outfits = outfitTextures(palette);
  const dressed = new Map();
  const dress = (mat, k) => {
    if (!k || !mat?.map) return mat;
    const key = `${mat.uuid}|${k}`;
    if (!dressed.has(key)) {
      const m = mat.clone();
      m.map = outfits[k];
      dressed.set(key, m);
    }
    return dressed.get(key);
  };

  // Shadows, tokens and grey discs: one instanced mesh each.
  const blobTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const blobs = new THREE.InstancedMesh(
    flat(new THREE.PlaneGeometry(9, 9)),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }),
    ids.length,
  );
  blobs.renderOrder = 1;
  const tokens = new THREE.InstancedMesh(tokenGeometry(TOKEN.height), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), ids.length);
  tokens.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ids.length * 3), 3);
  const greys = new THREE.InstancedMesh(
    flat(new THREE.CircleGeometry(1, 24)),
    new THREE.MeshBasicMaterial({ color: VERSION_COLORS.unknown, transparent: true, opacity: GREY.opacity, depthWrite: false, toneMapped: false }),
    ids.length,
  );
  greys.renderOrder = 2;
  // The shape on each token: one instanced mesh per version.
  const glyphs = {};
  for (const [v, strokes] of Object.entries(GLYPH_STROKES)) {
    const mesh = new THREE.InstancedMesh(
      glyphGeometry(strokes, GLYPH_WIDTH),
      new THREE.MeshBasicMaterial({ color: GLYPH_INK[v], toneMapped: false }),
      ids.length,
    );
    mesh.count = 0;
    glyphs[v] = mesh;
  }
  for (const m of [blobs, tokens, greys, ...Object.values(glyphs)]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  // Tokens and their shapes can be dimmed one by one (the focus of package C).
  const fades = [tokens, ...Object.values(glyphs)].map((mesh) => ({ mesh, ...instanceAlpha(mesh, ids.length) }));
  const tokenAlpha = fades[0].attr;
  const glyphAlpha = Object.fromEntries(Object.keys(glyphs).map((v, i) => [v, fades[i + 1].attr]));
  group.add(blobs, greys, tokens, ...Object.values(glyphs));
  const icons = iconMesh(ICON.max);
  group.add(icons);

  // Contagion: ring, flash, beam and sparks.
  const fxMax = 24;
  const beamGeo = paint(new THREE.CylinderGeometry(0.75, 1, 1, 24, 6, true).translate(0, 0.5, 0), (x, y) => (1 - y) ** 1.3);
  const pulseRing = fxMesh(paint(flat(new THREE.RingGeometry(0.7, 1, 48)), 1), fxMax * 2);
  const flash = fxMesh(paint(flat(new THREE.CircleGeometry(1, 32)), (x, y, z) => 1 - Math.hypot(x, z) ** 2), fxMax);
  const beams = fxMesh(beamGeo, fxMax, { side: THREE.DoubleSide });
  const sparks = fxMesh(paint(new THREE.OctahedronGeometry(1, 0), 1), fxMax * SPARKS);
  group.add(pulseRing, flash, beams, sparks);

  // Selection: dark band with a white dashed ring, beam, marker pointing
  // down from above the name label (always on top).
  const selBand = fxMesh(paint(flat(new THREE.RingGeometry(0.62, 1.08, 48)), 1), 1);
  const selRing = fxMesh(paint(dashedRing(0.72, 12), 1), 1);
  const selBeam = fxMesh(beamGeo, 1, { side: THREE.DoubleSide });
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1.4, 4).rotateX(Math.PI).translate(0, 0.7, 0),
    new THREE.MeshBasicMaterial({ color: SELECT.marker, toneMapped: false, depthTest: false, transparent: true }),
  );
  const markerEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(marker.geometry),
    new THREE.LineBasicMaterial({ color: '#5a4300', depthTest: false, transparent: true }),
  );
  marker.add(markerEdge);
  marker.renderOrder = markerEdge.renderOrder = 10;
  marker.visible = false;
  group.add(selBand, selRing, selBeam, marker);
  const edge = new THREE.Color(SELECT.edge);
  const outlineMat = outlineMaterial(SELECT.color);

  /** A fresh copy of a neighbor's figure: model, outfit and accessories, in model units. */
  const figure = (id) => {
    const look = looks.get(id);
    if (!look) return null;
    const gltf = models.get(`character-${look.model}`) ?? fallback;
    const root = clone(gltf.scene);
    const skinned = [];
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.frustumCulled = false; // skinned bounds are unreliable; we hide off-screen actors ourselves
        if (o.isSkinnedMesh) skinned.push(o);
        o.material = dress(o.material, look.outfit);
      }
    });
    const extras = [];
    for (const key of look.accessories) {
      const spec = ACCESSORIES[key];
      const bone = root.getObjectByName(spec.bone);
      const part = models.get(spec.file);
      if (!bone || !part) continue;
      const obj = part.scene.clone();
      obj.position.fromArray(spec.at);
      obj.rotation.set(...spec.rot);
      if (spec.size) obj.scale.setScalar(spec.size);
      obj.traverse((o) => {
        if (o.isMesh) o.castShadow = false;
      });
      bone.add(obj);
      extras.push(obj);
    }
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map();
    for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
    return { look, root, skinned, extras, mixer, actions };
  };

  const actors = ids.map((id) => {
    const { look, root, skinned, extras, mixer, actions } = figure(id);
    root.scale.setScalar(CHAR_SCALE * look.scale);
    group.add(root);
    return { id, job: jobs.get(id), lift: (hash(id) % 64) / 640, root, skinned, extras, mixer, actions, active: new Set(), outline: [], extrasShown: true };
  });

  // Portraits: a figure standing still (idle, first frame), drawn on demand.
  const portraits = createPortraits({
    figure(id) {
      const f = figure(id);
      if (!f) return null;
      return {
        root: f.root,
        pose() {
          const idle = f.actions.get('idle') ?? f.actions.values().next().value;
          if (idle) {
            idle.play();
            idle.time = 0;
          }
          f.mixer.update(0);
        },
      };
    },
    onReady(id) {
      app.bus.emit('portrait', { id });
      app.requestDraw();
    },
  });
  app.hooks.portrait = (id) => portraits.get(id);
  const indexOf = new Map(ids.map((id, i) => [id, i]));

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const white = new THREE.Color(1, 1, 1);
  const light = new THREE.Color();
  const unknown = new THREE.Color(VERSION_COLORS.unknown).getHexString();
  let selected = null;

  /** Poses an actor from weighted (clip, time) entries. */
  const pose = (a, entries) => {
    const used = new Set();
    for (const e of entries) {
      const action = a.actions.get(e.clip);
      if (!action || e.weight <= 0) continue;
      used.add(action);
      action.enabled = true;
      if (!action.isRunning()) action.play();
      action.setEffectiveWeight(e.weight);
      action.time = Math.min(e.time, action.getClip().duration);
    }
    for (const action of a.active) if (!used.has(action)) action.stop();
    a.active = used;
    a.mixer.update(0);
  };

  /** Seconds into the walk cycle at a position: from the distance walked, so it follows pos. */
  const lengths = new Map(); // from|to → length of the route
  const walkTime = (n, pos) => {
    const key = `${n.trip.from}|${n.trip.to}`;
    if (!lengths.has(key)) lengths.set(key, pathLength(tripPath(header, routes, n.trip.from, n.trip.to)));
    const span = Math.max(1, n.trip.arrive - n.trip.start);
    const walked = lengths.get(key) * Math.min(1, Math.max(0, (pos - n.trip.start) / span));
    const cycles = walked / STRIDE;
    return (cycles - Math.floor(cycles)) * (durations.walk ?? 1);
  };

  /** Weighted clips of an actor for a frame. */
  const clipsOf = (a, act, n, pos, wall) => {
    if (act.action === 'walk') {
      const entries = [{ clip: 'walk', time: walkTime(n, pos), weight: 1 }];
      const k = (pos - n.trip.start) / STEP_BLEND;
      if (k < 1) {
        entries[0].weight = Math.max(0, k);
        entries.push({ clip: 'idle', time: 0, weight: 1 - entries[0].weight });
      }
      return entries;
    }
    const g = gestureAt(act.action, a.id, a.job, wall, durations);
    const entries = [{ clip: g.clip, time: g.time, weight: g.blend }];
    if (g.prev) entries.push({ clip: g.prev.clip, time: g.prev.time, weight: 1 - g.blend });
    // Just arrived: the last step fades into the gesture.
    const since = n?.trip ? (pos - n.trip.arrive) / STEP_BLEND : Infinity;
    if (since >= 0 && since < 1) {
      for (const e of entries) e.weight *= since;
      entries.push({ clip: 'walk', time: walkTime(n, n.trip.arrive), weight: 1 - since });
    }
    return entries;
  };

  /** Outline of the selected actor: back-face copies of its skinned meshes. */
  const setOutline = (a, on) => {
    if (!a) return;
    if (on && !a.outline.length) {
      for (const mesh of a.skinned) {
        const o = new THREE.SkinnedMesh(mesh.geometry, outlineMat);
        o.bind(mesh.skeleton, mesh.bindMatrix);
        o.frustumCulled = false;
        mesh.parent.add(o);
        a.outline.push(o);
      }
    } else if (!on) {
      for (const o of a.outline) o.removeFromParent();
      a.outline = [];
    }
  };

  /** Puts an instance of an fx mesh. */
  const putFx = (mesh, i, x, y, z, sx, sy, sz, c, alpha, turn = 0) => {
    m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, turn), s.set(sx, sy, sz));
    mesh.setMatrixAt(i, m4);
    mesh.geometry.attributes.fxColor.setXYZW(i, c.r, c.g, c.b, alpha);
  };
  const doneFx = (mesh, count) => {
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.attributes.fxColor.needsUpdate = true;
  };

  function update(frame) {
    const { state, pos, camera: cam } = frame;
    const all = view.positionsAt(state, pos);
    // Decorative clock (app.now()); still when the reader asked for less movement.
    const wall = app.reducedMotion?.() ? 0 : frame.now / 1000;
    // World units per CSS px at the center, for the smallest sizes on screen.
    const unit = 1 / Math.max(1e-6, cam.scale);
    const tokenR = big * Math.max(TOKEN.radius, TOKEN.minPx * unit);
    const greyR = Math.max(GREY.radius, GREY.minPx * unit);
    const tokenH = Math.min(1, TOKEN.radius / tokenR);

    // One portrait per frame at most, if any was asked for.
    portraits.step();

    // Contagion: youngest tell of each listener.
    const told = new Map();
    for (const t of recentTells(store.events, store.index, pos, TELL_TICKS)) {
      const prev = told.get(t.listener);
      if (!prev || t.age < prev.age) told.set(t.listener, t);
    }
    // Icons over the heads and reactions on arriving, for the fact shown (only the store's state has events).
    const fact = app.factId?.() ?? null;
    const own = state === store.state;
    const iconOf = own ? iconsAt(store.events, store.index, pos, fact) : new Map();
    // The focus of package C: everybody else's token is dimmed.
    const focusList = app.hooks.rumorSpec?.()?.focus;
    const focus = focusList?.length ? new Set(focusList) : null;
    for (const f of fades) {
      const mat = focus ? f.clear : f.solid;
      if (f.mesh.material !== mat) f.mesh.material = mat;
    }

    let nTokens = 0;
    let nIcons = 0;
    let nGreys = 0;
    const nGlyphs = { correct: 0, incomplete: 0, wrong: 0 };
    actors.forEach((a, i) => {
      const wp = all.get(a.id) ?? { x: 0, y: 0 };
      a.root.position.set(wp.x, 0, wp.y);

      // On screen and how tall: hidden off screen, still when tiny.
      const feet = cam.toScreen(wp.x, wp.y, 0);
      const head = cam.toScreen(wp.x, wp.y, HEAD);
      const px = Math.abs(feet.y - head.y);
      const shown = view.onScreen(cam, feet, 60) || view.onScreen(cam, head, 60);
      a.root.visible = shown;
      if (shown) {
        const act = activityOf(state, a.id);
        const n = state.neighbors.get(a.id);
        let heading = restHeading(a.id);
        if (act.action === 'walk') {
          const ahead = view.position(a.id, state, pos + 0.15);
          heading = headingTo(wp, ahead) ?? heading;
        } else if (act.partner) {
          const other = all.get(act.partner);
          heading = (other && headingTo(wp, other)) ?? heading;
        }
        a.root.rotation.y = heading;
        // Hearing the rumor: a little jump (a function of pos).
        const hop = told.has(a.id) ? tellPulse(told.get(a.id).age).hop : 0;
        // Arriving for the rumor: a cheer or a puzzled shake (a function of pos).
        const react = own && px >= TINY_PX ? reactionAt(state, fact, a.id, pos) : null;
        if (hop > 0) {
          a.root.position.y = HOP * Math.sin(hop * Math.PI);
          pose(a, [{ clip: 'jump', time: hop * (durations.jump ?? 0.5), weight: 1 }]);
        } else if (react) {
          const r = reactionClips(react.kind, react.since, durations);
          a.root.position.y = HOP * 0.8 * r.hop;
          const rest = r.weight < 1 ? clipsOf(a, act, n, pos, wall).map((e) => ({ ...e, weight: e.weight * (1 - r.weight) })) : [];
          pose(a, [...r.entries, ...rest]);
        } else if (px >= TINY_PX || !a.active.size) pose(a, clipsOf(a, act, n, pos, wall));
        const extras = px >= ACCESSORY_PX;
        if (extras !== a.extrasShown) {
          a.extrasShown = extras;
          for (const e of a.extras) e.visible = extras;
        }
        // Its icon over the head, faded in as the character grows on screen.
        const ic = iconOf.get(a.id);
        const big = Math.min(1, Math.max(0, (px - ICON.fade[0]) / (ICON.fade[1] - ICON.fade[0])));
        if (ic && big > 0 && nIcons < ICON.max) {
          const lk = iconLook(ic.age);
          const perPx = HEAD / Math.max(1, px);
          const size = ICON.px * perPx * lk.scale;
          const top = HEAD * (a.root.scale.x / CHAR_SCALE) + a.root.position.y;
          const y = top + perPx * ICON.px * (lk.rise - ICON.drop);
          m4.compose(v.set(wp.x + perPx * (ICON.px * ICON.side + ICON.gap), y, wp.y), q.identity(), s.setScalar(size));
          icons.setMatrixAt(nIcons, m4);
          icons.geometry.attributes.iconCell.setX(nIcons, ICON_KINDS.indexOf(ic.kind));
          icons.geometry.attributes.iconAlpha.setX(nIcons, lk.alpha * big);
          nIcons++;
        }
      }

      // Shadow, and the token or the grey disc.
      m4.compose(v.set(wp.x, 0.2, wp.y), q.identity(), s.setScalar(a.root.scale.x / CHAR_SCALE));
      blobs.setMatrixAt(i, m4);
      const hex = app.hooks.neighborColor(a.id, state);
      color.set(hex);
      const tell = told.get(a.id);
      if (color.getHexString() === unknown && !tell) {
        m4.compose(v.set(wp.x, 0.28, wp.y), q.identity(), s.set(greyR, 1, greyR));
        greys.setMatrixAt(nGreys++, m4);
      } else {
        const k = tokenR * (tell ? tellPulse(tell.age).pop : 1) * (a.id === selected ? 1.15 : 1);
        // Overlapping tokens never share a height: a stable lift per
        // neighbor, and the wrong version on top.
        const lift = a.lift + (hex === VERSION_COLORS.wrong ? 0.15 : 0) + (tell ? 0.2 : 0);
        m4.compose(v.set(wp.x, 0.3 + lift, wp.y), q.identity(), s.set(k, k * tokenH, k));
        const alpha = focus && !focus.has(a.id) ? DIM_ALPHA : 1;
        tokens.setMatrixAt(nTokens, m4);
        tokenAlpha.setX(nTokens, alpha);
        tokens.setColorAt(nTokens++, color);
        // Its shape, just over the rim: in the middle while the character is
        // tiny, on the front of the token (towards the camera, clear of the
        // feet) once it stands on it.
        const ver = versionOfColor(hex);
        if (ver) {
          const front = Math.min(1, Math.max(0, (px - GLYPH_FRONT_PX[0]) / (GLYPH_FRONT_PX[1] - GLYPH_FRONT_PX[0])));
          const g = k * (1 - 0.4 * front);
          m4.compose(v.set(wp.x, 0.3 + lift + TOKEN.height * k * tokenH + 0.03, wp.y + 0.45 * k * front), q.identity(), s.set(g, 1, g));
          glyphAlpha[ver].setX(nGlyphs[ver], alpha);
          glyphs[ver].setMatrixAt(nGlyphs[ver]++, m4);
        }
      }
    });
    for (const [ver, mesh] of Object.entries(glyphs)) {
      mesh.count = nGlyphs[ver];
      mesh.instanceMatrix.needsUpdate = true;
      glyphAlpha[ver].needsUpdate = true;
    }
    tokenAlpha.needsUpdate = true;
    icons.count = nIcons;
    icons.visible = nIcons > 0;
    icons.instanceMatrix.needsUpdate = true;
    icons.geometry.attributes.iconCell.needsUpdate = true;
    icons.geometry.attributes.iconAlpha.needsUpdate = true;
    blobs.instanceMatrix.needsUpdate = true;
    tokens.count = nTokens;
    tokens.instanceMatrix.needsUpdate = true;
    tokens.instanceColor.needsUpdate = true;
    greys.count = nGreys;
    greys.instanceMatrix.needsUpdate = true;

    // Contagion effects, a function of pos.
    let nf = 0;
    let nr = 0;
    let ns = 0;
    const beamH = Math.max(40, 110 * unit);
    const fxR = Math.max(tokenR, TELL_PX * unit);
    for (const t of told.values()) {
      if (nf >= fxMax) break;
      const wp = all.get(t.listener);
      if (!wp) continue;
      const p = tellPulse(t.age);
      color.set(app.hooks.neighborColor(t.listener, state));
      light.copy(color).lerp(white, 0.3);
      // Two rings, the second a little later: a ripple.
      const p2 = tellPulse(Math.max(0, t.age - 0.12));
      putFx(pulseRing, nr++, wp.x, 0.5, wp.y, fxR * p.ring, 1, fxR * p.ring, light, p.ringAlpha);
      if (t.age > 0.12) putFx(pulseRing, nr++, wp.x, 0.52, wp.y, fxR * p2.ring, 1, fxR * p2.ring, white, p2.ringAlpha * 0.8);
      putFx(flash, nf, wp.x, 0.62, wp.y, fxR * 1.2, 1, fxR * 1.2, white, p.flash * 0.9);
      putFx(beams, nf, wp.x, 0.3, wp.y, fxR * 0.45, beamH * (0.7 + 0.3 * (1 - p.beam)), fxR * 0.45, light, p.beam);
      for (let k = 0; k < SPARKS; k++) {
        const sp = sparkAt(k, SPARKS, t.age, t.listener);
        const r = fxR * 0.2 * sp.size;
        putFx(sparks, ns++, wp.x + sp.x * fxR, sp.y * fxR * 1.6, wp.y + sp.z * fxR, r, r, r, color, sp.size > 0 ? 1 : 0, k + t.age * 6);
      }
      nf++;
    }
    for (const m of [flash, beams]) doneFx(m, nf);
    doneFx(pulseRing, nr);
    doneFx(sparks, ns);

    // Selection: ring, beam and marker over the head.
    const sel = selected !== null ? actors[indexOf.get(selected)] : null;
    const swp = sel ? all.get(sel.id) : null;
    if (swp) {
      const r = Math.max(tokenR * 1.45, SELECT.ringPx * unit);
      color.set(SELECT.color);
      putFx(selBand, 0, swp.x, 0.65, swp.y, r, 1, r, edge, 0.55);
      putFx(selRing, 0, swp.x, 0.7, swp.y, r, 1, r, color, 1, wall * 0.8);
      // Heights in px at this point: world units of height per CSS px.
      const ground = cam.toScreen(swp.x, swp.y, 0);
      const top = cam.toScreen(swp.x, swp.y, HEAD);
      const perPx = HEAD / Math.max(1, Math.abs(ground.y - top.y));
      putFx(selBeam, 0, swp.x, 0.3, swp.y, r * 0.45, Math.max(40, SELECT.beamPx * perPx), r * 0.45, color, 0.7);
      const m = SELECT.markerPx * perPx;
      const head = HEAD * (sel.root.scale.x / CHAR_SCALE);
      marker.position.set(swp.x, Math.max(head + 3, head + SELECT.labelPx * perPx) + Math.sin(wall * 3) * m * 0.15, swp.y);
      marker.scale.setScalar(m / 1.4);
      marker.rotation.y = wall * 1.5;
    }
    marker.visible = !!swp;
    doneFx(selRing, swp ? 1 : 0);
    doneFx(selBand, swp ? 1 : 0);
    doneFx(selBeam, swp ? 1 : 0);
  }

  const api = {
    group,
    update,
    selected(id) {
      const next = id && indexOf.has(id) ? id : null;
      if (next === selected) return;
      setOutline(selected !== null ? actors[indexOf.get(selected)] : null, false);
      selected = next;
      setOutline(selected !== null ? actors[indexOf.get(selected)] : null, true);
    },
  };
  // The URL's selection is announced before the models load: take it here.
  const wanted = String(app.params?.select ?? '').toLowerCase();
  const first = wanted && (header.neighbors ?? []).find((n) => n.id === wanted || n.name?.toLowerCase() === wanted);
  if (first) api.selected(first.id);
  return api;
}
