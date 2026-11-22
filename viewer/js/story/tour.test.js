// Tests of the story mode chapters (tour.js) and their sentences (phrase.js),
// on the four samples and the hand-written log (which has a model).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pick } from '../core/lang.js';
import { parseParams } from '../core/params.js';
import { FIXTURE, loadLog, SAMPLES } from '../core/testing.js';
import { marksOf } from '../replay/timeline.js';
import { createPhraser, plain } from './phrase.js';
import { STRINGS } from './strings.js';
import { BASE_ZONES, CHAPTER_HIDES, chapterAt, chaptersOf, partAt, TARGET_MS } from './tour.js';

function chaptersFor(rel) {
  const { header, events } = loadLog(rel);
  const fact = events.find((e) => e.type === 'inject')?.fact ?? null;
  return { header, events, chapters: chaptersOf({ header, events, marks: marksOf(events, fact) }) };
}

const ALL = [...SAMPLES, FIXTURE];

test('chapters play forward: in order, spans that do not overlap, parts that tile them', () => {
  for (const rel of ALL) {
    const { chapters } = chaptersFor(rel);
    assert.equal(chapters[0].n, 1, rel);
    assert.equal(chapters.at(-1).n, 7, rel);
    assert.equal(new Set(chapters.map((c) => c.n)).size, chapters.length, `${rel}: a chapter twice`);
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i];
      assert.ok(c.from <= c.to, `${rel} ch${c.n}: from ${c.from} > to ${c.to}`);
      if (i > 0) assert.equal(c.from, chapters[i - 1].to, `${rel} ch${c.n}: gap or overlap`);
      assert.ok(c.ms > 0 && c.speed >= 0, `${rel} ch${c.n}`);
      assert.ok(Math.abs(c.speed - (c.to - c.from) / (c.ms / 1000)) < 1e-9, `${rel} ch${c.n}: speed = span / time`);
      assert.equal(c.parts[0].from, c.from);
      assert.equal(c.parts.at(-1).to, c.to);
      assert.equal(c.parts.reduce((s, p) => s + p.ms, 0), c.ms, `${rel} ch${c.n}: parts add up`);
      for (let j = 1; j < c.parts.length; j++) assert.equal(c.parts[j].from, c.parts[j - 1].to);
      for (const z of BASE_ZONES) assert.ok(c.zones.includes(z), `${rel} ch${c.n}: zone ${z}`);
      const hides = CHAPTER_HIDES[c.n] ?? [];
      if (i > 0) for (const z of chapters[i - 1].zones) assert.ok(c.zones.includes(z) || hides.includes(z), `${rel} ch${c.n}: zones accumulate`);
      for (const z of hides) assert.ok(!c.zones.includes(z), `${rel} ch${c.n}: ${z} put away`);
      assert.ok(c.shot && typeof c.shot.kind === 'string' && typeof c.shot.zoom === 'number', `${rel} ch${c.n}: a shot`);
    }
  }
});

test('chapters left out: no model chapter in the samples (no model: rules); telephone has 1, 2, 3, 4 and 7', () => {
  const nums = (rel) => chaptersFor(rel).chapters.map((c) => c.n);
  for (const rel of SAMPLES) assert.ok(!nums(rel).includes(6), rel);
  assert.deepEqual(nums('runs/samples/telephone-20-en-s5.jsonl'), [1, 2, 3, 4, 7]);
  assert.deepEqual(nums('runs/samples/telephone-20-es-s5.jsonl'), [1, 2, 3, 4, 7]);
  assert.deepEqual(nums('runs/samples/party-100-es-s2.jsonl'), [1, 2, 3, 4, 5, 7]);
  assert.deepEqual(nums('runs/samples/party-25-en-s4.jsonl'), [1, 2, 3, 4, 5, 7]);
  // The hand log has a model: all seven, chapter 6 before 5 because it happens earlier.
  assert.deepEqual(nums(FIXTURE), [1, 2, 3, 4, 6, 5, 7]);
});

test('the starts come from the recording', () => {
  const { chapters, events, header } = chaptersFor('runs/samples/party-100-es-s2.jsonl');
  const at = (n) => chapters.find((c) => c.n === n);
  const inject = events.find((e) => e.type === 'inject');
  assert.equal(at(1).from, inject.tick - 20);
  assert.equal(at(2).from, inject.tick);
  assert.equal(at(3).from, events.find((e) => e.type === 'turn' && e.act === 'tell' && e.reject === null).tick);
  assert.equal(at(5).from, inject.slots.when * 30 - 10);
  assert.equal(at(7).from, events.find((e) => e.type === 'end').tick);
  assert.equal(at(4).parts[0].select, at(4).line.who);
  assert.equal(at(5).parts.at(-1).group, at(5).line.wrong);
  assert.equal(at(1).line.model, null);
  assert.equal(at(1).line.neighbors, header.neighbors.length);
  // Telephone: the first inject is the first tick, so chapter 1 is a still.
  const tel = chaptersFor('runs/samples/telephone-20-es-s5.jsonl').chapters;
  assert.equal(tel[0].from, tel[0].to);
  assert.equal(tel[0].speed, 0);
});

test('the model chapter: the busiest tick once the rumor travels, framed on a conversation', () => {
  const { chapters, events } = chaptersFor(FIXTURE);
  const six = chapters.find((c) => c.n === 6);
  const n = events.filter((e) => e.tick === six.from && (e.type === 'turn' || e.type === 'plan')).length;
  assert.equal(six.line.decisions, n);
  assert.ok(n >= 1);
  assert.equal(six.shot.kind, 'pair');
  assert.equal(chapters[0].line.model, 'fixture-test-model');
});

test('same recording, same chapters', () => {
  for (const rel of ALL) assert.deepEqual(chaptersFor(rel).chapters, chaptersFor(rel).chapters, rel);
});

test('about 90 seconds in all', () => {
  for (const rel of ALL) {
    const total = chaptersFor(rel).chapters.reduce((s, c) => s + c.ms, 0);
    assert.ok(total >= 60000 && total <= TARGET_MS + 1000, `${rel}: ${total} ms`);
  }
});

test('chapterAt: the last chapter started by a position', () => {
  const { chapters } = chaptersFor('runs/samples/party-100-es-s2.jsonl');
  assert.equal(chapterAt(chapters, chapters[0].from - 1), null);
  assert.equal(chapterAt(chapters, chapters[0].from).n, 1);
  for (const c of chapters) if (c.to > c.from) assert.equal(chapterAt(chapters, (c.from + c.to) / 2).n, c.n);
  assert.equal(chapterAt(chapters, chapters.at(-1).from).n, 7);
  assert.equal(chapterAt(chapters, chapters.at(-1).from + 100).n, 7);
  // A still (no ticks of its own) never holds a position: the next one does.
  const tel = chaptersFor('runs/samples/telephone-20-en-s5.jsonl').chapters;
  assert.equal(chapterAt(tel, tel[0].from).n, 2);
});

test('partAt follows the time inside a chapter', () => {
  const { chapters } = chaptersFor('runs/samples/party-100-es-s2.jsonl');
  const three = chapters.find((c) => c.n === 3);
  assert.equal(three.parts.length, 2);
  assert.equal(partAt(three, 0), 0);
  assert.equal(partAt(three, three.parts[0].ms - 1), 0);
  assert.equal(partAt(three, three.parts[0].ms), 1);
  assert.equal(partAt(three, three.ms * 2), 1);
  assert.equal(three.parts[0].shot.kind, 'pair');
  assert.equal(three.parts[1].shot.kind, 'home');
});

test('a recording without a rumor: the village and the end', () => {
  const { header, events } = loadLog('runs/samples/party-25-en-s4.jsonl');
  const quiet = events.filter((e) => e.type !== 'inject' && !e.fact);
  const chapters = chaptersOf({ header, events: quiet, marks: marksOf(quiet, null) });
  assert.deepEqual(
    chapters.map((c) => c.n),
    [1, 7],
  );
});

test('sentences of every chapter, and who decides', () => {
  for (const rel of ALL) {
    const { header, chapters } = chaptersFor(rel);
    for (const lang of ['es', 'en']) {
      const ph = createPhraser(header, lang, pick(STRINGS, lang));
      for (const c of chapters) {
        const p = ph.chapter(c.line);
        assert.ok(plain(p.title).length > 3, `${rel} ${lang} ch${c.n}`);
        assert.ok(p.body.length >= 1, `${rel} ${lang} ch${c.n}`);
        for (const s of p.body) assert.ok(!/\{|\}|undefined|null|NaN/.test(plain(s)), `${rel} ${lang} ch${c.n}: ${plain(s)}`);
      }
    }
  }
  const party = chaptersFor('runs/samples/party-100-es-s2.jsonl');
  const es = createPhraser(party.header, 'es', pick(STRINGS, 'es'));
  assert.equal(plain(es.chapter(party.chapters[0].line).title), 'Un pueblo de 100 vecinos');
  assert.match(plain(es.chapter(party.chapters[0].line).body[0]), /no hay modelo de lenguaje: deciden unas reglas fijas/);
  assert.equal(plain(es.decider()), 'sin modelo: reglas');
  const hand = chaptersFor(FIXTURE);
  const en = createPhraser(hand.header, 'en', pick(STRINGS, 'en'));
  assert.match(plain(en.chapter(hand.chapters[0].line).body[0]), /language model decides, fixture-test-model/);
  assert.equal(plain(en.decider()), 'decided by fixture-test-model');
});

test('the tour opens with tour=1, never with tour=0, and by itself only on a plain first visit', async () => {
  const { opensByItself } = await import('./tourview.js');
  const p = (q) => parseParams(q);
  assert.equal(opensByItself(p('?log=a.jsonl'), false), true);
  assert.equal(opensByItself(p('?log=a.jsonl'), true), false);
  assert.equal(opensByItself(p('?log=a.jsonl&tour=0'), false), false);
  assert.equal(opensByItself(p('?log=a.jsonl&tour=1'), true), true);
  assert.equal(opensByItself(p('?log=a.jsonl&tour=1&chapter=3&paused=1'), true), true);
  assert.equal(opensByItself(p('?log=a.jsonl&t=900&paused=1'), false), false);
  assert.equal(opensByItself(p('?log=a.jsonl&select=n003'), false), false);
  assert.equal(opensByItself(p('?log=a.jsonl&select=n003'), true, true), true);
  assert.equal(opensByItself(p('?log=a.jsonl&t=900&paused=1'), false, true), false);
  assert.equal(opensByItself(p('?log=a.jsonl&tour=0'), false, true), false);
  // Inside the game (playing, or «Mis partidas → Ver»), never: not even on a phone or with tour=1.
  assert.equal(opensByItself(p('?game=20261117-221700-ai-t417'), false), false);
  assert.equal(opensByItself(p('?game=20261117-221700-ai-t417&tour=1'), false, true), false);
  assert.equal(opensByItself(p('?play=1'), false, true), false);
});
