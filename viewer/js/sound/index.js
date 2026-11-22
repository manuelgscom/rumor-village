// Ambient sound (phase 8-2, 2.16): a murmur that grows with the open
// conversations and short taps on each tell (faithful or changed) and each
// arrival. Presentation only: it comes out of the events (sound/mix.js) and
// nothing decides from it. Everything is synthesized with WebAudio
// (sound/synth.js); there are no audio files.
//
//   button in #sound ── click ──► on/off, remembered in localStorage
//        │                         ('rumor-village.sound' = 'on' | 'off')
//        ▼
//   first gesture (the click, or any pointerdown/keydown if it was on before)
//        ▼
//   AudioContext ◄── onFrame: murmur = mixAt(store), taps = hitsBetween(prev, pos)
//                    bus 'speed' {value} (ticks/s) · bus 'pause' {paused}
//
// Muted at first. Off for good (not even the button) with embed=1 and in
// captures (isCapture). The context is suspended while muted and while the
// tab is hidden. Decorative movement of the murmur uses app.now().

import { isCapture } from '../core/params.js';
import { parseSpeed } from '../replay/playback.js';
import { hitsBetween, mixAt } from './mix.js';
import { createSynth } from './synth.js';

/** localStorage key of the choice. */
const KEY = 'rumor-village.sound';

/** Share of the murmur kept while paused: the village goes quiet, not dead. */
const PAUSED_MURMUR = 0.35;

/** Suspend the context this long after muting, once the fade is done (ms). */
const SUSPEND_AFTER_MS = 400;

const STRINGS = {
  es: { label: 'Sonido', turnOn: 'Activar el sonido', turnOff: 'Silenciar el sonido' },
  en: { label: 'Sound', turnOn: 'Turn the sound on', turnOff: 'Mute the sound' },
};

const SPEAKER = '<path d="M3 9.5h3l4.5-4v13l-4.5-4H3z"/>';
const WAVES = '<path d="M14 9.2a4 4 0 0 1 0 5.6 M16.6 6.6a7.6 7.6 0 0 1 0 10.8"/>';
const CROSS = '<path d="M14.5 9.5l5 5 M19.5 9.5l-5 5"/>';

function iconSvg(on) {
  return (
    '<svg class="snd-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    SPEAKER +
    (on ? WAVES : CROSS) +
    '</svg>'
  );
}

function loadChoice() {
  try {
    return window.localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

function saveChoice(on) {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // No storage: the choice lasts until the page closes.
  }
}

/** @param {object} app */
export function init(app) {
  const zone = app.zones.sound;
  if (!zone) return;
  zone.replaceChildren();
  if (app.params.embed || isCapture(app.params)) return;

  const t = STRINGS[app.lang] ?? STRINGS.en;
  const store = app.store;
  let on = loadChoice();
  let synth = null;
  let suspendTimer = 0;
  let speed = parseSpeed(app.params.speed).tps;
  let paused = store.live ? false : (app.params.paused ?? false);
  let prev = null; // position of the last frame heard
  let lastIndex = -1;
  let murmur = 0;
  let murmurSent = -1;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'snd-btn';
  button.setAttribute('aria-label', t.label);
  zone.append(button);

  const show = () => {
    button.innerHTML = iconSvg(on);
    button.title = on ? t.turnOff : t.turnOn;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.classList.toggle('on', on);
  };

  /** The context, created on the first gesture only. */
  const ensure = () => {
    if (synth) return synth;
    try {
      synth = createSynth();
    } catch (err) {
      console.warn('sound: WebAudio not available', err);
      synth = null;
    }
    return synth;
  };

  /** Brings the context in line with `on` and the tab. */
  const apply = () => {
    if (!synth) return;
    clearTimeout(suspendTimer);
    if (on && !document.hidden) {
      prev = null;
      murmurSent = -1;
      synth.ctx.resume().catch(() => {});
      synth.setOn(true);
    } else {
      synth.setOn(false);
      suspendTimer = setTimeout(() => synth.ctx.suspend().catch(() => {}), SUSPEND_AFTER_MS);
    }
  };

  button.addEventListener('click', () => {
    on = !on;
    saveChoice(on);
    show();
    if (on) ensure();
    apply();
  });

  // On from an earlier visit: the first gesture anywhere starts the audio
  // (browsers do not let a page start it by itself). The button handles its own.
  const firstGesture = (e) => {
    if (zone.contains(e.target)) return;
    window.removeEventListener('pointerdown', firstGesture, true);
    window.removeEventListener('keydown', firstGesture, true);
    if (!on) return;
    ensure();
    apply();
  };
  if (on) {
    window.addEventListener('pointerdown', firstGesture, true);
    window.addEventListener('keydown', firstGesture, true);
  }

  document.addEventListener('visibilitychange', apply);

  app.bus.on('speed', ({ value } = {}) => {
    if (value > 0) speed = value;
  });
  app.bus.on('pause', ({ paused: p } = {}) => {
    paused = !!p;
    murmurSent = -1;
  });

  app.onFrame(() => {
    if (!synth || !on || document.hidden) {
      prev = null;
      return;
    }
    const pos = store.pos;
    if (store.index !== lastIndex) {
      lastIndex = store.index;
      murmur = mixAt(store.events, store.index, pos, speed).murmur;
    }
    const level = paused ? murmur * PAUSED_MURMUR : murmur;
    if (level !== murmurSent) {
      murmurSent = level;
      synth.setMurmur(level);
    }
    // While paused the position only moves by seeks: they make no taps.
    if (!paused && prev !== null) for (const h of hitsBetween(store.events, prev, pos, speed)) synth.hit(h);
    prev = pos;
    synth.breathe(app.now());
  });

  show();
}
