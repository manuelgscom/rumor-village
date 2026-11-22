// Live event source (package E): EventSource on `events` (relative to the
// page: the engine serves the viewer and the stream on the same origin), with
// reconnection. Same shape as the sources of viewer/js/core/source.js:
//   {kind: 'live', start(onHeader, onEvents) → Promise}
//
//   EventSource ──message──► feed (header / event / skip / reload)
//        │                        │ events
//        │ error: it reconnects   ▼
//        │ alone, with            batcher ──one frame──► onEvents(events[])
//        │ Last-Event-ID
//        └ closed for good: a new EventSource after a pause (no Last-Event-ID:
//          line 1 comes again and tells whether it is the same run)
//
// The promise resolves at the `end` event and rejects if the stream cannot be
// read (bad header, malformed line). Another run behind the same address
// reloads the page: GET control says which run the engine serves (`run`, read
// once the header is in and again after each reconnection). The connection
// state is in `liveStatus` (index.js shows it).

import { createBatcher, createFeed } from './feed.js';

/** @typedef {'connecting'|'connected'|'reconnecting'|'ended'} LiveState */

const RETRY_MS = 2000;
const HOLD_MAX_MS = 4000;

function createStatus() {
  let value = 'connecting';
  const fns = new Set();
  return {
    /** @returns {LiveState} */
    get value() {
      return value;
    },
    /** @param {LiveState} v */
    set(v) {
      if (v === value) return;
      value = v;
      for (const fn of fns) fn(v);
    },
    /** @param {(v: LiveState) => void} fn @returns {() => void} */
    on(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}

/** Connection state of the live source of this page. */
export const liveStatus = createStatus();

const holds = [];

/**
 * Delays the first delivery of events until `promise` settles (at most a few
 * seconds). index.js uses it so that a `draft` is understood before the page
 * says it is ready (the screenshot is taken then). Call it from init(app).
 * @param {Promise<unknown>} promise
 */
export function holdFirstBatch(promise) {
  holds.push(promise);
}

function frame(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 16);
}

/**
 * Creates the live source.
 * @param {import('../core/params.js').Params} params
 * @param {{
 *   url?: string,
 *   EventSource?: typeof EventSource,
 *   fetch?: typeof fetch,
 *   reload?: () => void,
 *   schedule?: (fn: () => void) => void,
 *   status?: ReturnType<typeof createStatus>,
 *   warn?: (message: string) => void,
 * }} [opts] for the tests; the browser uses the defaults
 * @returns {import('../core/source.js').Source}
 */
export function liveSource(params, opts = {}) {
  const {
    url = 'events',
    EventSource: ES = globalThis.EventSource,
    fetch: fetchFn = (...a) => globalThis.fetch(...a),
    reload = () => location.reload(),
    schedule = frame,
    status = liveStatus,
    warn = console.warn,
  } = opts;
  const controlUrl = new URL('control', new URL(url, globalThis.location?.href ?? 'http://localhost/')).href;

  return {
    kind: 'live',
    start(onHeader, onEvents) {
      if (typeof ES !== 'function') return Promise.reject(new Error('live: this browser has no EventSource'));
      return new Promise((resolve, reject) => {
        const feed = createFeed({ warn });
        const batcher = createBatcher(onEvents, schedule);
        let es = null;
        let done = false;
        let opens = 0;
        let run = null; // the engine's run id, once known

        const finish = (err) => {
          if (done) return;
          done = true;
          es?.close();
          if (err) reject(err);
          else resolve();
        };

        let gone = false;
        const goAway = (reason) => {
          if (gone) return;
          gone = true;
          warn(`live: another run (${reason}): reloading`);
          finish();
          reload();
        };

        const readControl = async () => {
          try {
            const res = await fetchFn(controlUrl, { cache: 'no-store' });
            return res.ok ? await res.json() : null;
          } catch {
            return null; // the error handler of the stream reports it
          }
        };

        // After an automatic reconnection the ids go on from Last-Event-ID:
        // the lines that come may belong to another run, even one further on
        // (it may even send its end). The run id tells; without one (an older
        // engine), a clock going backwards. A page that has ended still goes
        // away when the run behind the address changed.
        const checkRun = async () => {
          const control = await readControl();
          if (!control) return;
          if (run !== null && typeof control.run === 'string') {
            if (control.run !== run) goAway(`run ${control.run}, was ${run}`);
          } else if (!done && Number.isInteger(control.tick) && control.tick < feed.lastTick) {
            goAway(`clock at ${control.tick}, last event at ${feed.lastTick}`);
          }
        };

        const onMessage = (ev) => {
          if (done) return;
          let action;
          try {
            action = feed.accept(ev.lastEventId, ev.data);
          } catch (err) {
            finish(err);
            return;
          }
          switch (action.kind) {
            case 'header': {
              try {
                onHeader(action.header);
              } catch (err) {
                finish(err);
                return;
              }
              readControl().then((control) => {
                if (run === null && typeof control?.run === 'string') run = control.run;
              });
              const held = holds.splice(0);
              if (!held.length) {
                batcher.open();
                break;
              }
              let timer;
              const timeout = new Promise((ok) => (timer = setTimeout(ok, HOLD_MAX_MS)));
              Promise.race([Promise.allSettled(held), timeout]).then(() => {
                clearTimeout(timer);
                batcher.open();
              });
              break;
            }
            case 'event':
              if (action.event) batcher.push(action.event);
              if (action.end) {
                // What is pending is still delivered; nothing else comes.
                status.set('ended');
                finish();
              }
              break;
            case 'reload':
              goAway(action.reason);
              break;
            default:
              break;
          }
        };

        const open = () => {
          if (done) return;
          es = new ES(url);
          es.onopen = () => {
            if (done) return;
            status.set('connected');
            if (opens++ > 0 && feed.started) checkRun();
          };
          es.onmessage = onMessage;
          es.onerror = () => {
            if (done) return;
            status.set(feed.started ? 'reconnecting' : 'connecting');
            if (es.readyState === 2 /* CLOSED */) {
              es.close();
              setTimeout(open, RETRY_MS);
            }
          };
        };
        open();
      });
    },
  };
}
