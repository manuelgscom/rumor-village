// Entry point of the viewer. Reads the URL, starts the source, creates `app`,
// calls init(app) of each package once (header known, no event yet), and runs
// the draw loop and the banner.
//
// app
//   header · kind ('recording'|'live') · lang ('es'|'en') · params · store
//   zones {map, overlay, labels, banner, now, rumor, story, panel, batch, side, inspect, timeline, input, summary, help, tour, game, start, stats, sound}
//     map is the WebGL canvas of the 3D scene (package A), overlay a 2D canvas on
//     top of it for the layers, labels a <div> for HTML anchored to the scene
//   factId() → chosen fact (default: the first inject) · setFact(id|null)
//   race → null, or [factA, factB]: two facts painted at once, each in its colour
//     (phase 9, the race) · setRace(list|null) sets it and emits 'race'
//   camera {x, y, scale, base, w, h, toScreen, toWorld, set, fit, view, zoom}   (set/fit emit 'zoom'; see camera.js)
//   onDraw(fn(frame))   3D scene and HTML labels, before the layers; frame = {state, pos, camera, w, h, dpr, now}
//     (now = app.now() of this frame, ms)
//   layers.register({id, z, draw(ctx, frame)})   2D layers on the overlay canvas; ctx in CSS pixels
//   hooks.neighborColor(id, state) → CSS color      default grey       (package C)
//   hooks.position(id, state, pos) → {x, y} world   default the place  (package A)
//   hooks.readingChars() → characters of text on screen, default 0     (package A; read by B)
//   hooks.rumorSpec() → overlaySpec of the current model, with `focus` (rumor/index.js)
//   hooks.portrait(id) → image URL of the neighbor, or null              (scene/actors; read by summary)
//   positionOf(id) → {x, y} world at the current pos · visibleNeighbors() → ids inside the view
//   onFrame(fn(dtMs)) · requestDraw()
//   holdReady(promise)   data-ready waits for it (models still loading)
//   holdStart(promise)   'loaded' (and so playback) waits for it too
//   fail(code, detail)   a coded error (core/strings.js): data-error, error screen
//   ui {mode, set(mode), only(zones|null)}   views simple/full/tech (data-ui on <html>)
//   story {fly, viewOf, goTo, setDirector, director, opening(k?)}   camera of package story (inert until it
//     starts); opening() flies from high above to the home view (k freezes it there)
//   link() → URL of the current state (package start fills it)
//   reducedMotion() → the reader asked for less movement
//   now() → ms of the decorative clock (sails, smoke, gestures, flights, sound);
//     the wall clock, or fixed with ?clock=<ms> · setClock(fn) replaces it (video)
//   quality {tier, auto, spec, set(tier), on(fn)}   level of the 3D scene (core/quality.js)
//   bus.on/emit: 'select' {neighbor} · 'group' {key} · 'seek' {pos} · 'zoom' · 'speed' {value, fast, engine}
//                · 'pause' {paused} · 'fact' {fact} · 'loaded' · 'ui' {mode}
//                · 'progress' {part: 'log'|'models', loaded, total} · 'help' (open or close the help card)
//                · 'quality' {tier} · 'chapter' {n, part} (story mode; n null when it closes)
//                · 'portrait' {id} (a neighbor's portrait is ready: hooks.portrait(id))
//                · 'race' {race} (app.race changed: null or two fact ids)
//                · 'game' {phase} (package game; phase: boot|menu|prepare|playing|ended)
// Layers: z 0–59 and 80–89 belong to package A, z 60–79 to package C.
//
// Views (app.ui): <html data-ui="simple|full|tech">; core.css hides the zones
// ([data-zone] in index.html) each view leaves out. only(zones) shows just
// those zones whatever the view (the story mode uncovers them one by one);
// only(null) gives the view back. <html data-picked> while a neighbor or a
// group is selected (the simple view shows #side only then).
//
// Everything informative is a pure function of (store.state, store.pos): never
// of the wall clock. Decorative movement uses app.now(), which can be injected. <html> gets data-ready="1" after the first full draw once the
// recording is in (or the first live batch; in the game mode, ?play=1, the
// header, as a waiting run sends no event), and data-error="<message>" if
// loading fails.
//
// With `left`/`right` in the URL the page is the split screen instead
// (viewer/js/split/): each side is this same viewer in an iframe with `embed=1`.
// With nothing to open, the start screen (viewer/js/start/). While a recording
// loads, <html data-loading> and the loading screen; on failure, the error
// screen with the plain message of its code.

import { createBus } from './bus.js';
import { createCamera, placeBounds } from './camera.js';
import { langOf, pick } from './lang.js';
import { inGame, isCapture, parseParams, UI_MODES } from './params.js';
import { createQuality } from './quality.js';
import { defaultPosition, spreadHeader } from './position.js';
import { droppedSource, fileSource } from './source.js';
import { createStore } from './store.js';
import { errorOf, errorText, STRINGS } from './strings.js';
import { applyCssVars, VERSION_COLORS } from './theme.js';
import { versionsAt } from '../rumor/tree.js';

import { init as initRender } from '../render/index.js';
import { init as initReplay } from '../replay/index.js';
import { init as initRumor } from '../rumor/index.js';
import { init as initPanel } from '../panel/index.js';
import { init as initLive } from '../live/index.js';
import { init as initSummary } from '../summary/index.js';
import { init as initStory } from '../story/index.js';
import { init as initBanner } from '../banner/index.js';
import { init as initSound } from '../sound/index.js';
import { hideLost, init as initStart, showError, showLoading, showLost, startScreen } from '../start/index.js';
import { init as initGame } from '../game/index.js';
import { init as initInspect } from '../inspect/index.js';
import { watchLost } from '../live/lost.js';
import { liveSource, liveStatus } from '../live/source.js';

const PACKAGES = [
  ['banner', initBanner],
  ['render', initRender],
  ['replay', initReplay],
  ['rumor', initRumor],
  ['inspect', initInspect],
  ['panel', initPanel],
  ['live', initLive],
  ['summary', initSummary],
  ['game', initGame],
  ['story', initStory],
  ['start', initStart],
  ['sound', initSound],
];

const root = document.documentElement;

/** Inside the game (?play=1 or ?game=): errors in its words (set by boot). */
let gamePage = false;

/** localStorage key of the chosen view. */
const UI_KEY = 'rumor-village.ui';

function loadPref(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePref(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // No storage: the choice lasts until the page closes.
  }
}

/** Language of the page before a header says it: ?lang=, else the browser's. */
function pageLang(params) {
  return params.lang ?? ((navigator.language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en');
}

/**
 * The views: data-ui on <html>, remembered; only() for the story mode. Inside
 * the game (phase 9-5) the view is always the simple one: set() does nothing
 * and the switch is hidden (core.css).
 * @param {import('./params.js').Params} params
 * @param {(mode: string) => void} onChange
 */
function createUi(params, onChange) {
  const saved = loadPref(UI_KEY);
  const fixed = inGame(params);
  let mode = fixed ? 'simple' : (params.ui ?? (UI_MODES.includes(saved) ? saved : 'simple'));
  const apply = () => {
    root.dataset.ui = mode;
    const dock = document.querySelector('.dock');
    if (dock) dock.open = mode === 'tech';
  };
  apply();
  return {
    get mode() {
      return mode;
    },
    set(m) {
      if (fixed || !UI_MODES.includes(m) || m === mode) return;
      mode = m;
      savePref(UI_KEY, m);
      apply();
      onChange(m);
    },
    only(zones) {
      const list = zones ? new Set(zones) : null;
      if (list) root.dataset.only = '1';
      else delete root.dataset.only;
      for (const el of document.querySelectorAll('[data-zone]')) el.toggleAttribute('data-shown', !!list?.has(el.dataset.zone));
    },
  };
}

/**
 * Stops the page with a coded error: data-error (for captures and the split
 * screen), the console, and the error screen of package start.
 */
function failPage(code, detail, lang, zones) {
  console.error(`viewer: ${code}${detail ? `: ${detail}` : ''}`);
  root.dataset.error = detail ? `${code}: ${detail}` : code;
  root.dataset.errorCode = code;
  delete root.dataset.loading;
  try {
    showError({ code, message: errorText(code, lang, gamePage), detail, lang, zones, game: gamePage });
  } catch (err) {
    console.error('viewer: error screen failed', err);
  }
}

function zonesOf(doc) {
  const z = {};
  for (const id of ['map', 'overlay', 'labels', 'banner', 'now', 'rumor', 'story', 'panel', 'batch', 'side', 'inspect', 'timeline', 'input', 'summary', 'help', 'tour', 'game', 'start', 'stats', 'sound'])
    z[id] = doc.getElementById(id);
  return z;
}

/**
 * Creates the app for a run whose header is known.
 * @param {object} header
 * @param {import('./params.js').Params} params
 * @param {'recording'|'live'} kind
 * @param {ReturnType<typeof zonesOf>} zones
 */
function createApp(raw, params, kind, zones, bus, onEmit) {
  // The viewer draws a roomier village than the header's map (position.js).
  const header = spreadHeader(raw);
  const lang = langOf(header);
  root.lang = lang;
  const canvas = zones.overlay;
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let dirty = true;
  let readyPending = false;
  let readyAsked = false;
  const holds = new Set();
  const startHolds = new Set();
  if (params.hold) startHolds.add(new Promise(() => {})); // captures of the loading screen
  const frameFns = [];
  const drawFns = [];
  const layerList = [];
  const failedLayers = new Set();
  let factOverride;

  const store = createStore(header, { live: kind === 'live', pos: params.t ?? header.start_tick });
  const requestDraw = () => {
    dirty = true;
  };
  onEmit(() => requestDraw());
  const camera = createCamera(() => bus.emit('zoom'));
  // Decorative clock: fixed with ?clock=<ms> so captures repeat exactly.
  let clock = params.clock !== null ? () => params.clock : () => performance.now();
  const quality = createQuality(params.q, isCapture(params));
  quality.on((tier) => bus.emit('quality', { tier }));

  const app = {
    header,
    kind,
    lang,
    params,
    store,
    zones,
    bus,
    camera,
    factId: () => (factOverride !== undefined ? factOverride : store.firstFact),
    setFact(id) {
      factOverride = id ?? undefined;
      bus.emit('fact', { fact: app.factId() });
    },
    race: null,
    setRace(list) {
      const next = Array.isArray(list) && list.length === 2 && list.every((f) => typeof f === 'string' && f) ? [list[0], list[1]] : null;
      const same = next === app.race || (next && app.race && next[0] === app.race[0] && next[1] === app.race[1]);
      if (same) return;
      app.race = next;
      bus.emit('race', { race: next ? [...next] : null });
    },
    layers: {
      register(layer) {
        if (!layer || typeof layer.draw !== 'function') throw new Error('layers.register: draw() missing');
        layerList.push(layer);
        layerList.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
        requestDraw();
      },
      list: () => [...layerList],
    },
    hooks: {
      neighborColor: () => VERSION_COLORS.unknown,
      position: (id, state, pos) => defaultPosition(header, store.firstPlace, id, state, pos),
      readingChars: () => 0,
      portrait: () => null,
    },
    positionOf: (id) => app.hooks.position(id, store.state, store.pos),
    visibleNeighbors() {
      const out = [];
      for (const n of header.neighbors ?? []) {
        const w = app.positionOf(n.id);
        const s = camera.toScreen(w.x, w.y);
        if (s.x >= 0 && s.y >= 0 && s.x <= camera.w && s.y <= camera.h) out.push(n.id);
      }
      return out;
    },
    onFrame(fn) {
      frameFns.push(fn);
    },
    onDraw(fn) {
      drawFns.push(fn);
      requestDraw();
    },
    requestDraw,
    holdReady(promise) {
      const p = Promise.resolve(promise).finally(() => {
        holds.delete(p);
        requestDraw();
      });
      holds.add(p);
    },
    holdStart(promise) {
      const p = Promise.resolve(promise).finally(() => startHolds.delete(p));
      startHolds.add(p);
    },
    /** Waits for every holdStart promise, also the ones added meanwhile. */
    async started() {
      while (startHolds.size) await Promise.allSettled([...startHolds]);
    },
    fail(code, detail = '') {
      // Behind the start screen a failure only leaves the village out.
      if (params.bg) return console.warn(`viewer: background recording: ${code} ${detail}`);
      failPage(code, detail, lang, zones);
    },
    ui: createUi(params, (mode) => bus.emit('ui', { mode })),
    // Replaced by package story when it starts (inert with embed=1).
    story: {
      fly() {},
      opening() {},
      viewOf: () => null,
      goTo() {},
      setDirector() {},
      director: false,
    },
    link: () => location.href,
    reducedMotion: () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    now: () => clock(),
    setClock(fn) {
      clock = typeof fn === 'function' ? fn : () => performance.now();
    },
    quality,
    /** Marks <html> ready after the next full draw. Only the first call counts. */
    readyAfterDraw() {
      if (readyAsked) return;
      readyAsked = true;
      readyPending = true;
      requestDraw();
    },
  };

  bus.on('seek', ({ pos }) => store.seek(pos));
  store.subscribe(requestDraw);

  // data-picked: a neighbor or a group is selected (the simple view shows #side then).
  let picked = { neighbor: params.select ?? null, group: params.group ?? null };
  const markPicked = () => root.toggleAttribute('data-picked', !!(picked.neighbor || picked.group));
  bus.on('select', ({ neighbor } = {}) => {
    picked = { ...picked, neighbor: neighbor ?? null };
    markPicked();
  });
  bus.on('group', ({ key } = {}) => {
    picked = { ...picked, group: key ?? null };
    markPicked();
  });
  markPicked();

  // Drawers (narrow screens, core.css): <html data-drawer="left|right">.
  // Picking a neighbor or a group opens the right one, where its card is.
  // Between 601 and 1100 px a folded drawer is off screen: it is inert, out of
  // the Tab order. Opened with its button, the focus goes into it; folded, it
  // goes back to that button. Wider, the columns are always there (never inert);
  // narrower, they are not shown at all.
  const text = pick(STRINGS, lang);
  const media = (q) => window.matchMedia?.(q) ?? { matches: false, addEventListener() {} };
  const narrowMq = media('(max-width: 1100px)');
  const drawerMq = media('(min-width: 601px) and (max-width: 1100px)');
  const narrow = () => narrowMq.matches;
  const columns = { left: document.querySelector('.column-left'), right: document.querySelector('.column-right') };
  const drawerBtns = [...document.querySelectorAll('.drawer-btn')];
  const markInert = () => {
    for (const [side, col] of Object.entries(columns)) {
      if (col) col.inert = drawerMq.matches && root.dataset.drawer !== side;
    }
  };
  const setDrawer = (side, { focus = false } = {}) => {
    const was = root.dataset.drawer;
    const wasCol = was ? columns[was] : null;
    const hadFocus = !!wasCol && wasCol !== columns[side] && wasCol.contains(document.activeElement);
    if (side) root.dataset.drawer = side;
    else delete root.dataset.drawer;
    for (const b of drawerBtns) b.setAttribute('aria-expanded', String(b.dataset.drawer === side));
    markInert();
    if (!drawerMq.matches) return;
    const col = side ? columns[side] : null;
    if (focus && col) col.focus({ preventScroll: true });
    else if (hadFocus) drawerBtns.find((b) => b.dataset.drawer === was)?.focus({ preventScroll: true });
  };
  for (const [side, col] of Object.entries(columns)) {
    if (!col) continue;
    col.tabIndex = -1; // takes the focus when its drawer opens
    col.setAttribute('aria-label', text.drawer[side]);
  }
  for (const b of drawerBtns) {
    b.textContent = text.drawer[b.dataset.drawer];
    b.onclick = () => {
      const open = root.dataset.drawer === b.dataset.drawer;
      setDrawer(open ? null : b.dataset.drawer, { focus: !open });
      if (open) b.focus({ preventScroll: true });
    };
  }
  setDrawer(null);
  drawerMq.addEventListener('change', markInert);
  // Set from elsewhere too (a package writing data-drawer): keep inert right.
  new MutationObserver(markInert).observe(root, { attributes: true, attributeFilter: ['data-drawer'] });

  // The folded «El rumor» tells how many know it (narrow screens): the count
  // of the rumor card (rumor/card.js), versionsAt of the current state.
  const leftBtn = drawerBtns.find((b) => b.dataset.drawer === 'left');
  const ids = (header.neighbors ?? []).map((n) => n.id);
  let countDirty = true;
  let shownCount = null;
  const markCount = () => {
    countDirty = true;
  };
  store.subscribe(markCount);
  bus.on('fact', markCount);
  narrowMq.addEventListener('change', markCount);
  const renderCount = () => {
    if (!countDirty || !leftBtn || !narrow()) return;
    countDirty = false;
    const fact = app.factId();
    const label = text.drawer.left;
    let shown = label;
    let aria = label;
    if (fact && store.state?.facts?.has(fact)) {
      const c = versionsAt(store.state, fact, ids).counts;
      const vars = { label, n: c.correct + c.incomplete + c.wrong, total: ids.length };
      const fillIn = (s) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
      shown = fillIn(text.drawerCount);
      aria = fillIn(text.drawerCountLabel);
    }
    if (shown === shownCount) return;
    shownCount = shown;
    leftBtn.textContent = shown;
    leftBtn.setAttribute('aria-label', aria);
  };
  frameFns.push(renderCount);
  bus.on('select', ({ neighbor } = {}) => {
    if (neighbor && narrow()) setDrawer('right');
  });
  bus.on('group', ({ key } = {}) => {
    if (key && narrow()) setDrawer('right');
  });

  // Overlay size and pixel density (the scene sizes its own canvas).
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    camera.resize(r.width, r.height);
    if (!camera.moved) camera.fit(placeBounds(header), 60);
    requestDraw();
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  const draw = () => {
    dirty = false;
    const { w, h } = camera;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const frame = { state: store.state, pos: store.pos, camera, w, h, dpr, now: clock() };
    for (const fn of drawFns) {
      try {
        fn(frame);
      } catch (err) {
        if (!failedLayers.has(fn)) {
          failedLayers.add(fn);
          console.error('viewer: scene draw failed', err);
        }
      }
    }
    for (const layer of layerList) {
      ctx.save();
      try {
        layer.draw(ctx, frame);
      } catch (err) {
        if (!failedLayers.has(layer.id)) {
          failedLayers.add(layer.id);
          console.error(`viewer: layer '${layer.id}' failed`, err);
        }
      }
      ctx.restore();
    }
    if (readyPending && !holds.size) {
      readyPending = false;
      root.dataset.ready = '1';
    }
  };

  let last = null;
  const loop = (now) => {
    const dt = last === null ? 0 : now - last;
    last = now;
    for (const fn of frameFns) {
      try {
        fn(dt);
      } catch (err) {
        console.error('viewer: onFrame callback failed', err);
      }
    }
    if (dirty) draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  for (const [name, init] of PACKAGES) {
    try {
      init(app);
    } catch (err) {
      console.error(`viewer: package '${name}' failed to start`, err);
    }
  }
  window.rumorApp = app; // for the browser console
  return app;
}

/**
 * Reads a source into a new app.
 * @param {import('./source.js').Source} source
 * @param {(bus: import('./bus.js').Bus) => void} [onBus] gets the bus before the source starts
 */
function start(source, params, zones, lang, onBus = () => {}) {
  let app = null;
  let batches = 0;
  let emitHook = () => {};
  const bus = createBus((type, payload) => emitHook(type, payload));
  onBus(bus);
  const recording = source.kind === 'recording';
  if (recording && !params.bg) {
    root.dataset.loading = '1';
    try {
      showLoading({ bus, lang, zones, params });
    } catch (err) {
      console.error('viewer: loading screen failed', err);
    }
  }
  return source
    .start(
      (header) => {
        app = createApp(header, params, source.kind, zones, bus, (fn) => {
          emitHook = fn;
        });
        // The game mode waits with only the header: no batch is coming yet.
        if (params.play) app.readyAfterDraw();
      },
      (events) => {
        app.store.append(events);
        if (source.kind === 'live' && batches++ === 0) app.readyAfterDraw();
      },
    )
    .then(async () => {
      if (!recording || !app) return;
      await app.started();
      if (root.dataset.error) return;
      delete root.dataset.loading;
      app.bus.emit('loaded');
      app.readyAfterDraw();
    })
    .catch((err) => {
      const { code, detail } = errorOf(err);
      // Behind the start screen a failure only leaves the village out.
      if (params.bg) return console.warn(`viewer: background recording: ${code} ${detail}`);
      failPage(code, detail, app?.lang ?? lang, zones);
    });
}

function boot() {
  document.getElementById('nojs')?.remove();
  const params = parseParams(location.search);
  const zones = zonesOf(document);
  const lang = pageLang(params);
  root.lang = lang;
  gamePage = inGame(params);
  applyCssVars(root);
  if (params.left || params.right) {
    import('../split/index.js')
      .then((m) => m.startSplit(params))
      .catch((err) => {
        const { code, detail } = errorOf(err);
        failPage(code, detail, lang, zones);
      });
    return;
  }
  if (params.embed) root.dataset.embed = '1';
  if (params.photo) root.dataset.photo = '1';
  try {
    if (params.live || params.play) {
      // Until the header arrives (the engine may be slow or not up yet).
      zones.banner.textContent = pick(STRINGS, lang)[params.play ? 'connectingGame' : 'connecting'];
      // The game says when it cannot be reached, with «Reintentar» (phase 9-5).
      if (params.play) watchLost(liveStatus, { show: () => showLost({ lang }), hide: hideLost });
      return start(liveSource(params), params, zones, lang);
    }
    if (params.log) return openLog(params, zones, lang);
  } catch (err) {
    const { code, detail } = errorOf(err);
    return failPage(code, detail, lang, zones);
  }

  // Nothing to open: the start screen (package start).
  startScreen({
    params,
    lang,
    zones,
    openFile(file) {
      delete root.dataset.ready;
      delete root.dataset.background;
      return start(droppedSource(file), params, zones, lang);
    },
    // The village behind the start screen: a recording playing with the
    // director, <html data-background>, no loading screen and nothing that
    // opens by itself (isCapture). `extra` overrides params (speed, t…).
    openBackground(path, extra = {}) {
      root.dataset.background = '1';
      const bg = { ...params, log: path, director: true, tour: false, paused: false, bg: true, ...extra };
      return start(fileSource(path), bg, zones, lang);
    },
  });
}

/** A recording from the URL, with its download progress on the bus. */
function openLog(params, zones, lang) {
  let bus = null;
  const source = fileSource(params.log, (loaded, total) => bus?.emit('progress', { part: 'log', loaded, total }));
  return start(source, params, zones, lang, (b) => (bus = b));
}

boot();
