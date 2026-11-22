import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pick } from '../core/lang.js';
import { FIXTURE, loadStore } from '../core/testing.js';
import { bubbleContent, bubbleFade, endedTurns, keepBubbles, lastTurns, LINGER, lingerMs, narration, newTextChars, placeBubbles, wrapLines } from './bubbles.js';
import { STRINGS } from './strings.js';

const measure = (s) => [...s].length * 7;

test('line breaking: no line wider than the bubble', () => {
  const text = 'Esta noche Manuel da una fiesta en la plaza a las diez. ¡Dicen que irán cincuenta!';
  const lines = wrapLines(text, 140, measure);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(measure(l) <= 140, l);
  assert.equal(lines.join(' '), text);
});

test('line breaking: long words are cut, overflow ends with an ellipsis', () => {
  const cut = wrapLines('supercalifragilisticexpialidocious', 70, measure);
  assert.ok(cut.length > 1);
  for (const l of cut) assert.ok(measure(l) <= 70);
  assert.equal(cut.join(''), 'supercalifragilisticexpialidocious');
  const many = wrapLines('uno dos tres cuatro cinco seis siete ocho nueve diez once doce', 56, measure, 2);
  assert.equal(many.length, 2);
  assert.ok(many[1].endsWith('…'));
  assert.ok(measure(many[1]) <= 56);
  assert.deepEqual(wrapLines('   ', 100, measure), []);
});

test('bubble content: text, claim or act label', () => {
  const store = loadStore(FIXTURE, 1237);
  const strings = pick(STRINGS, 'es');
  const turn = (id) => store.turn(id);
  const withText = store.events.find((e) => e.type === 'turn' && e.text);
  assert.deepEqual(bubbleContent(withText, store.state, store.header, strings), { kind: 'text', text: withText.text.trim() });

  const tell = store.events.find((e) => e.type === 'turn' && e.act === 'tell');
  const noText = { ...tell, text: null };
  // Without AI the claim, summarised: the data are what tells that mode apart.
  const rules = { ...store.header, policy: 'baseline' };
  const c = bubbleContent(noText, store.state, rules, strings);
  assert.equal(c.kind, 'claim');
  assert.ok(c.text.startsWith('fiesta · '), c.text);
  // With AI a narrator says it in plain words.
  const n = bubbleContent(noText, store.state, store.header, strings);
  assert.equal(n.kind, 'narration');
  assert.match(n.text, /^Le cuenta lo de la fiesta /);

  const greet = { ...store.events.find((e) => e.type === 'turn' && e.act === 'greet'), text: null };
  assert.deepEqual(bubbleContent(greet, store.state, rules, strings), { kind: 'act', text: 'saluda' });
  assert.deepEqual(bubbleContent({ ...greet, act: 'bye' }, store.state, rules, strings), { kind: 'act', text: 'se despide' });
  // With AI, greetings and goodbyes without text show nothing.
  assert.equal(bubbleContent(greet, store.state, store.header, strings), null);
  assert.equal(bubbleContent({ ...greet, act: 'bye' }, store.state, store.header, strings), null);
  const rejected = { ...greet, action: 'none', act: null, reject: 'malformed' };
  assert.equal(bubbleContent(rejected, store.state, store.header, strings).text, strings.rejected);
  const ask = { ...greet, act: 'ask', fact: 'f1' };
  assert.equal(bubbleContent(ask, store.state, store.header, strings).text, 'pregunta por fiesta');
  assert.ok(turn(10));
});

test('last turn of each active conversation, and of those ended this tick', () => {
  const store = loadStore(FIXTURE, 1213);
  const turns = lastTurns(store.state);
  assert.ok(turns.length >= 1);
  for (const { conv, turn } of turns) assert.equal(turn.id, conv.turns[conv.turns.length - 1].id);

  // A conversation that ends in the same tick as its last turn keeps that bubble for the tick.
  const end = store.events.find((e) => e.type === 'conv_end');
  store.seek(end.tick + 0.5);
  assert.ok(![...store.state.convs.keys()].includes(end.conv));
  const ended = endedTurns(store.events, store.index, end.tick);
  const mine = ended.find((x) => x.conv.id === end.conv);
  assert.ok(mine, 'ended conversation listed');
  const lastOfConv = store.events.filter((e) => e.type === 'turn' && e.conv === end.conv && e.tick <= end.tick).pop();
  assert.equal(mine.turn.id, lastOfConv.id);
  assert.deepEqual(endedTurns(store.events, store.index, end.tick + 1), []);
});

test('reading characters: only text of the current tick counts', () => {
  const b = (tick, kind, text) => ({ turn: { tick }, content: { kind, text } });
  const bubbles = [b(1213, 'text', 'Hola, Luis.'), b(1212, 'text', 'Texto de antes'), b(1213, 'claim', 'fiesta · plaza'), b(1213, 'act', 'saluda')];
  assert.equal(newTextChars(bubbles, 1213), 'Hola, Luis.'.length);
  assert.equal(newTextChars([...bubbles, b(1213, 'narration', 'Le cuenta lo de la fiesta')], 1213), 'Hola, Luis.'.length);
  assert.equal(newTextChars(bubbles, 1214), 0);
  assert.equal(newTextChars([], 1213), 0);
});

test('bubbles do not overlap each other, even for close speakers', () => {
  const items = [];
  for (let i = 0; i < 8; i++) items.push({ ax: 300 + (i % 4) * 30, top: 300 + Math.floor(i / 4) * 30, bottom: 310 + Math.floor(i / 4) * 30, w: 160, h: 40 });
  const rects = placeBubbles(items, { w: 1200, h: 800 });
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= 1200 && a.y + a.h <= 800);
    for (let j = i + 1; j < rects.length; j++) {
      const c = rects[j];
      const apart = a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y;
      assert.ok(apart, `${i} and ${j} overlap`);
    }
  }
  // Alone, a bubble sits right above its speaker.
  const [one] = placeBubbles([{ ax: 500, top: 400, bottom: 410, w: 100, h: 30 }], { w: 1200, h: 800 });
  assert.equal(one.x, 450);
  assert.ok(one.y + one.h <= 400 && one.y + one.h >= 380);
  // It avoids a dot right above the speaker by moving.
  const [moved] = placeBubbles([{ ax: 500, top: 400, bottom: 410, w: 100, h: 30 }], { w: 1200, h: 800 }, [{ x: 500, y: 375, r: 10 }]);
  assert.notDeepEqual(moved, one);
});

test('the tail goes from the bubble to the speaker, or nowhere if it covers it', async () => {
  const { tailOf } = await import('./bubbles.js');
  const it = { ax: 500, top: 400, bottom: 430 };
  assert.deepEqual(tailOf({ x: 450, y: 340, w: 100, h: 40 }, it), { bx: 500, baseY: 380, tipX: 500, tipY: 400 });
  assert.equal(tailOf({ x: 450, y: 440, w: 100, h: 40 }, it).tipY, 430);
  assert.equal(tailOf({ x: 450, y: 390, w: 100, h: 40 }, it), null);
});

test('narration: the claim in plain words, guesses after «cree que», es and en', () => {
  const store = loadStore(FIXTURE, 1237);
  const h = store.header;
  const es = pick(STRINGS, 'es');
  const en = pick(STRINGS, 'en');
  // Slot 24 is 12:00 of day 0; the turn at tick 1230 is day 0 too: «hoy».
  const claim = { who: 'n006', where: 'p01', when: 24, amount: 50, guess: [] };
  assert.equal(narration(claim, 'party', 1230, h, 'es', es), 'Le cuenta lo de la fiesta de Manuel en la plaza, hoy a las 12:00, 50 personas');
  assert.equal(narration(claim, 'party', 1230, h, 'en', en), 'Tells them about the party for Manuel at the plaza, today at 12:00, 50 people');
  assert.equal(
    narration({ ...claim, who: null, amount: null, guess: ['when'] }, 'party', 1230, h, 'es', es),
    'Le cuenta lo de la fiesta en la plaza; cree que hoy a las 12:00',
  );
  // Tomorrow, the bar (masculine), only the hour.
  assert.equal(narration({ when: 48 + 18 }, 'concert', 1230, h, 'es', es), 'Le cuenta lo del concierto, mañana a las 09:00');
  assert.equal(narration({ where: 'p02' }, 'wedding', 1230, h, 'es', es), 'Le cuenta lo de la boda en el bar');
  assert.equal(narration({}, undefined, 1230, h, 'es', es), 'Le cuenta lo de algo');
});

test('lingerMs: 60 ms a character, from 2.5 s to 6 s; nothing at «rápida»', () => {
  assert.deepEqual(LINGER, { perChar: 60, min: 2500, max: 6000, fade: 400 });
  assert.equal(lingerMs('saluda'), 2500);
  assert.equal(lingerMs('x'.repeat(50)), 3000);
  assert.equal(lingerMs('x'.repeat(500)), 6000);
  assert.equal(lingerMs('x'.repeat(50), true), 0);
});

test('keepBubbles: a bubble stays its time after its turn, then fades; replaced, cleared by a jump', () => {
  const it = (who, id, text = 'x'.repeat(50)) => ({ conv: { id: `c${id}` }, turn: { id, who, tick: 0 }, content: { kind: 'text', text } });
  const game = { linger: true };
  let shown = keepBubbles(new Map(), [it('a', 1)], 1000, game);
  assert.equal(shown.get('a').until, 4000);
  // The turn passes 0.8 s later: the bubble stays until 4 s, fading the last 400 ms.
  shown = keepBubbles(shown, [], 1800, game);
  assert.equal(shown.get('a').current, false);
  assert.equal(bubbleFade(shown.get('a'), 1800), 1);
  assert.equal(bubbleFade(shown.get('a'), 3800), 0.5);
  assert.equal(keepBubbles(shown, [], 4000, game).size, 0);
  // A turn still on keeps its first time; a new one of the same neighbor replaces it.
  shown = keepBubbles(new Map(), [it('a', 1)], 1000, game);
  assert.equal(keepBubbles(shown, [it('a', 1)], 2000, game).get('a').until, 4000);
  const next = keepBubbles(shown, [it('a', 2, 'hola')], 2000, game);
  assert.equal(next.size, 1);
  assert.equal(next.get('a').item.turn.id, 2);
  assert.equal(next.get('a').until, 4500);
  // Another speaker's bubble does not take it away.
  assert.deepEqual([...keepBubbles(shown, [it('b', 3)], 2000, game).keys()].sort(), ['a', 'b']);
  // A jump in the timeline, «rápida», or outside the game: only what is on now.
  assert.equal(keepBubbles(shown, [], 2000, { linger: true, reset: true }).size, 0);
  assert.equal(keepBubbles(shown, [], 2000, { linger: true, fast: true }).size, 0);
  assert.equal(keepBubbles(shown, [], 2000, { linger: false }).size, 0);
  assert.equal(keepBubbles(new Map(), [it('a', 1)], 1000, { linger: false }).get('a').until, 1000);
});
