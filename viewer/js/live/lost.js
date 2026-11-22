// Inside the game (phase 9-5): when the stream of `rumor play` is down for a
// while (the play.sh window was closed), the page says so and offers to try
// again (start/index.js showLost); once it is back, the card goes. Pure: the
// status, the timer and the two screens are given.
//
//   connecting / reconnecting ──LOST_MS──► show()
//   connected / ended ──────────────────► hide() (if shown), timer cleared
//
// A restart the page asked for («Activar Con IA», game/aidownload.js) is not
// a lost game: while expectRestart(true) holds, the timer waits again instead
// of showing the card.

/** How long the stream may be down before the page says so, in ms. */
export const LOST_MS = 4000;

let expected = false;

/**
 * The page has asked the engine to restart (it comes back on the same port):
 * the stream going down is expected until expectRestart(false).
 * @param {boolean} on
 */
export function expectRestart(on) {
  expected = !!on;
}

/**
 * Watches the connection state (live/source.js liveStatus).
 * @param {{value: string, on: (fn: (v: string) => void) => () => void}} status
 * @param {{show: () => void, hide: () => void, delay?: number,
 *   setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (t: any) => void}} o
 * @returns {() => void} stops watching
 */
export function watchLost(status, { show, hide, delay = LOST_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let shown = false;
  const on = (v) => {
    if (v === 'connected' || v === 'ended') {
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (shown) {
        shown = false;
        hide();
      }
      return;
    }
    if (timer !== null || shown) return;
    const fire = () => {
      if (expected) {
        timer = setTimer(fire, delay);
        return;
      }
      timer = null;
      shown = true;
      show();
    };
    timer = setTimer(fire, delay);
  };
  on(status.value);
  const off = status.on(on);
  return () => {
    off();
    if (timer !== null) clearTimer(timer);
  };
}
