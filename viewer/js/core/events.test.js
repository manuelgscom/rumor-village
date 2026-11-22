import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMAT, parseLine, parseLog } from './events.js';
import { FIXTURE, loadLog, SAMPLES } from './testing.js';

for (const rel of [...SAMPLES, FIXTURE]) {
  test(`reads ${rel} without warnings`, () => {
    const { header, events } = loadLog(rel);
    assert.equal(header.format, FORMAT);
    assert.ok(events.length > 0);
    assert.equal(events[events.length - 1].type, 'end');
    for (let i = 1; i < events.length; i++) assert.ok(events[i].tick >= events[i - 1].tick);
  });
}

const HEADER = '{"type":"header","format":1,"seed":1,"scenario":"x","lang":"es"}';

test('unknown event types are skipped with a warning', () => {
  const warnings = [];
  const text = `${HEADER}\n{"type":"gossip","tick":5}\n{"type":"end","tick":6}\n`;
  const { events } = parseLog(text, { warn: (m) => warnings.push(m) });
  assert.deepEqual(
    events.map((e) => e.type),
    ['end'],
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /gossip/);
});

test('rejects other formats, a missing header and malformed lines', () => {
  assert.throws(() => parseLog('{"type":"header","format":2}\n'), /format 2/);
  assert.throws(() => parseLog('{"type":"end","tick":1}\n'), /header/);
  assert.throws(() => parseLog(''), /empty/);
  assert.throws(() => parseLog(`${HEADER}\n{"type":"end",`), /line 2/);
  assert.throws(() => parseLog(`${HEADER}\n{"type":"end","tick":5}\n{"type":"end","tick":4}\n`), /out of order/);
  assert.throws(() => parseLine('[1]'), /object/);
});
