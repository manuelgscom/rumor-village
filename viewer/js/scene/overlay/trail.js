// The rumor seen from afar (phase 8-2, 2.2): the trail of the contagion on
// the ground and the tint of each place. The data is render/heat.js; this
// only draws it. The beacons (2.4) are beacons.js.
//
//   trail    low arcs from where the teller heard it to where it tells it,
//            green if it passed as it was and red if something changed,
//            faint at the start and strong at the end; a ring on the ground
//            when it was heard and told at the same place
//   tint     a disc under the crowd of each place and a ring split by the
//            versions of the people there (the bar of the place labels)
//   race     with two rumors (app.race, phase 9) both go by rumor instead:
//            each stretch and slice in the colour of its rumor (rumor/race.js)
//
//                    ╭──────────╮ trail
//                ●──╯            ╰──► ◯ tint of the place
//
// Everything is a function of (state, pos) and the events. They read from
// afar and at the mid level, and fade out close up (view.weights); with
// ?trail=0 they are not drawn. While a chain or a group is shown they dim.

import * as THREE from 'three';
import { daylight } from '../../core/clock.js';
import { VERSION_COLORS } from '../../core/theme.js';
import { GROUND_ARC, arcPoints } from '../../render/arc.js';
import { mergeTrails, RACE_TINT, raceTintAt, raceTrailsAt, tintAt, trailsAt } from '../../render/heat.js';
import { RACE_COLORS, raceSides } from '../../rumor/race.js';
import { createDisc, createRibbon, createRing, createSlice, ORDER, pool, SLICE_STEPS } from './ribbon.js';

/** Sizes on screen (CSS px): trail width (one tell, and the most), its edge, smallest place disc. */
const PX = { trail: 7, trailMax: 14, edge: 4, disc: 16 };
/** Dimming of the trail and tint while a chain or group is shown. */
const FOCUS_DIM = 0.35;

const GREEN = new THREE.Color(VERSION_COLORS.correct);
const RED = new THREE.Color(VERSION_COLORS.wrong);
/** Edge of the trail: white, softer at night. */
const EDGE = new THREE.Color('#ffffff');
const EDGE_ALPHA = { day: 0.9, night: 0.45 };
const TINT = Object.fromEntries(['correct', 'incomplete', 'wrong', 'unknown'].map((v) => [v, new THREE.Color(VERSION_COLORS[v])]));
/** The keys of a tint (the last one knows nothing) and their colours: by version, or by rumor in a race. */
const BY_VERSION = { order: ['correct', 'incomplete', 'wrong', 'unknown'], colors: TINT };
const BY_RACE = { order: RACE_TINT.order, colors: Object.fromEntries(RACE_TINT.order.map((v) => [v, new THREE.Color(RACE_TINT.colors[v])])) };
const RACE = RACE_COLORS.map((c) => new THREE.Color(c));

/**
 * Where each place is drawn: under its crowd when someone is there, else the
 * place point; with the radius of the crowd.
 * @param {ReturnType<import('../../render/view.js').createView>} view
 * @param {import('../../core/reduce.js').State} state
 * @param {number} pos
 * @returns {{out: Map<string, {x: number, y: number, r: number}>, placeOf: Map<string, string>}}
 */
export function placeAnchors(view, state, pos) {
  const { header } = view;
  const lay = view.layoutOf(state);
  const all = view.positionsAt(state, pos);
  const sum = new Map();
  for (const [id, place] of lay.placeOf) {
    const p = all.get(id);
    if (!p) continue;
    let s = sum.get(place);
    if (!s) sum.set(place, (s = { x: 0, y: 0, n: 0 }));
    s.x += p.x;
    s.y += p.y;
    s.n++;
  }
  const out = new Map();
  for (const pl of header.places ?? []) {
    const s = sum.get(pl.id);
    const b = lay.blocks.get(pl.id);
    const r = b ? Math.max(b.halfW, b.halfH) + 8 : 8;
    out.set(pl.id, s ? { x: s.x / s.n, y: s.y / s.n, r } : { x: pl.x, y: pl.y, r });
  }
  return { out, placeOf: lay.placeOf };
}

/**
 * @param {object} app
 * @param {ReturnType<import('../../render/view.js').createView>} view
 * @param {THREE.Group} group parent of everything drawn
 */
export function createTrail(app, view, group) {
  const { store } = app;
  const ids = (app.header.neighbors ?? []).map((n) => n.id);
  // Over the roofs: from afar a trail cut by the houses does not read.
  const ways = pool(() => createRibbon(GROUND_ARC.segments + 1, ORDER.trail), (r) => r.mesh, group);
  const wayEdges = pool(() => createRibbon(GROUND_ARC.segments + 1, ORDER.trail - 1), (r) => r.mesh, group);
  const pulses = pool(() => createRing(ORDER.trail, { depthTest: true }), (m) => m, group);
  const discs = pool(() => createDisc(), (m) => m, group);
  const slices = pool(() => createSlice(), (s) => s.mesh, group);
  const tmp = new THREE.Color();
  let edgeAlpha = EDGE_ALPHA.day;

  function drawTint(state, anchors, placeOf, px, k) {
    const race = app.race;
    const tints = race ? raceTintAt(raceSides(store.events, store.index, race, ids), placeOf) : tintAt(state, app.factId(), placeOf);
    const pal = race ? BY_RACE : BY_VERSION;
    const known = pal.order.slice(0, -1);
    for (const [place, t] of tints) {
      if (t.unknown === t.n) continue;
      const a = anchors.get(place);
      if (!a) continue;
      const r = Math.max(a.r, px * PX.disc);
      // The disc: the mix of the versions (or rumors) known there.
      const nKnown = t.n - t.unknown;
      tmp.setRGB(0, 0, 0);
      for (const v of known) {
        if (!t[v]) continue;
        tmp.r += (pal.colors[v].r * t[v]) / nKnown;
        tmp.g += (pal.colors[v].g * t[v]) / nKnown;
        tmp.b += (pal.colors[v].b * t[v]) / nKnown;
      }
      const d = discs.next();
      d.position.set(a.x, 0.5, a.y);
      d.scale.setScalar(r);
      d.material.color.copy(tmp);
      d.material.opacity = 0.42 * k;
      d.visible = true;
      // The ring: one slice per version (or rumor), in the order of the bar.
      let at = 0;
      for (const v of pal.order) {
        if (!t[v]) continue;
        const steps = (t[v] / t.n) * SLICE_STEPS;
        const s = slices.next();
        s.set(steps, at);
        at += steps;
        s.mesh.position.set(a.x, 0.6, a.y);
        s.mesh.scale.setScalar(r);
        s.mesh.material.color.copy(pal.colors[v]);
        s.mesh.material.opacity = (v === 'unknown' ? 0.45 : 0.95) * k;
      }
    }
  }

  function drawTrail(anchors, eye, px, k, pos) {
    const race = app.race;
    const { ways: list, pulses: rings } = race ? raceTrailsAt(store.events, store.index, pos, race) : mergeTrails(trailsAt(store.events, store.index, pos, app.factId()));
    // By change (green or red), or in a race by rumor.
    const colorOf = (w) => (race ? RACE[w.side] : w.changed ? RED : GREEN);
    for (const w of list) {
      const a = anchors.get(w.from);
      const b = anchors.get(w.to);
      if (!a || !b) continue;
      const pts = arcPoints(a, b, { n: GROUND_ARC.segments, shape: GROUND_ARC });
      const width = px * Math.min(PX.trailMax, PX.trail + (w.n - 1) * 2);
      const alphas = pts.map((_, i) => w.alpha * k * (0.45 + 0.55 * (i / GROUND_ARC.segments)));
      const widths = pts.map((_, i) => width * (0.6 + 0.4 * (i / GROUND_ARC.segments)));
      wayEdges.next().set(pts, eye, widths.map((x) => x + px * PX.edge), EDGE, alphas.map((x) => x * w.alpha * edgeAlpha));
      ways.next().set(pts, eye, widths, colorOf(w), alphas);
    }
    for (const p of rings) {
      const a = anchors.get(p.place);
      if (!a) continue;
      const m = pulses.next();
      const r = Math.max(a.r, px * PX.disc) * (1.15 + 0.5 * p.age) + px * 4;
      m.position.set(a.x, 0.7, a.y);
      m.scale.setScalar(r);
      m.material.color.copy(colorOf(p));
      m.material.opacity = p.alpha * k;
      m.visible = true;
    }
  }

  /**
   * @param {object} frame
   * @param {ReturnType<typeof placeAnchors>} anchors
   * @param {{x: number, y: number, z: number}} eye
   * @param {number} px world units per CSS px
   * @param {boolean} focused a chain or group is shown
   */
  function update(frame, anchors, eye, px, focused) {
    for (const p of [ways, wayEdges, pulses, discs, slices]) p.begin();
    if (view.row) return;
    const { state, pos, camera: cam } = frame;
    const w = view.weights(cam);
    const { out, placeOf } = anchors;
    edgeAlpha = EDGE_ALPHA.night + (EDGE_ALPHA.day - EDGE_ALPHA.night) * daylight(pos);
    const k = (1 - w.near) * (focused ? FOCUS_DIM : 1);
    if (app.params.trail !== false && k > 0.01) {
      drawTint(state, out, placeOf, px, k);
      drawTrail(out, eye, px, k, pos);
    }
  }

  return { update };
}
