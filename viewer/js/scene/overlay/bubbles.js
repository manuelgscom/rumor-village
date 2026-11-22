// Speech bubbles in HTML, anchored to the heads of the scene (what they say
// and where they go is render/bubbles.js; view.speech picks them). One per
// active conversation, from the near zoom level on.
//
//   ┌─────────────────────────┐
//   │ ● Carmen → Inma          │   who speaks to whom (dot: the speaker's version)
//   │ ¿Sabes que hay fiesta en │   text (outlined in accent during its own tick)
//   │ la plaza?                │   claim (no text): dashed, the claim summarised
//   └────╲────────────────────┘   act (no claim): a small pill, "Carmen saluda"
//         ╲  tail to the speaker's head
//
// The text of a bubble is presentation only: nothing decides from it.
//
// Inside the game (phase 9-5) each bubble stays at least what it takes to read
// it (render/bubbles.js keepBubbles, lingerMs: 60 ms a character, 2.5 s to
// 6 s, in wall time), though its turn has passed and the speaker walks on;
// then it fades out. One per speaker: a new one replaces it. Not at
// «rápida»; a jump in the timeline clears them. The village is not held.

import { neighborName } from '../../core/names.js';
import { inGame } from '../../core/params.js';
import { BUBBLE, BUBBLE_FONT, bubbleFade, bubbleSize, keepBubbles, placeBubbles, tailOf, wrapLines } from '../../render/bubbles.js';
import { parseSpeed } from '../../replay/playback.js';
import { HEAD } from '../world/plan.js';

const SVG = 'http://www.w3.org/2000/svg';
/** Font of the "who → to whom" line (css/render.css .bubble-who). */
const WHO_FONT = '800 12px Nunito, system-ui, sans-serif';
/** Near-level weights between which the bubbles fade in. */
const FADE = [0.3, 0.8];
/** Ticks the position may move in one frame before it counts as a jump. */
const JUMP_TICKS = 20;
/** Engine speeds (ticks per second) from which it is «rápida» (replay/constants.js SPEEDS.fast). */
const FAST_TPS = 60;

/**
 * @param {object} app
 * @param {ReturnType<import('../../render/view.js').createView>} view
 * @param {HTMLElement} root #labels
 * @returns {{update: (frame: object, avoid?: {x: number, y: number, r: number}[]) => {x: number, y: number, w: number, h: number}[]}}
 */
export function createBubbles(app, view, root) {
  const { header } = app;
  const tails = document.createElementNS(SVG, 'svg');
  tails.setAttribute('class', 'bubble-tails');
  const layer = document.createElement('div');
  layer.className = 'bubbles';
  root.append(tails, layer);
  const ctx = document.createElement('canvas').getContext('2d');
  const measureIn = (font) => {
    ctx.font = font;
    return (s) => ctx.measureText(s).width;
  };

  /** Bubbles on screen by speaker id. */
  const live = new Map();
  // Inside the game, what stays on screen (keepBubbles) and the speed.
  const inside = inGame(app.params);
  let shown = new Map();
  let lastPos = null;
  let fast = parseSpeed(app.params.speed).fast;
  app.bus?.on('speed', ({ value, fast: f } = {}) => {
    fast = !!f || value >= FAST_TPS;
  });
  app.bus?.on('engine', (e) => {
    if (e?.speed !== undefined && e.speed !== null) fast = e.speed === 'max' || e.speed >= FAST_TPS;
  });
  let fontGen = 0;
  document.fonts?.ready.then(() => {
    fontGen++;
    app.requestDraw();
  });

  function build(it, state) {
    const { turn, content } = it;
    const kind = content.kind;
    const who = neighborName(header, turn.who);
    const text = kind === 'act' ? `${who} ${content.text}` : content.text;
    const measure = measureIn(BUBBLE_FONT[kind]);
    const lines = wrapLines(text, BUBBLE.maxWidth[kind] - 2 * BUBBLE.padX, measure, BUBBLE.maxLines[kind]);
    const size = bubbleSize(lines, kind, measure);
    const el = document.createElement('div');
    el.className = `bubble bubble-${kind}`;
    let dot = null;
    if (kind !== 'act') {
      const to = turn.to ? neighborName(header, turn.to) : '';
      const head = document.createElement('div');
      head.className = 'bubble-who';
      dot = document.createElement('i');
      const name = document.createElement('b');
      name.textContent = who;
      head.append(dot, name);
      if (to) head.append(` → ${to}`);
      el.append(head);
      const whoW = measureIn(WHO_FONT)(`${who} → ${to}`) + 14;
      size.w = Math.max(size.w, Math.ceil(whoW + 2 * BUBBLE.padX));
      size.h += BUBBLE.head;
    }
    const body = document.createElement('div');
    body.className = 'bubble-text';
    body.textContent = lines.join('\n');
    el.append(body);
    // Room for the border (box-sizing: border-box).
    size.w += 3;
    size.h += 3;
    el.style.width = `${size.w}px`;
    el.style.height = `${size.h}px`;
    layer.append(el);
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('class', `tail tail-${kind}`);
    tails.append(path);
    void state;
    return { turnId: turn.id, gen: fontGen, el, path, dot, w: size.w, h: size.h, color: '', fresh: null, fade: 1 };
  }

  const drop = (b) => {
    b.el.remove();
    b.path.remove();
  };

  function update(frame, avoid = []) {
    const { camera: cam, state, pos, w, h } = frame;
    const near = view.weights(cam).near;
    const reset = lastPos !== null && (pos < lastPos - 1e-6 || pos - lastPos > JUMP_TICKS);
    lastPos = pos;
    if (near <= FADE[0]) {
      for (const b of live.values()) drop(b);
      live.clear();
      shown = new Map();
      return [];
    }
    const now = app.now();
    shown = keepBubbles(shown, view.speech(state, pos, cam), now, { linger: inside, fast, reset });
    const all = view.positionsAt(state, pos);
    const seen = new Set();
    const boxes = [];
    for (const [key, s] of shown) {
      const it = s.item;
      const wp = all.get(it.turn.who);
      if (!wp) continue;
      const top = cam.toScreen(wp.x, wp.y, HEAD + 2.2);
      // A lingering bubble whose speaker walked off screen goes.
      if (!s.current && !view.onScreen(cam, top, 0)) continue;
      seen.add(key);
      let b = live.get(key);
      if (b && (b.turnId !== it.turn.id || b.gen !== fontGen)) {
        drop(b);
        b = null;
      }
      if (!b) live.set(key, (b = build(it, state)));
      const fade = bubbleFade(s, now);
      if (fade !== b.fade) {
        b.fade = fade;
        b.el.style.opacity = b.path.style.opacity = fade === 1 ? '' : String(fade);
      }
      const foot = cam.toScreen(wp.x, wp.y, 0);
      boxes.push({ b, it, ax: top.x, top: top.y, bottom: foot.y + 2, w: b.w, h: b.h });
    }
    // A bubble fading out needs the next frames drawn.
    if ([...shown.values()].some((s) => !s.current)) app.requestDraw();
    for (const [key, b] of live) {
      if (!seen.has(key)) {
        drop(b);
        live.delete(key);
      }
    }
    if (!boxes.length) return [];

    // Keep the heads of everyone around visible where possible.
    const r = Math.max(5, 2.2 * cam.scale);
    const dots = [...avoid];
    for (const wp of all.values()) {
      const s = cam.toScreen(wp.x, wp.y, HEAD - 1);
      if (view.onScreen(cam, s, r)) dots.push({ x: s.x, y: s.y, r });
    }
    const rects = placeBubbles(boxes, { w, h }, dots);

    const alpha = Math.min(1, (near - FADE[0]) / (FADE[1] - FADE[0]));
    layer.style.opacity = tails.style.opacity = String(alpha);
    const tick = Math.floor(pos);
    boxes.forEach(({ b, it, ax, top, bottom }, i) => {
      const rect = rects[i];
      b.el.style.transform = `translate(${Math.round(rect.x)}px, ${Math.round(rect.y)}px)`;
      const t = tailOf(rect, { ax, top, bottom });
      if (t) {
        const half = Math.min(8, Math.max(5, Math.hypot(t.tipX - t.bx, t.tipY - t.baseY) / 6));
        const inset = t.tipY > t.baseY ? 1 : -1; // tuck the base under the bubble
        b.path.setAttribute('d', `M${t.bx - half},${t.baseY - inset * 2} L${t.tipX},${t.tipY} L${t.bx + half},${t.baseY - inset * 2} Z`);
      } else {
        b.path.setAttribute('d', '');
      }
      const fresh = it.turn.tick === tick;
      if (fresh !== b.fresh) {
        b.fresh = fresh;
        b.el.classList.toggle('fresh', fresh);
      }
      if (b.dot) {
        const color = view.neighborColor(it.turn.who, state);
        if (color !== b.color) {
          b.color = color;
          b.dot.style.background = color;
        }
      }
    });
    return rects.map((r2) => ({ x: r2.x, y: r2.y, w: r2.w, h: r2.h }));
  }

  return { update };
}
