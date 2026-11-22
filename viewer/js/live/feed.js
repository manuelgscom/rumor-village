// Pure part of the live source: what to do with each SSE message, and the
// batching of events. No DOM, no network.
//
//   message {id, data} ──► feed.accept ──► header | events | skip | reload
//                                               │
//                                    batcher.push(event) … flush once per frame
//
// Message n is line n of the log (the header is 1). After a reconnection the
// stream may repeat lines (skipped by id), or belong to another run: a
// different header on line 1, or an event older than the last one seen.

import { acceptEvent, checkHeader, parseLine } from '../core/events.js';

/**
 * @typedef {{kind: 'header', header: object}
 *   | {kind: 'event', event: object|null, end: boolean}
 *   | {kind: 'skip'}
 *   | {kind: 'reload', reason: string}} FeedAction
 *   event is null for an unknown event type (skipped with a warning)
 */

/**
 * Creates the message handler of one live run.
 * @param {{warn?: (message: string) => void}} [opts]
 */
export function createFeed({ warn = console.warn } = {}) {
  let headerLine = null;
  let lastId = 0;
  let lastTick = -Infinity;

  return {
    /** Id of the last line taken (0 before the header). */
    get lastId() {
      return lastId;
    },
    /** Tick of the last event taken (-Infinity before any). */
    get lastTick() {
      return lastTick;
    },
    /** True once the header is in. */
    get started() {
      return headerLine !== null;
    },

    /**
     * Handles one message.
     * @param {string|number} idText the SSE id (line number)
     * @param {string} data the line
     * @returns {FeedAction}
     * @throws {Error} on a malformed header or line (the run cannot be followed)
     */
    accept(idText, data) {
      const id = Number(idText);
      if (!Number.isInteger(id) || id < 1) throw new Error(`live: message without a line number (id '${idText}')`);
      if (id === 1) {
        if (headerLine === null) {
          const header = checkHeader(parseLine(data));
          headerLine = data;
          lastId = 1;
          return { kind: 'header', header };
        }
        return data === headerLine ? { kind: 'skip' } : { kind: 'reload', reason: 'another header' };
      }
      if (headerLine === null) throw new Error('live: the stream did not start with the header');
      if (id <= lastId) return { kind: 'skip' };
      if (id !== lastId + 1) warn(`live: lines ${lastId + 1}..${id - 1} missing`);
      let event;
      try {
        event = acceptEvent(parseLine(data), warn);
      } catch (err) {
        throw new Error(`live line ${id}: ${err.message}`);
      }
      if (event && event.tick < lastTick) return { kind: 'reload', reason: `tick ${event.tick} after ${lastTick}` };
      lastId = id;
      if (event) lastTick = event.tick;
      return { kind: 'event', event, end: event?.type === 'end' };
    },
  };
}

/**
 * Groups items and delivers them together, at most once per `schedule` call
 * (a frame in the browser). Nothing is delivered before `open()`; after it,
 * the first delivery happens even if empty (so the viewer knows the backlog is
 * in, or that there is none yet).
 * @template T
 * @param {(items: T[]) => void} deliver
 * @param {(fn: () => void) => void} schedule
 */
export function createBatcher(deliver, schedule) {
  let pending = [];
  let opened = false;
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    const items = pending;
    pending = [];
    deliver(items);
  };
  const plan = () => {
    if (opened && !scheduled) {
      scheduled = true;
      schedule(flush);
    }
  };

  return {
    /** @param {T} item */
    push(item) {
      pending.push(item);
      if (pending.length === 1) plan();
    },
    open() {
      if (opened) return;
      opened = true;
      plan();
    },
    get size() {
      return pending.length;
    },
  };
}
