import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBatcher, createFeed } from './feed.js';
import { readRepoFile } from '../core/testing.js';

const LOG = 'runs/samples/party-25-en-s4.jsonl';
const lines = () => readRepoFile(LOG).split('\n').filter(Boolean);

test('header first, then the events in order', () => {
  const all = lines();
  const feed = createFeed({ warn: (m) => assert.fail(m) });
  const first = feed.accept('1', all[0]);
  assert.equal(first.kind, 'header');
  assert.equal(first.header.scenario, 'party-25');
  let n = 0;
  for (let i = 1; i < all.length; i++) {
    const a = feed.accept(String(i + 1), all[i]);
    assert.equal(a.kind, 'event');
    n++;
    assert.equal(a.end, i === all.length - 1);
  }
  assert.equal(n, all.length - 1);
  assert.equal(feed.lastId, all.length);
});

test('repeated lines after a reconnection are skipped', () => {
  const all = lines();
  const feed = createFeed();
  for (let i = 0; i < 5; i++) feed.accept(i + 1, all[i]);
  assert.deepEqual(feed.accept('1', all[0]), { kind: 'skip' }); // the same header again
  assert.deepEqual(feed.accept('3', all[2]), { kind: 'skip' });
  assert.deepEqual(feed.accept('5', all[4]), { kind: 'skip' });
  assert.equal(feed.accept('6', all[5]).kind, 'event');
  assert.equal(feed.lastId, 6);
});

test('another run: a different header or a clock going back', () => {
  const all = lines();
  const other = readRepoFile('runs/samples/telephone-20-en-s5.jsonl').split('\n')[0];
  const feed = createFeed();
  for (let i = 0; i < 40; i++) feed.accept(i + 1, all[i]);
  assert.equal(feed.accept('1', other).kind, 'reload');

  const late = createFeed();
  late.accept(1, all[0]);
  late.accept(2, '{"type":"move","tick":900,"who":"n001","from":"p13","to":"p05","arrive":906,"fact":null}');
  const back = late.accept(3, '{"type":"move","tick":500,"who":"n002","from":"p13","to":"p05","arrive":506,"fact":null}');
  assert.equal(back.kind, 'reload');
});

test('bad streams fail with a message', () => {
  const all = lines();
  assert.throws(() => createFeed().accept('2', all[1]), /did not start with the header/);
  assert.throws(() => createFeed().accept('1', '{"type":"header","format":9}'), /format 9/);
  assert.throws(() => createFeed().accept('', all[0]), /line number/);
  const feed = createFeed();
  feed.accept(1, all[0]);
  assert.throws(() => feed.accept(2, '{oops'), /live line 2: malformed JSON/);
});

test('unknown event types are skipped with a warning; a gap is warned', () => {
  const all = lines();
  const warnings = [];
  const feed = createFeed({ warn: (m) => warnings.push(m) });
  feed.accept(1, all[0]);
  assert.deepEqual(feed.accept(2, '{"type":"future","tick":430}'), { kind: 'event', event: null, end: false });
  feed.accept(5, all[1]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /lines 3\.\.4 missing/);
});

test('the batcher delivers once per frame, and an empty first batch on open', () => {
  const frames = [];
  const got = [];
  const b = createBatcher((items) => got.push(items), (fn) => frames.push(fn));
  b.push(1);
  b.push(2);
  assert.equal(frames.length, 0, 'nothing before open');
  b.open();
  assert.equal(frames.length, 1);
  b.push(3);
  assert.equal(frames.length, 1, 'one frame for all');
  frames.shift()();
  assert.deepEqual(got, [[1, 2, 3]]);

  b.push(4);
  b.push(5);
  frames.shift()();
  assert.deepEqual(got, [[1, 2, 3], [4, 5]]);
  assert.equal(frames.length, 0);

  const empty = [];
  const e = createBatcher((items) => empty.push(items), (fn) => fn());
  e.open();
  assert.deepEqual(empty, [[]]);
});
