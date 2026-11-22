// promo/tools/check-sources.mjs: only new Con IA games of runs/demo/.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkSources, itemsOf } from '../../promo/tools/check-sources.mjs';

const head = (extra) => JSON.stringify({ type: 'header', lang: 'es', policy: 'model', model: 'm.gguf', ...extra }) + '\n{"type":"move"}\n';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'check-sources-'));
  await mkdir(join(root, 'runs/demo'), { recursive: true });
  await mkdir(join(root, 'runs/play'), { recursive: true });
  const rec = (id, mode, file = `runs/demo/${id}.jsonl`) => ({ id, mode, file });
  await writeFile(
    join(root, 'runs/demo/manifest.json'),
    JSON.stringify({
      format: 1,
      recordings: [rec('good', 'ai'), rec('rules', 'rules'), rec('nomodel', 'ai'), rec('baseline', 'ai'), rec('old', 'ai', 'runs/play/old.jsonl'), rec('gone', 'ai')],
    }),
  );
  await writeFile(join(root, 'runs/demo/good.jsonl'), head());
  await writeFile(join(root, 'runs/demo/rules.jsonl'), head());
  await writeFile(join(root, 'runs/demo/nomodel.jsonl'), head({ model: null }));
  await writeFile(join(root, 'runs/demo/baseline.jsonl'), head({ policy: 'baseline' }));
  await writeFile(join(root, 'runs/play/old.jsonl'), head());
  return root;
}

test('checkSources: a new Con IA game passes and gives its header', async () => {
  const root = await fixture();
  const r = await checkSources([{ id: 'a', source: 'good' }, { id: 'b', source: 'good', lang: 'es' }], { root });
  assert.deepEqual(r.errors, []);
  assert.equal(r.sources.get('good').header.model, 'm.gguf');
});

test('checkSources: every bad source is reported', async () => {
  const root = await fixture();
  const items = ['rules', 'nomodel', 'baseline', 'old', 'gone', 'nowhere'].map((source) => ({ id: source, source }));
  items.push({ id: 'nosrc' }, { id: 'lang', source: 'good', lang: 'en' });
  const { errors } = await checkSources(items, { root, where: 'f.json' });
  assert.equal(errors.length, 8);
  const has = (re) => assert.ok(errors.some((e) => re.test(e)), `${re} in ${errors.join(' | ')}`);
  has(/f\.json: rules: .*mode is "rules"/);
  has(/nomodel: .*header\.model is null/);
  has(/baseline: .*policy is "baseline"/);
  has(/old: .*not under runs\/demo/);
  has(/gone: .*ENOENT/);
  has(/nowhere: .*not in runs\/demo\/manifest\.json/);
  has(/nosrc: no source/);
  has(/lang: lang en, but source good is es/);
});

test('checkSources: no manifest fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'check-sources-'));
  const { errors } = await checkSources([{ id: 'a', source: 'x' }], { root });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /manifest\.json: cannot read it/);
});

test('itemsOf: shots, stills, a list or one object', () => {
  assert.deepEqual(itemsOf({ shots: [1] }), [1]);
  assert.deepEqual(itemsOf({ stills: [2] }), [2]);
  assert.deepEqual(itemsOf([3]), [3]);
  assert.deepEqual(itemsOf({ source: 's' }), [{ source: 's' }]);
});
