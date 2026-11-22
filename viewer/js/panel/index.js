// Package D: figures panel (#panel) and batch panel (#batch). See
// docs/fases/fase-3.md, section D. Only wiring here: the logic is in
// figures.js and lanes.js (pure, tested), the DOM in *-dom.js.
//
//   store.subscribe ─ append ─► perf index + batch index (incremental)
//          └──────── seek ────┐
//   bus 'fact' · 'select' ────┴─► dirty ─► onFrame ─► render both panels
//
// Both panels live in the folding block `.dock` (<details>), titled in
// `.dock-title`. It opens by itself live or when the log has perf samples (a
// run with a model), and stays closed for a baseline recording. While a
// neighbor is selected it folds, so their card and chain in #side have the
// room. Once the user folds or unfolds it, it is left as they put it. Without
// a model (header.policy "baseline") there are no model figures: the block is
// not shown at all.

import { pick } from '../core/lang.js';
import { createBatch } from './batch-dom.js';
import { addPerf, createPerfIndex } from './figures.js';
import { createFigures } from './figures-dom.js';
import { addEvents, createBatchIndex } from './lanes.js';
import { STRINGS } from './strings.js';

/**
 * Starts the package. Called once, with the header known and before any event.
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  if (!app.zones.panel || !app.zones.batch) return;
  const s = pick(STRINGS, app.lang);
  const perfIndex = createPerfIndex();
  const batchIndex = createBatchIndex();
  let dirty = true;
  const invalidate = () => {
    dirty = true;
  };

  const figures = createFigures(app, s, perfIndex, batchIndex, invalidate);
  const batch = createBatch(app, s, batchIndex);

  const dock = app.zones.panel.closest('details');
  const title = dock?.querySelector('.dock-title');
  if (title) title.textContent = s.dockTitle;
  dock?.classList.toggle('pn-none', app.header.policy === 'baseline');
  let userSet = false;
  let selected = app.params.select ?? null;
  title?.addEventListener('click', () => {
    userSet = true;
  });
  const autoOpen = () => {
    if (!dock || userSet) return;
    const want = (app.store.live || perfIndex.ticks.length > 0) && !selected;
    if (dock.open !== want) dock.open = want;
  };

  const take = (from, to) => {
    addPerf(perfIndex, app.store.events, from, to);
    addEvents(batchIndex, app.store.events, from, to);
  };
  take(0, app.store.events.length);
  let seen = app.store.events.length;

  app.store.subscribe((change) => {
    if (change.type === 'append') {
      take(Math.max(seen, change.from), change.to);
      seen = Math.max(seen, change.to);
      autoOpen();
    }
    dirty = true;
  });
  app.bus.on('loaded', autoOpen);
  autoOpen();
  app.bus.on('fact', invalidate);
  app.bus.on('select', (p) => {
    selected = p?.neighbor ?? null;
    batch.select(selected);
    autoOpen();
    dirty = true;
  });

  app.onFrame(() => {
    if (!dirty) return;
    dirty = false;
    figures.render();
    batch.render();
  });
}
