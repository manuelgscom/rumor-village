// Beacons of the consequences (phase 8-2, 2.4): a beam of light over the
// original place of the rumor during its hour (green), over the original place
// at another hour where people arrive (amber) and over another place where
// people arrive (red), in the colors of the groups (rumor/overlay.js). The
// data is render/heat.js beaconsAt, a function of the events and pos.
//
//        ░        ░
//        ▒        ▒     beam: bright at the foot, fading upwards
//        ▓        ▓     wider when more people arrived for it
//      ──◯──    ──◯──   ring on the ground
//      plaza    escuela
//      21:00    21:00 (another place)
//
// The beams are additive and not tone mapped, but faint: they mark the place
// without burning the picture. Present at every zoom level, softer close up.
// In a race (app.race, phase 9) the beacons of both rumors stand together.

import * as THREE from 'three';
import { beaconsAt } from '../../render/heat.js';
import { GROUP_COLORS } from '../../rumor/overlay.js';
import { createBeam, createRing, ORDER, pool } from './ribbon.js';

/** Height (world units), smallest radius on screen (CSS px), opacity of the core and strength of the glow. */
const BEAM = { height: 240, px: 6, core: 0.75, halo: 0.35 };

const COLORS = Object.fromEntries(Object.entries(GROUP_COLORS).map(([k, c]) => [k, new THREE.Color(c)]));

/**
 * @param {object} app
 * @param {ReturnType<import('../../render/view.js').createView>} view
 * @param {THREE.Group} group parent of everything drawn
 */
export function createBeacons(app, view, group) {
  const { store, header } = app;
  const ids = (header.neighbors ?? []).map((n) => n.id);
  const cores = pool(() => createBeam(ORDER.beam + 1, { additive: false }), (m) => m, group);
  const halos = pool(() => createBeam(), (m) => m, group);
  const feet = pool(() => createRing(ORDER.beam - 1, { depthTest: true }), (m) => m, group);

  /**
   * @param {object} frame
   * @param {Map<string, {x: number, y: number, r: number}>} anchors scene/overlay/trail.js placeAnchors
   * @param {number} px world units per CSS px
   * @param {boolean} [strong] full strength at every zoom (chapter 5 of the story mode)
   */
  function update(frame, anchors, px, strong = false) {
    cores.begin();
    halos.begin();
    feet.begin();
    if (view.row) return;
    const k = strong ? 1 : 1 - 0.5 * view.weights(frame.camera).near;
    const facts = app.race ?? [app.factId()];
    const list = facts.flatMap((f) => beaconsAt(store.events, store.index, frame.pos, f, ids));
    // Several at one place (the original hour and another one) stand side by side.
    const at = new Map();
    for (const b of list) at.set(b.place, [...(at.get(b.place) ?? []), b]);
    for (const b of list) {
      const p = anchors.get(b.place);
      if (!p) continue;
      const color = COLORS[b.kind];
      const r = Math.max(p.r * 0.3, px * BEAM.px) * (1 + Math.min(0.6, b.n / 40));
      const here = at.get(b.place);
      const a = { x: p.x + (here.indexOf(b) - (here.length - 1) / 2) * r * 1.2, y: p.y };
      const h = BEAM.height * (0.6 + 0.4 * b.strength);
      // A plain core that keeps its color on a light ground, in a glow.
      const c = cores.next();
      c.position.set(a.x, 0, a.y);
      c.scale.set(r * 0.5, h, r * 0.5);
      c.material.color.copy(color);
      c.material.opacity = BEAM.core * b.strength * k;
      c.visible = true;
      const g = halos.next();
      g.position.set(a.x, 0, a.y);
      g.scale.set(r * 1.2, h * 0.8, r * 1.2);
      g.material.color.copy(color).multiplyScalar(BEAM.halo * b.strength * k);
      g.visible = true;
      const f = feet.next();
      f.position.set(a.x, 0.8, a.y);
      f.scale.setScalar(r * 1.3);
      f.material.color.copy(color);
      f.material.opacity = 0.9 * b.strength * k;
      f.visible = true;
    }
  }

  return { update };
}
