let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

// --- Continuous 2-stroke moped engine (persistent node graph, not a one-shot) ---
// The target is the classic ANNOYING MOSQUITO whine of a screaming moped, not a
// low aircraft drone (a first version at 52-128 Hz read exactly like a small
// plane). So: high firing rate (a 2T fires every revolution — idle here is
// ~5700 rpm ≈ 95 Hz, flat out ~235 Hz), a HIGHPASS that strips the boomy lows,
// a wide-open lowpass so the saw harmonics buzz, and an octave-up "whine" saw
// that carries the sting. The "ring-ding" chatter is band-passed exhaust noise
// amplitude-chopped at the firing rate; a slow LFO wobbles the rate a touch so
// it putters instead of droning.
const ENGINE_IDLE_HZ = 95;
const ENGINE_MAX_HZ = 235;
const ENGINE_VOLUME = 0.042;

interface EngineNodes {
  saw: OscillatorNode;
  saw2: OscillatorNode;
  whine: OscillatorNode;
  chop: OscillatorNode;
  lfo: OscillatorNode;
  noise: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  master: GainNode;
}

let engine: EngineNodes | null = null;
let engineLastT = -1;

/** Synthesized sound effects (Web Audio API, no assets). */
export class SoundEffects {
  /** Starts the moped engine loop (idempotent). Runs until `stopEngine`. */
  static startEngine(): void {
    const ctx = getAudioContext();
    if (!ctx || engine) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(ENGINE_VOLUME, now + 0.25);
    master.connect(ctx.destination);

    // The tonal chain: highpass (kills the aircraft-drone lows) into a wide
    // lowpass that opens further with the revs.
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(240, now);
    highpass.Q.value = 0.5;
    highpass.connect(master);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2600, now);
    filter.Q.value = 0.6;
    filter.connect(highpass);

    // Two detuned saws at the firing rate = the body of the buzz.
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(ENGINE_IDLE_HZ, now);
    const sawGain = ctx.createGain();
    sawGain.gain.value = 0.5;
    saw.connect(sawGain);
    sawGain.connect(filter);

    const saw2 = ctx.createOscillator();
    saw2.type = "sawtooth";
    saw2.frequency.setValueAtTime(ENGINE_IDLE_HZ, now);
    saw2.detune.value = 22; // slight detune = rough, mechanical
    const saw2Gain = ctx.createGain();
    saw2Gain.gain.value = 0.28;
    saw2.connect(saw2Gain);
    saw2Gain.connect(filter);

    // Octave-up saw: the mosquito sting on top of the buzz.
    const whine = ctx.createOscillator();
    whine.type = "sawtooth";
    whine.frequency.setValueAtTime(ENGINE_IDLE_HZ * 2, now);
    whine.detune.value = -14;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.24;
    whine.connect(whineGain);
    whineGain.connect(filter);

    // Exhaust noise, band-passed and amplitude-chopped at the firing rate —
    // this is what makes it read "ring-ding-ding" 2-stroke, not a synth pad.
    const noiseLen = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseBand = ctx.createBiquadFilter();
    noiseBand.type = "bandpass";
    noiseBand.frequency.value = 2400;
    noiseBand.Q.value = 1.0;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.22; // chopped around this base by `chop`
    noise.connect(noiseBand);
    noiseBand.connect(noiseGain);
    noiseGain.connect(master);

    const chop = ctx.createOscillator();
    chop.type = "square";
    chop.frequency.setValueAtTime(ENGINE_IDLE_HZ, now);
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.16;
    chop.connect(chopDepth);
    chopDepth.connect(noiseGain.gain);

    // Slow small wobble on the firing rate so the idle putters.
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 7.5;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 4;
    lfo.connect(lfoDepth);
    lfoDepth.connect(saw.frequency);
    lfoDepth.connect(saw2.frequency);
    lfoDepth.connect(whine.frequency);
    lfoDepth.connect(chop.frequency);

    saw.start(now);
    saw2.start(now);
    whine.start(now);
    chop.start(now);
    lfo.start(now);
    noise.start(now);

    engine = { saw, saw2, whine, chop, lfo, noise, filter, master };
    engineLastT = -1;
  }

  /** Revs the engine: `t` is the normalized travel speed (0 = base, 1 = max). */
  static setEngineSpeed(t: number): void {
    const ctx = getAudioContext();
    if (!ctx || !engine) return;
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    // Called every frame — skip tiny changes so the automation list stays short.
    if (Math.abs(clamped - engineLastT) < 0.015) return;
    engineLastT = clamped;
    const now = ctx.currentTime;
    const f = ENGINE_IDLE_HZ + (ENGINE_MAX_HZ - ENGINE_IDLE_HZ) * clamped;
    engine.saw.frequency.setTargetAtTime(f, now, 0.09);
    engine.saw2.frequency.setTargetAtTime(f, now, 0.09);
    engine.whine.frequency.setTargetAtTime(f * 2, now, 0.09);
    engine.chop.frequency.setTargetAtTime(f, now, 0.09);
    engine.filter.frequency.setTargetAtTime(2600 + 1600 * clamped, now, 0.12);
  }

  /** Cuts the engine (crash / run over) with a quick fade. Safe to re-call. */
  static stopEngine(): void {
    const ctx = getAudioContext();
    if (!ctx || !engine) return;
    const { saw, saw2, whine, chop, lfo, noise, master } = engine;
    engine = null;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    const end = now + 0.15;
    saw.stop(end);
    saw2.stop(end);
    whine.stop(end);
    chop.stop(end);
    lfo.stop(end);
    noise.stop(end);
    window.setTimeout(() => master.disconnect(), 300);
  }

  /** Countdown tick (3 / 2 / 1 / YA) — the shared 750 Hz blip. */
  static playCountdownTick(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(750, now);
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  /** A short airy whoosh when a pizza is thrown. */
  static playThrow(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.18;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + 0.16);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.18);
  }

  /** A cheerful two-note delivery ding; pitch rises with the combo. */
  static playDeliver(combo: number): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const step = Math.min(combo - 1, 8);
    const base = 660 * Math.pow(2, step / 12);
    for (const [i, mult] of [1, 1.5].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      const t = now + i * 0.08;
      osc.frequency.setValueAtTime(base * mult, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.16);
    }
  }

  /** A soft descending blip when a customer is missed. */
  static playMiss(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  /** Harsh crunch when the scooter wipes out. */
  static playCrash(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "square";
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(44, now + 0.4);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);

    // A short noise crack layered on top.
    const bufferSize = ctx.sampleRate * 0.25;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    src.connect(ng);
    ng.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.25);
  }
}
