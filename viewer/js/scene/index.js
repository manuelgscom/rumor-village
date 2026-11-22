// The 3D scene (package A): renderer on #map, the village, the neighbors, sky
// and light, HTML labels and post-processing. Started by render/index.js.
//
//   app.onDraw(frame) ──► camera ← core camera.view()
//                         sky.update(pos) · actors.update(frame) · labels.update(frame)
//                         render (with or without fx)
//
// The models load in the background; playback ('loaded') and <html data-ready>
// wait for them (app.holdStart, app.holdReady), and their progress goes on the
// bus as 'progress' {part: 'models'}. Without WebGL the viewer stops with the
// error no-webgl; if the models fail, with models-failed.
//
// Performance (fase 8-2, 2.1):
//   - the shadow map is static: redrawn when the village is built, when
//     palette.shadowKey changes (the sun moved) and when the quality tier changes;
//   - with the tab hidden nothing asks for a redraw;
//   - app.quality picks the pixel ratio cap, the MSAA samples of the fx target,
//     bloom + tilt-shift on or off (off = plain render, the fx=0 path) and the
//     shadow map size; fx=0 always draws as 'low'. With q=auto the governor of
//     scene/quality.js steps the tier down when frames are slow;
//   - ?stats=1 shows the frame meter (scene/stats.js).
//
// Photo mode (fase 8-2, 2.15): H puts or takes data-photo on <html> (core.css
// then hides everything but the scene; ?photo=1 sets it at start). P saves the
// canvas as a PNG, only in photo mode: outside it, p is the "previous mark" of
// the replay bar (replay/index.js), which photo mode pre-empts.

import * as THREE from 'three';
import { createActors } from './actors/index.js';
import { ACTOR_FILES } from './actors/look.js';
import { createAssets } from './assets.js';
import { createFx } from './fx.js';
import { createLabels } from './labels.js';
import { createSceneOverlay } from './overlay/index.js';
import { createSky } from './sky.js';
import { createStats } from './stats.js';
import { createGovernor } from './quality.js';
import { TIERS } from '../core/quality.js';
import { buildVillage, PIECES } from './world/build.js';
import { HEAD } from './world/plan.js';

/**
 * @param {object} app
 * @param {ReturnType<import('../render/view.js').createView>} view
 */
export function initScene(app, view) {
  const canvas = app.zones.map;
  // What the scene draws with: the tier of app.quality, or 'low' with fx=0.
  const specOf = () => (app.params.fx ? app.quality.spec : TIERS.low);
  let spec = specOf();
  let renderer;
  try {
    // MSAA of the canvas only on the plain path (no bloom) of a tier that asks
    // for samples; with post-processing the fx target smooths. Today 'low' (and
    // fx=0, which draws as 'low') has 0 samples: canvas MSAA tripled its frame
    // time in SwiftShader (fase 8-2 A, 400 → 133 ms).
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !spec.bloom && spec.samples > 0, powerPreference: 'high-performance' });
  } catch (err) {
    app.fail('no-webgl', err?.message ?? '');
    return null;
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  // Calls and triangles of a whole frame (all passes): reset by hand per draw.
  renderer.info.autoReset = false;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 6000);
  const sky = createSky(scene, view.plan.ground, { life: () => spec.life });
  let fx = null;
  let size = '';
  /** Applies the current tier: fx on or off, MSAA samples, pixel ratio, shadow map size. */
  function applyTier() {
    spec = specOf();
    fx?.dispose();
    fx = spec.bloom ? createFx(renderer, scene, camera, { samples: spec.samples, ao: spec.ao }) : null;
    const shadow = sky.sun.shadow;
    if (shadow.mapSize.x !== spec.shadowMap) {
      shadow.mapSize.set(spec.shadowMap, spec.shadowMap);
      shadow.map?.dispose();
      shadow.map = null;
    }
    renderer.shadowMap.needsUpdate = true;
    size = ''; // pixel ratio and fx size again on the next draw
    app.requestDraw();
  }
  applyTier();
  app.quality.on(applyTier);
  const labels = createLabels(app, view);

  let actors = null;
  let village = null;
  let overlay = null;
  const assets = createAssets({
    onProgress: (loaded, total) => app.bus.emit('progress', { part: 'models', loaded, total }),
  });
  const loading = (async () => {
    const [kitList, charList] = await Promise.all([
      Promise.all(PIECES.map((n) => assets.town(n))),
      Promise.all(ACTOR_FILES.map((f) => assets.character(f))),
    ]);
    const kit = new Map(PIECES.map((n, i) => [n, kitList[i]]));
    village = buildVillage(view.plan, kit);
    scene.add(village.group);
    renderer.shadowMap.needsUpdate = true;
    // Lamps, plus other warm spots of the village (glows: [{x, z, r}]).
    sky.setLamps(village.lamps, village.glows ?? []);
    actors = createActors(app, view, new Map(ACTOR_FILES.map((f, i) => [f, charList[i]])));
    scene.add(actors.group);
    actors.selected(selectedId);
    overlay = createSceneOverlay(app, view);
    if (overlay.group) scene.add(overlay.group);
    app.requestDraw();
  })().catch((err) => {
    console.error('viewer: models failed to load', err);
    app.fail('models-failed', err?.message ?? String(err));
  });
  app.holdStart(loading);
  app.holdReady(loading);

  // The last selection, also the one made before the models finished loading.
  let selectedId = app.params.select ?? null;
  app.bus.on('select', ({ neighbor } = {}) => {
    selectedId = neighbor ?? null;
    actors?.selected(selectedId);
  });

  const stats = createStats(app, renderer);
  // q=auto (never in a capture, never with fx=0): step down when frames are slow.
  const governor = app.quality.auto && app.params.fx ? createGovernor({ budgetMs: 24, tier: app.quality.tier }) : null;

  // The scene moves on its own (gestures, sails), so it redraws every frame,
  // unless the tab is hidden.
  app.onFrame((dt) => {
    if (document.hidden) return;
    stats?.frame(dt);
    if (governor && village) {
      const next = governor.push(dt);
      if (next) app.quality.set(next);
    }
    app.requestDraw();
  });

  let ratio = 1;
  let shadowKey = null;
  let fogBase = null;
  let lastFrame = null;
  app.onDraw((frame) => {
    lastFrame = frame;
    draw(frame);
  });
  /** Draws the scene for a frame of app.onDraw. */
  function draw(frame) {
    const { camera: cam, w, h, dpr, pos } = frame;
    const k = `${w}|${h}|${dpr}`;
    if (k !== size) {
      size = k;
      ratio = Math.min(dpr, spec.dprCap);
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      fx?.setSize(w, h, ratio);
      camera.aspect = w / h;
    }
    const v = cam.view();
    camera.fov = v.fov;
    camera.near = Math.max(1, v.distance * 0.05);
    camera.far = v.distance * 6 + 2000;
    camera.position.set(v.eye.x, v.eye.y, v.eye.z);
    camera.up.set(v.up.x, v.up.y, v.up.z);
    camera.lookAt(v.target.x, v.target.y, v.target.z);
    camera.updateProjectionMatrix();
    // The horizon fog of sky.js is set for the usual views; a camera farther
    // away (the opening shot) pushes it back so the village is not washed out.
    if (scene.fog) {
      fogBase ??= { near: scene.fog.near, far: scene.fog.far };
      scene.fog.near = Math.max(fogBase.near, v.distance * 1.2);
      scene.fog.far = Math.max(fogBase.far, v.distance * 3.2);
    }

    renderer.info.reset();
    const palette = sky.update(pos);
    if (palette.shadowKey !== shadowKey) {
      shadowKey = palette.shadowKey;
      renderer.shadowMap.needsUpdate = true;
    }
    village?.update?.(frame, palette);
    actors?.update(frame);
    overlay?.update(frame);
    labels.update(frame);

    if (fx) fx.render(cam.zoom(), palette.light);
    else renderer.render(scene, camera);
    stats?.drawn(renderer.info.render, ratio);
  }

  if (!app.params.bg) attachPhoto(app, canvas, () => lastFrame && draw(lastFrame));

  return { renderer, scene, camera, HEAD };
}

/** Whether the keyboard is writing in a field (no shortcut then). */
function typing(t) {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/**
 * Photo mode keys: H toggles data-photo on <html>; P (in photo mode) saves the
 * canvas as a PNG. The canvas has no preserved drawing buffer, so the scene is
 * drawn again right before reading it, in the same task.
 * @param {object} app
 * @param {HTMLCanvasElement} canvas
 * @param {() => void} redraw  draws the last frame again
 */
function attachPhoto(app, canvas, redraw) {
  const root = document.documentElement;
  // Capture phase on window: runs before the replay bar's keys (document,
  // bubbling), which skip a key whose default was prevented.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'h') {
        if (root.dataset.photo) delete root.dataset.photo;
        else root.dataset.photo = '1';
        // The canvas may change size; the next frame picks it up.
        app.requestDraw();
      } else if (key === 'p' && root.dataset.photo) {
        redraw();
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `rumor-village-${Math.floor(app.store?.pos ?? 0)}.png`;
        a.click();
      } else {
        return;
      }
      e.preventDefault();
    },
    true,
  );
}
