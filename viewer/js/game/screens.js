// The screens around a game (phase 9-5): the menu, «Con IA y Sin IA» (the
// screen `boot`), challenges, friend's challenge and «Mis partidas». Each
// function returns an element; index.js owns the state and the actions (ctx).
//
// ctx: {t, lang, state, profile, games, aiAvailable, aiReason, mode,
//       gamesError, reloadGames(), tutorialChallenge, aiDownload (aidownload.js
//       createAiDownload: download(), activate(), note(), acting()),
//       go(screen, opts?), free(), challenge(file), friend(code), tutorial(), howto(),
//       setPreference({mode?, lang?}) (remembered in the profile; the page reloads),
//       quit() → true when closed (the closing screen is painted), false when it failed}
//
//   ┌ Rumor Village ──────────────── [Castellano|English] ┐ [menu-lang]
//   │ Cuentas un rumor a un vecino y miras cómo corre …    │
//   │ ┌ ✨ Juegas Con IA ··· [Qué cambia] ┐ [menu-mode]     │
//   │ │ La IA está entrenada … · Tu ordenador puede …     │ │
//   │ │ Quién decide: [Con IA (recomendado)] [Sin IA]     │ │ [menu-mode-pick], only with the AI
//   │ ┌ TUTORIAL (accent, wide) ─────────┐ [menu-tutorial] │
//   │ [Partida libre] [Retos] [Reto del amigo] [Mis partidas]
//   │ [Cómo se juega][menu-howto] [Con IA y Sin IA] [Cerrar el juego]
//   └──────────────────────────────────────────────────────┘

import { DOWNLOAD_URL } from '../core/links.js';
import { ASK, SHOWCASE } from '../core/showcase.js';
import { REPO_URL } from '../summary/strings.js';
import { fill } from '../rumor/strings.js';
import { downloadOf, downloadView } from './aidownload.js';
import { button, copyText, el, screen, segmented } from './dom.js';
import { measureUnit, modeLabel, starsText } from './prepare.js';
import { starsOf, starText } from './profile.js';

/**
 * The line of the computer, without figures (they stay in «Con IA y Sin
 * IA»): «Tu ordenador puede jugar Con IA (va rápido)», «… (mejor con 25
 * vecinos)», «… (va lento)», or
 * «Comprobando tu ordenador…»; null without the AI.
 */
export function computerLine(ctx) {
  const { t, state } = ctx;
  const check = state?.check ?? {};
  if (check.state === 'running') return t.pcChecking;
  if (!ctx.aiAvailable) return null;
  // «Va lento» only when Sin IA is the advice: «25 vecinos» is not slow, it
  // is what a 100-neighbor game would ask (phase 10: 11.8 decisions/s on the
  // reference card with the 3D view sharing it).
  if (check.advice === 'rules') return t.pcSlow;
  if (check.advice === 'neighbors25') return t.pc25;
  if (Number.isFinite(check.decisions_per_s)) return t.pcFast;
  return t.pcAi;
}

/** «Tu ordenador: tarjeta gráfica compatible, 13,5 decisiones por segundo» (the detail), or null. */
function computerDetail(ctx) {
  const { t, state } = ctx;
  const check = state?.check ?? {};
  let pc;
  if (check.state === 'running') pc = t.teamChecking;
  // The block of the download says what is missing.
  else if (downloadOfCtx(ctx)) return null;
  else if (!ctx.aiAvailable) return `${capital(ctx.aiReason || t.teamNoAi)}.`;
  else if (Number.isFinite(check.decisions_per_s)) pc = fill(t.teamAi, { n: (Math.round(check.decisions_per_s * 10) / 10).toLocaleString(ctx.lang) });
  else pc = t.teamAiNoSpeed;
  return `${t.team}: ${pc}`;
}

/**
 * The card of the mode, the first thing of the menu (A2): Con IA sells what it
 * brings, Sin IA says why without jargon; each opens «Con IA y Sin IA».
 */
export function modeCard(ctx) {
  const { t } = ctx;
  const ai = ctx.mode === 'ai';
  // The downloaded game without the model: the block of the download says it all.
  const dl = ai ? null : downloadOfCtx(ctx);
  const why = ai ? t.modeCardAiText : dl ? null : !ctx.aiAvailable ? `${capital(ctx.aiReason || t.teamNoAi)}.` : t.modeCardChosen;
  const pc = computerLine(ctx);
  return el(
    'div',
    { class: `gm-mode-card gm-mode-card-${ai ? 'ai' : 'rules'}`, gm: 'menu-mode', 'data-check': ctx.state?.check?.state ?? 'none' },
    el(
      'div',
      { class: 'gm-mode-card-text' },
      el('strong', { text: ai ? t.modeCardAi : t.modeCardRules }),
      why ? el('span', { text: why }) : null,
      pc ? el('span', { class: 'gm-pc', text: pc }) : null,
      // How to get the AI, as «Con IA y Sin IA» says it: its download, when the game can.
      ctx.aiAvailable ? null : dl ? aiDownloadBlock(ctx) : aiHowTo(ctx),
      // The choice itself, here and not only in «Más opciones» (it is remembered).
      ctx.aiAvailable && ctx.setPreference ? modePick(ctx) : null,
    ),
    button(ai ? t.modeWhat : t.modeMiss, () => ctx.go('boot'), { class: 'gm-btn' }),
  );
}

/** «Quién decide: [Con IA (recomendado)] [Sin IA]» on the card of the mode. */
function modePick(ctx) {
  const { t } = ctx;
  const pick = segmented(
    [
      { value: 'ai', label: t.modeAiRecommended },
      { value: 'rules', label: t.modeRules },
    ],
    ctx.mode,
    (v) => choose(pick, () => ctx.setPreference({ mode: v })),
    { gm: 'menu-mode-pick', label: t.whoDecides },
  );
  return el('span', { class: 'gm-mode-pick' }, el('span', { class: 'gm-pc', text: `${t.whoDecides}:` }), pick);
}

/** The language of the whole game, at the head of the menu (remembered). */
function langPick(ctx) {
  const { t } = ctx;
  const pick = segmented(
    [
      { value: 'es', label: t.langEs },
      { value: 'en', label: t.langEn },
    ],
    ctx.lang,
    (v) => choose(pick, () => ctx.setPreference({ lang: v })),
    { gm: 'menu-lang', label: t.language },
  );
  return pick;
}

/** Runs a choice of a segmented row with its buttons disabled until it ends (a reload, usually). */
async function choose(row, fn) {
  const buttons = [...row.querySelectorAll('button')];
  for (const b of buttons) b.disabled = true;
  try {
    await fn();
  } finally {
    for (const b of buttons) if (b.isConnected) b.disabled = false;
  }
}

/** `ai.download` when the AI can be downloaded here (never on the web version), else null. */
function downloadOfCtx(ctx) {
  return ctx.web || ctx.aiAvailable ? null : downloadOf(ctx.state);
}

/**
 * The download of the AI (aidownload.js), in the card of the mode and in «Con
 * IA y Sin IA»: what is going on, the progress bar, the folder for the file by
 * hand, and «Descargar la IA» or «Activar Con IA». index.js draws it again in
 * place (data-gm="ai-download") while it moves; `data-view` tells whether
 * anything changed.
 */
export function aiDownloadBlock(ctx) {
  const { t, lang } = ctx;
  const ctl = ctx.aiDownload ?? null;
  const v = downloadView(downloadOfCtx(ctx), t, lang, { note: ctl?.note?.() ?? null, acting: ctl?.acting?.() ?? false });
  const copy = v.folder
    ? button(t.aiDl.copy, async () => {
        copy.textContent = (await copyText(v.folder)) ? t.aiDl.copied : t.aiDl.copyFailed;
      }, { class: 'gm-btn gm-quiet', 'data-action': 'copy' })
    : null;
  return el(
    'div',
    { class: 'gm-dl', gm: 'ai-download', 'data-dl': v.state, 'data-view': JSON.stringify(v) },
    v.lines.map((line, i) => el('span', { class: i ? 'gm-pc' : 'gm-dl-line', text: line })),
    v.progress ? el('progress', { class: 'gm-dl-bar', max: 100, value: v.progress.value, 'aria-label': v.progress.label, text: `${v.progress.value} %` }) : null,
    v.folder ? el('span', { class: 'gm-dl-folder' }, el('code', { text: v.folder }), copy) : null,
    v.hint ? el('span', { class: 'gm-pc', text: v.hint }) : null,
    v.action
      ? button(v.actionLabel, () => ctl?.[v.action]?.(), { class: 'gm-btn gm-primary gm-dl-action', gm: `ai-${v.action}`, 'data-action': v.action, disabled: v.busy })
      : null,
    v.note ? el('span', { class: 'gm-error', role: 'alert', text: v.note }) : null,
  );
}

const capital = (s) => String(s ?? '').charAt(0).toLocaleUpperCase() + String(s ?? '').slice(1);

/**
 * How to get Con IA when it is not available: the text, and on the web version
 * the button «Descárgalo para jugar Con IA» (the download page of phase 11,
 * else the repository).
 */
export function aiHowTo(ctx, cls = 'gm-pc') {
  const { t } = ctx;
  if (!ctx.web) return el('span', { class: cls, text: t.aiHowTo });
  return el(
    'span',
    { class: cls },
    `${t.aiWebHowTo} `,
    el('a', { class: 'gm-btn gm-download', gm: 'download', href: DOWNLOAD_URL || REPO_URL, target: '_blank', rel: 'noopener', text: t.aiDownload }),
  );
}

/**
 * «Con IA y Sin IA» (the screen `boot`, from the foot of the menu): the
 * advantages of Con IA with a real exchange of a game (core/showcase.js),
 * what it costs, what Sin IA is good for, and the computer in detail.
 */
export function bootScreen(ctx) {
  const { t, lang, state } = ctx;
  const advice = state?.check?.advice;
  const adviceText = advice === 'neighbors25' ? t.adviceNeighbors25 : advice === 'rules' ? t.adviceRules : null;
  const show = SHOWCASE[lang === 'es' ? 'es' : 'en'];
  const team = computerDetail(ctx);
  const ai = el(
    'div',
    { class: 'gm-mode-col gm-mode-col-ai', 'data-on': String(ctx.mode === 'ai') },
    el('h3', {}, el('span', { text: t.modeAi }), ' ', el('span', { class: 'gm-badge', text: t.recommended })),
    el('ul', { class: 'gm-pros' }, t.aiPros.map((p) => el('li', { text: p }))),
    el('p', { class: 'gm-hint', text: t.aiCosts }),
  );
  const rules = el(
    'div',
    { class: 'gm-mode-col', 'data-on': String(ctx.mode === 'rules') },
    el('h3', { text: t.modeRules }),
    el('p', { text: t.rulesPros }),
  );
  const talk = el(
    'div',
    { class: 'gm-show' },
    el(
      'div',
      { class: 'gm-show-col' },
      el('h4', { text: t.showTalk }),
      show.talk.map((l) => el('p', { class: 'gm-bubble' }, el('b', { text: `${l.who}: ` }), l.text)),
    ),
    el(
      'div',
      { class: 'gm-show-col gm-show-rules' },
      el('h4', { text: t.showRules }),
      el('p', { class: 'gm-bubble' }, el('b', { text: `${show.rules.who}: ` }), show.rules.text),
    ),
  );
  const think = el(
    'details',
    { class: 'gm-show-think' },
    el('summary', { text: fill(t.showThink, { name: show.think.who }) }),
    el('h4', { text: t.thinkRead }),
    el('pre', { class: 'gm-think-read', text: show.think.read }),
    el('h4', { text: t.thinkDecided }),
    el('p', { text: show.think.decided }),
    el('p', { class: 'gm-hint', text: show.think.checked }),
  );
  // What only the AI does (a real exchange, core/showcase.js ASK): she had forgotten, and asks.
  const ask = ASK[lang === 'es' ? 'es' : 'en'];
  const only = el(
    'div',
    { class: 'gm-show-col gm-only-ai' },
    el('h4', { text: t.onlyAi }),
    el('p', { class: 'gm-hint', text: ask.forgot }),
    ask.talk.map((l) => el('p', { class: 'gm-bubble' }, el('b', { text: `${l.who}: ` }), l.text)),
    el('p', { class: 'gm-hint', text: ask.rules }),
  );
  const body = [
    el('div', { class: 'gm-mode-cols' }, ai, rules),
    only,
    talk,
    think,
    el('p', { class: 'gm-hint', text: show.translated || ask.translated ? `${t.showSource} ${t.showTranslated}` : t.showSource }),
    team ? el('p', { class: 'gm-team', 'data-check': state?.check?.state ?? 'none', text: team }) : null,
    adviceText ? el('p', { class: 'gm-advice', text: `${adviceText} ${t.adviceFree}` }) : null,
    // How to get it: on the web version, the download (phase 10); in the downloaded game, the AI's download.
    ctx.aiAvailable ? null : downloadOfCtx(ctx) ? el('div', { class: 'gm-advice' }, aiDownloadBlock(ctx)) : el('p', { class: 'gm-advice' }, aiHowTo(ctx, 'gm-how')),
    // Where to change it, only when there is a choice.
    ctx.aiAvailable ? el('p', { class: 'gm-hint', text: fill(t.yourMode, { mode: modeLabel(ctx.mode, t) }) }) : null,
  ];
  return screen('boot', t.modesScreenTitle, body, [button(t.back, () => ctx.go('menu'), { class: 'gm-btn gm-primary' })]);
}

/**
 * The menu: the card of the mode, «Tutorial» always first and wide, the four
 * entries, and the foot (A). «Cerrar el juego» asks first, then waits for
 * the answer: when it cannot confirm the close, the menu stays and says so.
 */
export function menuScreen(ctx) {
  const { t } = ctx;
  const entry = (gm, title, hint, onclick, cls = '') =>
    el('button', { type: 'button', class: `gm-entry ${cls}`.trim(), gm, onclick }, el('strong', { text: title }), el('span', { text: hint }));
  // Always big and first; once done it says so, and invites to see it again.
  const done = ctx.profile?.tutorial_seen === true;
  const tutorial = ctx.tutorialChallenge
    ? el(
        'button',
        { type: 'button', class: 'gm-entry gm-entry-main', gm: 'menu-tutorial', onclick: () => ctx.tutorial() },
        el('strong', {}, t.menuTutorial, done ? el('span', { class: 'gm-done', text: ` ${t.tutorialDone}` }) : null),
        el('span', { text: done ? t.tutorialAgain : t.menuTutorialHint }),
      )
    : null;

  const quitAgain = button(t.tryAgain, () => quit(), { class: 'gm-btn', gm: 'quit-again' });
  const quitFailed = el('div', { class: 'gm-quit-failed', role: 'alert' }, el('p', { class: 'gm-error', text: t.quitFailed }), quitAgain);
  quitFailed.hidden = true;
  const quitButton = button(t.quit, () => ask(true), { class: 'gm-btn gm-quiet', gm: 'quit' });
  const quitYes = button(t.quitYes, () => quit(), { class: 'gm-btn gm-primary', gm: 'quit-yes' });
  const quitNo = button(t.quitNo, () => ask(false), { class: 'gm-btn' });
  const quitAsk = el('div', { class: 'gm-quit-ask', role: 'alertdialog', 'aria-label': t.quitAsk }, el('p', { text: t.quitAsk }), el('div', { class: 'gm-actions' }, quitNo, quitYes));
  quitAsk.hidden = true;
  function ask(on) {
    quitAsk.hidden = !on;
    (on ? quitNo : quitButton).focus();
  }
  async function quit() {
    quitYes.disabled = true;
    quitAgain.disabled = true;
    let ok = false;
    try {
      ok = (await ctx.quit()) === true;
    } catch {
      ok = false;
    }
    if (ok) return; // the closing screen has replaced the menu
    quitYes.disabled = false;
    quitAgain.disabled = false;
    quitAsk.hidden = true;
    quitFailed.hidden = false;
    quitAgain.focus();
  }

  const body = [
    el('p', { class: 'gm-lead', text: t.menuLead }),
    modeCard(ctx),
    tutorial,
    el(
      'div',
      { class: 'gm-entries' },
      entry('menu-free', t.menuFree, t.menuFreeHint, () => ctx.free()),
      entry('menu-challenges', t.menuChallenges, t.menuChallengesHint, () => ctx.go('challenges')),
      entry('menu-friend', t.menuFriend, t.menuFriendHint, () => ctx.go('friend')),
      entry('menu-games', t.menuGames, t.menuGamesHint, () => ctx.go('games')),
    ),
    quitAsk,
    quitFailed,
  ];
  const foot = [
    ctx.tutorialChallenge ? button(t.menuHowto, () => ctx.howto(), { class: 'gm-btn', gm: 'menu-howto' }) : null,
    button(t.menuModes, () => ctx.go('boot'), { class: 'gm-btn' }),
    // The web version has nothing to close: the tab is the game.
    ctx.web ? null : quitButton,
    ctx.version ? el('span', { class: 'gm-version', gm: 'version', text: fill(t.version, { v: ctx.version }) }) : null,
  ];
  const node = screen('menu', t.bootTitle, body, foot);
  // The language beside the title: it is the whole game's, not one game's.
  if (ctx.setPreference) {
    const title = node.querySelector('.gm-title');
    const head = el('div', { class: 'gm-menu-head' });
    title.replaceWith(head);
    head.append(title, langPick(ctx));
  }
  return node;
}

/**
 * The challenges (without the tutorial), in order, under one line on how the
 * stars work: the intro, «Tu mejor resultado» per mode (the current one
 * marked, the one not available dimmed)
 * and what each star asks in the current mode (F).
 */
export function challengesScreen(ctx) {
  const { t, lang } = ctx;
  const list = (ctx.state?.challenges ?? []).filter((c) => c && !c.tutorial).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const rows = list.map((c) => {
    const s = starsOf(ctx.profile, c.id);
    const mode = (m) => {
      const off = m === 'ai' && !ctx.aiAvailable;
      return el(
        'span',
        { class: `gm-star-mode${m === ctx.mode ? ' on' : ''}${off ? ' off' : ''}`, title: off ? t.starsOff : undefined },
        `${modeLabel(m, t)} `,
        el('b', { class: 'gm-stars', text: starText(s[m]) }),
      );
    };
    const need = starsText(c, ctx.mode, t);
    return el(
      'li',
      { class: 'gm-challenge', 'data-id': c.id },
      el(
        'div',
        { class: 'gm-ch-text' },
        el('strong', { text: c.title?.[lang] ?? c.title?.en ?? c.id }),
        el('span', { class: 'gm-hint', text: c.intro?.[lang] ?? c.intro?.en ?? '' }),
        el('span', { class: 'gm-ch-stars' }, el('span', { text: `${t.yourStars}: ` }), mode('ai'), ' · ', mode('rules')),
        need ? el('span', { class: 'gm-ch-need', text: need }) : null,
      ),
      button(t.play, () => ctx.challenge(c), { class: 'gm-btn gm-primary' }),
    );
  });
  // How the stars work, once for the whole list (phase 9-6).
  const how = el('p', { class: 'gm-hint gm-ch-how', text: t.challengesStars });
  const body = rows.length ? [how, el('ul', { class: 'gm-list' }, rows)] : el('p', { class: 'gm-hint', text: t.noChallenges });
  return screen('challenges', t.challengesTitle, body, [button(t.back, () => ctx.go('menu'))]);
}

/** Friend's challenge: paste a code or a link. */
export function friendScreen(ctx) {
  const { t } = ctx;
  const area = el('textarea', { class: 'gm-code', rows: 4, spellcheck: false, placeholder: 'RV1-…', gm: 'friend-code', 'aria-label': t.friendHint });
  if (ctx.params?.code) area.value = ctx.params.code;
  const error = el('p', { class: 'gm-error', role: 'alert' });
  const go = () => {
    const why = ctx.friend(area.value.trim());
    if (why) error.textContent = why;
  };
  const body = [el('p', { class: 'gm-hint', text: t.friendHint }), area, error];
  return screen('friend', t.friendTitle, body, [
    button(t.back, () => ctx.go('menu')),
    button(t.friendPlay, go, { class: 'gm-btn gm-primary' }),
  ]);
}

/** A date of a game id or ISO text, short. */
function dateText(g, lang) {
  const d = new Date(g.started ?? NaN);
  if (!Number.isNaN(d.getTime())) return d.toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' });
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(g.id ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : (g.id ?? '');
}

/** «Mis partidas»: date, kind, mode, challenge and «marca: 14 enterados · ★★☆»; each opens its replay. */
export function gamesScreen(ctx) {
  const { t, lang } = ctx;
  const challenges = new Map((ctx.state?.challenges ?? []).map((c) => [c.id, c]));
  const marks = ctx.profile?.games ?? {};
  const rows = (ctx.games ?? []).map((g) => {
    const s = g.settings ?? {};
    const ch = g.challenge ? challenges.get(g.challenge) : null;
    const kind = s.type === 'telephone' ? t.typeTelephone : `${t.typeVillage} · ${fill(t.neighborsN, { n: s.neighbors ?? 25 })}`;
    const mark = marks[g.id];
    const unit = measureUnit(ch, t);
    const value = mark && mark.score !== null && mark.score !== undefined ? fill(t.gameMark, { value: mark.score, unit }).trim() : null;
    const markText = [value, Number.isInteger(mark?.stars) ? starText(mark.stars) : null].filter(Boolean).join(' · ');
    // tour=0: the story mode never opens by itself over a played game (core/params.js).
    const href = `?log=${encodeURIComponent(`games/${g.id}.jsonl`)}&game=${encodeURIComponent(g.id)}&lang=${lang}&tour=0`;
    return el(
      'li',
      { class: 'gm-game', 'data-id': g.id },
      el(
        'div',
        { class: 'gm-ch-text' },
        el('strong', { text: g.challenge ? (ch?.title?.[lang] ?? ch?.title?.en ?? g.challenge) : t.gameFree }),
        el('span', { class: 'gm-hint', text: `${dateText(g, lang)} · ${kind} · ${modeLabel(s.mode === 'rules' ? 'rules' : 'ai', t)}` }),
        markText ? el('span', { class: 'gm-ch-stars', text: markText }) : null,
      ),
      el('a', { class: 'gm-btn', href, text: t.watch }),
    );
  });
  let body;
  if (rows.length) body = el('ul', { class: 'gm-list' }, rows);
  else if (ctx.gamesError) {
    // A failed fetch is not «no games yet»: say it and offer to ask again.
    const again = button(t.tryAgain, async () => {
      again.disabled = true;
      try {
        await ctx.reloadGames();
      } catch {
        again.disabled = false;
      }
    }, { class: 'gm-btn gm-primary', gm: 'games-again' });
    body = el('div', { class: 'gm-games-failed', role: 'alert' }, el('p', { class: 'gm-error', text: t.gamesFailed }), again);
  } else body = el('p', { class: 'gm-hint', text: t.noGames });
  return screen('games', t.gamesTitle, body, [button(t.back, () => ctx.go('menu'))]);
}
