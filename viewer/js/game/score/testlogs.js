// Tiny hand-made recordings for the tests of the scoring (node tests only).
// Format 1 events with only the fields the measures, the history and the
// summary read.

/** A header with `n` neighbors n001…; `priest` is the id with job priest. */
export function header(n, { priest = null, policy = 'baseline', lang = 'es' } = {}) {
  const neighbors = [];
  for (let k = 1; k <= n; k++) {
    const id = `n${String(k).padStart(3, '0')}`;
    neighbors.push({ id, name: `Vecino${k}`, gender: 'f', job: id === priest ? 'priest' : 'farmer', trait: 'gossip', home: 'p03' });
  }
  return {
    type: 'header',
    format: 1,
    seed: 1,
    scenario: 'hand',
    lang,
    policy,
    model: policy === 'model' ? 'test' : null,
    params: { neighbors: n, end_tick: 1440 },
    tick_seconds: 60,
    start_tick: 420,
    start_weekday: 0,
    places: [
      { id: 'p01', key: 'square', name: 'plaza', kind: 'public', x: 0, y: 0 },
      { id: 'p02', key: 'bar', name: 'bar', kind: 'public', x: 1, y: 0 },
      { id: 'p03', key: 'upper_quarter', name: 'barrio alto', kind: 'home', x: 2, y: 0 },
    ],
    routes: [],
    neighbors,
    relations: [],
  };
}

export const inject = (tick, fact, to, slots) => ({
  type: 'inject',
  tick,
  fact,
  text: null,
  what: 'party',
  slots: { who: null, where: null, when: null, amount: null, ...slots },
  to,
});

const VERDICT = { who: 'omitted', where: 'omitted', when: 'omitted', amount: 'omitted' };

/**
 * A tell turn and the memory events it leaves in the listener.
 * @param {number} tick
 * @param {number} id
 * @param {string} who speaker
 * @param {string} to listener
 * @param {string} fact
 * @param {object} said slots said: {where: 'p01', when: 42}
 * @param {{guess?: string[], verdict?: object}} [opts]
 */
export function tell(tick, id, who, to, fact, said, { guess = [], verdict = {} } = {}) {
  const claim = { who: null, where: null, when: null, amount: null, ...said, guess };
  const v = { ...VERDICT };
  for (const s of Object.keys(said)) v[s] = guess.includes(s) ? 'declared_guess' : 'faithful';
  Object.assign(v, verdict);
  const turn = {
    type: 'turn',
    tick,
    id,
    conv: 'c1',
    n: 1,
    who,
    to,
    card: 'x',
    action: 'say',
    act: 'tell',
    fact,
    claim,
    reject: null,
    verdict: v,
    conflicts: [],
    text: null,
    gen: null,
  };
  const mems = Object.entries(said).map(([slot, value]) =>
    mem(tick, to, fact, slot, guess.includes(slot) ? 'doubt' : 'sure', value, 'told', id),
  );
  return [turn, ...mems];
}

export const mem = (tick, who, fact, slot, state, value, cause, turn = null) => ({
  type: 'memory',
  tick,
  who,
  fact,
  slot,
  state,
  value,
  cause,
  turn,
});

export const arrive = (tick, who, place, fact, slot) => ({ type: 'arrive', tick, who, place, fact, slot });

export const end = (tick) => ({ type: 'end', tick, decisions: 0, turns: 0, plans: 0, rejected: 0, conversations: 0, informed: 0 });

/** Memory events of an inject recipient. */
export const injected = (tick, who, fact, slots) =>
  Object.entries(slots).map(([slot, value]) => mem(tick, who, fact, slot, 'sure', value, 'inject'));

/**
 * An honest village of 4 (n004 the priest, never told): n001 ─1─► n002 ─2─► n003,
 * party at the square (p01) at 21:00 (slot 42). With `change`, turn 2 says 22:00
 * (slot 44) as a declared guess: n002 is the culprit.
 */
export function chainLog({ change = false } = {}) {
  const f = 'f1';
  const slots = { where: 'p01', when: 42 };
  return {
    header: header(4, { priest: 'n004' }),
    events: [
      inject(480, f, ['n001'], slots),
      ...injected(480, 'n001', f, slots),
      ...tell(500, 1, 'n001', 'n002', f, slots),
      ...tell(520, 2, 'n002', 'n003', f, change ? { where: 'p01', when: 44 } : slots, change ? { guess: ['when'] } : {}),
      arrive(1260, 'n001', 'p01', f, 42),
      arrive(1260, 'n002', 'p01', f, 42),
      arrive(1270, 'n001', 'p02', f, 42), // a second arrive does not count
      arrive(1320, 'n003', change ? 'p01' : 'p02', f, change ? 44 : 42),
      end(1440),
    ],
  };
}
