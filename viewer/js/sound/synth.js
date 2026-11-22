// The WebAudio graph of the ambient sound: everything synthesized, no audio
// files. Created only after a gesture of the user (sound/index.js).
//
//   noise ─► band-pass ─► voice gain ─┐  (4 voices, swelling with app.now())
//   noise ─► band-pass ─► voice gain ─┼─► murmur gain ─► low-pass ─┐
//                                    ...                           ├─► master ─► compressor ─► limiter ─► out
//   taps: faithful (clean sine) · changed (detuned pair) · arrive (bell) ─┘
//
// No Math.random: the noise and the pitch of each tap come from seeded numbers.

/** Master level when on: moderate, the compressor and the limiter keep peaks down. */
const MASTER = 0.35;

/** Murmur level: a floor so the village never goes dead quiet, and the span on top. */
const MURMUR_FLOOR = 0.035;
const MURMUR_SPAN = 0.3;

/** Voices of the murmur: band centre (Hz), Q, swell period (s), syllable rate (Hz). */
const VOICES = [
  { freq: 320, q: 1.4, swell: 7.3, syl: 3.1 },
  { freq: 520, q: 1.8, swell: 9.1, syl: 4.3 },
  { freq: 780, q: 2.2, swell: 6.2, syl: 3.7 },
  { freq: 1150, q: 2.6, swell: 11.7, syl: 5.2 },
];

/** Pentatonic steps (semitones) for the taps. */
const SCALE = [0, 2, 4, 7, 9, 12];

/** Seeded PRNG (mulberry32): 0 <= x < 1. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small integer hash of a tap's place in time, for its pitch and pan. */
function hashOf(at) {
  return prng(Math.round(at * 1000) ^ 0x9e3779b9)();
}

/**
 * Builds the graph on a new AudioContext.
 * @returns {{ctx: AudioContext, setOn: (on: boolean) => void, setMurmur: (level: number) => void,
 *   breathe: (nowMs: number) => void, hit: (h: {kind: string, at: number}) => void}}
 */
export function createSynth() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const t0 = () => ctx.currentTime;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  limiter.connect(ctx.destination);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.01;
  comp.release.value = 0.3;
  comp.connect(limiter);

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(comp);

  // Murmur: seeded white noise through band-passes, one per voice.
  const rand = prng(20261117);
  const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;

  const murmurTone = ctx.createBiquadFilter();
  murmurTone.type = 'lowpass';
  murmurTone.frequency.value = 1800;
  murmurTone.connect(master);
  const murmur = ctx.createGain();
  murmur.gain.value = MURMUR_FLOOR;
  murmur.connect(murmurTone);

  const voices = VOICES.map((v, i) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = v.freq;
    band.Q.value = v.q;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    src.connect(band).connect(gain).connect(murmur);
    src.start(0, (i * noise.duration) / VOICES.length);
    return { ...v, band, gain, phase: i * 1.7 };
  });

  // Taps go through their own bus, a touch under the murmur's top.
  const taps = ctx.createGain();
  taps.gain.value = 0.8;
  taps.connect(master);

  /** One enveloped oscillator into `out`. */
  const tone = (out, type, freq, start, attack, decay, peak, detune = 0) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
    osc.connect(env).connect(out);
    osc.start(start);
    osc.stop(start + attack + decay + 0.05);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  };

  return {
    ctx,
    setOn(on) {
      master.gain.setTargetAtTime(on ? MASTER : 0, t0(), 0.12);
    },
    setMurmur(level) {
      const l = Math.min(1, Math.max(0, level));
      murmur.gain.setTargetAtTime(MURMUR_FLOOR + MURMUR_SPAN * l, t0(), 0.6);
    },
    /** Slow swells and a syllable flutter of each voice, from the decorative clock. */
    breathe(nowMs) {
      const s = nowMs / 1000;
      for (const v of voices) {
        const swell = 0.5 + 0.5 * Math.sin((2 * Math.PI * s) / v.swell + v.phase);
        const syl = 0.5 + 0.5 * Math.sin(2 * Math.PI * v.syl * s + v.phase * 3);
        v.gain.gain.setTargetAtTime(0.25 + 0.45 * swell * (0.55 + 0.45 * syl), t0(), 0.05);
        v.band.frequency.setTargetAtTime(v.freq * (0.92 + 0.16 * swell), t0(), 0.3);
      }
    },
    /** A short tap, now. */
    hit(h) {
      const r = hashOf(h.at);
      const start = t0() + 0.01;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const out = pan ?? ctx.createGain();
      if (pan) pan.pan.value = (r - 0.5) * 0.8;
      out.connect(taps);
      const step = SCALE[Math.floor(r * SCALE.length) % SCALE.length];
      if (h.kind === 'faithful') {
        const f = 523.25 * 2 ** (step / 12); // around C5
        tone(out, 'sine', f, start, 0.006, 0.35, 0.16);
        tone(out, 'sine', f * 2, start, 0.004, 0.18, 0.04);
      } else if (h.kind === 'changed') {
        const f = 440 * 2 ** (step / 12); // around A4, a little sour
        tone(out, 'triangle', f, start, 0.008, 0.45, 0.12);
        tone(out, 'triangle', f * 2 ** (1 / 12), start, 0.008, 0.4, 0.09, 18);
      } else {
        const f = 1046.5 * 2 ** (step / 12); // a small bell
        tone(out, 'sine', f, start, 0.003, 1.1, 0.07);
        tone(out, 'sine', f * 2.76, start, 0.002, 0.5, 0.025);
        tone(out, 'sine', f * 5.4, start, 0.001, 0.25, 0.012);
      }
      setTimeout(() => out.disconnect(), 1500);
    },
  };
}
