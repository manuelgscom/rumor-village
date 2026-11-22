// Event sources. Every source has the same shape:
//
//   {kind: 'recording' | 'live', start(onHeader, onEvents) → Promise}
//
// `onHeader(header)` is called once, before any event; `onEvents(events[])`
// with each batch, in log order. A recording calls it once with every event
// and its promise resolves when done; a live source keeps calling it (see
// viewer/js/live/source.js). The promise rejects if the source fails.

import { parseLog } from './events.js';
import { codedError } from './strings.js';

/**
 * @typedef {object} Source
 * @property {'recording'|'live'} kind
 * @property {(onHeader: (header: object) => void, onEvents: (events: object[]) => void) => Promise<void>} start
 */

/**
 * Recording from the text of a whole log.
 * @param {() => Promise<string>} readText
 * @param {{warn?: (message: string) => void}} [opts]
 * @returns {Source}
 */
export function textSource(readText, { warn = console.warn } = {}) {
  return {
    kind: 'recording',
    async start(onHeader, onEvents) {
      const text = await readText();
      let parsed;
      try {
        parsed = parseLog(text, { warn });
      } catch (err) {
        if (err?.code) throw err;
        throw codedError('log-bad-line', err?.message ?? String(err));
      }
      const { header, events } = parsed;
      onHeader(header);
      onEvents(events);
    },
  };
}

/**
 * Recording from a URL (the `log` parameter, relative to the page).
 * Fails with the codes log-not-found (404) or log-unreachable (core/strings.js).
 * @param {string} url
 * @param {(loaded: number, total: number) => void} [onProgress] bytes read and
 *   expected (total 0 when the server does not say)
 * @returns {Source}
 */
export function fileSource(url, onProgress = () => {}) {
  return textSource(async () => {
    let res;
    try {
      res = await fetch(url, { cache: 'no-store' });
    } catch (err) {
      throw codedError('log-unreachable', `${url}: ${err.message}`);
    }
    if (res.status === 404) throw codedError('log-not-found', url);
    if (!res.ok) throw codedError('log-unreachable', `${url}: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body?.getReader) {
      const text = await res.text();
      onProgress(text.length, total || text.length);
      return text;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let loaded = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        text += decoder.decode(value, { stream: true });
        onProgress(loaded, total);
      }
    } catch (err) {
      throw codedError('log-unreachable', `${url}: ${err.message}`);
    }
    text += decoder.decode();
    onProgress(loaded, total || loaded);
    return text;
  });
}

/**
 * Recording from a file dropped on the page (a File from a drop event).
 * @param {File} file
 * @returns {Source}
 */
export function droppedSource(file) {
  return textSource(() => file.text());
}

/**
 * Calls `onFile` with the first file dropped on `element` (browser only).
 * @param {HTMLElement} element
 * @param {(file: File) => void} onFile
 */
export function acceptDrop(element, onFile) {
  element.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    element.classList.add('drop');
  });
  element.addEventListener('dragleave', () => element.classList.remove('drop'));
  element.addEventListener('drop', (ev) => {
    ev.preventDefault();
    element.classList.remove('drop');
    const file = ev.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}
