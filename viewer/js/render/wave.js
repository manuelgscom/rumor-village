// The wave when the rumor passes (pure, no DOM): every `tell` turn that was
// not rejected starts a ring at the listener that grows for WAVE_TICKS ticks.
// Its age comes from the playback position, never from the wall clock.
//
//   tick of the turn      pos
//        │◄── age 0 … 1 ──►│        ring radius grows, alpha fades
//        ◯ ─────────────── ( ◯ )

/** Life of a wave in ticks. */
export const WAVE_TICKS = 4;

/**
 * Waves alive at a position: tell turns with tick in (pos - ticks, pos],
 * looking back from the last applied event.
 * @param {object[]} events store.events
 * @param {number} index store.index (events applied)
 * @param {number} pos playback position
 * @param {number} [ticks]
 * @returns {{listener: string, speaker: string, fact: string, tick: number, age: number}[]}
 *   age from 0 (just told) to 1 (gone)
 */
export function recentTells(events, index, pos, ticks = WAVE_TICKS) {
  const out = [];
  for (let i = Math.min(index, events.length) - 1; i >= 0; i--) {
    const e = events[i];
    if (e.tick <= pos - ticks) break;
    if (e.type !== 'turn' || e.reject !== null || e.action !== 'say' || e.act !== 'tell' || !e.fact) continue;
    const age = Math.min(1, Math.max(0, (pos - e.tick) / ticks));
    out.push({ listener: e.to, speaker: e.who, fact: e.fact, tick: e.tick, age });
  }
  return out.reverse();
}
