// The "El rumor" card in #rumor: the fact as it came in, how many know it, and
// the four versions as a stacked bar that is also the legend of the colors of
// the village, plus the curve of how many know it over time.
//
//   EL RUMOR                 entró a las 20:10 · por Carmen
//   [selector, with several facts]
//   Fiesta
//   ┌ QUIÉN ──┬ DÓNDE ──────┐
//   │ Manuel  │ plaza       │
//   ├ CUÁNDO ─┼ CUÁNTOS ────┤
//   │ 22:00   │ 50 personas │  the unit of the amount: unitOf (core/names.js)
//   └─────────┴─────────────┘
//   30 de 100 lo saben
//   ▇▇▇▇▇▇▇▇▆▆▆▆▅▅░░░░░░░░░░░░░
//   ● correcta 17   ● incompleta 10
//   ● deformada 3   ● sin enterarse 70
//   ▁▁▂▃▅▆▇  (stacked curve, inject → end of the run)

import { clockOf } from '../core/clock.js';
import { claimSummary, neighborName, slotValueText, unitOf, whatName } from '../core/names.js';
import { VERSION_COLORS } from '../core/theme.js';
import { inGame } from '../core/params.js';
import { SLOTS } from '../core/version.js';
import { canvas2d, el, put } from './dom.js';
import { spreadBands } from './spread.js';
import { fill } from './strings.js';

const CURVE_H = 46;
const KEYS = ['correct', 'incomplete', 'wrong', 'unknown'];

/**
 * Creates the card.
 * @param {object} app
 * @param {object} t texts (strings.js, picked)
 * @param {{fact: (id: string) => void}} act
 * @returns {{render: (m: object, spread: import('./spread.js').Spread, tick: number) => void}}
 */
export function createCard(app, t, act) {
  const root = app.zones.rumor;
  const header = app.header;
  // Inside the game only the details the rumor has (phase 9-5): no «QUIÉN —».
  const game = inGame(app.params);
  const total = (header.neighbors ?? []).length;
  const time = (tick) => clockOf(tick, header.start_weekday ?? 0, app.lang).time;
  const end = header.params?.end_tick;
  let pending = null;

  function title(m, facts) {
    const top = el('div', 'rc-top');
    top.append(el('span', 'rc-kicker', t.kicker));
    if (m.fact) {
      const f = app.store.state.facts.get(m.fact.id);
      const to = f?.to ?? [];
      const names = to.length > 1 ? fill(t.andMore, { name: neighborName(header, to[0]), n: to.length - 1 }) : to.length ? neighborName(header, to[0]) : '';
      top.append(el('span', 'rc-when', [fill(t.entered, { time: time(m.fact.tick) }), names && fill(t.via, { names })].filter(Boolean).join(' · ')));
    }
    const box = el('div', 'rc-head');
    box.append(top);
    if (facts.length > 1) {
      const sel = el('select', 'rc-factsel');
      sel.dataset.act = 'fact';
      sel.title = t.chooseFact;
      sel.setAttribute('aria-label', t.chooseFact);
      for (const f of facts) {
        const o = el('option', null, `${time(f.tick)} · ${claimSummary({ ...f.slots, guess: [] }, header, f.what)}`);
        o.value = f.id;
        if (f.id === m.fact?.id) o.setAttribute('selected', '');
        sel.append(o);
      }
      box.append(sel);
    }
    return box;
  }

  function fact(m) {
    const box = el('div', 'rc-fact');
    const what = whatName(m.fact.what, app.lang);
    box.append(el('div', 'rc-what', what.charAt(0).toUpperCase() + what.slice(1)));
    const text = app.store.state.facts.get(m.fact.id)?.text;
    if (text) box.append(el('div', 'rc-text', `«${text}»`));
    const grid = el('div', 'rc-slots');
    const unit = unitOf(m.fact.what, app.lang);
    for (const s of SLOTS) {
      const v = m.fact.slots[s];
      const none = v === null || v === undefined;
      if (none && game) continue;
      const tile = el('div', `rc-slot${none ? ' rc-none' : ''}`);
      const value = el('span', 'rc-svalue', none ? '—' : slotValueText(s, v, header));
      if (!none && s === 'amount' && unit) value.append(el('span', 'rc-unit', unit));
      tile.append(el('span', 'rc-slabel', t.slots[s]), value);
      grid.append(tile);
    }
    box.append(grid);
    return box;
  }

  function spread(m) {
    const c = m.versions.counts;
    const known = c.correct + c.incomplete + c.wrong;
    const box = el('div', 'rc-spread');
    const line = el('div', 'rc-know');
    line.dataset.gm = 'rumor-count'; // the guided game points at it (story/tutorial.js)
    const n = el('b', 'rc-n', String(known));
    n.dataset.count = String(known); // counts when it changes (rumor/index.js)
    line.append(n, el('span', 'rc-of', fill(t.ofKnow, { n: total })));
    box.append(line);
    const bar = el('div', 'rc-bar');
    for (const k of KEYS) {
      if (!c[k]) continue;
      const seg = el('i', `rc-seg rc-${k}`);
      seg.style.flexGrow = String(c[k]);
      seg.title = `${t.versions[k]}: ${c[k]}`;
      bar.append(seg);
    }
    box.append(bar);
    const legend = el('div', 'rc-legend');
    for (const k of KEYS) {
      const item = el('span', `rc-key${c[k] ? '' : ' rc-zero'}`);
      const sw = el('i', 'rc-swatch');
      sw.style.background = VERSION_COLORS[k];
      const kn = el('b', 'rc-kn', String(c[k]));
      kn.dataset.count = String(c[k]);
      item.append(sw, el('span', 'rc-klabel', t.versions[k]), kn);
      legend.append(item);
    }
    box.append(legend);
    const curve = el('div', 'rc-curvebox');
    curve.append(el('canvas', 'rc-curve'));
    const axis = el('div', 'rc-axis');
    // The end of a day reads «24:00», as the prepare screen says, not «00:00».
    axis.append(el('span', null, time(m.fact.tick)), el('span', 'rc-axislabel', t.curve), el('span', null, end ? (end % 1440 === 0 ? '24:00' : time(end)) : ''));
    curve.append(axis);
    box.append(curve);
    return box;
  }

  function render(m, series, tick) {
    const facts = [...(app.store.state.facts?.values() ?? [])];
    const wrap = el('div', 'rc');
    wrap.append(title(m, facts));
    if (!m.fact) {
      wrap.append(el('div', 'rc-empty', t.noFact));
      put(root, wrap);
      pending = null;
      return;
    }
    wrap.append(fact(m), spread(m));
    put(root, wrap);
    pending = { series, tick, canvas: root.querySelector('canvas.rc-curve') };
    paint();
  }

  function paint() {
    if (!pending?.canvas) return;
    const { series, tick, canvas } = pending;
    const box = canvas2d(canvas, CURVE_H);
    if (!box) return;
    const { ctx, w, h } = box;
    const right = end && end > (series.start ?? 0) ? end : Math.max(tick, (series.start ?? tick) + 60);
    const inner = h - 2;
    // Half and full marks: the curve is out of every neighbor.
    ctx.strokeStyle = 'rgba(30, 42, 54, 0.10)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(0, 1.5 + inner / 2);
    ctx.lineTo(w, 1.5 + inner / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();
    const { bands, head } = spreadBands(series, tick, right, total, w, inner);
    ctx.save();
    ctx.translate(0, 1);
    for (const b of bands) {
      ctx.beginPath();
      b.points.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = VERSION_COLORS[b.key];
      ctx.fill();
    }
    if (head) {
      ctx.strokeStyle = 'rgba(30, 42, 54, 0.55)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(head.x, 0);
      ctx.lineTo(head.x, inner);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = VERSION_COLORS.correct;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Math.min(Math.max(head.x, 3), w - 3), Math.max(head.y, 3), 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  root.addEventListener('change', (ev) => {
    const s = ev.target;
    if (s instanceof HTMLSelectElement && s.dataset.act === 'fact') act.fact(s.value);
  });
  new ResizeObserver(() => paint()).observe(root);
  return { render };
}
