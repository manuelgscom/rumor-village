// The Web Worker of the web version (phase 10, package F): loads
// rumor_web.js (and its .wasm) once and answers the calls of engine.js
// createWorkerEngine, one at a time. Messages:
//   in  {id, moduleUrl, method: 'info'|'preview'|'header'|'play', args: [...]}
//   out {id, result} or {id, error}

import { wrapModule } from './engine.js';

let engine = null;

async function load(moduleUrl) {
  if (!engine) {
    engine = (async () => {
      const { default: createRumorWeb } = await import(moduleUrl);
      return wrapModule(await createRumorWeb());
    })();
  }
  return engine;
}

self.onmessage = async (ev) => {
  const { id, moduleUrl, method, args } = ev.data ?? {};
  try {
    const e = await load(moduleUrl);
    if (typeof e[method] !== 'function') throw new Error(`unknown method ${method}`);
    const result = await e[method](...(args ?? []));
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
};
