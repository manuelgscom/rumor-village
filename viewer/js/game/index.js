// Package C of phase 9: the game mode (docs/juego.md, the design; docs/fases/
// fase-9.md, the plan). Glue only: the logic is in prepare.js,
// profile.js and state.js (tested without DOM); the screens are drawn by
// screens.js, prepareview.js and endview.js; scoring is score/ (package D).
//
//   #game (fixed, over the interface, under #start)
//   ┌──────────────────────────────────────────────┐
//   │ .gm-root: one screen at a time               │
//   │   boot · menu · challenges · friend · games  │  centred card
//   │   prepare                                    │  left panel, the village beside it
//   │   playing: .gm-bar · ended: .gm-bar + .gm-end│
//   └──────────────────────────────────────────────┘
//
// The viewer keeps no game state: GET state on every page load says where we
// are, and the engine keeps the draft (POST preview). After POST start,
// POST reset, or a preview with town_changed, the page reloads; the hash
// (#prepare, #menu, #games) says which screen to come back to.
//
//   GET state ─► waiting ─► ?screen= · #hash · draft? prepare : menu ─► …
//             ├► playing ─► bar (mode label, «Terminar ya») ─ end event ─┐
//             └► ended ──────────────────────────────────────────────────┴► game card
//
// Bus: 'game' {phase, draft?, editing?} with phase boot | menu | prepare |
// playing | ended: each time the phase changes and, while preparing, on every
// refresh with the effective draft (the draft plus the rumor open in the
// editor, what «Empezar» would start) and `editing` (that rumor, or null).
// The guided game (story/tutorialview.js) reads it; it gets the same values
// as startTutorial(app, {phase, draft}) when it opens late. <html data-game="play|replay"> shows the zone and
// <html data-game-phase> lets css/game.css lift the card over the 8-2 card.
//
// ?play=1&code=RV1-… opens a friend's challenge (score/ decodeCode). ?game=<id>
// with ?log= is the replay of a played game («Mis partidas»): a bar with the
// mode label, the game card at the end and a link back to the game.
//
// The guided first game (viewer/js/story/tutorialview.js, package F) is
// started with startTutorial(app, {api, onDone, phase, draft, intro}) on any
// page whose draft is the tutorial challenge while the profile wants it (chosen
// and under way, `tutorial_guided`, or never seen; profile.js wantsTutorial), or
// with ?screen=tutorial. Phase 9-5, `intro` (its part 1, «Cómo funciona»):
//   'first'  «Tutorial» in the menu (and ?screen=tutorial): part 1, then part 2;
//            a reload of a new town on the way carries it (carry `intro`)
//   'only'   «Cómo se juega»: part 1 alone; onDone({intro: true}) goes back to
//            the menu without marking the tutorial seen
//   false    a page coming back to a guide under way (a reload): part 2 as it was
//
// sessionStorage 'rv-prepare-carry' (phase 9-2; a comfort of the tab, it works
// without it): a change of type, town or neighbors regenerates the town and
// reloads the page (town_changed). Before that reload the open editor and what
// Teléfono set aside of a village game go there, and come back on the next
// page (prepare.js parseCarry, restoreVillage, fitToHeader). «Probar con otro
// vecino» at the end leaves one too (prepare.js retryCarry): the same rumor
// open in the editor, its recipients emptied, and the focus on them, with
// whom it was told to and how far it went («La otra vez…», phase 9-4). Phase
// 9-4 adds the names of the town before (the notes say what a new census took
// away, prepare.js townChanges) and the race set aside (raceStashOf).
//
// Phase 9-4, without a reload: «Menú» keeps the rumor open in the editor and
// «Partida libre» brings it back; a race the count of rumors takes away is
// set aside and comes back with the same pair (prepare.js restoreRace).
// It points at these data-gm anchors:
//   menu-tutorial · menu-free · menu-challenges · menu-friend · menu-games   the menu entries
//   menu-mode · menu-howto      the card of the mode and «Cómo se juega» (phase 9-5)
//   rumor-text · understood     «✎ ¿Prefieres escribirlo?» and «Rellenar la frase» (Con IA only)
//   rumor-what                  the seven kinds, with their icon
//   rumor-where · rumor-when    the gaps «dónde» and «cuándo pasa» of the sentence (phase 9-5)
//   rumor-example               «Usar este ejemplo» (fills the fact; phase 9-2)
//   rumor-to                    whom it is told to (phase 9-2)
//   neighbor-card               each card of a neighbor, with data-id (phase 9-5)
//   rumor-add                   «Guardar» (the editor's accept; «Empezar» also takes
//                               the rumor open in the editor)
//   rumor-new                   «Añadir un rumor» (opens the editor again)
//   rumor-list                  the list of prepared rumors
//   bet · race                  the bets and the race
//   start                       «Empezar» (the one main button: «Contárselo a Ana y empezar»)
//   ready                       the card «Rumor listo» of a free game (phase 9-4)
//   ready-to · ready-edit       its «Cambiar a quién» and «Cambiar el rumor»
//   customize                   «Más opciones» (a <details>: rumors, race, bets, settings)
//   mode-label · stop           the mode label and «Terminar ya» while playing
//   final                       the game card at the end
//   whodidit · share            «¿Quién fue?» and «Compartir»
//   retry                       «Probar con otro vecino» (phase 9-3)
//   again · new                 «Otra vez» and «Partida nueva»
//   rumor-count                 the counter of the rumor card (rumor/card.js; the guided game)
//
// Bus 'prepare-focus' {neighbor, home, usual} (phase 9-5): the card of a
// neighbor under the pointer or the focus (its id, the place id of its home,
// the key of the place where it spends the day, or null), and all null when
// it is left; render/preview.js marks them on the map.

import { pick } from '../core/lang.js';
import { createApi } from '../live/api.js';
import { expectRestart } from '../live/lost.js';
import { createAiDownload } from './aidownload.js';
import { fill } from '../rumor/strings.js';
import { button, el, screen as screenEl } from './dom.js';
import { decodeCode } from './score/code.js';
import { createBar, createEndCard, strongReasons, raceFacts, raceLegend, readCode, scoreCall, scoreText } from './endview.js';
import {
  challengeLocks,
  challengeRumor,
  DEFAULT_SETTINGS,
  editorFits,
  effectiveDraft,
  fieldErrorText,
  fitRumor,
  fitToHeader,
  isEmptyDraft,
  lastTryText,
  measureUnit,
  modeOfHeader,
  namesOf,
  newDraft,
  normalizeDraft,
  parseCarry,
  raceStashOf,
  lastVillage,
  randomTown,
  suggestNeighbor,
  firstByName,
  restoreRace,
  restoreVillage,
  retryCarry,
  stashVillage,
  townChanges,
  villageSizeOf,
} from './prepare.js';
import { createPrepare } from './prepareview.js';
import { informedEnd } from './score/measures.js';
import { markGuided, markTutorial, normalizeProfile, prefsOf, updateProfile, wantsTutorial, withPrefs } from './profile.js';
import { aiDownloadBlock, aiHowTo, bootScreen, challengesScreen, friendScreen, gamesScreen, menuScreen } from './screens.js';
import { loadState, phaseOf, SCREENS, screenOf } from './state.js';
import { STRINGS } from './strings.js';

/** Wait after the last change before saving the draft (POST preview), in ms. */
const SAVE_MS = 350;
/** Polling of GET state while the hardware check runs, in ms. */
const CHECK_MS = 1500;
/** sessionStorage key of what a reload of «Preparar la partida» carries over. */
const CARRY_KEY = 'rv-prepare-carry';
/**
 * sessionStorage key of the try before («Probar con otro vecino», carry
 * `last`): written at «Empezar», read by the end card of that game (it
 * compares the score with it) across every reload while it is played.
 */
const LAST_TRY_KEY = 'rv-last-try';

/**
 * sessionStorage keys of the neighbor to propose in the next free game (phase
 * 9-5): the one the end card advised ({town, id}, createEndCard `recommended`),
 * and the proposal made with the example rumor ({town, id, kind, reasons}),
 * read back while that village is prepared. Comforts of the tab.
 */
const TIP_KEY = 'rv-tip';
const PROPOSAL_KEY = 'rv-proposal';

function readJson(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No sessionStorage: the proposal is the neighbor with most reasons.
  }
}

/** Keeps (or forgets, with null) the try before for the game about to start. */
function keepLastTry(last) {
  try {
    if (last) sessionStorage.setItem(LAST_TRY_KEY, JSON.stringify(last));
    else sessionStorage.removeItem(LAST_TRY_KEY);
  } catch {
    // No sessionStorage: the end card just does not compare.
  }
}

/** The try before of the game being played, or null. */
function readLastTry() {
  try {
    return parseCarry({ last: JSON.parse(sessionStorage.getItem(LAST_TRY_KEY) ?? 'null') })?.last ?? null;
  } catch {
    return null;
  }
}

/** The carry left by the page before, read once (null without one or without storage). */
function takeCarry() {
  try {
    const raw = sessionStorage.getItem(CARRY_KEY);
    sessionStorage.removeItem(CARRY_KEY);
    return raw ? parseCarry(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Leaves the carry for the next page; without storage, nothing is kept. */
function leaveCarry(carry) {
  try {
    sessionStorage.setItem(CARRY_KEY, JSON.stringify(carry));
  } catch {
    // No sessionStorage (private mode, blocked): the reload just forgets the editor.
  }
}

/** Reloads the page on a screen (the hash), with an optional new query. */
function reloadTo(screen, search = location.search) {
  reloading = true;
  history.replaceState(null, '', `${location.pathname}${search}#${screen}`);
  location.reload();
}

/** A reload of the page itself is under way (it leaves its own carry): pagehide keeps out. */
let reloading = false;

/** The screen the page asked to come back to (#prepare…), forgotten once read. */
function takeResume() {
  const h = (location.hash ?? '').slice(1);
  if (h) history.replaceState(null, '', `${location.pathname}${location.search}`);
  return h || null;
}

/**
 * The timetable of the jobs (GET /timetable, phase 9-5), for the neighbor
 * cards: `app.timetable` ({jobs: {<job>: [24 place keys or "home"]}}), null
 * until it arrives or when it cannot be read, and bus 'timetable' {timetable}
 * once it is there. Cards work without it (core/neighbors.js).
 * @param {object} app
 * @param {ReturnType<typeof createApi>} api
 */
function loadTimetable(app, api) {
  app.timetable = null;
  api
    .timetable()
    .then((reply) => {
      if (!reply.ok || !reply.body?.jobs) return;
      app.timetable = reply.body;
      app.bus.emit('timetable', { timetable: reply.body });
    })
    .catch(() => {});
}

/**
 * Starts the package. Called once, with the header known and before any event.
 * @param {object} app see viewer/js/core/app.js
 */
export function init(app) {
  const { params } = app;
  if (!params.play && !params.game) return;
  const zone = app.zones.game;
  if (!zone) return;
  document.documentElement.dataset.game = params.play ? 'play' : 'replay';
  const root = el('div', { class: 'gm-root' });
  zone.replaceChildren(root);
  const t = pick(STRINGS, app.lang);
  const api = createApi();
  loadTimetable(app, api);
  if (!params.play) return startReplay(app, root, t, api);
  app.holdReady(
    startGame(app, root, t, api).catch((err) => {
      console.error('game: start failed', err);
    }),
  );
}

/**
 * Tells the bus and the CSS which phase the game is in: when it changes, and
 * always when `extra` comes (the effective draft while preparing).
 */
function createPhase(app) {
  let current = null;
  const set = (phase, extra = null) => {
    if (phase === current && !extra) return;
    current = phase;
    document.documentElement.dataset.gamePhase = phase;
    app.bus.emit('game', { phase, ...extra });
  };
  set.current = () => current;
  return set;
}

async function startGame(app, root, t, api) {
  const { params, lang } = app;
  const setPhase = createPhase(app);
  const resume = takeResume();
  // Read always (it is for one page only), used only when coming back to prepare.
  const carried = takeCarry();
  const carry = resume === 'prepare' ? carried : null;
  const loaded = await loadState(api);
  if (!loaded.ok) {
    console.warn('game: no answer from the game', loaded.error);
    root.replaceChildren(
      screenEl('error', t.bootTitle, el('p', { class: 'gm-error', text: t.noEngine }), [
        button(t.tryAgain, () => location.reload(), { class: 'gm-btn gm-primary' }),
      ]),
    );
    setPhase('boot');
    return;
  }
  let state = loaded.state;
  const [profileReply, gamesReply] = await Promise.all([api.profile(), api.games()]);
  let profile = normalizeProfile(profileReply.ok ? profileReply.body : null);
  // A failed fetch is not «no games yet»: «Mis partidas» says it and offers to try again.
  const gamesOf = (reply) => (reply.ok && Array.isArray(reply.body?.games) ? reply.body.games : []);
  let games = gamesOf(gamesReply);
  let gamesError = gamesReply.ok ? null : (gamesReply.error ?? 'error');
  const aiAvailable = state.ai?.available === true;
  const aiReason = state.ai?.reason ? (t.aiReasons?.[state.ai.reason] ?? state.ai.reason) : '';
  const challenges = Array.isArray(state.challenges) ? state.challenges : [];
  const challengeById = (id) => challenges.find((c) => c?.id === id) ?? null;
  const tutorialChallenge = challenges.find((c) => c?.tutorial) ?? null;
  // The mode of a new draft: the player's choice (menu or «Quién decide»), else Con IA when there is AI.
  const preferredMode = () => (aiAvailable ? (prefsOf(profile).mode ?? 'ai') : 'rules');

  // --- The draft (kept by the engine) -----------------------------------------
  let header = app.header; // the town of the draft: the live header, then each preview's
  const fromHeader = () => {
    const h = app.header;
    const s = { ...DEFAULT_SETTINGS, lang, mode: preferredMode() };
    if (Number.isInteger(h.seed)) s.town = h.seed;
    if (h.scenario === 'telephone-20') s.type = 'telephone';
    const size = villageSizeOf(h);
    if (s.type === 'village' && size !== null) s.neighbors = size;
    return newDraft(s);
  };
  const norm = (d) => normalizeDraft(d, { aiAvailable, header, challenge: challengeById(d?.challenge), lang });
  let draft = norm(state.draft ?? fromHeader());
  let saving = false;
  let starting = false;
  let errors = [];
  let notes = [];
  let saveTimer = null;
  let savePromise = null;
  let view = null; // the prepare screen, while it is shown
  let current = null; // the screen shown
  // What Teléfono set aside of a village game ({rumors, race, editor}), until Pueblo comes back.
  let villageStash = carry?.village ?? null;
  // The editor of the next prepare screen: one carried over (with the field to
  // focus, «Probar con otro vecino»), or {example: true}.
  let nextEditor = carry?.editor
    ? { ...carry.editor, rumor: fitRumor(carry.editor.rumor, header), focus: carry.focus ?? null }
    : carry?.example
      ? { example: true }
      : null;
  /** The draft «Empezar» would start: the draft plus the rumor open in the editor, normalized. */
  const effective = (editing) => norm(effectiveDraft(draft, editing ?? null));
  // The race set aside while there are not exactly two rumors, with the pair it
  // was for (prepare.js raceStashOf); it comes back with the same pair.
  let raceStash = carry?.race ?? null;
  // «La otra vez se lo contaste a …» after «Probar con otro vecino» (prepare.js retryCarry).
  const lastTry = carry?.last ?? null;
  // The editor open when «Menú» was pressed: «Partida libre» brings it back.
  let menuEditor = null;
  // «Tutorial» chosen and its part 1 not shown yet: a reload of a new town carries it.
  let introNext = carry?.intro === true;

  const refresh = () => view?.update();
  const save = async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    saving = true;
    refresh();
    const reply = await api.preview(draft);
    saving = false;
    if (reply.ok && reply.body?.town_changed) {
      await prefSaving; // «Quién decide» or «Idioma» chosen: remembered before the page goes
      // A new town: the page reloads; the editor and the stash go with it
      // (before the first paint, the editor still waiting in nextEditor).
      const pending = !view && nextEditor?.rumor ? nextEditor : null;
      const editing = view ? view.editing() : pending;
      // The names of this town too: the next page says whom the new census took away.
      const names = namesOf(effectiveDraft(draft, editing), header);
      leaveCarry({ village: villageStash, editor: editing, example: !editing && nextEditor?.example === true, focus: pending?.focus ?? null, names, race: raceStash, last: lastTry, intro: introNext });
      reloadTo('prepare');
      return new Promise(() => {}); // the page is going
    }
    if (reply.ok && reply.body?.header) header = reply.body.header;
    errors = reply.ok ? [] : [fill(t.saveError, { error: reply.error })];
    refresh();
    return reply.ok;
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => (savePromise = save()), SAVE_MS);
  };
  const flush = async () => {
    // A change still waiting, or a save that failed: save now.
    if (saveTimer || errors.length) return save();
    if (savePromise) return savePromise;
    return true;
  };
  const setDraft = (next) => {
    const was = draft.settings.type;
    const now = next?.settings?.type;
    let reopen = null;
    if (was === 'village' && now === 'telephone' && !draft.challenge) {
      // Teléfono keeps one rumor: the rest waits for Pueblo.
      villageStash = stashVillage(draft, view?.editing() ?? null);
    } else if (was === 'telephone' && now === 'village' && villageStash) {
      next = restoreVillage(next, villageStash);
      // The village editor comes back too, unless another one is open (or it was on the first rumor, edited in Teléfono).
      if (!view?.editing() && villageStash.editor && villageStash.editor.index !== 0) reopen = villageStash.editor;
      villageStash = null;
    }
    const before = draft;
    draft = norm(next);
    if (before.settings.type === 'village' && draft.settings.type === 'village') {
      // A race the count of rumors takes away is set aside; the same pair brings it back.
      if (next?.race && !draft.race) raceStash = raceStashOf(before) ?? raceStash;
      else if (draft.race) raceStash = null;
      else if (raceStash) {
        const back = norm(restoreRace(draft, raceStash));
        if (back.race) {
          draft = back;
          raceStash = null;
        }
      }
    }
    errors = [];
    scheduleSave();
    refresh();
    if (reopen && view && editorFits(reopen, draft)) view.reopen(reopen);
  };
  /** Replaces the draft and saves it at once; then shows prepare (or reloads). */
  const applyDraft = async (next) => {
    draft = norm(next);
    errors = [];
    if (await save()) go('prepare');
  };

  const challengeDraftOf = (ch, mode = draft.settings.mode) => {
    const fromD = scoreCall('challengeDraft', ch, mode);
    if (fromD && typeof fromD === 'object' && fromD.settings) return { ...fromD, challenge: ch.id };
    const base = newDraft({ ...draft.settings, ...ch.settings, mode, until: ch.settings?.until ?? null });
    return { ...base, challenge: ch.id, rumors: ch.rumor?.fact?.what ? [challengeRumor(ch)] : [] };
  };

  // --- Friend's challenge --------------------------------------------------------
  const friend = params.code ? readCode(params.code) : null;
  // «su marca es 14 enterados»: the unit of the measure of its challenge (a free game: enterados).
  const friendLine = () => {
    if (!friend?.score) return '';
    const value = scoreText(friend.score);
    const unit = value === '—' ? '' : measureUnit(challengeById(friend.challenge), t);
    return fill(t.friendFrom, { score: t.score, value: unit ? `${value} ${unit}` : value });
  };
  const friendDraft = (p) => {
    const d = { settings: { ...p.settings }, rumors: p.rumors ?? [], challenge: p.challenge ?? null, bets: p.bets ?? null, race: p.race ?? null };
    if (p.mode) d.settings.mode = p.mode;
    if (p.mode === 'ai' && !aiAvailable) notes = [t.friendNoMode];
    return d;
  };
  // The code alone or a link that holds it; another version of the game is said apart.
  const openCode = (text) => {
    try {
      decodeCode(text);
    } catch (err) {
      return err?.code === 'version' ? t.friendVersion : t.friendBad;
    }
    const code = /RV\d+-[A-Za-z0-9_-]*/.exec(text)?.[0];
    if (!code || !readCode(code)) return t.friendBad;
    reloadTo('friend', `?play=1&code=${encodeURIComponent(code)}&lang=${lang}`);
    return null;
  };
  if (friend?.mode === 'ai' && !aiAvailable) notes = [t.friendNoMode];

  // --- Profile and tutorial ----------------------------------------------------------
  const saveProfile = async (next) => {
    profile = normalizeProfile(next);
    const reply = await api.saveProfile(profile);
    return reply.ok;
  };
  /**
   * Read-modify-write of the profile: the guide (tutorialview.js) and the end
   * card write it too, so a change starts from a fresh GET profile. Without it,
   * nothing is written (the stars would be wiped).
   */
  const changeProfile = async (fn) => {
    try {
      const got = await api.profile();
      if (!got.ok) {
        profile = fn(profile);
        return false;
      }
      return await saveProfile(fn(got.body));
    } catch {
      return false;
    }
  };
  // --- The player's preferences: mode and language (profile.js prefsOf) ------------
  let prefSaving = Promise.resolve(true);
  /** Remembers {mode?, lang?} in the profile; the next start of the game opens with them. */
  const remember = (patch) => (prefSaving = changeProfile((p) => withPrefs(p, patch)));
  /**
   * From the menu: remembers the choice and puts it in the draft. A new mode or
   * language is a new world for the engine (town_changed): the page reloads on
   * the menu, in the new language.
   */
  const setPreference = async (patch) => {
    const next = norm({ ...draft, settings: { ...draft.settings, ...patch } });
    if (JSON.stringify(next.settings) === JSON.stringify(draft.settings)) return;
    await Promise.all([remember(patch), flush()]);
    draft = next;
    const reply = await api.preview(draft);
    if (reply.ok && reply.body?.town_changed) return reloadTo('menu', `?play=1&lang=${draft.settings.lang}`);
    if (reply.ok && reply.body?.header) header = reply.body.header;
    go('menu');
  };

  let tutorialStarted = false;
  let guide = null; // the running guide (tutorialview.js startTutorial)
  /** Before a reload: the guide's profile save, if it started, has to land. */
  const guideSaved = () => Promise.resolve(guide?.saving?.()).catch(() => false);
  /** The guide; intro: 'first' (chosen now: part 1 first) or false (coming back to it). */
  const runTutorial = (draftNow, intro = false) => {
    if (tutorialStarted) return;
    tutorialStarted = true;
    introNext = false;
    import('../story/tutorialview.js')
      .then((m) => {
        guide = m.startTutorial(app, {
          api,
          intro,
          // What the page knows now: the guide may open after the bus said it.
          phase: setPhase.current(),
          draft: draftNow ?? (view ? effective(view.editing()) : draft),
          // Finished, skipped or ×: seen, and no longer under way (after the guide's own save).
          onDone: ({ saved } = {}) => {
            Promise.resolve(saved)
              .catch(() => false)
              .then(() => changeProfile(markTutorial));
          },
        });
      })
      .catch((err) => console.warn('game: the guided first game is not available', err));
  };
  /**
   * «Cómo se juega»: part 1 of the tutorial alone, over the village; back to
   * the menu at its end, without marking the tutorial seen.
   */
  const runHowto = () => {
    root.replaceChildren();
    root.classList.remove('gm-modal');
    root.dataset.screen = 'howto';
    current = 'howto';
    import('../story/tutorialview.js')
      .then((m) => {
        m.startTutorial(app, { api, intro: 'only', phase: setPhase.current(), draft, onDone: () => go('menu') });
      })
      .catch((err) => {
        console.warn('game: «Cómo se juega» is not available', err);
        go('menu');
      });
  };
  const isTutorialDraft = () => !!tutorialChallenge && draft.challenge === tutorialChallenge.id;

  // --- The download of the AI (downloaded game without the model; aidownload.js) -------
  // Polled while it moves; only its block is drawn again, in place. «Activar Con
  // IA» restarts the engine: the page waits for it and reloads on the menu.
  const menuSearch = `?play=1&lang=${lang}`;
  const drawAiDownload = () => {
    for (const old of root.querySelectorAll('[data-gm="ai-download"]')) {
      const next = aiDownloadBlock(ctx);
      if (next.dataset.view === old.dataset.view) continue;
      const focused = old.contains(document.activeElement) ? document.activeElement.dataset.action : null;
      old.replaceWith(next);
      if (focused) next.querySelector(`[data-action="${focused}"]`)?.focus();
    }
  };
  const aiDl = createAiDownload({
    api,
    getState: () => state,
    update: (body) => {
      state = { ...state, ai: body.ai ?? state.ai, check: body.check ?? state.check };
    },
    changed: drawAiDownload,
    // Any reload from here on (also live/source.js, on the new run) lands on the menu.
    onActivating: () => {
      reloading = true;
      history.replaceState(null, '', `${location.pathname}${menuSearch}#menu`);
    },
    expectRestart,
    reload: () => reloadTo('menu', menuSearch),
  });

  // --- Hardware check: poll while it runs ---------------------------------------------
  const checkRunning = () => state.check?.state === 'running';
  if (checkRunning()) {
    const timer = setInterval(async () => {
      const next = await loadState(api);
      if (!next.ok) return;
      state = { ...state, check: next.state.check, ai: next.state.ai };
      aiDl.sync();
      if (!checkRunning()) {
        clearInterval(timer);
        if (current === 'boot' || current === 'menu') go(current);
        refresh();
      }
    }, CHECK_MS);
  }

  // --- Screens ------------------------------------------------------------------------
  const ctx = {
    t,
    lang,
    params,
    api,
    get state() {
      return state;
    },
    get profile() {
      return profile;
    },
    get games() {
      return games;
    },
    get gamesError() {
      return gamesError;
    },
    reloadGames: async () => {
      const reply = await api.games();
      games = gamesOf(reply);
      gamesError = reply.ok ? null : (reply.error ?? 'error');
      go('games');
    },
    aiAvailable,
    aiReason,
    aiDownload: aiDl,
    // The web version (phase 10): Sin IA only, nothing to close, Con IA by download.
    web: state.platform === 'web',
    version: typeof state.version === 'string' ? state.version : null,
    get mode() {
      return draft.settings.mode;
    },
    tutorialChallenge,
    go: (s) => go(s),
    // A free draft already under way is kept, with the editor open when «Menú»
    // was pressed; otherwise a new one, in a town at random, with the example
    // rumor ready («Rumor listo», phase 9-4; docs/juego.md).
    free: () => {
      const kept = menuEditor;
      menuEditor = null;
      if (!draft.challenge && (!isEmptyDraft(draft) || kept)) {
        nextEditor = kept;
        return go('prepare');
      }
      nextEditor = { example: true };
      // The village of the last game, so the neighbors learnt are the same ones;
      // a village at random only the first time («Otro pueblo» changes it).
      const village = lastVillage(games) ?? { town: randomTown() };
      return applyDraft(newDraft({ ...DEFAULT_SETTINGS, lang, ...village, mode: preferredMode() }));
    },
    challenge: (ch) => applyDraft(challengeDraftOf(ch)),
    friend: openCode,
    // The guided game, chosen in the menu: under way until it ends, across reloads;
    // part 1 («Cómo funciona») first, also when a new town reloads the page.
    tutorial: async () => {
      if (!tutorialChallenge) return;
      introNext = true;
      await changeProfile(markGuided);
      await applyDraft(challengeDraftOf(tutorialChallenge));
      runTutorial(undefined, 'first');
    },
    howto: () => runHowto(),
    setPreference,
    // true when the game closed: a reply 200, or no answer (a closing server can drop the
    // connection). Otherwise false, and the menu stays to say so (screens.js).
    quit: async () => {
      const reply = await api.quit();
      if (!reply.ok && reply.status !== 0) return false;
      root.replaceChildren(screenEl('quit', t.bootTitle, el('p', { text: t.quitDone })));
      return true;
    },
  };

  const prepareCtx = {
    t,
    lang,
    api,
    aiAvailable,
    aiReason,
    // Whom the example of a new free game is told to, and why («Rumor listo»): the
    // neighbor the end card advised if they live here, else the one with most strong
    // reasons, else the first by name. Kept for this village.
    newProposal: (h) => {
      const town = h?.seed ?? null;
      const tip = readJson(TIP_KEY);
      writeJson(TIP_KEY, null);
      let prop;
      if (tip && tip.town === town && (h?.neighbors ?? []).some((n) => n.id === tip.id)) prop = { town, id: tip.id, kind: 'tip' };
      else {
        const best = suggestNeighbor(h, app.timetable ?? null, lang, strongReasons);
        prop = best ? { town, id: best.id, kind: 'best', reasons: best.reasons } : { town, id: firstByName(h), kind: 'first' };
      }
      writeJson(PROPOSAL_KEY, prop);
      return prop;
    },
    proposal: () => {
      const p = readJson(PROPOSAL_KEY);
      return p && p.town === (header?.seed ?? null) ? p : null;
    },
    // The village of the last game: the head says whether the neighbors are the same.
    lastVillage: () => lastVillage(games),
    // The jobs' timetable for the cards of the neighbors (null until it arrives).
    timetable: () => app.timetable ?? null,
    // The card under the pointer or the focus; null when it is left (render/preview.js).
    focusNeighbor: (p) => app.bus.emit('prepare-focus', { neighbor: p?.id ?? null, home: p?.home?.id ?? null, usual: p?.usual?.key ?? null }),
    header: () => header,
    draft: () => draft,
    setDraft,
    remember,
    challenge: () => challengeById(draft.challenge),
    locks: () => challengeLocks(challengeById(draft.challenge)),
    checkRunning,
    violations: () => {
      const ch = challengeById(draft.challenge);
      // checkDraft: [{field, error}] of what «Empezar» would start; one line
      // per kind of error. A missing `to` is already said by the blockers.
      const v = ch ? scoreCall('checkDraft', ch, effective(view?.editing() ?? null)) : null;
      if (!Array.isArray(v)) return [];
      const kinds = [...new Set(v.map((x) => x?.error).filter((e) => e && e !== 'missing'))];
      return kinds.map((e) => t.violations[e] ?? e);
    },
    busy: () => saving,
    starting: () => starting,
    friendLine,
    notes: () => notes,
    errors: () => errors,
    // The rumor being edited is kept while the menu is visited (phase 9-4).
    menu: () => {
      menuEditor = view?.editing() ?? null;
      go('menu');
    },
    effective,
    // The race set aside (raceStash): «La carrera necesita exactamente dos rumores».
    raceStashed: () => !!raceStash,
    lastTry: () => lastTryText(lastTry, t),
    // Every change of the draft or the editor: the bus says the effective draft (the guide reads it).
    edited: (editing) => setPhase('prepare', { draft: effective(editing), editing: editing?.rumor ?? null }),
    initialEditor: () => {
      const e = nextEditor;
      nextEditor = null;
      if (e?.example) return e;
      return editorFits(e, draft);
    },
    stashed: () => !!villageStash,
    start: async () => {
      if (starting) return;
      starting = true;
      refresh();
      if (!(await flush())) {
        starting = false;
        return refresh();
      }
      const reply = await api.start(draft);
      if (reply.ok) {
        // The end card of this game compares its score with the try before.
        keepLastTry(lastTry);
        // A new run: the page reloads and GET state says «playing».
        reloading = true;
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        location.reload();
        return;
      }
      starting = false;
      const list = Array.isArray(reply.body?.errors) ? reply.body.errors : [];
      errors = list.length ? [...new Set(list.map((e) => fieldErrorText(e, t)))] : [fill(t.startError, { error: reply.error })];
      refresh();
    },
  };

  function go(s) {
    if (view) prepareCtx.focusNeighbor(null);
    current = s;
    // The screen in the hash: a reload (F5) comes back to it (screenOf `resume`).
    if (SCREENS.includes(s)) history.replaceState(null, '', `${location.pathname}${location.search}#${s}`);
    view = null;
    root.dataset.screen = s;
    root.classList.toggle('gm-modal', ['boot', 'menu', 'challenges', 'friend', 'games', 'error'].includes(s));
    let node;
    if (s === 'boot') node = bootScreen(ctx);
    else if (s === 'menu') node = menuScreen(ctx);
    else if (s === 'challenges') node = challengesScreen(ctx);
    else if (s === 'friend') node = friendScreen(ctx);
    else if (s === 'games') node = gamesScreen(ctx);
    else {
      view = createPrepare(prepareCtx);
      node = view.el;
    }
    root.replaceChildren(node);
    setPhase(phaseOf(s));
  }

  // --- Where we are -------------------------------------------------------------------
  let s = screenOf(state, { screen: params.screen, resume, emptyDraft: isEmptyDraft(draft) });
  if (s === 'playing' || s === 'ended') return playing(app, root, t, api, { state, draft, challengeById, setPhase, friend, profile, games, saveProfile, isTutorial: isTutorialDraft() && wantsTutorial(profile), runTutorial, guideSaved });

  // Back after a reload of a new town: the neighbors and places it lacks are dropped.
  // What it took away is said in the notes, rumor by rumor (phase 9-4), the
  // open editor included (its rumor is numbered where it would go).
  if (carry && state.state === 'waiting') {
    const fitted = norm(fitToHeader(draft, header));
    const lost = townChanges(effectiveDraft(draft, carry.editor), effectiveDraft(fitted, nextEditor?.rumor ? nextEditor : null), { names: carry.names, t });
    if (lost.length) notes = [...notes, t.townChanged, ...lost];
    if (JSON.stringify(fitted) !== JSON.stringify(draft)) {
      draft = fitted;
      await save();
    }
  }

  // A reload by the player (F5) while preparing keeps the open editor and what is set
  // aside (phase 9-5), the way a new town does; a change still waiting to be saved goes
  // with keepalive.
  const keepApi = createApi({ fetch: (url, init) => globalThis.fetch(url, { ...init, keepalive: true }) });
  addEventListener('pagehide', () => {
    if (reloading || current !== 'prepare' || !view) return;
    if (saveTimer) keepApi.preview(draft).catch(() => {});
    const editing = view.editing();
    const names = namesOf(effectiveDraft(draft, editing), header);
    leaveCarry({ village: villageStash, editor: editing, example: false, focus: null, names, race: raceStash, last: lastTry, intro: false });
  });

  // Every start of the game: the player's language and mode (the profile) instead of
  // the server's default draft; without a choice yet, the language of the page
  // (?lang=, else the browser's). Once: the page comes back with the screen in the
  // hash (a `resume`), and from then on the menu or «Más opciones» rule.
  const prefs = prefsOf(profile);
  const wantLang = prefs.lang ?? params.lang ?? ((navigator.language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en');
  const wantMode = preferredMode();
  if (state.state === 'waiting' && !resume && !carried && !params.code && isEmptyDraft(draft) && (draft.settings.lang !== wantLang || draft.settings.mode !== wantMode)) {
    draft = norm({ ...draft, settings: { ...draft.settings, lang: wantLang, mode: wantMode } });
    const reply = await api.preview(draft);
    if (reply.ok && reply.body?.town_changed) return reloadTo(s);
    if (reply.ok && reply.body?.header) header = reply.body.header;
  }

  // The cards of the neighbors wait for the timetable; it can arrive after the first paint.
  app.bus.on('timetable', () => refresh());

  if (s === 'tutorial') {
    s = 'prepare';
    if (tutorialChallenge && !isTutorialDraft()) {
      introNext = true;
      draft = norm(challengeDraftOf(tutorialChallenge));
      await save();
    }
    runTutorial(undefined, 'first');
  } else if (params.code && resume !== 'prepare' && params.screen !== 'friend') {
    // A friend's code arriving (link or «Reto del amigo»): its draft, once.
    if (friend) {
      draft = norm(friendDraft(friend));
      await save();
      s = 'prepare';
    } else {
      s = 'friend';
    }
  }
  go(s);
  aiDl.sync();
  // Back after a reload: part 1 still to show when «Tutorial» was chosen just before.
  if (s === 'prepare' && isTutorialDraft() && wantsTutorial(profile)) runTutorial(undefined, introNext ? 'first' : false);
}

/** Playing and ended: the bar, the race colours, and the card at the end. */
function playing(app, root, t, api, { state, draft, challengeById, setPhase, friend, profile, games = [], saveProfile, isTutorial, runTutorial, guideSaved = async () => true }) {
  const { lang, store } = app;
  const mode = modeOfHeader(app.header);
  const challenge = challengeById(draft.challenge);
  const title = challenge ? (challenge.title?.[lang] ?? challenge.title?.en ?? challenge.id) : t.freeGame;
  root.classList.remove('gm-modal');
  const bar = createBar({
    t,
    mode,
    title,
    onStop: state.state === 'playing' ? async () => (await api.stop()).ok : null,
    race: draft.race, // «Terminar ya» warns that a race still to come stays undecided
    events: () => store.events,
    // The goal near the clock and what the first rumor is waiting for (phase 9-4).
    challenge,
    draft,
    store,
    bus: app.bus,
    header: app.header,
    lang,
  });
  root.replaceChildren(bar.el);
  // The challenge and the draft go with the phase: render/ marks the subject of the challenge.
  setPhase(state.state === 'ended' ? 'ended' : 'playing', { draft, challenge: draft.challenge ?? null });
  const lastTry = readLastTry();
  if (isTutorial) runTutorial(draft, false);

  let raced = !draft.race;
  let ended = false;
  const check = () => {
    if (!raced) {
      const facts = raceFacts(store.events, draft.rumors);
      if (facts.length === 2) {
        raced = true;
        app.setRace(facts);
        bar.el.insertBefore(raceLegend({ t, lang, facts, events: store.events }), bar.el.querySelector('.gm-stop'));
      }
    }
    if (!ended && store.events.some((e) => e.type === 'end')) {
      ended = true;
      showEnd();
    }
  };

  /** «Probar con otro vecino», or null when the game had no single recipient to change. */
  function retryAction() {
    // It carries too whom it was told to and how far it went («La otra vez…», phase 9-4).
    const header = store.header ?? app.header;
    const informed = informedEnd({ header, events: store.events }).size;
    const carry = challengeLocks(challenge).to ? null : retryCarry(draft, { header, informed, lang: draft.settings?.lang ?? lang, t });
    if (!carry) return null;
    return async () => {
      // POST reset keeps the engine's draft; the carry reopens its rumor without recipients.
      await guideSaved();
      await api.reset();
      leaveCarry(carry);
      reloadTo('prepare');
    };
  }

  function showEnd() {
    bar.ended();
    setPhase('ended');
    const id = state.game?.id ?? null;
    const game = { id, settings: draft.settings, rumors: draft.rumors, challenge: draft.challenge, bets: draft.bets, race: draft.race };
    const card = createEndCard({
      t,
      lang,
      log: { header: store.header ?? app.header, events: store.events },
      game,
      challenge,
      mode,
      fact: app.factId(),
      friendCode: friend ? app.params.code : null,
      lastTry,
      // The games before, for «Tu mejor marca en este pueblo» (endview.js drops this one by id).
      past: { games, marks: profile?.games ?? {}, challenges: state.challenges ?? [] },
      // The jobs' timetable: the hint to do better can say «donde hay mucha gente».
      timetable: app.timetable ?? null,
      // The web version offers the download of Con IA at the end too (phase 10).
      download: state.platform === 'web' ? aiHowTo({ t, web: true }, 'gm-how') : null,
      actions: {
        // «Probar con otro vecino»: the same town and rumor, the editor open on whom to tell first.
        retry: retryAction(),
        again: async () => {
          await guideSaved();
          await api.reset();
          reloadTo('prepare');
        },
        newGame: async () => {
          await guideSaved();
          await api.reset({ clear: true });
          reloadTo('menu', `?play=1&lang=${lang}`);
        },
        onScored: async ({ score, stars, status }) => {
          if (!id) return;
          try {
            const fresh = await api.profile();
            const next = updateProfile(fresh.ok ? fresh.body : profile, { id, challenge: draft.challenge, mode, score, stars });
            status.textContent = (await saveProfile(next)) ? t.saved : t.notSaved;
          } catch {
            status.textContent = t.notSaved;
          }
        },
      },
    });
    root.append(card.el, card.pill);
    // The neighbor the card advised: the next free game in this village proposes them.
    const town = (store.header ?? app.header)?.seed ?? null;
    writeJson(TIP_KEY, card.recommended ? { town, id: card.recommended } : null);
  }

  store.subscribe((change) => {
    if (change.type === 'append') check();
  });
  check();
}

/** The replay of a played game (?game=<id>&log=…): bar, race colours, card at the end. */
function startReplay(app, root, t, api) {
  const { params, lang, store } = app;
  const mode = modeOfHeader(app.header);
  const back = `?play=1&lang=${lang}#games`;
  let card = null;
  let game = null;
  let challenge = null;
  const open = el('button', { type: 'button', class: 'gm-btn gm-primary', text: t.yourGame, onclick: () => showCard() });
  // «Abriendo la partida…» until its data is read; then «Partida jugada · Reto».
  const bar = createBar({ t, mode, title: t.replayOpening, extra: [open, el('a', { class: 'gm-btn', href: back, text: t.backToGame })] });
  root.append(bar.el);

  let past = null;
  const ready = (async () => {
    try {
      const res = await fetch(`games/${encodeURIComponent(params.game)}.game.json`, { cache: 'no-store' });
      if (res.ok) game = await res.json();
    } catch (err) {
      console.warn('game: no game data for the replay', err);
    }
    const [st, gamesReply, profileReply] = await Promise.all([loadState(api), api.games(), api.profile()]);
    challenge = st.ok ? ((st.state.challenges ?? []).find((c) => c?.id === game?.challenge) ?? null) : null;
    past = {
      games: gamesReply.ok && Array.isArray(gamesReply.body?.games) ? gamesReply.body.games : [],
      marks: normalizeProfile(profileReply.ok ? profileReply.body : null).games,
      challenges: st.ok ? (st.state.challenges ?? []) : [],
    };
    const name = challenge ? (challenge.title?.[lang] ?? challenge.title?.en ?? challenge.id) : t.gameFree;
    bar.el.querySelector('.gm-bar-title').textContent = `${t.replayOf} · ${name}`;
  })();

  function showCard() {
    if (card) {
      card.el.hidden = false;
      card.pill.hidden = true;
      return;
    }
    const g = game ?? { id: params.game, settings: {}, rumors: [], challenge: null, bets: null, race: null };
    card = createEndCard({
      t,
      lang,
      log: { header: store.header ?? app.header, events: store.events },
      game: g,
      challenge,
      mode,
      fact: app.factId(),
      friendCode: null,
      // No «Probar con otro vecino» before a replay; the games before, as at the end of a game.
      lastTry: null,
      past,
      timetable: app.timetable ?? null,
      actions: { back },
    });
    root.append(card.el, card.pill);
  }

  // The race colours once loaded; the card the first time playback crosses the end.
  let endTick = null;
  let lastPos = null;
  app.bus.on('loaded', async () => {
    await ready;
    if (game?.race) {
      const facts = raceFacts(store.events, game.rumors);
      if (facts.length === 2) app.setRace(facts);
    }
    endTick = store.events.find((e) => e.type === 'end')?.tick ?? null;
  });
  app.onFrame(() => {
    if (endTick !== null && lastPos !== null && lastPos < endTick && store.pos >= endTick && !card) showCard();
    lastPos = store.pos;
  });
}
