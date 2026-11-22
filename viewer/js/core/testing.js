// Helpers for the node tests of every package (node only: never import it
// from the browser code).
//
//   import { loadLog, SAMPLES, FIXTURE } from '../core/testing.js';
//   const { header, events } = loadLog(FIXTURE);

import { readFileSync } from 'node:fs';
import { parseLog } from './events.js';
import { createStore } from './store.js';

/** Absolute path of a file given relative to the repo root. */
export function repoPath(rel) {
  return new URL(`../../../${rel}`, import.meta.url).pathname;
}

/** Text of a file given relative to the repo root. */
export function readRepoFile(rel) {
  return readFileSync(repoPath(rel), 'utf8');
}

/** The sample recordings (repo-relative paths). */
export const SAMPLES = [
  'runs/samples/party-100-es-s2.jsonl',
  'runs/samples/party-25-en-s4.jsonl',
  'runs/samples/telephone-20-en-s5.jsonl',
  'runs/samples/telephone-20-es-s5.jsonl',
];

/** The hand-written log with text (see viewer/fixtures/README.md). */
export const FIXTURE = 'viewer/fixtures/hand-text.jsonl';

/**
 * Reads and parses a log; fails on any warning.
 * @param {string} rel repo-relative path
 * @returns {{header: object, events: object[]}}
 */
export function loadLog(rel) {
  return parseLog(readRepoFile(rel), {
    warn: (m) => {
      throw new Error(`${rel}: ${m}`);
    },
  });
}

/**
 * A store with the whole log appended, at `pos` (default: the end).
 * @param {string} rel repo-relative path
 * @param {number} [pos]
 * @returns {import('./store.js').Store}
 */
export function loadStore(rel, pos) {
  const { header, events } = loadLog(rel);
  const end = events.length ? events[events.length - 1].tick : header.start_tick;
  const store = createStore(header, { pos: pos ?? end });
  store.append(events);
  return store;
}
