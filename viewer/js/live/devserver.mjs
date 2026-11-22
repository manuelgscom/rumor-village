// A stand-in for the engine's live server, for the tests and the screenshot
// of package E when the engine is not at hand. Node only, no dependencies.
// It replays a recording as if it were running and answers the same routes as
// engine/src/server/live_server.h, with the same codes; the checks of /inject
// are a rough copy (the engine's are the ones that count).
//
//   node viewer/js/live/devserver.mjs --log runs/samples/party-100-es-s2.jsonl \
//        --port 18080 [--at 1230] [--speed 2] [--extract 0] [--root viewer]
//
//   GET  /events    SSE: id = line number; lines with tick <= --at at once,
//                   then one tick every 1/speed s; ": keepalive" every 15 s
//   GET  /control   {paused, speed, tick, ended, extract, run}
//   POST /control   {action} and/or {speed}
//   POST /viewport  204
//   POST /inject    dryRun 200 / 202 / 400 / 409
//   POST /extract   501 unless an extractor is given (tests)
//   GET  /...       static files of --root (the viewer)
//
// Listens on 127.0.0.1 only.

import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const WORDS = {
  es: { understood: 'Entendido', today: 'hoy', tomorrow: 'mañana' },
  en: { understood: 'Understood', today: 'today', tomorrow: 'tomorrow' },
};

const fold = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Creates the server (not listening yet).
 * @param {{
 *   lines: string[],            the log, header first
 *   at?: number,                tick already run when it starts (default start_tick)
 *   speed?: number|'max',       ticks per second after that
 *   paused?: boolean,
 *   root?: string|null,         folder served at "/"
 *   extractor?: ((text: string) => object)|null,  answer of POST /extract
 *   keepaliveMs?: number,
 * }} opts
 */
export function createDevServer({
  lines,
  at,
  speed = 2,
  paused = false,
  root = null,
  extractor = null,
  keepaliveMs = 15000,
}) {
  const header = JSON.parse(lines[0]);
  const ticks = lines.map((l, i) => (i === 0 ? -Infinity : JSON.parse(l).tick));
  const words = WORDS[header.lang === 'es' ? 'es' : 'en'];
  const last = ticks[ticks.length - 1];
  const run = Math.random().toString(16).slice(2, 18); // a new id for each server, as the engine
  const control = { paused, speed, tick: at ?? header.start_tick, ended: false, extract: !!extractor, run };
  const streams = new Set();
  const viewports = [];
  const injected = [];

  // Lines visible at the current tick.
  const visible = () => {
    let n = 1;
    while (n < lines.length && ticks[n] <= control.tick) n++;
    return n;
  };
  const pushAll = () => {
    const n = visible();
    for (const s of streams) {
      let out = '';
      for (; s.next < n; s.next++) out += `id: ${s.next + 1}\ndata: ${lines[s.next]}\n\n`;
      if (out) s.res.write(out);
    }
  };
  if (control.tick >= last) control.ended = true;

  let timer = null;
  const pace = () => {
    clearTimeout(timer);
    if (control.paused || control.ended) return;
    const ms = control.speed === 'max' ? 1 : 1000 / control.speed;
    timer = setTimeout(() => {
      control.tick++;
      if (control.tick >= last) control.ended = true;
      pushAll();
      pace();
    }, ms);
  };

  const place = (text) => {
    const f = fold(text);
    return (header.places ?? []).find((p) => p.id === text || p.key === text || fold(p.name) === f);
  };
  const neighbor = (text) => {
    const f = fold(text);
    return (header.neighbors ?? []).find((n) => n.id === text || fold(n.name) === f);
  };

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const error = (res, code, message) => json(res, code, { error: message });

  const readBody = (req) =>
    new Promise((ok) => {
      let text = '';
      req.setEncoding('utf8');
      req.on('data', (c) => (text += c));
      req.on('end', () => {
        try {
          const v = JSON.parse(text);
          ok(v && typeof v === 'object' && !Array.isArray(v) ? v : null);
        } catch {
          ok(null);
        }
      });
    });

  // The checks of the engine, roughly: a fact and its «Entendido».
  const readFact = (given) => {
    if (!given || typeof given !== 'object') return { error: 'fact is an object' };
    for (const k of Object.keys(given)) {
      if (!['what', 'who', 'where', 'when', 'amount'].includes(k)) return { error: `unknown slot '${k}' in fact` };
    }
    const f = { what: given.what ?? null, who: given.who ?? null, where: given.where ?? null, when: given.when ?? null, amount: given.amount ?? null };
    if (typeof f.what !== 'string' || !f.what.trim()) return { error: 'the fact is not valid' };
    const parts = [f.what.trim()];
    if (f.who !== null) {
      const n = neighbor(f.who);
      if (!n) return { error: `unknown neighbor: ${f.who}` };
      parts.push(n.name);
    }
    if (f.where !== null) {
      const p = place(f.where);
      if (!p || p.kind !== 'public') return { error: `unknown place: ${f.where}` };
      parts.push(p.name);
    }
    if (f.when !== null) {
      const m = /^(\S+) (\d{2}):(00|30)$/.exec(f.when);
      if (!m || ![words.today, words.tomorrow].includes(m[1])) return { error: 'the fact is not valid' };
      parts.push(f.when);
    }
    if (f.amount !== null) {
      if (!Number.isInteger(f.amount) || f.amount < 0) return { error: 'the fact is not valid' };
      parts.push(String(f.amount));
    }
    const empty = ['who', 'where', 'when', 'amount'].filter((k) => f[k] === null);
    return { fact: f, understood: `${words.understood}: ${parts.join(' · ')}`, empty };
  };

  const routes = {
    'GET /events': (req, res) => {
      const lastId = Number(req.headers['last-event-id']);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const s = { res, next: Number.isInteger(lastId) && lastId > 0 ? lastId : 0 };
      streams.add(s);
      const keep = setInterval(() => res.write(': keepalive\n\n'), keepaliveMs);
      req.on('close', () => {
        clearInterval(keep);
        streams.delete(s);
      });
      pushAll();
    },
    'GET /control': (req, res) => json(res, 200, control),
    'POST /control': async (req, res) => {
      const body = await readBody(req);
      if (!body) return error(res, 400, 'the body is not a JSON object');
      for (const k of Object.keys(body)) if (k !== 'action' && k !== 'speed') return error(res, 400, `unknown key '${k}'`);
      if ('action' in body && !['pause', 'resume'].includes(body.action)) return error(res, 400, 'action is "pause" or "resume"');
      if ('speed' in body && body.speed !== 'max' && !(Number.isInteger(body.speed) && body.speed >= 1)) {
        return error(res, 400, 'speed is an integer of at least 1 or "max"');
      }
      if (!('action' in body) && !('speed' in body)) return error(res, 400, 'nothing to do: give action or speed');
      if ('action' in body) control.paused = body.action === 'pause';
      if ('speed' in body) control.speed = body.speed;
      pace();
      json(res, 200, control);
    },
    'POST /viewport': async (req, res) => {
      const body = await readBody(req);
      if (!body || !Array.isArray(body.neighbors) || Object.keys(body).length !== 1) {
        return error(res, 400, 'the body is {"neighbors":[...]}');
      }
      for (const id of body.neighbors) {
        if (typeof id !== 'string' || !(header.neighbors ?? []).some((n) => n.id === id)) {
          return error(res, 400, `unknown neighbor ${JSON.stringify(id)}`);
        }
      }
      viewports.push(body.neighbors);
      res.writeHead(204);
      res.end();
    },
    'POST /inject': async (req, res) => {
      const body = await readBody(req);
      if (!body) return error(res, 400, 'the body is not a JSON object');
      for (const k of Object.keys(body)) if (!['fact', 'text', 'to', 'dryRun'].includes(k)) return error(res, 400, `unknown key '${k}'`);
      const fact = readFact(body.fact);
      if (fact.error) return error(res, 400, fact.error);
      if ('text' in body && body.text !== null && typeof body.text !== 'string') return error(res, 400, 'text is a string');
      const to = body.to;
      if (!to || typeof to !== 'object' || Object.keys(to).length !== 1) return error(res, 400, 'to is {"place":...} or {"neighbors":[...]}');
      if ('place' in to) {
        if (typeof to.place !== 'string' || !place(to.place)) return error(res, 400, `unknown place: ${to.place}`);
      } else if (Array.isArray(to.neighbors) && to.neighbors.length) {
        for (const n of to.neighbors) if (typeof n !== 'string' || !neighbor(n)) return error(res, 400, `unknown neighbor ${JSON.stringify(n)}`);
      } else {
        return error(res, 400, 'to is {"place":...} or {"neighbors":[...]}');
      }
      if ('dryRun' in body && typeof body.dryRun !== 'boolean') return error(res, 400, 'dryRun is a boolean');
      const answer = { understood: fact.understood, empty: fact.empty };
      if (body.dryRun) return json(res, 200, answer);
      if (control.ended) return error(res, 409, 'the run has ended');
      injected.push(body);
      json(res, 202, { ...answer, queued: true });
    },
    'POST /extract': async (req, res) => {
      if (!extractor) return error(res, 501, 'this run has no extract task');
      const body = await readBody(req);
      if (!body || typeof body.text !== 'string' || Object.keys(body).length !== 1) return error(res, 400, 'the body is {"text":"..."}');
      if (control.ended) return error(res, 409, 'the run has ended');
      json(res, 200, extractor(body.text));
    },
  };

  const base = root ? resolve(root) : null;
  const serveFile = async (req, res) => {
    if (!base || req.method !== 'GET') return error(res, 404, 'not found');
    let file = resolve(base, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (file !== base && !file.startsWith(base + sep)) return error(res, 403, 'forbidden');
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      await stat(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      createReadStream(file).pipe(res);
    } catch {
      error(res, 404, 'not found');
    }
  };

  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const route = routes[`${req.method} ${path}`];
    if (route) return route(req, res);
    return serveFile(req, res);
  });
  server.on('listening', pace);
  server.on('close', () => clearTimeout(timer));
  const closeAll = server.close.bind(server);
  server.close = (cb) => {
    clearTimeout(timer);
    for (const s of streams) s.res.end();
    streams.clear();
    server.closeAllConnections?.();
    return closeAll(cb);
  };
  return Object.assign(server, { control, viewports, injected, pushAll });
}

/**
 * Listens on 127.0.0.1.
 * @param {import('node:http').Server} server
 * @param {number} [port] 0 = any free one
 * @returns {Promise<number>} the port
 */
export function listen(server, port = 0) {
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok(server.address().port));
  });
}

async function main(argv) {
  const opt = { log: '', port: '18080', at: '', speed: '2', extract: '0', root: 'viewer' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opt)) throw new Error(`devserver: unknown option ${argv[i]}`);
    opt[key] = argv[i + 1] ?? '';
  }
  if (!opt.log) throw new Error('devserver: --log is required');
  const lines = readFileSync(opt.log, 'utf8').split('\n').filter((l) => l.trim() !== '');
  const server = createDevServer({
    lines,
    at: opt.at === '' ? undefined : Number(opt.at),
    speed: opt.speed === 'max' ? 'max' : Number(opt.speed),
    root: opt.root,
    extractor: null,
  });
  const port = await listen(server, Number(opt.port));
  console.log(`devserver: ${opt.log} on http://127.0.0.1:${port}/ (viewer from ${resolve(opt.root)})`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
