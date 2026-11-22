// Package A: the 3D village, zoom and speech bubbles. See docs/fases/fase-7.md.
//
//   scene (WebGL, viewer/js/scene/)   ground, roads, buildings, trees, light,
//                                     neighbors and HTML labels
//   z 45  render.waves      ring from the listener when the rumor passes (2D overlay)
//   (z 60–79 package C: chains and halos, 2D overlay)
//   z 80  render.bubbles    speech bubbles (near, 2D overlay)
//
// Hooks filled here: position, readingChars and textNeighbors (ids of the
// neighbors on screen whose bubble would be drawn at the current zoom).
// Input (input.js): pointer and keys + and -; the card on hovering a neighbor.

import { placePoint } from '../core/position.js';
import { initScene } from '../scene/index.js';
import { newTextChars } from './bubbles.js';
import { attachHover, attachInput } from './input.js';
import { busiestPlace, focusTarget } from './layout.js';
import { createView } from './view.js';
import { LEVELS, NEAR_FADE, zoomFactor } from './zoom.js';

/**
 * Starts the package. Called once, with the header known and before any event.
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  const view = createView(app);
  const { camera: cam, store, params, header } = app;

  app.hooks.position = (id, state, pos) => view.position(id, state, pos);
  // Only the text new at this tick: package B pauses at the end of every
  // tick while this is above 0.
  app.hooks.readingChars = () => {
    if (!view.bubblesShown(cam)) return 0;
    return newTextChars(view.speech(store.state, store.pos, cam), Math.floor(store.pos));
  };
  app.hooks.textNeighbors = () => (view.bubblesShown(cam) ? app.visibleNeighbors() : []);
  app.view = view;

  initScene(app, view);
  attachInput(app, view);
  attachHover(app, view);

  // Home view: the whole model (or the telephone row) in the room the panels
  // leave. While nobody has moved the camera, this keeps it there.
  const centre = { x: (view.bounds.minX + view.bounds.maxX) / 2, y: (view.bounds.minY + view.bounds.maxY) / 2 };
  const stage = app.zones.map;
  const measure = (el, fn) => {
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? fn(r) : 0;
  };
  const fitHome = () => {
    if (!app.params.embed && stage) {
      const st = stage.getBoundingClientRect();
      view.setInsets({
        // A folded drawer (narrow screens, core.css) is off the stage: 0.
        l: Math.max(0, measure(document.querySelector('.column-left > :not(:empty)'), (r) => r.right - st.left)),
        r: Math.max(0, measure(document.querySelector('.column-right'), (r) => st.right - r.left)),
        t: measure(app.zones.banner, (r) => r.bottom - st.top),
        b: measure(document.querySelector('.bar'), (r) => st.bottom - r.top),
      });
    }
    const home = view.homeView(cam);
    cam.base = home.scale;
    if (cam.moved) return;
    if (Math.abs(cam.scale - home.scale) > 1e-9 || Math.abs(cam.x - home.x) > 1e-6 || Math.abs(cam.y - home.y) > 1e-6) cam.reset(home);
  };
  app.onFrame(fitHome);
  fitHome();

  // Camera from the URL: a free camera (cam), or zoom level and focus (a place or a neighbor).
  const applyParams = () => {
    if (params.cam) {
      cam.base = view.baseScale(cam);
      cam.set({ x: params.cam.x, y: params.cam.y, scale: cam.base * params.cam.zoom });
      return;
    }
    const z = zoomFactor(params.zoom);
    const target = focusTarget(header, params.focus);
    if (z === null && !target) return;
    const level = z ?? LEVELS.mid;
    let at = null;
    if (target?.kind === 'neighbor') at = app.positionOf(target.id);
    else if (target?.kind === 'place' && !view.row) at = placePoint(header, target.id);
    if (!at && !view.row && level >= NEAR_FADE[0]) {
      // Close up without a focus: where most people are talking.
      const busy = busiestPlace(store.state);
      at = busy ? placePoint(header, busy) : null;
    }
    at ??= centre;
    cam.base = view.baseScale(cam);
    cam.set({ x: at.x, y: at.y, scale: cam.base * level });
  };
  if (store.live) {
    applyParams();
    const off = store.subscribe((change) => {
      if (change.type !== 'append') return;
      off();
      applyParams();
    });
  } else {
    app.bus.on('loaded', applyParams);
  }
}
