// The fetch and EventSource of the web version (phase 10, package F): the
// routes of `rumor play` under the folder of the page go to the fake server
// (server.js); everything else goes to the real ones.
//
//   fetch('state') ─► <folder of the page>/state ─► server.handle ─► Response
//   new EventSource('events') ─► server.stream (line n = id n, header = 1)
//   fetch('js/core/app.js'), new EventSource(elsewhere) ─► the real ones
//
// The stream behaves as the one of live_run.cpp: it sends every line from
// the first and the new ones as they are let through; when the run behind it
// changes (start, reset, another village) it drops (onerror, readyState
// CONNECTING) and comes back after a moment from the last id received, so
// live/source.js finds the other run as it does with the engine.

/** The routes of the game (play_server.cpp routes()), relative to the page's folder. */
const ROUTE = /^(state|control|viewport|inject|extract|preview|start|stop|reset|quit|card|games|profile|timetable|games\/[^/]+\.game\.json|games\/[^/]+\.jsonl)$/;
const EVENTS = 'events';
const RECONNECT_MS = 1000;

/**
 * The route of a URL for the page at `pageHref`, or null when it is not one
 * of the game (another origin, folder or name).
 * @param {string} href absolute
 * @param {string} pageHref
 * @param {RegExp} [pattern]
 */
export function routeOf(href, pageHref, pattern = ROUTE) {
  let url;
  let page;
  try {
    url = new URL(href, pageHref);
    page = new URL(pageHref);
  } catch {
    return null;
  }
  if (url.origin !== page.origin) return null;
  const folder = new URL('./', page).pathname;
  if (!url.pathname.startsWith(folder)) return null;
  const path = decodeURIComponent(url.pathname.slice(folder.length));
  return pattern.test(path) ? { path, query: url.searchParams } : null;
}

/** A Response for an answer of server.handle. */
export function toResponse(answer) {
  if (answer.status === 204) return new Response(null, { status: 204 });
  const text = 'text' in answer ? answer.text : JSON.stringify(answer.body);
  const type = answer.type ?? 'application/json';
  return new Response(text, { status: answer.status, headers: { 'content-type': type } });
}

/**
 * A fetch that answers the game routes with `server` and passes the rest on.
 * @param {{handle: Function}} server
 * @param {typeof fetch} realFetch
 * @param {() => string} pageHref
 */
export function createFetch(server, realFetch, pageHref = () => globalThis.location.href) {
  return function fetch(input, init = {}) {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const route = routeOf(href, pageHref());
    if (!route) return realFetch(input, init);
    const method = String(init?.method ?? (typeof input === 'object' ? input?.method : null) ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : '';
    return server.handle(method, route.path, route.query, body).then(toResponse);
  };
}

/**
 * An EventSource class: `events` under the page's folder is the stream of
 * `stream` (server.stream); any other URL opens a real one.
 * @param {{run: () => string|null, count: () => number, lines: (from: number) => string[], subscribe: (fn: () => void) => () => void}} stream
 * @param {Promise<unknown>} ready the server is restored
 * @param {typeof EventSource|undefined} RealEventSource
 * @param {() => string} pageHref
 * @param {{later?: (fn: () => void, ms: number) => any, cancel?: (t: any) => void}} [timers]
 */
export function createEventSource(stream, ready, RealEventSource, pageHref = () => globalThis.location.href, timers = {}) {
  const later = timers.later ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = timers.cancel ?? ((t) => clearTimeout(t));
  const eventsRoute = /^events$/;

  return class FakeEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;

    constructor(url, init) {
      if (!routeOf(String(url), pageHref(), eventsRoute)) {
        if (typeof RealEventSource !== 'function') throw new Error('web: this browser has no EventSource');
        return new RealEventSource(url, init);
      }
      this.url = new URL(String(url), pageHref()).href;
      this.withCredentials = false;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this._listeners = { open: new Set(), message: new Set(), error: new Set() };
      this._next = 0; // lines sent (the id of the last one)
      this._run = null;
      this._timer = null;
      this._unsubscribe = null;
      this._pumping = false;
      ready.then(
        () => this._open(),
        () => this._drop(),
      );
    }

    get CONNECTING() {
      return 0;
    }
    get OPEN() {
      return 1;
    }
    get CLOSED() {
      return 2;
    }

    addEventListener(type, fn) {
      this._listeners[type]?.add(fn);
    }
    removeEventListener(type, fn) {
      this._listeners[type]?.delete(fn);
    }

    close() {
      this.readyState = 2;
      if (this._timer !== null) cancel(this._timer);
      this._timer = null;
      this._unsubscribe?.();
      this._unsubscribe = null;
    }

    _emit(type, ev) {
      try {
        this[`on${type}`]?.(ev);
      } catch (err) {
        console.error(err);
      }
      for (const fn of this._listeners[type]) {
        try {
          fn(ev);
        } catch (err) {
          console.error(err);
        }
      }
    }

    _open() {
      if (this.readyState === 2) return;
      this._run = stream.run();
      this.readyState = 1;
      this._unsubscribe = stream.subscribe(() => this._changed());
      this._emit('open', { type: 'open', target: this });
      this._pump();
    }

    /** The server ended this connection (another run): drop and come back. */
    _drop() {
      if (this.readyState === 2) return;
      this._unsubscribe?.();
      this._unsubscribe = null;
      this.readyState = 0;
      this._emit('error', { type: 'error', target: this });
      if (this.readyState === 2) return; // closed by the handler
      this._timer = later(() => {
        this._timer = null;
        this._open();
      }, RECONNECT_MS);
    }

    _changed() {
      if (this.readyState !== 1) return;
      if (stream.run() !== this._run) return this._drop();
      this._pump();
    }

    /** Sends the lines not sent yet, in a task of their own (never inside the server's call). */
    _pump() {
      if (this._pumping) return;
      this._pumping = true;
      later(() => {
        this._pumping = false;
        if (this.readyState !== 1 || stream.run() !== this._run) return;
        const from = this._next;
        const fresh = stream.lines(from);
        for (let i = 0; i < fresh.length; i++) {
          if (this.readyState !== 1) return;
          this._next = from + i + 1;
          this._emit('message', { type: 'message', data: fresh[i], lastEventId: String(from + i + 1), origin: '', target: this });
        }
      }, 0);
    }
  };
}
