// Figures that count up or down when they change (phase 8-2, 2.14).
//
//   countAt(from, to, elapsed, dur)   pure: the integer shown `elapsed` ms in
//   createCounters(app)               DOM: set(el, n) or sync(root) over
//                                     [data-count], and frame() every frame
//
//   47 ──► 48 ──► 49 ──► 50     ease-out over COUNT_MS of app.now()
//
// The value a counter ends on is always the informative one (a function of
// state and pos); only the way there is decorative and uses app.now(). Off in
// captures (isCapture: t, paused, clock, summary…) and with reduced motion:
// the figure is written at once, so two shots of a URL are the same.

import { isCapture } from '../core/params.js';

/** Length of a count, in ms. */
export const COUNT_MS = 700;

/**
 * The integer shown `elapsed` ms after a count from `from` to `to` started.
 * @param {number} from
 * @param {number} to
 * @param {number} elapsed ms
 * @param {number} [dur] ms
 * @returns {number}
 */
export function countAt(from, to, elapsed, dur = COUNT_MS) {
  if (!(dur > 0) || !(elapsed < dur) || from === to) return to;
  if (!(elapsed > 0)) return from;
  const k = 1 - (1 - elapsed / dur) ** 3;
  return Math.round(from + (to - from) * k);
}

/**
 * Counters of one package. Elements are remembered weakly: one rebuilt by
 * morph (rumor/dom.js) keeps its count; a new one shows its figure at once.
 * @param {{params: object, now: () => number, reducedMotion: () => boolean}} app
 * @param {(n: number) => string} [format]
 */
export function createCounters(app, format = String) {
  /** @type {WeakMap<Element, {from: number, to: number, t0: number, shown: number}>} */
  const known = new WeakMap();
  /** @type {Set<Element>} */
  const running = new Set();
  const still = () => isCapture(app.params) || app.reducedMotion();

  const write = (el, n) => {
    const text = format(n);
    if (el.textContent !== text) el.textContent = text;
  };

  /**
   * Shows `n` in `el`, counting from what it showed (or from `from`, when
   * given and the element is new).
   * @param {Element} el
   * @param {number} n
   * @param {number} [from]
   */
  const set = (el, n, from) => {
    const k = known.get(el);
    if (k && k.to === n) {
      write(el, k.shown);
      return;
    }
    const start = k ? k.shown : from;
    if (start === undefined || start === n || still()) {
      known.set(el, { from: n, to: n, t0: 0, shown: n });
      running.delete(el);
      write(el, n);
      return;
    }
    known.set(el, { from: start, to: n, t0: app.now(), shown: start });
    running.add(el);
    write(el, start);
  };

  return {
    set,
    /** Forgets an element: its next figure shows at once, or counts from `from`. */
    reset(el) {
      known.delete(el);
      running.delete(el);
    },
    /**
     * Every [data-count] under root: its figure is data-count.
     * @param {Element|null} root
     */
    sync(root) {
      if (!root) return;
      for (const el of root.querySelectorAll('[data-count]')) {
        const n = Number(el.getAttribute('data-count'));
        if (Number.isFinite(n)) set(el, n);
      }
    },
    /** Advances the counts under way; call it from app.onFrame. */
    frame() {
      if (!running.size) return;
      const now = app.now();
      for (const el of running) {
        const k = known.get(el);
        if (!k) {
          running.delete(el);
          continue;
        }
        k.shown = countAt(k.from, k.to, now - k.t0);
        write(el, k.shown);
        if (k.shown === k.to) running.delete(el);
      }
    },
    /** Whether some count is under way. */
    get busy() {
      return running.size > 0;
    },
  };
}
