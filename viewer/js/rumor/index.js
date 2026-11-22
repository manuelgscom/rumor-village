// Rumor panels: versions, chain, consequences and culprit (phase 3, package
// C) and the cards of phase 7 (package D). See docs/fases/fase-7.md.
//
// Only wiring: the logic is in history.js, chain.js, groups.js, tree.js,
// spread.js, person.js and model.js (pure), the drawing in card.js (#rumor),
// side.js and graph.js (#side) and overlay.js (the scene, package C).
//
//   bus in:  'select' {neighbor}  'group' {key}  'fact'  'loaded'  'race'
//   fact:    with several facts in so far, #rumor offers a selector (app.setFact)
//   bus out: 'select' {neighbor}  'group' {key}  'seek' {pos}
//   hooks:   neighborColor(id, state) → color of the version of app.factId(),
//            or with app.race the colour of its rumor (race.js)
//   layers:  z 64 chains · z 72 rings and names
//   strip:   with the telephone row, a band over the bar (stripview.js)
//   params:  select (id or name), group (right | other_time | other_place)
//
// Everything shown is a function of store.events[0..store.index) and
// store.pos: the model is rebuilt when any of them, the fact, the selection or
// the group changes.
//
// Inside the game (?play=1 or ?game=, phase 9-5) nothing names a culprit until
// the game ends (the `end` event at the position): a group shows its members
// and «Consecuencias» stay, but no «⚠ Culpable» in the card, the graph or the
// scene. The card of a neighbor is the one of the lists of the game
// (core/neighbors.js neighborProfile, with app.timetable; bus 'timetable').

import { pick } from '../core/lang.js';
import { inGame } from '../core/params.js';
import { versionColor } from '../core/theme.js';
import { versionOf } from '../core/version.js';
import { GROUP_KEYS } from './groups.js';
import { createHistory } from './history.js';
import { buildModel } from './model.js';
import { overlaySpec } from './overlay.js';
import { raceColor, raceSides } from './race.js';
import { createCard } from './card.js';
import { createSide } from './side.js';
import { createStrip } from './stripview.js';
import { createCounters } from '../panel/count.js';
import { isRow } from '../render/layout.js';
import { spreadSeries } from './spread.js';
import { STRINGS } from './strings.js';

/**
 * Starts the package. Called once, with the header known and before any event.
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  const { store, header, bus } = app;
  const t = pick(STRINGS, app.lang);
  const ids = (header.neighbors ?? []).map((n) => n.id);
  const h = createHistory();
  const game = inGame(app.params);
  /** Inside the game, until it ends: no culprit anywhere. */
  const secret = () => game && !store.state?.ended;

  let select = null;
  let group = null;
  let lead = null;

  // Color by version of the chosen fact; in a race, by the rumor it knows.
  app.hooks.neighborColor = (id, state) => {
    if (app.race) return raceColor(raceSides(store.events, store.index, app.race, ids).get(id));
    const fact = app.factId();
    const original = fact ? state?.facts.get(fact)?.slots : undefined;
    if (!original) return versionColor(null);
    return versionColor(versionOf(state.neighbors.get(id)?.memory[fact], original));
  };

  // The model, rebuilt only when what it depends on changes (also when the
  // timetable of the neighbor cards arrives).
  let profileKey = 0;
  bus.on('timetable', () => {
    profileKey += 1;
    app.requestDraw();
  });
  let model = null;
  let modelKey = '';
  const current = () => {
    h.ingest(store.events);
    const tick = Math.floor(store.pos);
    const hide = secret();
    const key = [store.index, tick, app.factId(), select, group, lead, h.size, hide, profileKey].join('|');
    if (key !== modelKey) {
      modelKey = key;
      model = buildModel({ h, state: store.state, idx: store.index, tick, fact: app.factId(), ids, select, group, lead });
      if (hide) model = { ...model, culprits: null, secret: true };
    }
    return model;
  };

  const byIdOrName = (v) => {
    if (!v) return null;
    if (ids.includes(v)) return v;
    const low = String(v).toLowerCase();
    return header.neighbors.find((n) => n.name.toLowerCase() === low)?.id ?? null;
  };

  bus.on('select', ({ neighbor } = {}) => {
    const id = byIdOrName(neighbor);
    if (id !== select) lead = null;
    select = id;
  });
  bus.on('group', ({ key } = {}) => {
    group = GROUP_KEYS.includes(key) ? key : null;
  });
  // When the game ends, a card open from the game is closed once: the end card
  // comes first. A neighbor picked afterwards shows over it (core.css).
  let closedAtEnd = false;
  bus.on('game', ({ phase } = {}) => {
    if (phase !== 'ended' || closedAtEnd) return;
    closedAtEnd = true;
    if (select) bus.emit('select', { neighbor: null });
  });
  // The race colours are read from app.race on every frame: only redraw.
  bus.on('race', () => app.requestDraw());
  const applyParams = () => {
    if (app.params.group) bus.emit('group', { key: app.params.group });
    if (app.params.select) bus.emit('select', { neighbor: byIdOrName(app.params.select) });
  };
  bus.on('loaded', applyParams);
  if (store.live) applyParams();

  // #side.
  // The curve of #rumor: one sweep per fact and log length.
  let spread = null;
  let spreadKey = '';
  const spreadNow = () => {
    const key = `${app.factId()}|${store.events.length}`;
    if (key !== spreadKey) {
      spreadKey = key;
      spread = spreadSeries(store.events, app.factId(), ids);
    }
    return spread;
  };

  const card = createCard(app, t, { fact: (id) => app.setFact(id) });
  const side = createSide(app, t, {
    select: (id) => bus.emit('select', { neighbor: id }),
    group: (key) => {
      if (select) bus.emit('select', { neighbor: null });
      bus.emit('group', { key });
    },
    lead: (slot) => {
      lead = slot;
      app.requestDraw();
    },
    seek: (tick) => bus.emit('seek', { pos: tick }),
  });
  // The telephone strip (phase 8-2, 2.12), only for the row and never embedded.
  const strip = isRow(header) && !app.params.embed ? createStrip(app, t, h, (id) => bus.emit('select', { neighbor: id })) : null;
  // Figures that count when they change (panel/count.js): [data-count] in both cards.
  const counters = createCounters(app);

  let shown = null;
  app.onFrame(() => {
    // Rewound to before the chosen fact came in: back to the first one.
    const f = app.factId();
    if (f && f !== store.firstFact && !store.state.facts.has(f)) app.setFact(null);
    const m = current();
    if (m !== shown) {
      shown = m;
      card.render(m, spreadNow(), Math.floor(store.pos));
      side.render(m);
      counters.sync(app.zones.rumor);
      counters.sync(app.zones.side);
    }
    strip?.render(store.index, app.factId(), select);
    counters.frame();
  });

  // What the scene draws of the rumor (scene/overlay/): chains, rings and
  // labels of the model shown here, so it follows the slot chosen in the panel.
  let spec = null;
  let specOf = null;
  const specNow = () => {
    const m = current();
    if (m !== specOf) {
      specOf = m;
      spec = overlaySpec(m, header);
    }
    return spec;
  };
  app.hooks.rumorSpec = specNow;
}
