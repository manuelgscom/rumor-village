// «¿Qué pensó?» (package E): the decisions of a neighbor and the plain words
// of one of them, with AI (the card, the decision, the verdicts) and without
// AI (the rule and the dice), from the log and a GET /card answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pick } from '../core/lang.js';
import { FIXTURE, loadLog } from '../core/testing.js';
import { decisionLine, decisionsOf, explain, isBad, percent, rollText, ruleText } from './plain.js';
import { STRINGS } from './strings.js';

function ctxOf(header, events, lang = header.lang) {
  const injects = new Map(events.filter((e) => e.type === 'inject').map((e) => [e.fact, e]));
  return { header, lang, t: pick(STRINGS, lang), whatOf: (f) => injects.get(f)?.what ?? null, slotsOf: (f) => injects.get(f)?.slots ?? null };
}

test('inspect: es and en have the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.es).sort(), Object.keys(STRINGS.en).sort());
  assert.deepEqual(Object.keys(STRINGS.es.rules).sort(), ['answer_question', 'bye', 'greet_back', 'greet_first', 'plan_go', 'plan_no_time', 'tell_chance']);
  assert.deepEqual(Object.keys(STRINGS.es.verdicts).sort(), ['contradiction', 'declared_guess', 'faithful', 'hardened_doubt', 'invented', 'omitted']);
});

test('inspect: the decisions of a neighbor, newest first, as of the position', () => {
  const { events } = loadLog(FIXTURE);
  const all = decisionsOf(events, events.length, 'n002');
  assert.ok(all.length >= 3);
  for (const { i, e } of all) {
    assert.equal(events[i], e);
    assert.ok(e.type === 'turn' || e.type === 'plan');
    assert.equal(e.who, 'n002');
  }
  for (let k = 1; k < all.length; k++) assert.ok(all[k - 1].i > all[k].i, 'newest first');
  // Rewound: only those before the position, the same objects.
  const idx = events.findIndex((e) => e.type === 'turn' && e.id === 20);
  const before = decisionsOf(events, idx, 'n002');
  assert.deepEqual(before, all.filter((d) => d.i < idx));
  assert.deepEqual(decisionsOf(events, events.length, 'n999'), []);
});

test('inspect: with AI, the card, the decision and the verdict per slot', () => {
  const { header, events } = loadLog(FIXTURE);
  const ctx = ctxOf(header, events);
  const e = events.find((x) => x.type === 'turn' && x.id === 20);
  const card = { tick: e.tick, who: e.who, kind: 'turn', policy: 'model', card: 'Eres Luis, funcionario.\nLo que sabes:\n[1] fiesta', rule: null };
  const x = explain(e, card, ctx);
  assert.equal(x.policy, 'model');
  assert.equal(x.mode, 'Con IA');
  assert.equal(x.card, true);
  assert.equal(x.read, card.card);
  assert.equal(x.line, 'Le contó a Ana: fiesta · Manuel · plaza · 23:00? · 50');
  assert.equal(x.said, `«${e.text}»`);
  assert.deepEqual(
    x.verdicts.map((v) => `${v.label} ${v.value}: ${v.text}`),
    ['quién Manuel: lo contó tal cual', 'dónde plaza: lo contó tal cual', 'cuándo 23:00?: lo supuso y lo dijo', 'cuántos 50 personas: lo contó tal cual'],
  );
  assert.equal(x.reject, null);
  assert.equal(x.rule, null);
  assert.deepEqual(x.rolls, []);
  // In English.
  const en = explain(e, card, ctxOf(header, events, 'en'));
  assert.equal(en.mode, 'With AI');
  assert.equal(en.verdicts[2].text, 'guessed and said so');
  assert.equal(en.said, `“${e.text}”`);
});

test('inspect: failures, rejections and kept values in plain words', () => {
  const { header, events } = loadLog(FIXTURE);
  const ctx = ctxOf(header, events);
  const base = events.find((x) => x.type === 'turn' && x.id === 20);
  const bad = { ...base, verdict: { ...base.verdict, where: 'invented', when: 'hardened_doubt' }, conflicts: ['who'] };
  const x = explain(bad, null, ctx);
  assert.equal(x.card, false, 'no card: only the log');
  assert.equal(x.read, null);
  assert.ok(isBad(bad));
  assert.equal(x.verdicts[1].bad, true);
  assert.equal(x.verdicts[1].text, 'se lo inventó · el juego no lo dejó pasar');
  assert.equal(x.verdicts[2].text, 'dio por seguro lo que dudaba');
  assert.equal(x.conflicts, 'Ana no cambió quién: ya lo tenía por cierto.');
  const rejected = { ...base, action: 'none', act: null, fact: null, claim: null, verdict: null, reject: 'truncated', text: null };
  const r = explain(rejected, null, ctx);
  assert.equal(r.line, 'Propuso algo que no valía (con Ana)');
  assert.equal(r.reject, 'El juego no la aceptó (una respuesta cortada) y no hizo nada en su lugar.');
  assert.deepEqual(r.verdicts, []);
  assert.ok(isBad(rejected));
  assert.ok(!isBad(base));
  // An answer for another decision of the same tick is not used.
  const plan = explain(base, { tick: base.tick, who: base.who, kind: 'plan', policy: 'model', card: 'x', rule: null }, ctx);
  assert.equal(plan.card, false);
});

test('inspect: «se lo calló» only for a detail the rumor had; no engine words', () => {
  const { header, events } = loadLog(FIXTURE);
  const ctx = ctxOf(header, events);
  const base = events.find((x) => x.type === 'turn' && x.id === 20);
  const inj = events.find((x) => x.type === 'inject' && x.fact === base.fact);
  // The rumor had every detail: keeping one quiet is said.
  const quiet = { ...base, verdict: { ...base.verdict, amount: 'omitted' } };
  assert.equal(explain(quiet, null, ctx).verdicts.find((v) => v.slot === 'amount').text, 'se lo calló');
  // A rumor without «cuántos»: nothing to keep quiet, the row is left out.
  const noAmount = { ...ctx, slotsOf: () => ({ ...inj.slots, amount: null }) };
  assert.equal(explain(quiet, null, noAmount).verdicts.find((v) => v.slot === 'amount'), undefined);
  // No word of the engine in any text of the package.
  const texts = (v) => (typeof v === 'string' ? [v] : Object.values(v).flatMap(texts));
  for (const text of texts(STRINGS)) assert.doesNotMatch(text, /motor|engine|grabación|recording|\bfiel\b/i);
});

test('inspect: one line per kind of decision', () => {
  const { header, events } = loadLog(FIXTURE);
  const ctx = ctxOf(header, events);
  const line = (e) => decisionLine(e, ctx);
  const greet = events.find((x) => x.type === 'turn' && x.act === 'greet' && x.who === 'n003');
  assert.equal(line(greet), 'Saludó a Elena');
  const plan = events.find((x) => x.type === 'plan' && x.action === 'go');
  assert.equal(line(plan), 'Pensó ir: fiesta · Manuel · plaza · 22:00 · 50');
  assert.equal(line({ ...plan, action: 'none', claim: null, verdict: null }), 'Decidió no ir (fiesta)');
  assert.equal(line({ ...greet, act: 'bye' }), 'Se despidió de Elena');
  assert.equal(line({ ...greet, act: 'ask', fact: 'f1' }), 'Le preguntó a Elena por fiesta');
  assert.equal(line({ ...greet, action: 'none', act: null }), 'Dejó la charla con Elena');
  const en = ctxOf(header, events, 'en');
  assert.equal(decisionLine(greet, en), 'Said hello to Elena');
  // Names come from the header (its language): only the frame is translated.
  assert.equal(decisionLine(plan, en), 'Planned to go: fiesta · Manuel · plaza · 22:00 · 50');
});

test('inspect: without AI, the rule in words and each roll of the dice', () => {
  const { header, events } = loadLog('runs/samples/party-25-en-s4.jsonl');
  const e = events.find((x) => x.type === 'turn' && x.act === 'tell');
  const card = {
    tick: e.tick,
    who: e.who,
    kind: 'turn',
    policy: 'baseline',
    card: null,
    rule: {
      rule: 'tell_chance',
      rolls: [
        { name: 'pick_fact', chance_ppm: 500000, roll_ppm: 0, hit: true },
        { name: 'tell', chance_ppm: 600000, roll_ppm: 230000, hit: true },
        { name: 'guess_forgotten', chance_ppm: 125000, roll_ppm: 900000, hit: false },
      ],
    },
  };
  const es = { ...ctxOf(header, events, 'es') };
  const x = explain(e, card, es);
  assert.equal(x.policy, 'baseline');
  assert.equal(x.mode, 'Sin IA');
  assert.equal(x.read, null);
  assert.deepEqual(x.verdicts, [], 'no verdicts without AI');
  assert.equal(x.rule, 'Una vez por charla puede contar algo; el dado decide, según su carácter y si son familia, amigos o rivales.');
  // Telling says why it was likely: the character, and what the listener is to them.
  assert.equal(x.rolls[0], 'Qué contar: uno de 2, al azar');
  assert.match(x.rolls[1], /^Probabilidad de contarlo: 60 % \([^)]+\)\. Salió 23: lo contó$/);
  assert.equal(x.rolls[2], 'Probabilidad de suponer lo olvidado: 12,5 %. Salió 90: no lo supuso');
  const en = explain(e, card, ctxOf(header, events, 'en'));
  assert.equal(en.mode, 'Without AI');
  assert.match(en.rolls[1], /^Chance of telling it: 60% \([^)]+\)\. Rolled 23: told it$/);
  assert.equal(en.rolls[2], "Chance of guessing what was forgotten: 12.5%. Rolled 90: didn't guess it");
  // The character and the relationship, by name and gender; sure at 100 %.
  const pair = { header: { neighbors: [{ id: 'a', gender: 'f', trait: 'gossip' }, { id: 'b', gender: 'f' }], relations: [{ a: 'b', b: 'a', type: 'friend' }] } };
  const tell = { name: 'tell', chance_ppm: 1000000, roll_ppm: 895000, hit: true };
  assert.equal(rollText(tell, { ...es, ...pair }, { who: 'a', to: 'b' }), 'Lo contaba seguro (cotilla, y es su amiga)');
  assert.equal(rollText({ ...tell, chance_ppm: 600000 }, { ...es, ...pair }, { who: 'a', to: 'b' }), 'Probabilidad de contarlo: 60 % (cotilla, y es su amiga). Salió 89,5: lo contó');
  assert.equal(rollText({ ...tell, chance_ppm: 600000 }, { ...es, ...pair }, { who: 'a', to: 'c' }), 'Probabilidad de contarlo: 60 % (cotilla). Salió 89,5: lo contó');
  // A single candidate, a miss of going, and every rule has words.
  assert.equal(rollText({ name: 'pick_fact', chance_ppm: 1000000, roll_ppm: 0, hit: true }, es), 'Qué contar: solo tenía uno');
  assert.equal(rollText({ name: 'go', chance_ppm: 300000, roll_ppm: 712345, hit: false }, es), 'Probabilidad de ir: 30 %. Salió 71,2: no va');
  for (const r of ['greet_first', 'answer_question', 'tell_chance', 'greet_back', 'bye', 'plan_go', 'plan_no_time']) assert.ok(!ruleText(r, es).includes('«'), r);
  assert.equal(ruleText('new_rule', es), 'Regla «new_rule».');
  assert.equal(percent(1000000, es), '100 %');
  // Without the card answer, a recording without AI says only what the log has.
  const bare = explain(e, null, es);
  assert.equal(bare.card, false);
  assert.equal(bare.rule, null);
  assert.deepEqual(bare.rolls, []);
});

test('inspect: telling first, greetings and goodbyes apart to fold', async () => {
  const { splitDecisions, isSmallTalk } = await import('./plain.js');
  const d = (i, act, extra = {}) => ({ i, e: { type: 'turn', action: 'say', act, ...extra } });
  const list = [d(5, 'bye'), d(4, 'tell'), d(3, 'greet'), d(2, 'ask'), { i: 1, e: { type: 'plan', action: 'go' } }, d(0, 'greet', { reject: 'malformed' })];
  const { main, small } = splitDecisions(list);
  assert.deepEqual(main.map((x) => x.i), [4, 2, 1, 0]);
  assert.deepEqual(small.map((x) => x.i), [5, 3]);
  assert.equal(isSmallTalk({ type: 'plan', act: 'greet' }), false);
});
