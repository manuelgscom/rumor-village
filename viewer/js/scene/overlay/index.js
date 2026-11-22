// Package C (phase 7): what is written and pointed at over the village.
//
//   hops     every tell of the last WAVE_TICKS ticks (render/wave.js): an arc
//            from the teller's head to the listener's, a spark that travels
//            it and a ring on the ground where it lands, in the color of the
//            version the listener now holds
//   chain    with a neighbor selected ('select') or a group ('group'), the
//            hops of rumor/overlay.js overlaySpec lit in 3D: arcs with an
//            arrowhead, rings on the ground and HTML labels («21:00 → 22:00»
//            at the top of the arc that changed it, ◆ origin, ⚠ culprit)
//            The chain flows the way the rumor went: a glint runs along each
//            arc from teller to listener (decorative, app.now(); still with
//            reduced motion)
//   trail    the trail of the last hours and the tint of the places (trail.js)
//   beacons  beams over where people go for the rumor (beacons.js)
//   bubbles  HTML speech bubbles at the heads (bubbles.js)
//
// Everything is a function of (state, pos), the hops' animation included;
// only the glint of the chain uses the decorative clock (frame.now).
// The boxes of the bubbles and labels are reserved for scene/labels.js.

import * as THREE from 'three';
import { ARC, arcPoint, arcPoints, hopPhase, HOP, trailAlpha } from '../../render/arc.js';
import { recentTells } from '../../render/wave.js';
import { createHistory } from '../../rumor/history.js';
import { GROUP_KEYS } from '../../rumor/groups.js';
import { buildModel } from '../../rumor/model.js';
import { INK, overlaySpec, spreadLabels } from '../../rumor/overlay.js';
import { HEAD } from '../world/plan.js';
import { createBeacons } from './beacons.js';
import { createBubbles } from './bubbles.js';
import { reserve } from './reserved.js';
import { createArrow, createRibbon, createRing, createSpark, ORDER, pool } from './ribbon.js';
import { createTrail, placeAnchors } from './trail.js';

/** Sizes on screen (CSS px): hop arc, chain arc per spec width, spark, ring growth, arrowhead, smallest arc height. */
const PX = { hop: 7, hopEdge: 4, chainPerWidth: 1.6, chainEdge: 3, spark: 6, ringGrow: 46, arrow: 5, lift: 30, hopLift: 64 };
/** Part of a chain arc left free at each end, so it starts and ends off the heads. */
const GAP = 0.05;
/** Height of the chain label of a neighbor (CSS px, css/render.css). */
const TAG_H = 22;
const EMPTY = { segments: [], rings: [], labels: [], focus: [] };
/** The glint of a chain arc: ms per pass, its half length (share of the arc) and strength. */
const FLOW = { period: 1800, half: 0.1, alpha: 0.75 };
/** Hops that kept the data are INK in overlaySpec: light here, so they read by day and by night. */
const KEPT = '#a9b8c8';
/** Outline under every chain arc. */
const EDGE = new THREE.Color('#1d2a35');
const WHITE = new THREE.Color('#ffffff');

/**
 * The rumor overlay of the moment: from rumor/index.js when it publishes it
 * (app.hooks.rumorSpec), or built here from the same pure modules.
 * @param {object} app
 * @returns {() => ReturnType<typeof overlaySpec>}
 */
function specSource(app) {
  const { store, header, bus, params } = app;
  const ids = (header.neighbors ?? []).map((n) => n.id);
  const byIdOrName = (v) => {
    if (!v) return null;
    if (ids.includes(v)) return v;
    const low = String(v).toLowerCase();
    return header.neighbors?.find((n) => n.name.toLowerCase() === low)?.id ?? null;
  };
  // The bus may have spoken before the models loaded: start from the URL.
  let select = byIdOrName(params.select);
  let group = GROUP_KEYS.includes(params.group) ? params.group : null;
  bus.on('select', ({ neighbor } = {}) => {
    select = byIdOrName(neighbor);
  });
  bus.on('group', ({ key } = {}) => {
    group = GROUP_KEYS.includes(key) ? key : null;
  });
  const h = createHistory();
  let key = '';
  let spec = EMPTY;
  return () => {
    if (typeof app.hooks.rumorSpec === 'function') return app.hooks.rumorSpec() ?? EMPTY;
    if (!select && !group) return EMPTY;
    h.ingest(store.events);
    const tick = Math.floor(store.pos);
    const fact = app.factId();
    const k = [store.index, tick, fact, select, group, h.size].join('|');
    if (k !== key) {
      key = k;
      const m = buildModel({ h, state: store.state, idx: store.index, tick, fact, ids, select, group });
      spec = overlaySpec(m, header);
    }
    return spec;
  };
}

/**
 * @param {object} app
 * @param {ReturnType<import('../../render/view.js').createView>} view
 * @returns {{group: THREE.Object3D|null, update: (frame: object) => void}}
 */
export function createSceneOverlay(app, view) {
  const { store } = app;
  const group = new THREE.Group();
  group.name = 'rumor-overlay';
  const specNow = specSource(app);
  const root = app.zones.labels;
  const bubbles = root ? createBubbles(app, view, root) : null;

  const hops = pool(() => createRibbon(ARC.segments + 1, ORDER.hop), (r) => r.mesh, group);
  const hopEdges = pool(() => createRibbon(ARC.segments + 1, ORDER.hop - 1), (r) => r.mesh, group);
  const sparks = pool(createSpark, (s) => s.group, group);
  const rings = pool(() => createRing(), (m) => m, group);
  const chains = pool(() => createRibbon(ARC.segments + 1, ORDER.chain), (r) => r.mesh, group);
  const edges = pool(() => createRibbon(ARC.segments + 1, ORDER.chain - 1), (r) => r.mesh, group);
  const arrows = pool(() => createArrow(), (a) => a.mesh, group);
  const flows = pool(() => createRibbon(ARC.segments + 1, ORDER.chain + 0.5), (r) => r.mesh, group);
  const trail = createTrail(app, view, group);
  const beacons = createBeacons(app, view, group);
  // Story mode: chapter 3 (the spread) shows the trail at full strength, and
  // chapter 5 (the consequences) the beacons, even close up.
  let chapter = null;
  app.bus.on('chapter', ({ n } = {}) => {
    chapter = n ?? null;
  });

  // HTML labels of the chain.
  const tagLayer = document.createElement('div');
  tagLayer.className = 'chain-tags';
  root?.append(tagLayer);
  const tags = [];
  const tagAt = (i) => {
    while (tags.length <= i) {
      const el = document.createElement('div');
      el.className = 'chain-tag';
      tagLayer.append(el);
      tags.push({ el, text: '', cls: '', w: 0 });
    }
    return tags[i];
  };

  // CSS color → THREE.Color, and its alpha ("rgba(…, 0.6)" from overlaySpec).
  const colors = new Map();
  const parse = (css) => {
    const m = /^rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(String(css).replace(/\s+/g, ''));
    if (!m) return { color: new THREE.Color(css), alpha: 1 };
    return { color: new THREE.Color(`rgb(${m[1]},${m[2]},${m[3]})`), alpha: Number(m[4]) };
  };
  const paint = (css) => {
    let c = colors.get(css);
    if (!c) colors.set(css, (c = parse(css)));
    return c;
  };
  const colorOf = (css) => paint(css).color;

  /** Draws the hops; returns screen points along them, which the bubbles keep clear of. */
  function drawHops(frame, all, eye, px) {
    const { state, pos, camera: cam } = frame;
    const marks = [];
    for (const wv of recentTells(store.events, store.index, pos)) {
      const a = all.get(wv.speaker);
      const b = all.get(wv.listener);
      if (!a || !b) continue;
      const color = colorOf(view.neighborColor(wv.listener, state));
      const ph = hopPhase(wv.age);
      const min = px * PX.hopLift;
      const pts = arcPoints(a, b, { min });
      for (let i = 8; i <= ARC.segments - 8; i += 4) {
        if (trailAlpha(i / ARC.segments, ph.head) * ph.fade < 0.2) continue;
        const sp = cam.toScreen(pts[i][0], pts[i][2], pts[i][1]);
        if (view.onScreen(cam, sp, 0)) marks.push(sp);
      }
      const alphas = pts.map((_, i) => trailAlpha(i / ARC.segments, ph.head) * ph.fade);
      const widths = pts.map((_, i) => px * PX.hop * (0.55 + 0.45 * trailAlpha(i / ARC.segments, ph.head)));
      hopEdges.next().set(pts, eye, widths.map((w) => w + px * PX.hopEdge), WHITE, alphas.map((x) => x * 0.9));
      hops.next().set(pts, eye, widths, color, alphas);
      if (wv.age < HOP.travel + 0.08) {
        const s = sparks.next();
        const p = arcPoint(a, b, ph.head, min);
        s.group.position.set(p[0], p[1], p[2]);
        s.group.scale.setScalar(px * PX.spark);
        s.halo.material.color.copy(color);
        s.core.material.opacity = ph.fade;
        s.group.visible = true;
      }
      if (ph.ring > 0) {
        const m = rings.next();
        const r = 3 + ph.ring * Math.max(10, px * PX.ringGrow);
        m.position.set(b.x, 0.4, b.y);
        m.scale.setScalar(r);
        m.material.color.copy(color);
        m.material.opacity = 0.85 * (1 - ph.ring) * ph.fade;
        m.visible = true;
      }
    }
    return marks;
  }

  function drawChain(spec, all, eye, px, now) {
    const order = [...spec.segments].sort((x, y) => x.width - y.width);
    const still = app.reducedMotion();
    order.forEach((sg, k) => {
      const a = all.get(sg.a);
      const b = all.get(sg.b);
      if (!a || !b) return;
      const { color, alpha } = paint(sg.color === INK ? KEPT : sg.color);
      const pts = arcPoints(a, b, { u0: GAP, u1: 1 - GAP, min: px * PX.lift });
      const width = px * Math.max(2.5, sg.width * PX.chainPerWidth);
      const ones = pts.map(() => alpha);
      if (sg.width > 2) edges.next().set(pts, eye, pts.map(() => width + px * PX.chainEdge), EDGE, pts.map(() => 0.5));
      chains.next().set(pts, eye, pts.map(() => width), color, ones);
      const tip = pts[pts.length - 1];
      const prev = pts[pts.length - 3];
      arrows.next().point(tip, [tip[0] - prev[0], tip[1] - prev[1], tip[2] - prev[2]], Math.max(width * 3, px * PX.arrow * 2), color);
      // The glint, from teller to listener; staggered so the arcs do not pulse together.
      if (still || alpha < 0.8) return;
      const span = 1 + 4 * FLOW.half;
      const head = ((((now / FLOW.period + 0.5 + k * 0.37) % 1) + 1) % 1) * span - 2 * FLOW.half;
      const glow = pts.map((_, i) => {
        const d = (i / ARC.segments - head) / FLOW.half;
        return FLOW.alpha * Math.exp(-d * d);
      });
      flows.next().set(pts, eye, pts.map(() => width * 0.7), WHITE, glow);
    });
    for (const rg of spec.rings) {
      const p = all.get(rg.id);
      if (!p) continue;
      const m = rings.next();
      m.position.set(p.x, 0.3, p.y);
      m.scale.setScalar(Math.max(4.5, rg.r * px * 0.75));
      m.material.color.copy(colorOf(rg.color === INK ? KEPT : rg.color));
      m.material.opacity = 0.95;
      m.visible = true;
    }
  }

  function chainTags(spec, all, cam, px) {
    const want = [];
    for (const l of spec.labels) {
      const p = all.get(l.id);
      if (!p) continue;
      const s = cam.toScreen(p.x, p.y, HEAD + 2.4);
      const kind = l.text.startsWith('⚠') ? 'culprit' : l.text.startsWith('◆') ? 'origin' : 'who';
      want.push({ s, text: l.text, cls: kind, color: l.color });
    }
    for (const sg of spec.segments) {
      if (!sg.label) continue;
      const a = all.get(sg.a);
      const b = all.get(sg.b);
      if (!a || !b) continue;
      const top = arcPoint(a, b, 0.5, px * PX.lift);
      const s = cam.toScreen(top[0], top[2], top[1] + 1.5);
      want.push({ s, text: sg.label, cls: 'change', color: sg.color });
    }
    const boxes = [];
    want.forEach((t, i) => {
      const tag = tagAt(i);
      if (tag.text !== t.text || tag.cls !== t.cls) {
        tag.text = t.text;
        tag.cls = t.cls;
        tag.el.textContent = t.text;
        tag.el.className = `chain-tag chain-${t.cls}`;
        tag.w = 0;
      }
      tag.el.style.setProperty('--tag', t.color);
      tag.el.hidden = false;
      if (!tag.w) tag.w = tag.el.offsetWidth || t.text.length * 8 + 16;
      boxes.push({ x: t.s.x - tag.w / 2, y: t.s.y - TAG_H, w: tag.w });
    });
    for (let i = want.length; i < tags.length; i++) tags[i].el.hidden = true;
    const placed = spreadLabels(boxes, TAG_H);
    return placed.map((b, i) => {
      tags[i].el.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y)}px)`;
      return { x: b.x, y: b.y, w: b.w, h: TAG_H };
    });
  }

  function update(frame) {
    const { camera: cam, state, pos } = frame;
    const v = cam.view();
    const eye = v.eye;
    const px = 1 / Math.max(1e-6, cam.scale); // world units per CSS px at the centre
    const all = view.positionsAt(state, pos);
    for (const p of [hops, hopEdges, sparks, rings, chains, edges, arrows, flows]) p.begin();

    const spec = specNow();
    const anchors = placeAnchors(view, state, pos);
    trail.update(frame, anchors, eye, px, chapter !== 3 && (spec.focus?.length ?? 0) > 0);
    beacons.update(frame, anchors.out, px, chapter === 5);
    drawChain(spec, all, eye, px, frame.now ?? app.now());
    const marks = drawHops(frame, all, eye, px);

    const R = 9;
    const taken = [
      ...(bubbles?.update(frame, marks.map((m) => ({ x: m.x, y: m.y, r: R }))) ?? []),
      ...chainTags(spec, all, cam, px),
    ];
    reserve(app, taken);
  }

  return { group, update };
}
