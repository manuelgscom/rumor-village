// The tutorial on screen (phase 9, package F; 9-3, 9-4, 9-5). Two parts:
// «Cómo funciona» (howtoview.js, eight cards without interaction) and «Tu
// primera partida», here: a small card in the look of the story mode (tr-* of
// story.css) and a ring around what to press. The chapters are pure
// (tutorial.js); this file only reads the page and the bus, and draws.
//
//   startTutorial(app, {intro})
//     'first' ─► Cómo funciona ─► Tu primera partida        (ctx.tutorial)
//     'only'  ─► Cómo funciona ─► onDone({intro: true})     (ctx.howto: back to the menu, not seen)
//     false   ─► Tu primera partida                         (a reload; the default)
//
//   ┌ .tu-root ─────────────────────────────────────────┐
//   │ TUTORIAL  Con IA  Tu primera partida · Paso 2 de 7 × │   × = fold the card
//   │ ¿Qué ha pasado?                                    │
//   │ Escribe el rumor como lo dirías en la calle…       │
//   │ ● ● ○ ○ ○ ○ ○ ○  [Señálamelo] [Seguir sin guía] [Siguiente]
//   └────────────────────────────────────────────────────┘
//            ╭───────────╮
//            │ (target)  │  .tu-ring: [data-gm=…], a zone or a neighbor
//            ╰───────────╯
//
//   folded:  ( Guía )   the pill opens the card again on the same step; nothing
//                       is saved and the guide goes on underneath
//
// «Señálamelo» moves the focus to the control the ring points at (its first
// focusable control when the target itself is not one). «Seguir sin guía»
// leaves the guide and marks it as seen. On a phone (≤600 px, no side columns)
// «Ver qué decidió» opens a reading panel inside the card itself (who, when,
// what reached them and what they hold now) with «Volver al paso»; the
// neighbor stays selected.
//
// The game package calls startTutorial(app, {api, onDone, phase, draft, intro})
// when the player chooses the tutorial or «Cómo se juega», and again after
// every reload while the profile wants it (the page reloads after «Empezar»),
// then with intro false. Part 1 never marks the tutorial as seen; «Saltar
// explicación» goes on to part 2 ('first') or back to the menu ('only').
// Nothing is kept in
// the browser: the chapter comes back from the game phase, the draft and the
// log. From the last chapter on («¿Y con otro vecino?»), or with «Seguir sin
// guía», POST /profile gets `tutorial_seen: true` and loses `tutorial_guided`
// (read-modify-write of the whole profile).
//
// Reads: bus 'game' {phase, draft?, editing?} (while preparing, draft is the
// effective draft: what «Empezar» would start), bus 'select', app.store (the
// log as far as it is applied, store.index; the whole log at the end, for the
// first exchange when it was never played back), GET /state once (phase, draft
// and mode after a reload), and every frame the [data-gm] elements (a target
// may not be there yet: the ring waits for it; it is scrolled into view once
// per chapter). The first exchange is kept once seen: going back in the
// playback does not take it away from the card.
// Writes: app.ui.only(zones of the chapter), <html data-tutorial="<key>">
// while it runs, the camera once in «Alguien se ha enterado» (app.story.fly to who heard
// it), and bus 'select' + 'inspect' {neighbor, turn} from «Ver qué decidió».

import { clockOf } from '../core/clock.js';
import { pick } from '../core/lang.js';
import { neighborName } from '../core/names.js';
import { versionOf } from '../core/version.js';
import { factSentence, firstOfRow, placeWithArticle, rumorIssues } from '../game/prepare.js';
import { createApi } from '../live/api.js';
import { HEAD } from '../scene/world/plan.js';
import { introOf } from './howto.js';
import { showHowto } from './howtoview.js';
import { fill } from './phrase.js';
import { STRINGS } from './strings.js';
import {
  BASE_ZONES,
  tutorialAdvance,
  tutorialChapterAt,
  tutorialChapters,
  tutorialHolds,
  tutorialShowsNext,
  tutorialEntry,
  tutorialFacts,
  tutorialFocus,
  tutorialLeft,
  tutorialNext,
  tutorialResult,
  tutorialStory,
  tutorialTargets,
  SEEN_FROM,
  withTutorialSeen,
} from './tutorial.js';

/** Room around a highlighted element, in px. */
const PAD = 6;
/** Radius of the ring around a neighbor, in px. */
const NEIGHBOR_R = 28;
/** Names written out in a list before the rest is counted («Luis, Ana, Inma y 4 más»). */
const LIST_MAX = 4;

/** What can take the focus, for «Señálamelo». */
const FOCUSABLE = 'button, input, select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])';
/** Phones: the side columns are hidden, the decision is read inside the card. */
const NARROW = '(max-width: 600px)';

/** The running guide: one per page. */
let running = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function segs(parent, list) {
  for (const s of list) parent.append(s.strong ? el('b', '', s.text) : document.createTextNode(s.text));
  return parent;
}

/** The rectangle of an element on screen, or null when it is not shown. */
function shown(node) {
  if (!node?.isConnected) return null;
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/** The node itself when it takes the focus, else its first control that does. */
function focusTarget(node) {
  const ok = (n) => !n.disabled && !!shown(n);
  if (node.matches(FOCUSABLE) && ok(node)) return node;
  return [...node.querySelectorAll(FOCUSABLE)].find(ok) ?? null;
}

/** The engine phase of GET /state as a game phase, or null while waiting (boot, menu or prepare). */
function phaseOfState(state) {
  return state === 'playing' || state === 'ended' ? state : null;
}

/** The mode the game is played in: the draft's, else the run's (header.policy). */
function modeOf(app, draft) {
  const m = draft?.settings?.mode;
  if (m === 'ai' || m === 'rules') return m;
  return app.header?.policy === 'baseline' ? 'rules' : 'ai';
}

/**
 * Starts the tutorial. A second call while it runs returns the same one.
 * @param {object} app see viewer/js/core/app.js
 * @param {{api?: ReturnType<typeof createApi>,
 *   onDone?: (r: {skipped?: boolean, saved?: Promise<boolean>, intro?: boolean}) => void,
 *   phase?: string|null, draft?: object|null, intro?: 'first'|'only'|false}} [opts]
 *   phase and draft: what the game package knows when it calls; intro: see
 *   the top of the file (anything else is false). onDone: {skipped, saved}
 *   when part 2 ends (saved: the profile save), {intro: true} when part 1
 *   ends alone ('only'); closing during part 1 of 'first' says {skipped: true}
 * @returns {{close: () => void, active: () => boolean, chapter: () => string|null, saving: () => Promise<boolean>}}
 *   chapter: 'howto' during part 1
 */
export function startTutorial(app, opts = {}) {
  if (running?.active()) return running;
  const intro = introOf(opts.intro);
  const onDone = opts.onDone ?? (() => {});
  let guide = null;
  let howto = null;
  // What the game says while part 1 is on screen, for part 2 when it starts.
  const latest = { phase: opts.phase ?? null, draft: opts.draft ?? null };
  const offGame = intro
    ? app.bus.on('game', (p = {}) => {
        if (typeof p.phase === 'string') latest.phase = p.phase;
        if (p.draft && typeof p.draft === 'object') latest.draft = p.draft;
      })
    : null;
  const toGuide = () => {
    if (typeof offGame === 'function') offGame();
    guide = startGuide(app, { ...opts, ...latest });
  };
  const handle = {
    close: () => {
      if (guide) return guide.close();
      if (!howto?.active()) return;
      howto.close();
      if (typeof offGame === 'function') offGame();
      app.ui.only(null);
      onDone(intro === 'only' ? { intro: true } : { skipped: true, saved: Promise.resolve(false) });
    },
    active: () => (guide ? guide.active() : !!howto?.active()),
    chapter: () => (guide ? guide.chapter() : howto?.active() ? 'howto' : null),
    saving: () => (guide ? guide.saving() : Promise.resolve(true)),
  };
  running = handle;
  if (!intro) {
    toGuide();
    return handle;
  }
  howto = showHowto(app, {
    intro,
    mode: modeOf(app, opts.draft),
    draft: opts.draft ?? null,
    onEnd: () => {
      if (intro === 'only') {
        if (typeof offGame === 'function') offGame();
        app.ui.only(null);
        return onDone({ intro: true });
      }
      // Part 2 uncovers what its chapter needs; meanwhile the game screens come back.
      app.ui.only(BASE_ZONES);
      toGuide();
    },
  });
  return handle;
}

/**
 * Part 2, «Tu primera partida».
 * @param {object} app
 * @param {{api?: ReturnType<typeof createApi>, onDone?: Function, phase?: string|null, draft?: object|null}} opts
 */
function startGuide(app, { api = createApi(), onDone = () => {}, phase = null, draft = null } = {}) {
  const { bus, store, header } = app;
  const t = pick(STRINGS, app.lang).tutorial;
  const root = document.documentElement;
  const narrowMq = window.matchMedia?.(NARROW) ?? null;
  const narrow = () => !!narrowMq?.matches;
  const inspect = !!app.zones?.inspect;

  let active = true;
  let dirty = true;
  let saved = null; // the promise of the profile save, once started
  let k = -1;
  let shownKey = null;
  let shownMode = null;
  let shownSig = null; // what the card says, to draw it again only when it changes
  let log = []; // the events applied (store.index), taken again when the store moves
  let facts = null; // tutorialFacts of that log
  let seenIndex = -1;
  let seenLength = -1;
  let flown = false; // the camera went to who heard it first
  let directorBack = false; // the flight switched the automatic camera off: on again after the step
  let watchShot = null; // whom «Míralo correr» framed last
  let holding = false; // the guide paused the village
  let selfPause = false; // our own 'pause' on the bus
  let resumedOn = null; // the step on which the player resumed it by hand
  let kept = null; // the first exchange (tutorialFacts().heard), kept once seen
  let ready = false; // GET /state answered: the first chapter can be chosen
  let statePhase = null;
  let stateMode = null;
  // picked: a neighbor selected; reading: the reading panel of a phone;
  // folded: the card put away behind the pill.
  // summary: the summary of the day is open; byOpenSummary: it folded the card;
  // thinkSeen: a «¿Qué pensó?» was opened in the game; parked: «Siguiente» of
  // «¿Qué pensó?» folded the card until the end; groups: «Quién va a ir» is on screen.
  const ui = { picked: false, reading: false, folded: false, summary: false, byOpenSummary: false, thinkSeen: false, parked: false, groups: false };
  let lockedDecision = null; // the decision «¿Qué pensó?» shows, fixed once the step opens
  let scrolled = null; // the chapter (and its missing state) whose target was scrolled into view
  let goNode = null; // what «Señálamelo» focuses
  const offs = [];

  // ── Card and ring ──────────────────────────────────────────────────
  const box = el('div', 'tu-root');
  const card = el('div', 'tr-card tu-card');
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', t.label);
  card.setAttribute('aria-live', 'polite');
  const top = el('div', 'tr-top');
  const modeTag = el('span', 'tr-who');
  const stepTag = el('span', 'tu-step');
  top.append(el('span', 'tr-label', t.label), modeTag, stepTag);
  const x = el('button', 'tr-x', '×');
  x.type = 'button';
  x.title = t.fold;
  x.setAttribute('aria-label', t.fold);
  x.setAttribute('aria-expanded', 'true');
  const title = el('h2', 'tr-title');
  title.tabIndex = -1;
  const body = el('div', 'tr-body');
  const nav = el('div', 'tr-nav');
  const dots = el('div', 'tr-dots');
  dots.setAttribute('aria-hidden', 'true'); // «Paso n de m» says it in words
  const bGo = el('button', 'tr-explore tu-go', t.goTo);
  bGo.type = 'button';
  bGo.hidden = true;
  const bSkip = el('button', 'tr-explore tu-skip', t.skip);
  bSkip.type = 'button';
  bSkip.title = t.skipTitle;
  const bNext = el('button', 'tr-explore last tu-next', t.next);
  bNext.type = 'button';
  nav.append(dots, bGo, bSkip, bNext);
  card.append(top, x, title, body, nav);
  // «Ver qué decidió», in the body of «¿Qué pensó?», and «Volver al paso» of the reading panel.
  const bDecide = el('button', 'tr-explore last tu-decide', t.decide);
  bDecide.type = 'button';
  const bBack = el('button', 'tr-explore tu-back', t.back);
  bBack.type = 'button';
  // The folded card: a pill that opens it again.
  const pill = el('button', 'tu-pill', t.unfold);
  pill.type = 'button';
  pill.title = t.unfoldTitle;
  pill.setAttribute('aria-label', t.unfoldTitle);
  pill.hidden = true;
  box.append(card, pill);
  box.hidden = true;
  const ring = el('div', 'tu-ring');
  ring.hidden = true;
  document.body.append(ring, box);

  // ── Facts and chapters ─────────────────────────────────────────────
  const modeNow = () => {
    const m = draft?.settings?.mode;
    if (m === 'ai' || m === 'rules') return m;
    return stateMode ?? modeOf(app, null);
  };
  let mode = modeNow();
  let chapters = tutorialChapters({ mode, inspect });
  // 'boot' is said again after every reload: the engine's state knows better then.
  const phaseNow = () => (phase && phase !== 'boot' ? phase : (statePhase ?? phase));
  const input = () => ({ phase: phaseNow(), draft, log, mode, inspect });

  const update = () => {
    if (!ready) return;
    dirty = false;
    // Only what is on screen: live, the newest events wait for the playback.
    if (store.index !== seenIndex || store.events.length !== seenLength) {
      seenIndex = store.index;
      seenLength = store.events.length;
      log = store.events.slice(0, store.index);
    }
    const m = modeNow();
    if (m !== mode) {
      // Same chapter after a change of mode (the table differs only in «Siguiente»).
      const key = chapters[k]?.key;
      mode = m;
      chapters = tutorialChapters({ mode, inspect });
      k = Math.max(0, chapters.findIndex((c) => c.key === key));
    }
    facts = tutorialFacts(input());
    if (!kept && facts.heard) kept = facts.heard;
    const derived = tutorialChapterAt(input());
    k = k < 0 ? tutorialEntry(chapters, derived) : tutorialAdvance(chapters, k, derived);
    if (tutorialLeft(chapters, k, phaseNow())) return finish(false);
    if (k >= chapters.findIndex((c) => c.key === SEEN_FROM)) save();
    show();
  };

  // ── Drawing ────────────────────────────────────────────────────────
  const nameOf = (id) => neighborName(header, id);

  const listFormat = (() => {
    try {
      return new Intl.ListFormat(app.lang, { type: 'conjunction' });
    } catch {
      return null;
    }
  })();

  /** Neighbors' names as a list of segments, the names in bold: «Luis, Ana y 4 más». */
  const listOf = (ids) => {
    const names = ids.map(nameOf);
    if (names.length > LIST_MAX) names.splice(LIST_MAX - 1, Infinity, t.story.more.replace('{n}', names.length - LIST_MAX + 1));
    if (!listFormat) return [{ text: names.join(', '), strong: true }];
    return listFormat.formatToParts(names).map((p) => ({ text: p.value, strong: p.type === 'element' }));
  };

  const timeOf = (tick) => clockOf(tick, header?.start_weekday ?? 0, app.lang).time;

  /** The neighbors the player told the rumor to (its injects), in a log. */
  const toldByPlayer = (events, fact) => [...new Set(events.filter((e) => e.type === 'inject' && e.fact === fact).flatMap((e) => e.to ?? []))];

  /** The version a neighbor holds now (as far as the log is shown), or null. */
  const versionNow = (who) => {
    const fact = facts?.fact;
    const inj = log.find((e) => e.type === 'inject' && e.fact === fact);
    return inj ? versionOf(store.state?.neighbors?.get?.(who)?.memory?.[fact], inj.slots) : null;
  };

  /** «Carmen se lo contó a Luis a las 12:13: le llegó intacto.» (or incomplete, or distorted) */
  const exchangeLine = (h) => ({
    tpl: h.how === 'distorted' ? t.story.exchangeDistorted : h.how === 'incomplete' ? t.story.exchangeIncomplete : t.story.exchange,
    values: { from: nameOf(h.from), name: nameOf(h.who), time: timeOf(h.tick) },
  });

  /** The end: how many heard about it and who moved it most; and, if someone told it distorted, the guessing game. */
  const endLines = () => {
    const r = tutorialResult(store.events, facts?.fact ?? null);
    if (!r) return [];
    const values = { n: r.informed, total: header?.neighbors?.length ?? 0 };
    const out = [r.top ? { tpl: t.story.result, values: { ...values, name: nameOf(r.top) } } : { tpl: t.story.resultAlone, values }];
    if (r.distorted) out.push({ tpl: t.story.resultChanged, values: {} });
    return out;
  };

  /** What «Empezar» will do: «Ana se enterará al empezar. Una fiesta en la plaza, hoy a las 12:00.» */
  const impliesLines = () => {
    const settings = draft?.settings ?? {};
    const r = (Array.isArray(draft?.rumors) ? draft.rumors : []).find((x) => rumorIssues(x, settings).length === 0);
    const fact = r ? factSentence(r.fact, { header, lang: app.lang }) : null;
    if (!fact) return [];
    const im = t.implies;
    const at = r.at && r.at !== 'start' ? fill(im.atTime, { time: r.at }) : [{ text: im.atStart }];
    const to = r.to ?? {};
    if (typeof to.place === 'string' && to.place) return [{ tpl: im.place, values: { place: placeWithArticle(header, to.place, app.lang), at, fact } }];
    let ids = Array.isArray(to.neighbors) ? to.neighbors : [];
    if (!ids.length && settings.type === 'telephone') ids = [firstOfRow(header)].filter(Boolean);
    if (!ids.length) return [];
    return [{ tpl: ids.length > 1 ? im.many : im.one, values: { to: listOf(ids), at, fact } }];
  };

  /**
   * The summary of «¿Qué pensó?», in two parts with their tags: then (what
   * reached the neighbor, and when) and now (what they hold and to whom they told it).
   */
  const storyLines = (who) => {
    const s = t.story;
    const name = nameOf(who);
    const out = [];
    const { received, told } = tutorialStory(log, who, facts?.fact ?? null);
    if (received) {
      out.push({ tpl: s.then, values: { time: timeOf(received.tick) }, tag: true });
      if (received.from === null) out.push({ tpl: s.receivedYou, values: { name } });
      else {
        const tpl = received.how === 'distorted' ? s.receivedDistorted : received.how === 'incomplete' ? s.receivedIncomplete : s.received;
        out.push({ tpl, values: { name, from: nameOf(received.from) } });
      }
    }
    out.push({ tpl: s.now, values: {}, tag: true });
    const v = versionNow(who);
    if (v) out.push({ tpl: v === 'correct' ? s.nowCorrect : v === 'incomplete' ? s.nowIncomplete : s.nowWrong, values: {} });
    if (!facts?.heard) {
      // Nobody heard it from a neighbor yet: it got as far as the player told it.
      const ids = toldByPlayer(log, facts?.fact);
      out.push(ids.length > 1 ? { tpl: s.aloneMany, values: { list: listOf(ids) } } : { tpl: s.alone, values: { name } });
      return out;
    }
    const changed = told.filter((x) => !x.intact).map((x) => x.to);
    const list = listOf(told.map((x) => x.to));
    if (!told.length) out.push({ tpl: s.toldNone, values: {} });
    else if (!changed.length) out.push({ tpl: s.told, values: { list } });
    else if (changed.length === told.length) out.push({ tpl: s.toldChanged, values: { list } });
    else out.push({ tpl: s.toldMixed, values: { list, changed: listOf(changed) } });
    return out;
  };

  /**
   * What the card says now, as plain data: title, lead (lines before the
   * paragraphs), paras, decide (the «Ver qué decidió» line), lines (the
   * summary under it) and reading (the reading panel of a phone instead).
   */
  const content = () => {
    const ch = chapters[k];
    const values = {};
    const { missing } = tutorialTargets(ch, facts);
    let raw = t.body[ch.key];
    let heading = t.title[ch.key];
    let variant = mode;
    let lead = [];
    let lines = [];
    let decide = null;
    let reading = false;
    if (missing) {
      // The type is missing (Sin IA «Siguiente» skipped it, or it was cleared): say so.
      raw = t.body.missing;
      heading = t.title.missing;
    } else if (ch.key === 'start') {
      lead = impliesLines();
    } else if (ch.key === 'heard') {
      variant = kept ? 'known' : 'wait';
      // Nobody has told it yet: the title says what to wait for.
      if (!kept) heading = t.title.heardWait;
      if (kept) lead = [exchangeLine(kept)];
    } else if (ch.key === 'think' && ui.thinkSeen && !(ui.reading && narrow())) {
      // A «¿Qué pensó?» was opened: the step lets the game run to the end.
      raw = t.body.thinkSeen;
    } else if (ch.key === 'think') {
      // The neighbor of the step stays the same while it is open (the log moves on).
      if (!lockedDecision && facts?.decision) lockedDecision = facts.decision;
      const d = lockedDecision;
      values.name = d ? nameOf(d.who) : t.someone;
      if (d) {
        decide = { who: d.who, at: d.turn !== null ? { tpl: t.story.decidedAt, values: { time: timeOf(d.tick) } } : null };
        lines = storyLines(d.who);
        // A phone has no side columns: the decision is read in the card.
        reading = ui.reading && narrow();
        if (reading) heading = nameOf(d.who);
      }
    } else if (ch.key === 'retry') {
      lead = endLines();
    } else if (ch.key === 'watch') {
      // «Quién va a ir» (package rumor, #side) on screen: what it is; the village held: say so.
      raw = [...(Array.isArray(raw) ? raw : raw[variant]), ...(ui.groups ? t.body.watchGroups : []), ...(holding ? t.body.watchHeld : [])];
    }
    const paras = Array.isArray(raw) ? raw : raw[variant];
    const seen = ch.key === 'think' && ui.thinkSeen;
    return { key: ch.key, mode, seen, heading, lead, paras: reading ? [] : paras.map((tpl) => ({ tpl, values })), decide, lines: decide && narrow() && !reading ? [] : lines, reading };
  };

  /** The guide takes the camera to some neighbors; the automatic camera comes back after the step. */
  const flyTo = (ids) => {
    const story = app.story;
    if (!ids.length || !story?.fly || !story.viewOf) return;
    if (story.director) {
      directorBack = true;
      story.setDirector?.(false);
    }
    story.fly(() => story.viewOf({ kind: 'pair', ids, zoom: 4.6 }), true, !!app.reducedMotion?.());
  };

  /** Draws the card when what it says changed; flies to the first encounter, then to who heard it, once each. */
  const show = () => {
    const c = content();
    const sig = JSON.stringify(c);
    if (sig !== shownSig) render(c, sig);
    // «Míralo correr»: the encounter the headline tells (or who heard it from the player).
    if (c.key === 'watch') {
      const ids = tutorialFocus(facts, log);
      const key = ids.join(',');
      if (key && key !== watchShot) {
        watchShot = key;
        flyTo(ids);
      }
    }
    const who = kept?.who;
    if (c.key === 'heard' && who && !flown) {
      flown = true;
      flyTo([who]);
    }
  };

  const line = (l, cls) => segs(el('p', l.tag ? 'tu-tag' : cls), fill(l.tpl, l.values));

  const render = (c, sig) => {
    const ch = chapters[k];
    shownSig = sig;
    box.hidden = false;
    card.hidden = ui.folded;
    pill.hidden = !ui.folded;
    title.textContent = c.heading;
    body.replaceChildren(...c.lead.map((l) => line(l, 'tr-text')), ...c.paras.map((p) => segs(el('p', 'tr-text'), fill(p.tpl, p.values))));
    if (c.decide && c.reading) {
      if (c.decide.at) body.append(line(c.decide.at, 'tr-text'));
    } else if (c.decide) {
      const p = el('p', 'tr-text tu-decide-row');
      p.append(bDecide);
      if (c.decide.at) segs(p.appendChild(el('span', 'tu-when')), fill(c.decide.at.tpl, c.decide.at.values));
      body.append(p);
    }
    for (const l of c.lines) body.append(line(l, 'tr-text tu-hint'));
    if (c.reading) {
      const p = el('p', 'tr-text');
      p.append(bBack);
      body.append(p);
    }
    // «Siguiente» also comes to «¿Qué pensó?» once one was opened (tutorial.js tutorialShowsNext).
    bNext.hidden = !tutorialShowsNext(ch, { thinkSeen: ui.thinkSeen });
    if (ch.key === shownKey && mode === shownMode) return;
    if ((shownKey === 'heard' || shownKey === 'watch') && ch.key !== shownKey) giveCameraBack();
    // The end: the card put away after «¿Qué pensó?» comes back.
    if (ch.key === 'retry' && ui.parked) {
      ui.parked = false;
      if (ui.folded) fold(false, false);
    }
    // «¿Qué pensó?» starts on the map, whatever was picked while exploring.
    if (ch.key === 'think' && shownKey !== 'think') {
      ui.picked = false;
      ui.reading = false;
    }
    shownKey = ch.key;
    shownMode = mode;
    modeTag.replaceChildren(el('b', '', t.mode[mode]));
    stepTag.textContent = t.step.replace('{n}', k + 1).replace('{total}', chapters.length);
    dots.replaceChildren(
      ...chapters.map((other, i) => {
        const d = el('span', i === k ? 'tr-dot on' : i < k ? 'tr-dot done' : 'tr-dot');
        d.title = `${t.step.replace('{n}', i + 1).replace('{total}', chapters.length)} · ${t.title[other.key]}`;
        return d;
      }),
    );
    bNext.textContent = ch.last ? t.done : t.next;
    // The end hands over to the end card: «Listo» is a secondary button there.
    bNext.classList.toggle('last', !ch.last);
    bSkip.hidden = !!ch.last;
    box.dataset.chapter = ch.key;
    root.dataset.tutorial = ch.key;
    app.ui.only(ch.zones);
  };

  /** The ring around a neighbor on the map, or null when off screen. */
  const neighborRect = (who) => {
    const canvas = app.zones?.overlay;
    if (!who || !canvas) return null;
    const w = app.positionOf(who);
    const s = app.camera.toScreen(w.x, w.y, HEAD * 0.5);
    const c = canvas.getBoundingClientRect();
    if (!(s.x >= 0 && s.y >= 0 && s.x <= c.width && s.y <= c.height)) return null;
    return { x: c.left + s.x - NEIGHBOR_R, y: c.top + s.y - NEIGHBOR_R, w: 2 * NEIGHBOR_R, h: 2 * NEIGHBOR_R, round: true, bare: true };
  };

  /** The rectangle to ring for the current chapter, or null: {x, y, w, h, round, node?}. */
  const gmRect = (key) => {
    const node = document.querySelector(`[data-gm="${key}"]`);
    const r = shown(node);
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height, round: false, node } : null;
  };

  const targetRect = () => {
    const ch = chapters[k];
    for (const tg of tutorialTargets(ch, facts).targets) {
      if (tg.startsWith('gm:')) {
        const r = gmRect(tg.slice(3));
        if (r) return r;
      } else if (tg === 'freetext') {
        // Con IA: the free text while it is empty, «Rellenar la frase» once something is written.
        const area = document.querySelector('[data-gm="rumor-text"]');
        const r = gmRect(typeof area?.value === 'string' && area.value.trim() ? 'understood' : 'rumor-text');
        if (r) return r;
      } else if (tg.startsWith('zone:')) {
        const z = document.getElementById(tg.slice(5));
        const r = z?.childElementCount ? shown(z) : null;
        if (r) return { x: r.left, y: r.top, w: r.width, h: r.height, round: false };
      } else if (tg === 'listener') {
        // Nobody has heard it from a neighbor yet: no ring, the map is free to explore.
        if (!kept) return null;
        const r = neighborRect(kept.who);
        if (r) return r;
      } else if (tg === 'neighbor') {
        if (ui.picked) {
          for (const id of ['inspect', 'side']) {
            const z = document.getElementById(id);
            const r = z?.childElementCount ? shown(z) : null;
            if (r) return { x: r.left, y: r.top, w: r.width, h: r.height, round: false };
          }
          continue;
        }
        const r = neighborRect((lockedDecision ?? facts?.decision)?.who);
        if (r) return r;
      }
    }
    return null;
  };

  /**
   * The summary of the day (package summary, #summary .sm-card) open over the
   * card: the card folds into the pill while it stays open, and comes back
   * when it closes, if it was this that folded it.
   */
  const followSummary = () => {
    // The small card (#summary .sm-card) or the big one of the end of the day (.sm-final).
    const open = !!(shown(document.querySelector('#summary .sm-card')) || shown(document.querySelector('.sm-final')));
    if (open === ui.summary) return;
    ui.summary = open;
    if (open && !ui.folded) {
      ui.byOpenSummary = true;
      fold(true, false);
    } else if (!open && ui.byOpenSummary) {
      ui.byOpenSummary = false;
      if (ui.folded) fold(false, false);
    }
  };

  const place = () => {
    followSummary();
    // «Quién va a ir» shows only when the rumor sends people somewhere.
    const groups = !!shown(document.querySelector('#side .rs-groupsec'));
    if (groups !== ui.groups) {
      ui.groups = groups;
      dirty = true;
    }
    let r = targetRect();
    // Once per chapter, the control to use is brought into view (the panel scrolls).
    const key = `${chapters[k]?.key}${tutorialTargets(chapters[k], facts).missing ? ':missing' : ''}`;
    if (r?.node && scrolled !== key) {
      scrolled = key;
      r.node.scrollIntoView?.({ block: 'nearest' });
      r = targetRect();
    }
    goNode = r?.node ?? null;
    if (bGo.hidden !== !goNode) bGo.hidden = !goNode;
    if (ui.folded) r = null;
    ring.hidden = !r;
    if (r) {
      const pad = r.bare ? 0 : PAD;
      ring.style.transform = `translate(${Math.round(r.x - pad)}px, ${Math.round(r.y - pad)}px)`;
      ring.style.width = `${Math.round(r.w + 2 * pad)}px`;
      ring.style.height = `${Math.round(r.h + 2 * pad)}px`;
      ring.classList.toggle('round', r.round);
    }
    // The card leaves the lower half to a target that is down there.
    const low = !!r && r.y + r.h / 2 > window.innerHeight * 0.55;
    box.classList.toggle('tu-top', low);
  };

  // ── Profile and the end ────────────────────────────────────────────
  /** Marks the guided game as seen, once. Resolves to whether it was saved. */
  const save = () => {
    if (saved) return saved;
    saved = (async () => {
      const got = await api.profile();
      // Without the current profile, writing would wipe the stars: leave it.
      if (!got.ok) {
        console.warn(`tutorial: profile not read: ${got.error}`);
        return false;
      }
      const put = await api.saveProfile(withTutorialSeen(got.body));
      if (!put.ok) console.warn(`tutorial: profile not saved: ${put.error}`);
      return put.ok;
    })();
    return saved;
  };

  const finish = (skipped) => {
    if (!active) return;
    // Never leave the village paused, nor the automatic camera taken, nor the panels open.
    setHold(false);
    giveCameraBack();
    bus.emit('select', { neighbor: null });
    active = false;
    for (const off of offs) off?.();
    box.remove();
    ring.remove();
    delete root.dataset.tutorial;
    app.ui.only(null);
    onDone({ skipped, saved: save() });
  };

  // ── Pace and camera ────────────────────────────────────────────────
  /** Pauses or resumes the village (bus 'pause' {engine: true}: package live sends POST control). */
  const setHold = (on) => {
    if (on === holding) return;
    holding = on;
    // An ended game has nothing to resume.
    if (!on && phaseNow() === 'ended') return;
    selfPause = true;
    bus.emit('pause', { paused: on, engine: true });
    selfPause = false;
    dirty = true; // the card says the village waits
  };
  /** The automatic camera, if the guide's flight to the listener switched it off. */
  const giveCameraBack = () => {
    if (!directorBack) return;
    directorBack = false;
    app.story?.setDirector?.(true);
  };

  // ── Input ──────────────────────────────────────────────────────────
  // × folds the card (the guide goes on underneath); the pill opens it on the same step.
  // focus: by the player's hand (× or the pill); not when the summary of the day folds it.
  const fold = (on, focus = true) => {
    ui.folded = on;
    card.hidden = on;
    pill.hidden = !on;
    x.setAttribute('aria-expanded', on ? 'false' : 'true');
    if (on) ring.hidden = true;
    if (focus) (on ? pill : title).focus();
  };
  x.addEventListener('click', () => {
    ui.byOpenSummary = false;
    fold(true);
  });
  pill.addEventListener('click', () => {
    ui.byOpenSummary = false;
    ui.parked = false;
    fold(false);
  });
  bSkip.addEventListener('click', () => finish(true));
  /** Whether something else (an open panel) sits over the middle of a node. */
  const covered = (node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint?.(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && !node.contains(hit) && !hit.contains(node) && !box.contains(hit);
  };
  bGo.addEventListener('click', () => {
    const node = goNode?.isConnected ? focusTarget(goNode) : null;
    if (!node) return;
    node.scrollIntoView?.({ block: 'nearest' });
    // A panel over it (the card of a neighbor, «¿Qué pensó?»): closed first.
    if (covered(node)) {
      ui.picked = false;
      bus.emit('select', { neighbor: null });
    }
    node.focus();
  });
  bNext.addEventListener('click', () => {
    const ch = chapters[k];
    if (ch.last) return finish(false);
    if (ch.key === 'think') {
      // Seen: close the panels on the right and put the card away until the end
      // (the next step comes with the end of the game, not with «Siguiente»).
      bus.emit('select', { neighbor: null });
      ui.picked = false;
      ui.reading = false;
      ui.parked = true;
      ui.byOpenSummary = false;
      fold(true, false);
      return;
    }
    k = tutorialNext(chapters, k, tutorialChapterAt(input()));
    if (k >= chapters.findIndex((c) => c.key === SEEN_FROM)) save();
    show();
  });
  bDecide.addEventListener('click', () => {
    const d = lockedDecision ?? facts?.decision;
    if (!d) return;
    // The map selects the neighbor, then «¿Qué pensó?» opens on their decision
    // (their first tell of the rumor, else the newest one).
    // Who has not told it yet: the turn in which it reached them.
    const turn = d.turn ?? (facts?.heard?.who === d.who ? facts.heard.turn : null);
    ui.picked = true;
    bus.emit('select', { neighbor: d.who });
    // The decision by its turn id (and its tick): package inspect unfolds it and brings it into view.
    bus.emit('inspect', { neighbor: d.who, turn, tick: d.tick });
    if (!narrow()) return;
    ui.reading = true;
    show();
    bBack.focus();
  });
  bBack.addEventListener('click', () => {
    // Back to the step; the neighbor stays selected.
    ui.reading = false;
    show();
    (bDecide.isConnected ? bDecide : bNext).focus();
  });

  const on = (type, fn) => {
    const off = bus.on(type, (p) => active && fn(p ?? {}));
    offs.push(typeof off === 'function' ? off : null);
  };
  on('game', (p) => {
    if (typeof p.phase === 'string') phase = p.phase;
    if (p.draft && typeof p.draft === 'object') draft = p.draft;
    dirty = true;
  });
  // A neighbor picked moves the ring of «¿Qué pensó?» from the map to the panel;
  // picked during «¿Qué pensó?», their «¿Qué pensó?» is open: the step was seen.
  on('select', ({ neighbor }) => {
    ui.picked = !!neighbor;
    if (neighbor && chapters[k]?.key === 'think' && !ui.thinkSeen) {
      ui.thinkSeen = true;
      dirty = true;
    }
  });
  // «Ver qué decidió» (or any other «¿Qué pensó?» opened on a decision) during the game.
  on('inspect', ({ neighbor }) => {
    if (!neighbor || phaseNow() !== 'playing' || ui.thinkSeen) return;
    ui.thinkSeen = true;
    dirty = true;
  });
  // Phone ↔ wider: the summary moves between the card and the reading panel.
  if (narrowMq?.addEventListener) {
    const onNarrow = () => (dirty = true);
    narrowMq.addEventListener('change', onNarrow);
    offs.push(() => narrowMq.removeEventListener('change', onNarrow));
  }
  // The store moves every frame while playing: the facts change only with the events applied.
  offs.push(
    store.subscribe(() => {
      if (store.index !== seenIndex || store.events.length !== seenLength) dirty = true;
    }),
  );

  // The village paused while the guide waits for «Siguiente» (tutorial.js tutorialHolds).
  on('pause', ({ paused, engine }) => {
    // The player pressed play on this step: the guide does not pause it again here.
    if (selfPause || !engine || paused || !holding) return;
    holding = false;
    resumedOn = chapters[k]?.key ?? null;
    dirty = true;
  });
  // Leaving the page while held (a reload): resume, with a request that outlives the page.
  const onHide = () => {
    if (holding && phaseNow() === 'playing') createApi({ fetch: (u, init) => globalThis.fetch(u, { ...init, keepalive: true }) }).setControl({ action: 'resume' });
  };
  window.addEventListener('pagehide', onHide);
  offs.push(() => window.removeEventListener('pagehide', onHide));

  app.onFrame(() => {
    if (!active || !ready) return;
    if (dirty) update();
    if (!active) return;
    place();
    const ch = chapters[k];
    setHold(tutorialHolds(ch, { phase: phaseNow(), known: !!kept, folded: ui.folded, resumed: resumedOn === ch?.key }));
  });

  // After a reload the phase, the draft and the mode come from the engine.
  Promise.resolve(api.state())
    .then((reply) => {
      if (!reply?.ok || !reply.body) return;
      statePhase = phaseOfState(reply.body.state);
      if (!draft && reply.body.draft) draft = reply.body.draft;
      if (reply.body.ai?.available === false) stateMode = 'rules';
    })
    .catch(() => {})
    .finally(() => {
      if (!active) return;
      ready = true;
      update();
      app.requestDraw();
    });

  // saving: the profile save once started (the end card waits for it before a reload).
  return { close: () => finish(true), active: () => active, chapter: () => chapters[k]?.key ?? null, saving: () => saved ?? Promise.resolve(true) };
}
