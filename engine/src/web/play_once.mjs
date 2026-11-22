// The web engine in Node: one game of a draft, as `rumor play --once` does
// (scripts/wasm-diff.sh compares both). Writes <id>.jsonl, <id>.cards.jsonl
// and <id>.game.json in the out folder and prints the id.
//
//   node engine/src/web/play_once.mjs build/wasm/rumor_web.js <draft.json> <out dir>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [moduleFile, draftFile, outDir] = process.argv.slice(2);
if (!moduleFile || !draftFile || !outDir) {
  console.error('usage: node play_once.mjs <rumor_web.js> <draft.json> <out dir>');
  process.exit(2);
}

const { default: createRumorWeb } = await import(pathToFileURL(resolve(moduleFile)).href);
const engine = await createRumorWeb();
const call = (method, input) => engine.ccall('rw_call', 'string', ['string', 'string'], [method, JSON.stringify(input)]);

const draft = JSON.parse(await readFile(draftFile, 'utf8'));
const text = call('play', { draft, stop_at: null, now_ms: Date.now(), taken: [] });
const nl = text.indexOf('\n');
const meta = JSON.parse(nl < 0 ? text : text.slice(0, nl));
if (!meta.ok) {
  console.error(`rumor-web: the draft cannot be played: ${JSON.stringify(meta.body)}`);
  process.exit(1);
}
const lines = text.slice(nl + 1).split('\n');
const log = lines.slice(0, meta.log_lines);
const cards = lines.slice(meta.log_lines, meta.log_lines + meta.cards_lines);
const id = meta.game.id;
const game = { ...meta.game, ended: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), end_tick: meta.end_tick };
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, `${id}.jsonl`), log.map((l) => `${l}\n`).join(''));
await writeFile(join(outDir, `${id}.cards.jsonl`), cards.map((l) => `${l}\n`).join(''));
await writeFile(join(outDir, `${id}.game.json`), `${JSON.stringify(game, null, 2)}\n`);
console.error(`rumor-web: ${meta.ticks.length} ticks in ${meta.compute_ms.toFixed(1)} ms`);
console.log(id);
