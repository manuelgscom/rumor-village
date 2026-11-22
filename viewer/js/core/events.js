// Reading the event log, format 1 (docs/contrato.md, section 6; the format is
// defined by engine/src/core/event.h). One header line, then one event per
// line in tick order. The viewer reads leniently: unknown event types are
// skipped with a warning; the strict reader is the engine's.

import { codedError } from './strings.js';

/** The only log format this viewer reads. */
export const FORMAT = 1;

/** Event types of format 1. */
export const EVENT_TYPES = new Set([
  'move',
  'inject',
  'conv_start',
  'turn',
  'conv_end',
  'memory',
  'plan',
  'arrive',
  'perf',
  'end',
]);

/**
 * Parses one line of the log.
 * @param {string} line
 * @returns {object} the header or the event object
 * @throws {Error} on malformed JSON or a line without a type
 */
export function parseLine(line) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch (err) {
    throw new Error(`malformed JSON: ${err.message}`);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('expected a JSON object');
  if (typeof obj.type !== 'string') throw new Error("missing key 'type'");
  return obj;
}

/**
 * Checks a header object.
 * @param {object} header
 * @returns {object} the same header
 * @throws {Error} if it is not a header of format 1
 */
export function checkHeader(header) {
  if (!header || header.type !== 'header') throw new Error('the first line must be the header');
  if (header.format !== FORMAT) {
    throw new Error(`log format ${header.format} is not supported (expected ${FORMAT})`);
  }
  return header;
}

/**
 * Keeps an event if this viewer knows its type.
 * @param {object} event
 * @param {(message: string) => void} [warn] called for an unknown type
 * @returns {object|null} the event, or null to skip it
 * @throws {Error} if a known event has no integer tick
 */
export function acceptEvent(event, warn = console.warn) {
  if (!EVENT_TYPES.has(event.type)) {
    if (event.type === 'header') throw new Error('the header can only be on line 1');
    warn(`log: unknown event type '${event.type}' ignored`);
    return null;
  }
  if (!Number.isInteger(event.tick)) throw new Error(`event '${event.type}' without an integer tick`);
  return event;
}

/**
 * Parses a whole log.
 * @param {string} text the JSONL text
 * @param {{warn?: (message: string) => void}} [opts]
 * @returns {{header: object, events: object[]}}
 * @throws {Error} with the line number, on a bad header or a malformed line
 */
export function parseLog(text, { warn = console.warn } = {}) {
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length || lines[0].trim() === '') throw new Error('empty log: the header is missing');
  let header = null;
  const events = [];
  let lastTick = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    try {
      const obj = parseLine(lines[i]);
      if (i === 0) {
        header = checkHeader(obj);
        continue;
      }
      const event = acceptEvent(obj, warn);
      if (!event) continue;
      if (event.tick < lastTick) throw new Error(`tick ${event.tick} after tick ${lastTick}: events out of order`);
      lastTick = event.tick;
      events.push(event);
    } catch (err) {
      throw codedError('log-bad-line', `log line ${i + 1}: ${err.message}`);
    }
  }
  return { header, events };
}
