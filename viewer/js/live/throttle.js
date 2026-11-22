// Limits the POST viewport calls: at most one every `interval` ms, and only
// when the list changed since the last one sent. The last list asked for is
// always sent in the end (trailing call). No DOM; the clock and the timer are
// given, so the tests drive them.
//
//   update(A) ─ send A
//   update(B) ┐ within the interval: wait
//   update(C) ┘ ─────────────── interval ends ─ send C (B is never sent)
//   update(C)   same as last sent: nothing

/**
 * Normal form of a list of ids: sorted, without repeats.
 * @param {Iterable<string>} ids
 * @returns {string[]}
 */
export function normalIds(ids) {
  return [...new Set(ids ?? [])].sort();
}

/**
 * Creates the limiter.
 * @param {{
 *   send: (ids: string[]) => Promise<boolean>|boolean,  true when it got there
 *   interval?: number,
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 * }} opts
 */
export function createViewportSender({ send, interval = 500, now = () => Date.now(), setTimer = setTimeout }) {
  let sentKey = null; // what the engine has
  let lastAt = -Infinity;
  let wanted = null; // the newest list asked for
  let timer = null;
  let inFlight = false;

  const fire = async () => {
    timer = null;
    if (wanted === null) return;
    const ids = wanted;
    const key = ids.join(',');
    if (key === sentKey) return;
    if (inFlight) {
      timer = setTimer(fire, interval);
      return;
    }
    inFlight = true;
    lastAt = now();
    let ok = false;
    try {
      ok = await send(ids);
    } catch {
      ok = false;
    }
    inFlight = false;
    // A newer list may have arrived meanwhile. A failed one waits for the
    // next update (no retry loop against an engine that is gone).
    if (ok) {
      sentKey = key;
      if (wanted.join(',') !== sentKey && timer === null) timer = setTimer(fire, interval);
    }
  };

  return {
    /**
     * Asks for the engine to have this list.
     * @param {Iterable<string>} ids
     */
    update(ids) {
      wanted = normalIds(ids);
      if (wanted.join(',') === sentKey || timer !== null) return;
      const wait = lastAt + interval - now();
      if (wait <= 0 && !inFlight) fire();
      else timer = setTimer(fire, Math.max(wait, 0) || interval);
    },
    /** The list the engine has, or null before the first success. */
    get sent() {
      return sentKey === null ? null : sentKey === '' ? [] : sentKey.split(',');
    },
  };
}
