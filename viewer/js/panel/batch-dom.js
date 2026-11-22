// Batch panel in #batch: one row per lane (sequence of the batch). Each row
// shows who decides, the text written so far over a bar of its progress, and
// the output tokens of that generation. Clicking a row selects its speaker.
//
//   LOTE                         3 carriles · 2 generando
//   1 Carmen  ▓▓▓▓▓▓▓▓▓¡Luis! Ven, que traigo▍░░░░   31 tok
//   2 Elena   ▓▓▓▓▓▓Sí, da gusto. ¿Qué▍░░░░░░░░░░   36 tok
//   3 Manuel  Ni te lo imagines, Pedro, no paro.     38 tok   (done)

import { hhmm, minuteOfDay } from '../core/clock.js';
import { neighborName } from '../core/names.js';
import { formatNumber } from './figures.js';
import { batchView, itemText, revealed } from './lanes.js';
import { fill } from './strings.js';

/** Height available for the lanes, and the row height limits (CSS pixels). */
const BODY_MAX = 192;
const ROW_MIN = 12;
const ROW_MAX = 44;
/** Line height of the row text: normal and dense rows. */
const LINE = 15;
const LINE_DENSE = 12;
const DENSE_BELOW = 18;

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.append(e);
  return e;
}

function setText(e, text) {
  if (e.textContent !== text) e.textContent = text;
}

/**
 * Row layout for a number of lanes: how many rows are lanes, whether the last
 * one sums up the rest, and the height and text lines of each row.
 * @param {number} lanes
 * @returns {{shown: number, summary: boolean, rowH: number, lines: number, dense: boolean}}
 */
export function layoutFor(lanes) {
  const fit = Math.floor(BODY_MAX / ROW_MIN);
  const summary = lanes > fit;
  const rows = summary ? fit : Math.max(1, lanes);
  const rowH = Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor(BODY_MAX / rows)));
  const dense = rowH < DENSE_BELOW;
  const lh = dense ? LINE_DENSE : LINE;
  return { shown: summary ? fit - 1 : lanes, summary, rowH, lines: Math.max(1, Math.floor((rowH - 2) / lh)), dense };
}

/**
 * Builds the batch panel.
 * @param {object} app
 * @param {object} s strings of the language
 * @param {import('./lanes.js').BatchIndex} index
 * @returns {{render: () => void, select: (id: string|null) => void}}
 */
export function createBatch(app, s, index) {
  const root = app.zones.batch;
  root.replaceChildren();
  root.classList.add('bt');

  const head = el('div', 'bt-head', root);
  el('span', 'bt-title', head).textContent = s.lanesTitle;
  const info = el('span', 'bt-info', head);
  const body = el('div', 'bt-lanes', root);
  const note = el('div', 'bt-note', root);

  const lang = app.lang;
  const header = app.header;
  let rows = [];
  let summaryRow = null;
  let layoutKey = '';
  let selected = app.params.select ?? null;

  const buildRows = (layout) => {
    body.replaceChildren();
    body.classList.toggle('dense', layout.dense);
    body.style.setProperty('--row-h', `${layout.rowH}px`);
    body.style.setProperty('--lines', String(layout.lines));
    rows = [];
    for (let i = 0; i < layout.shown; i++) {
      const row = el('div', 'bt-lane free', body);
      const bar = el('div', 'bt-bar', row);
      const n = el('span', 'bt-n', row);
      n.textContent = String(i + 1);
      const who = el('span', 'bt-who', row);
      const txt = el('span', 'bt-txt', row);
      const inner = el('span', 'bt-inner', txt);
      const tok = el('span', 'bt-tok', row);
      row.addEventListener('click', () => {
        if (row.dataset.who) app.bus.emit('select', { neighbor: row.dataset.who });
      });
      rows.push({ row, bar, who, txt, inner, tok, key: '', measure: false });
    }
    summaryRow = layout.summary ? el('div', 'bt-lane bt-more', body) : null;
  };

  const fillRow = (r, laneRow) => {
    if (!laneRow) {
      if (r.key !== 'free') {
        r.key = 'free';
        r.row.className = 'bt-lane free';
        delete r.row.dataset.who;
        r.row.removeAttribute('title');
        r.bar.style.width = '0%';
        setText(r.who, '');
        setText(r.inner, '');
        setText(r.tok, '');
      }
      return;
    }
    const e = laneRow.item.event;
    const progress = laneRow.progress;
    const full = itemText(e, header, index.what, s);
    const shown = revealed(full, progress);
    const sel = e.who === selected ? ' sel' : '';
    const kind = e.type === 'plan' ? ' plan' : e.type === 'turn' && e.text ? '' : ' claim';
    const key = `${e.id}|${laneRow.phase}|${shown.length}|${sel}`;
    if (r.key === key) return;
    r.key = key;
    r.measure = laneRow.phase === 'run';
    r.row.className = `bt-lane ${laneRow.phase}${kind}${sel}`;
    r.row.dataset.who = e.who;
    const name = neighborName(header, e.who);
    r.row.title = fill(s.selectHint, { name });
    r.bar.style.width = `${(progress * 100).toFixed(2)}%`;
    setText(r.who, name);
    setText(r.inner, shown);
    setText(r.tok, e.gen?.out !== null && e.gen?.out !== undefined ? `${formatNumber(e.gen.out, lang)} ${s.tok}` : '');
  };

  const render = () => {
    const view = batchView(index, app.store.pos);
    root.dataset.mode = view.mode;
    if (view.mode === 'empty' || view.mode === 'before') {
      setText(note, view.mode === 'empty' ? s.noGen : s.beforeGen);
    } else {
      setText(note, '');
    }
    const layout = layoutFor(view.laneCount);
    const lk = `${layout.shown}|${layout.summary}|${layout.rowH}`;
    if (lk !== layoutKey) {
      layoutKey = lk;
      buildRows(layout);
    }

    const lanesText = view.laneCount === 1 ? s.lane1 : fill(s.lanes, { n: view.laneCount });
    let state = '';
    if (view.mode === 'active') state = fill(s.running, { n: view.running });
    else if (view.mode === 'rest') state = fill(s.resting, { time: hhmm(minuteOfDay(view.tick)) });
    setText(info, view.laneCount ? [lanesText, state].filter(Boolean).join(' · ') : '');

    const byLane = new Map(view.rows.map((r) => [r.lane, r]));
    rows.forEach((r, i) => fillRow(r, byLane.get(i)));
    // Second pass, after every write: a text that no longer fits shows its
    // tail (the words being written). Measured on the inner span, whose size
    // does not depend on the alignment.
    const dense = body.classList.contains('dense');
    const tails = rows.map((r) => {
      if (!r.measure) return null;
      r.measure = false;
      return dense ? r.inner.offsetWidth > r.txt.clientWidth : r.inner.offsetHeight > r.txt.clientHeight;
    });
    rows.forEach((r, i) => {
      if (tails[i] !== null) r.txt.classList.toggle('tail', tails[i]);
      else if (!r.row.classList.contains('run')) r.txt.classList.remove('tail');
    });
    if (summaryRow) {
      const rest = view.rows.filter((r) => r.lane >= layout.shown);
      const running = rest.filter((r) => r.phase === 'run').length;
      setText(summaryRow, fill(s.moreLanes, { n: view.laneCount - layout.shown, k: running }));
    }
  };

  return {
    render,
    select(id) {
      selected = id ?? null;
    },
  };
}
