// Figures panel in #panel: neighbors, informed, the last perf sample and the
// tokens/s series. Live, a badge says «todo ocurre en local», and «sin
// conexión» in front while the browser has no network (navigator.onLine, the
// only thing not taken from the log).
//
//   [● sin conexión · todo ocurre en local]          muestra de las 20:29
//   ┌ 100 ──────┬ 5230 MB ──┬ 214 ──────┐
//   │ vecinos   │ VRAM      │ tokens/s  │
//   ├ 37 ───────┼ 5,9 ──────┼ 3 ────────┤
//   │ enterados │ decis./s  │ lote      │
//   └───────────┴───────────┴───────────┘
//   tokens/s ╱╲_╱‾╲__╱‾‾●                máx. 788

import { hhmm, minuteOfDay } from '../core/clock.js';
import { whatName } from '../core/names.js';
import { figuresAt, formatNumber, perfAt, sampleTickAt, sparkPoints } from './figures.js';
import { fill } from './strings.js';

const SPARK_PAD = 3;

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.append(e);
  return e;
}

function setText(e, text) {
  if (e.textContent !== text) e.textContent = text;
}

function stat(parent, label, cls = '') {
  const box = el('div', `pn-stat${cls}`, parent);
  const value = el('span', 'pn-value', box);
  el('span', 'pn-label', box).textContent = label;
  return value;
}

/**
 * Builds the figures panel.
 * @param {object} app
 * @param {object} s strings of the language
 * @param {import('./figures.js').PerfIndex} perfIndex
 * @param {import('./lanes.js').BatchIndex} batchIndex for the batch clock (perfAt)
 * @param {() => void} invalidate asks for a render on the next frame
 * @returns {{render: () => void}}
 */
export function createFigures(app, s, perfIndex, batchIndex, invalidate) {
  const root = app.zones.panel;
  root.replaceChildren();
  root.classList.add('pn');

  const head = el('div', 'pn-head', root);
  const badge = el('span', 'pn-local', head);
  badge.hidden = !app.store.live;
  const offline = el('span', 'pn-offline', badge);
  offline.textContent = `${s.offline} · `;
  el('span', '', badge).textContent = s.local;
  const sample = el('span', 'pn-sample', head);

  const tiles = el('div', 'pn-tiles', root);
  const neighbors = stat(tiles, s.neighbors, ' pn-big');
  const vram = stat(tiles, s.vram, ' pn-perf pn-big');
  const tokens = stat(tiles, s.tokens, ' pn-perf');
  const informedBox = el('div', 'pn-stat', tiles);
  const informedValue = el('span', 'pn-value', informedBox);
  const informedLabel = el('span', 'pn-label', informedBox);
  const decisions = stat(tiles, s.decisions, ' pn-perf');
  const batch = stat(tiles, s.batch, ' pn-perf');

  const note = el('div', 'pn-note', root);
  const spark = el('div', 'pn-spark', root);
  el('span', 'pn-sparklabel', spark).textContent = s.tokens;
  const canvas = el('canvas', '', spark);
  const max = el('span', 'pn-max', spark);
  canvas.title = s.seekHint;

  const lang = app.lang;
  const updateOnline = () => root.classList.toggle('offline', navigator.onLine === false);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  const drawSpark = (count) => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(root);
    ctx.strokeStyle = css.getPropertyValue('--line').trim() || '#d9ddd3';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();
    const pts = sparkPoints(perfIndex, count, w, h, SPARK_PAD);
    if (!pts.length) return;
    const accent = css.getPropertyValue('--accent').trim() || '#2f5d8a';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, h);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts.at(-1).x, h);
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    const last = pts.at(-1);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  };

  let sparkCount = -1;
  canvas.addEventListener('click', (ev) => {
    const r = canvas.getBoundingClientRect();
    const tick = sampleTickAt(perfIndex, ev.clientX - r.left, r.width, SPARK_PAD);
    if (tick !== null) app.bus.emit('seek', { pos: tick });
  });
  new ResizeObserver(() => {
    sparkCount = -1;
    invalidate();
  }).observe(canvas);

  const render = () => {
    const store = app.store;
    const shown = perfAt(store.state, perfIndex, batchIndex, store.pos);
    const f = figuresAt({
      header: app.header,
      state: store.state,
      fact: app.factId(),
      sample: shown.sample,
      perfIndex,
      live: store.live,
    });
    setText(neighbors, formatNumber(f.neighbors, lang));
    if (f.informed === null) {
      setText(informedValue, '—');
      setText(informedLabel, s.noFact);
    } else {
      const what = store.state.facts.get(f.fact)?.what;
      setText(informedValue, formatNumber(f.informed, lang));
      setText(informedLabel, s.informed);
      const hint = what ? fill(s.informedOf, { what: whatName(what, lang) }) : s.informed;
      if (informedBox.title !== hint) informedBox.title = hint;
    }

    root.dataset.status = f.status;
    const p = f.perf;
    setText(decisions, p ? formatNumber(p.decisionsPerS, lang, 1) : '—');
    setText(tokens, p ? formatNumber(p.tokensPerS, lang) : '—');
    setText(vram, p ? formatNumber(p.vramMb, lang) : '—');
    setText(batch, p ? formatNumber(p.batch, lang) : '—');
    setText(sample, p ? fill(s.sampleAt, { time: hhmm(minuteOfDay(p.tick)) }) : '');
    const message = { baseline: s.baseline, none: s.noSamples, pending: s.pending }[f.status] ?? '';
    setText(note, message);
    setText(max, perfIndex.ticks.length ? fill(s.max, { value: formatNumber(perfIndex.max, lang) }) : '');

    const count = shown.count;
    const key = count * 1e6 + perfIndex.ticks.length;
    if (key !== sparkCount) {
      sparkCount = key;
      drawSpark(count);
    }
  };

  return { render };
}
