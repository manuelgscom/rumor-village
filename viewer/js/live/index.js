// Package E: live mode. Only glue: the logic is in feed.js, api.js,
// throttle.js, inject.js and flow.js (tested without DOM).
//
//   #input (right of the bottom bar)
//   ┌──────────────────────────────────────────────┐
//   │ ● conectado  [ ¿Qué pasa? ……… ] [Enviar]     │
//   └──────────────────────────────────────────────┘
//   floating panel above it, when open:
//   ┌ Dónde / Cuándo / Quién / Cuánta gente ──────┐  (fields: no extractor;
//   │                                              │   the amount label follows
//   │                                              │   the unit: amountLabel)
//   │ A quién                                      │
//   │ Entendido: fiesta · plaza · hoy 21:00        │
//   │ Sin dato: quién, cuánta gente     [Soltar]   │
//   └──────────────────────────────────────────────┘
//
// It also forwards pause and speed of package B to the engine (only when the
// bus event says engine: true), tells the others what the engine state is
// (bus 'engine' {paused, speed, ended}: after GET control at the start, after
// each POST control and at the end event) and tells the engine which neighbors
// would show text (POST viewport, limited by throttle.js). Once a rumor is
// dropped, the viewer follows it (app.setFact, createFollow of flow.js).
// Nothing in a recording. In the game mode (?play=1) the input is not mounted:
// the game prepares its rumors itself (viewer/js/game/); the engine control
// and the viewport go on as above.

import { pick } from '../core/lang.js';
import { advance, initState, reduce } from '../core/reduce.js';
import { controlBody, createApi, engineState } from './api.js';
import { createFlow, createFollow } from './flow.js';
import {
  allPlaces,
  amountLabel,
  DAY_WORDS,
  busiestPlace,
  halfHours,
  neighborNames,
  parseDraft,
  presentAt,
  publicPlaces,
  whatLabels,
} from './inject.js';
import { holdFor } from './hold.js';
import { holdFirstBatch, liveStatus } from './source.js';
import { STRINGS } from './strings.js';
import { createViewportSender } from './throttle.js';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function select(options, { blank = null, values = options } = {}) {
  const s = el('select');
  if (blank !== null) s.append(el('option', { value: '', text: blank }));
  options.forEach((label, i) => s.append(el('option', { value: values[i], text: label })));
  return s;
}

/** The name of `names` equal to `wanted` but for case, or null. */
function nameIn(names, wanted) {
  const w = String(wanted ?? '').trim().toLocaleLowerCase();
  return names.find((n) => n.toLocaleLowerCase() === w) ?? null;
}

/** Speech bubble icon at the start of the input. */
function bubbleIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'live-icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z');
  svg.append(path);
  return svg;
}

/**
 * Shows the server's «Entendido: fiesta · plaza · hoy 21:00» as a label and
 * one chip per part; the text reads the same as the server's.
 * @param {HTMLElement} box
 * @param {string|null} understood
 */
function renderUnderstood(box, understood) {
  if ((box.dataset.text ?? '') === (understood ?? '')) return;
  box.dataset.text = understood ?? '';
  if (!understood) return box.replaceChildren();
  const m = /^([^:·]+):\s*(.*)$/.exec(understood);
  if (!m) return box.replaceChildren(el('span', { class: 'live-chip', text: understood }));
  const parts = m[2].split(' · ').filter((p) => p.trim() !== '');
  const out = [el('span', { class: 'live-u-label', text: `${m[1]}:` }), ' '];
  parts.forEach((p, i) => {
    if (i) out.push(el('span', { class: 'live-u-sep', text: ' · ' }));
    out.push(el('span', { class: 'live-chip', text: p }));
  });
  box.replaceChildren(...out);
}

function datalist(id, options) {
  return el('datalist', { id }, ...options.map((o) => el('option', { value: o })));
}

/**
 * Starts the package. Called once, with the header known and before any event.
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  if (!app.store.live) return; // a recording: no input, no engine
  const zone = app.zones.input;
  const { header, lang } = app;
  const text = pick(STRINGS, lang);
  const api = createApi();

  // --- Engine control (bus events of package B) -------------------------------
  let flash = null;
  let engine = null; // the last engine state told on the bus
  // Where a failed control goes: the status of the input once mounted.
  let warn = (message) => console.warn(`live: ${message}`);
  const tellEngine = (state) => {
    if (!state) return;
    // The end event may come before the engine marks itself ended.
    if (liveStatus.value === 'ended') state = { ...state, ended: true };
    engine = state;
    app.bus.emit('engine', { ...state });
  };
  const forward = (type) => async (payload) => {
    const body = controlBody(type, payload);
    if (!body) return;
    const reply = await api.setControl(body);
    if (!reply.ok) warn(reply.status === 0 ? text.network : `${text.error} ${reply.status}: ${reply.error}`);
    else tellEngine(engineState(reply.body));
  };
  app.bus.on('pause', forward('pause'));
  app.bus.on('speed', forward('speed'));
  // The end event; before the first GET control answers, that answer tells it.
  liveStatus.on((v) => {
    if (v === 'ended' && engine && !engine.ended) tellEngine({ ...engine, ended: true });
  });

  // --- Viewport ---------------------------------------------------------------
  const sender = createViewportSender({ send: async (ids) => (await api.viewport(ids)).ok });
  const textNeighbors = () =>
    typeof app.hooks.textNeighbors === 'function' ? app.hooks.textNeighbors() : app.visibleNeighbors();
  const updateViewport = () => {
    if (liveStatus.value === 'ended') return;
    try {
      sender.update(textNeighbors() ?? []);
    } catch (err) {
      console.error('live: viewport failed', err);
    }
  };
  app.bus.on('zoom', updateViewport);
  app.store.subscribe(updateViewport);

  // --- Reading pauses (live/hold.js) --------------------------------------------
  // While following the edge at x1 or x4, each tick with new text on screen
  // asks the engine to hold the next one for the time to read it.
  let held = null;
  app.onFrame(() => {
    const { store } = app;
    const ms = holdFor({
      pos: store.pos,
      edge: store.lastTick,
      chars: Number(app.hooks.readingChars?.()) || 0,
      held,
      engine,
    });
    if (!ms) return;
    held = Math.floor(store.pos);
    api.setControl({ hold_ms: ms }).then((reply) => {
      if (!reply.ok && reply.status !== 409) warn(`hold: ${reply.status} ${reply.error ?? ''}`);
    });
  });
  updateViewport();

  if (!zone || app.params.play) {
    // No input: only the engine state at the start.
    api
      .control()
      .then((reply) => reply.ok && tellEngine(engineState(reply.body)))
      .catch((err) => console.error('live: control failed', err));
    return;
  }

  // --- The input ----------------------------------------------------------------
  zone.replaceChildren();
  zone.classList.add('live-input');

  const status = el('span', { class: 'live-status' });
  const showStatus = (v) => {
    if (flash) return;
    status.dataset.state = v;
    status.textContent = text[v] ?? v;
  };
  function showFlash(message) {
    clearTimeout(flash);
    status.dataset.state = 'warn';
    status.textContent = message;
    flash = setTimeout(() => {
      flash = null;
      showStatus(liveStatus.value);
    }, 4000);
  }
  showStatus(liveStatus.value);
  liveStatus.on(showStatus);
  warn = showFlash;

  const ids = { what: 'live-what-list', who: 'live-who-list' };
  const main = el('input', { class: 'live-main', type: 'text', autocomplete: 'off', spellcheck: false });
  const send = el('button', { type: 'submit', class: 'live-send', text: text.send });

  const days = ['today', 'tomorrow'];
  const where = select(publicPlaces(header), { blank: text.none });
  const day = select(
    days.map((d) => DAY_WORDS[lang][d]),
    { blank: text.none, values: days },
  );
  const time = select(halfHours(), { blank: text.none });
  const who = el('input', { type: 'text', autocomplete: 'off', spellcheck: false });
  who.setAttribute('list', ids.who);
  const amount = el('input', { type: 'number', min: '0', step: '1', inputMode: 'numeric' });
  const to = select(allPlaces(header));
  let toTouched = false;

  const row = (label, ...controls) => el('label', { class: 'live-row' }, el('span', { text: label }), ...controls);
  const amountRow = row(text.amountAny, amount);
  const amountName = amountRow.firstChild;
  const fields = el(
    'div',
    { class: 'live-fields' },
    row(text.where, where),
    row(text.when, el('span', { class: 'live-pair' }, day, time)),
    row(text.who, who),
    amountRow,
  );
  const toRow = row(text.to, el('span', { class: 'live-pair' }, el('small', { text: text.toHint }), to));
  const toNote = el('div', { class: 'live-to-note' });
  const understood = el('div', { class: 'live-understood' });
  const notes = el('div', { class: 'live-notes' });
  const error = el('div', { class: 'live-error' });
  const done = el('div', { class: 'live-done' });
  const dropBtn = el('button', { type: 'button', class: 'live-drop', text: text.drop });
  const closeBtn = el('button', { type: 'button', class: 'live-close', text: '×', title: text.close });
  const popHint = el('div', { class: 'live-pop-hint' });
  const pop = el(
    'div',
    { class: 'live-pop' },
    closeBtn,
    el('div', { class: 'live-pop-head' }, el('strong', { text: text.title }), popHint),
    fields,
    toRow,
    toNote,
    understood,
    notes,
    error,
    el('div', { class: 'live-actions' }, done, dropBtn),
  );
  const field = el('span', { class: 'live-field' }, bubbleIcon(), main);
  const form = el('form', { class: 'live-form' }, field, send, pop, datalist(ids.what, whatLabels(lang)), datalist(ids.who, neighborNames(header)));
  zone.append(status, form);

  // The state at the live edge (the view may be rewound): who is where now.
  const edge = { state: initState(header), n: 0 };
  const edgeState = () => {
    const ev = app.store.events;
    while (edge.n < ev.length) reduce(edge.state, ev[edge.n++]);
    advance(edge.state, app.store.lastTick);
    return edge.state;
  };

  let open = false;
  let draftError = null; // a name of the draft that is not a place
  let droppedWaiting = false;
  const setOpen = (v) => {
    open = v;
    if (open && !toTouched) to.value = busiestPlace(header, edgeState(), app.visibleNeighbors()) || to.value;
    render();
  };

  const flow = createFlow({ api, lang, text, onChange: () => render() });

  function render() {
    const s = flow.state;
    const fieldsMode = s.mode === 'fields';
    // The run has ended: nothing more can be dropped (the engine would say 409).
    const ended = liveStatus.value === 'ended';
    if (ended && open) open = false;
    main.disabled = ended;
    main.placeholder = ended ? text.endedHint : fieldsMode ? text.whatHint : text.phrase;
    main.title = ended ? text.endedTitle : '';
    if (ended) main.value = '';
    if (fieldsMode) main.setAttribute('list', ids.what);
    else main.removeAttribute('list');
    pop.hidden = !open;
    fields.hidden = !fieldsMode;
    toRow.hidden = !fieldsMode && s.phase !== 'understood';
    popHint.textContent = fieldsMode ? text.fieldsHint : text.extractHint;
    const amountText = amountLabel(main.value, lang, text);
    if (amountName.textContent !== amountText) amountName.textContent = amountText;
    renderUnderstood(understood, s.understood);
    notes.replaceChildren(...s.notes.map((n) => el('div', { text: n })));
    error.textContent = s.error ?? draftError ?? '';
    const waiting = s.phase === 'dropped' && droppedWaiting ? ` · ${text.waiting}` : '';
    done.textContent = s.phase === 'dropped' ? `✓ ${text.dropped} ${s.droppedAt}${waiting}` : s.phase === 'busy' ? text.sending : '';
    renderToNote();
    dropBtn.hidden = s.phase !== 'understood';
    send.disabled = ended || s.phase === 'busy';
    dropBtn.disabled = s.phase === 'busy';
  }

  // Nobody at the chosen place: the engine keeps the fact until somebody comes.
  let shownNote = '';
  function renderToNote() {
    const show = open && !toRow.hidden && to.value && presentAt(header, edgeState(), to.value) === 0;
    const note = show ? text.nobodyAt.replace('{place}', to.value) : '';
    if (note !== shownNote) toNote.textContent = shownNote = note;
  }
  app.store.subscribe((change) => {
    if (open && change.type === 'append') renderToNote();
  });

  const fieldValues = () => ({
    what: main.value,
    where: where.value,
    day: day.value,
    time: time.value,
    who: who.value,
    amount: amount.value,
    to: to.value,
  });

  const understand = () => {
    setOpen(true);
    return flow.understand(flow.state.mode === 'extract' ? { text: main.value } : fieldValues());
  };

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    understand();
  });
  // The rumor just dropped is the one followed (colors, cards, summary).
  const follow = createFollow((fact) => app.setFact(fact));
  app.store.subscribe((change) => {
    if (change.type === 'append') follow.check(app.store.events);
  });
  dropBtn.addEventListener('click', async () => {
    droppedWaiting = presentAt(header, edgeState(), to.value) === 0;
    follow.arm(app.store.events.length);
    const s = await flow.drop(to.value);
    if (s.phase === 'dropped') {
      main.value = '';
      who.value = '';
      amount.value = '';
      follow.check(app.store.events);
    } else {
      follow.disarm();
    }
    render();
  });
  closeBtn.addEventListener('click', () => setOpen(false));
  form.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') setOpen(false);
  });
  main.addEventListener('focus', () => {
    if (flow.state.mode === 'fields' && !open && liveStatus.value !== 'ended') setOpen(true);
  });
  liveStatus.on(() => render());
  for (const input of [main, where, day, time, who, amount]) {
    input.addEventListener('input', () => {
      draftError = null;
      flow.edit();
      render();
    });
  }
  to.addEventListener('change', () => {
    toTouched = true;
    draftError = null;
    render();
  });
  render();

  // --- Start: is there an extractor? Then the draft, if any -------------------
  const ready = (async () => {
    const reply = await api.control();
    if (reply.ok) tellEngine(engineState(reply.body));
    flow.setExtract(reply.ok && reply.body?.extract === true);
    const draft = parseDraft(app.params.draft, flow.state.mode === 'extract');
    if (!draft) return;
    if ('text' in draft) {
      main.value = draft.text;
    } else {
      main.value = draft.what;
      where.value = nameIn(publicPlaces(header), draft.where) ?? '';
      day.value = draft.day;
      time.value = draft.time;
      const target = nameIn(allPlaces(header), draft.to);
      if (target) {
        to.value = target;
        toTouched = true;
      }
      // A place the fields cannot hold: say so instead of dropping it silently.
      const bad = [draft.where && !where.value ? draft.where : null, draft.to && !target ? draft.to : null].filter(Boolean);
      if (bad.length) {
        draftError = `${text.unknownPlace}: ${bad.map((b) => `«${b}»`).join(', ')}`;
        setOpen(true);
        return;
      }
    }
    await understand();
  })();
  ready.catch((err) => console.error('live: start of the input failed', err));
  if (app.params.draft) holdFirstBatch(ready);
}
