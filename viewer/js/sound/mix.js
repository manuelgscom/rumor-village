// What the ambient sound plays, as a pure function of the events and the
// playback position (phase 8-2, 2.16). No DOM, no WebAudio: sound/index.js
// turns this into audio. Sound is presentation only: it comes out of the
// events and nothing decides from it.
//
//   murmur   0..1, grows with the conversations open at pos
//            (conv_start seen and its conv_end not yet)
//   hits     short taps:
//              faithful  a tell (turn, action 'say', act 'tell', fact set,
//                        reject null) whose verdict is 'faithful' in every slot
//              changed   the same tell with some slot not 'faithful'
//                        (contradiction, invented, omitted, declared_guess,
//                        hardened_doubt...)
//              arrive    an `arrive` event
//
// The faithful/changed split is a sound approximation: it reads only the
// verdict of the turn. The exact per-hop change (what reached the listener
// against what the speaker had) is rumor/chain.js hopSlot, which needs the
// whole history and is not worth it for a tap.
//
// Taps in time. The hits of one tick are spread evenly inside it: hit k of n
// sounds at `at = tick + k / n`. While playing, the taps that sound between
// two positions are the ones whose `at` was crossed (hitsBetween). At high
// speed they would pile up, so real time is cut into slots of
// 1 / maxPerSecond seconds (speed / maxPerSecond ticks) and each slot keeps
// one tap at most: the most telling one (changed > faithful > arrive), the
// earliest on a tie. The slot of a tap depends only on its tick and the speed,
// so the same taps sound whether the frames are short or long.
//
//   ticks  ──|──x──x──|──x─────|─x─x─x──|──     x = hit, | = slot edge
//   kept       x            x       x            one per slot
//
// Going backwards, or forwards farther than a frame of playback can go, is a
// seek: no taps at all, so a jump does not let loose an avalanche.

/** Taps per second of real time, at most. */
export const MAX_HITS_PER_SECOND = 6;

/** Open conversations that give half of the full murmur. */
export const MURMUR_HALF = 6;

/**
 * A move longer than this many seconds of real playback is a seek. Playback
 * steps at most 250 ms per frame (replay/constants.js MAX_FRAME_MS).
 */
export const MAX_STEP_SECONDS = 0.5;

/** Priority of each kind inside a slot (higher wins). */
const RANK = { changed: 3, faithful: 2, arrive: 1 };

/**
 * Whether a turn is a tell that went through.
 * @param {object} e
 */
function isTell(e) {
  return e.type === 'turn' && e.reject === null && e.action === 'say' && e.act === 'tell' && !!e.fact;
}

/**
 * faithful | changed of a tell, from its verdict (see the header comment).
 * @param {object} turn
 * @returns {'faithful'|'changed'}
 */
export function tellKind(turn) {
  const verdict = turn.verdict ?? {};
  for (const v of Object.values(verdict)) if (v !== null && v !== 'faithful') return 'changed';
  return 'faithful';
}

/**
 * Kind of tap of one event, or null.
 * @param {object} e
 * @returns {'faithful'|'changed'|'arrive'|null}
 */
export function hitKind(e) {
  if (e.type === 'arrive') return 'arrive';
  if (isTell(e)) return tellKind(e);
  return null;
}

/** First index with tick >= tick (events are in tick order). */
function lowerBound(events, tick) {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].tick < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Every tap of the whole ticks t0..t1 (both included), spread in their tick.
 * @param {object[]} events
 * @param {number} t0
 * @param {number} t1
 * @returns {{kind: string, tick: number, at: number}[]}
 */
function hitsOfTicks(events, t0, t1) {
  const out = [];
  let i = lowerBound(events, t0);
  while (i < events.length && events[i].tick <= t1) {
    const tick = events[i].tick;
    const inTick = [];
    for (; i < events.length && events[i].tick === tick; i++) {
      const kind = hitKind(events[i]);
      if (kind) inTick.push(kind);
    }
    inTick.forEach((kind, k) => out.push({ kind, tick, at: tick + k / inTick.length }));
  }
  return out;
}

/**
 * Taps that sound while the position goes from `from` to `to` (a tap sounds
 * when from < at <= to), at most one per slot of 1 / maxPerSecond real
 * seconds. Backwards or a jump give none.
 * @param {object[]} events in tick order
 * @param {number} from previous position (ticks)
 * @param {number} to current position (ticks)
 * @param {number} speed ticks per second of real time
 * @param {number} [maxPerSecond]
 * @returns {{kind: 'faithful'|'changed'|'arrive', tick: number, at: number}[]} in time order
 */
export function hitsBetween(events, from, to, speed, maxPerSecond = MAX_HITS_PER_SECOND) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return [];
  if (!(speed > 0) || !(maxPerSecond > 0)) return [];
  if (to - from > Math.max(1, speed * MAX_STEP_SECONDS)) return [];
  const slotLen = speed / maxPerSecond; // ticks
  const firstSlot = Math.floor(from / slotLen);
  const lastSlot = Math.floor(to / slotLen);
  // Whole slots, so the choice inside each one does not depend on the frames.
  const t0 = Math.floor(firstSlot * slotLen);
  const t1 = Math.floor((lastSlot + 1) * slotLen);
  const best = new Map();
  for (const h of hitsOfTicks(events, t0, t1)) {
    const slot = Math.floor(h.at / slotLen);
    if (slot < firstSlot || slot > lastSlot) continue;
    const cur = best.get(slot);
    if (!cur || RANK[h.kind] > RANK[cur.kind]) best.set(slot, h);
  }
  return [...best.values()].filter((h) => h.at > from && h.at <= to).sort((a, b) => a.at - b.at);
}

/**
 * Conversations open with the first `index` events applied.
 * @param {object[]} events
 * @param {number} index
 */
export function openConversations(events, index) {
  const open = new Set();
  const n = Math.min(index, events.length);
  for (let i = 0; i < n; i++) {
    const e = events[i];
    if (e.type === 'conv_start') open.add(e.conv);
    else if (e.type === 'conv_end') open.delete(e.conv);
  }
  return open.size;
}

/**
 * The mix of one instant.
 * @param {object[]} events store.events
 * @param {number} index store.index: events applied at pos (tick <= floor(pos))
 * @param {number} pos playback position (ticks)
 * @param {number} speed ticks per second of real time
 * @returns {{murmur: number, hits: {kind: 'faithful'|'changed'|'arrive', tick: number}[]}}
 *   murmur 0..1; hits: the taps kept in the last slot of real time up to pos
 */
export function mixAt(events, index, pos, speed) {
  const open = openConversations(events, index);
  const murmur = open / (open + MURMUR_HALF);
  const slotLen = speed > 0 ? speed / MAX_HITS_PER_SECOND : 0;
  const hits = slotLen > 0 ? hitsBetween(events, pos - slotLen, pos, speed).map(({ kind, tick }) => ({ kind, tick })) : [];
  return { murmur, hits };
}
