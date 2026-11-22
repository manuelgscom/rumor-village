// Static file server for the viewer, without dependencies.
//
//   node viewer/tools/static.mjs --root /work --host 127.0.0.1 --port 8000
//
// Serves files under the root and nothing outside it. Answers a single byte
// range ("Range: bytes=N-" or "bytes=N-M") with 206, as a resumed download of
// the model asks it (scripts/dist-model-serve.sh, phase 10). Also importable:
// `serve({root, host, port})` resolves to the listening server (port 0 picks a
// free one; read it from server.address().port).

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gguf': 'application/octet-stream',
};

/**
 * The byte range of a Range header for a file of `size` bytes: {start, end}
 * (inclusive), null without a header, or 'bad' when it cannot be served.
 * Only one range of the form "bytes=N-", "bytes=N-M" or "bytes=-N".
 * @param {string|undefined} header
 * @param {number} size
 */
export function byteRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'bad';
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'bad';
  return { start, end };
}

/**
 * Starts the server.
 * @param {{root: string, host?: string, port?: number, quiet?: boolean}} opts
 * @returns {Promise<import('node:http').Server>}
 */
export function serve({ root, host = '127.0.0.1', port = 8000, quiet = false }) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    const send = (code, text) => {
      res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed');
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return send(400, 'bad request');
    }
    let file = resolve(base, '.' + path);
    if (file !== base && !file.startsWith(base + sep)) return send(403, 'forbidden');
    try {
      let info = await stat(file);
      if (info.isDirectory()) {
        file = resolve(file, 'index.html');
        info = await stat(file);
      }
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
      const range = byteRange(req.headers.range, info.size);
      if (range === 'bad') {
        res.writeHead(416, { 'content-range': `bytes */${info.size}` });
        return res.end();
      }
      const head = { 'content-type': type, 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
      if (range) {
        res.writeHead(206, {
          ...head,
          'content-length': range.end - range.start + 1,
          'content-range': `bytes ${range.start}-${range.end}/${info.size}`,
        });
      } else {
        res.writeHead(200, { ...head, 'content-length': info.size });
      }
      if (req.method === 'HEAD') return res.end();
      createReadStream(file, range ? { start: range.start, end: range.end } : {}).pipe(res);
    } catch {
      send(404, 'not found');
    } finally {
      if (!quiet) console.log(`${req.method} ${req.url} ${res.statusCode}`);
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok(server));
  });
}

function main(argv) {
  const opt = { root: '.', host: '127.0.0.1', port: 8000 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opt)) throw new Error(`static: unknown option ${argv[i]}`);
    opt[key] = key === 'port' ? Number(argv[i + 1]) : argv[i + 1];
  }
  serve(opt).then((server) => {
    console.log(`static: serving ${resolve(opt.root)} on ${opt.host}:${server.address().port}`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
