import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSummary, initialsOf, neighborInitials, neighborName, placeName, slotValueText, WHAT, whatName } from './names.js';
import { langOf, pick } from './lang.js';
import { FIXTURE, loadLog, readRepoFile } from './testing.js';

test('the what table matches data/vocab', () => {
  for (const lang of ['es', 'en']) {
    const vocab = JSON.parse(readRepoFile(`data/vocab/${lang}.json`));
    assert.deepEqual(WHAT[lang], vocab.what, lang);
  }
});

test('names from the header', () => {
  const { header } = loadLog(FIXTURE);
  assert.equal(neighborName(header, 'n001'), 'Carmen');
  assert.equal(neighborInitials(header, 'n002'), 'LU');
  assert.equal(neighborName(header, 'n099'), 'n099');
  assert.equal(placeName(header, 'p01'), 'plaza');
  assert.equal(initialsOf('José Luis'), 'JL');
  assert.equal(initialsOf('Ángela'), 'ÁN');
  assert.equal(slotValueText('when', 44, header), '22:00');
  assert.equal(slotValueText('who', 'n006', header), 'Manuel');
  assert.equal(whatName('party', 'es'), 'fiesta');
  assert.equal(whatName('mystery', 'es'), 'mystery');
});

test('claim summary marks guesses and skips nulls', () => {
  const { header } = loadLog(FIXTURE);
  const claim = { who: null, where: 'p01', when: 44, amount: null, guess: ['when'] };
  assert.equal(claimSummary(claim, header, 'party'), 'fiesta · plaza · 22:00?');
  assert.equal(
    claimSummary({ who: 'n006', where: 'p01', when: 46, amount: 50, guess: [] }, header),
    'Manuel · plaza · 23:00 · 50',
  );
  assert.equal(claimSummary(null, header, 'party'), 'fiesta');
});

test('language of the header', () => {
  assert.equal(langOf({ lang: 'es' }), 'es');
  assert.equal(langOf({ lang: 'en' }), 'en');
  assert.equal(langOf(null), 'en');
  assert.deepEqual(pick({ es: { a: 'uno' }, en: { a: 'one', b: 'two' } }, 'es'), { a: 'uno', b: 'two' });
});

test('unitOf: the unit of the amount of each fact, in both languages', async () => {
  const { unitOf, WHAT } = await import('./names.js');
  for (const lang of ['es', 'en']) for (const what of Object.keys(WHAT[lang])) assert.ok(unitOf(what, lang), `${lang} ${what}`);
  assert.equal(unitOf('party', 'es'), 'personas');
  assert.equal(unitOf('lottery', 'en'), 'euros');
  assert.equal(unitOf('nope', 'es'), '');
});
