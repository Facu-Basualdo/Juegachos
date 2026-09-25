import { getAudio, resumeAudio } from "./audio";
import type { EffectId } from "./ImitameTransport";
import { soundDuration, type Note, type Sound, type Timbre } from "./sounds";

/**
 * Sintesis de los sonidos de referencia y reproduccion de las tomas con los
 * sabotajes de la ruleta. Todo Web Audio, sin assets.
 */

const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBufferSourceNode {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  return src;
}

/** Programa el contorno de altura de una nota sobre un AudioParam de frecuencia. */
function scheduleContour(param: AudioParam, note: Note, at: number, mult = 1): void {
  const m = note.m ?? [60];
  param.setValueAtTime(midiToHz(m[0]) * mult, at);
  if (m.length === 1) return;
  const step = note.d / (m.length - 1);
  for (let i = 1; i < m.length; i++) {
    param.exponentialRampToValueAtTime(midiToHz(m[i]) * mult, at + step * i);
  }
}

/** Vibrato suave (LFO sobre `detune`), para que la voz y el silbido no suenen a tono de prueba. */
function vibrato(ctx: AudioContext, osc: OscillatorNode, at: number, end: number, cents: number): void {
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.frequency.value = 5.5;
  depth.gain.value = cents;
  lfo.connect(depth);
  depth.connect(osc.detune);
  lfo.start(at);
  lfo.stop(end);
}

function envelope(ctx: AudioContext, at: number, d: number, peak: number, attack: number, release: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, Math.max(at + attack, at + d - release));
  g.gain.exponentialRampToValueAtTime(0.0001, at + d);
  return g;
}

function playNote(ctx: AudioContext, out: AudioNode, timbre: Timbre, note: Note, at: number): void {
  const end = at + note.d + 0.02;
  switch (timbre) {
    case "silbido": {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      scheduleContour(osc.frequency, note, at);
      vibrato(ctx, osc, at, end, 18);
      const env = envelope(ctx, at, note.d, 0.35, 0.03, 0.06);
      osc.connect(env).connect(out);
      osc.start(at);
      osc.stop(end);
      return;
    }
    case "voz": {
      // Diente de sierra por dos formantes de "a": suena a garganta, no a oscilador.
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      scheduleContour(osc.frequency, note, at);
      vibrato(ctx, osc, at, end, 25);
      const env = envelope(ctx, at, note.d, 0.5, 0.04, 0.08);
      for (const [f, q, g] of [
        [750, 5, 1],
        [1200, 6, 0.6],
        [2600, 8, 0.25],
      ] as const) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = f;
        bp.Q.value = q;
        const gain = ctx.createGain();
        gain.gain.value = g;
        osc.connect(bp).connect(gain).connect(env);
      }
      env.connect(out);
      osc.start(at);
      osc.stop(end);
      return;
    }
    case "ladrido": {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      scheduleContour(osc.frequency, note, at);
      const n = noise(ctx);
      const nGain = ctx.createGain();
      nGain.gain.value = 0.35;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 900;
      bp.Q.value = 1.4;
      const env = envelope(ctx, at, note.d, 0.9, 0.006, note.d * 0.7);
      osc.connect(bp);
      n.connect(nGain).connect(bp);
      bp.connect(env).connect(out);
      osc.start(at);
      osc.stop(end);
      n.start(at);
      n.stop(end);
      return;
    }
    case "bip": {
      const osc = ctx.createOscillator();
      osc.type = "square";
      scheduleContour(osc.frequency, note, at);
      const env = envelope(ctx, at, note.d, 0.12, 0.005, 0.01);
      osc.connect(env).connect(out);
      osc.start(at);
      osc.stop(end);
      return;
    }
    case "bocina": {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1800;
      const env = envelope(ctx, at, note.d, 0.22, 0.015, 0.04);
      for (const cents of [-9, 9]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.detune.value = cents;
        scheduleContour(osc.frequency, note, at);
        osc.connect(lp);
        osc.start(at);
        osc.stop(end);
      }
      lp.connect(env).connect(out);
      return;
    }
    case "golpe": {
      const n = noise(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1400;
      bp.Q.value = 0.9;
      const env = envelope(ctx, at, note.d, 1, 0.002, note.d * 0.9);
      n.connect(bp).connect(env).connect(out);
      n.start(at);
      n.stop(end);
      return;
    }
  }
}

/** Reproduce un sonido de referencia. Devuelve su duracion en segundos. */
export function playSound(sound: Sound): number {
  const a = getAudio();
  if (!a) return 0;
  resumeAudio();
  const at = a.ctx.currentTime + 0.05;
  for (const note of sound.notes) playNote(a.ctx, a.bus, sound.timbre, note, at + note.t);
  return soundDuration(sound);
}

// ---------- Tomas ----------

/** Arma un AudioBuffer reproducible con las muestras de una toma (ya decodificada del mu-law). */
export function takeToBuffer(pcm: Float32Array, rate: number): AudioBuffer | null {
  const a = getAudio();
  if (!a || pcm.length === 0) return null;
  const buf = a.ctx.createBuffer(1, pcm.length, rate);
  buf.getChannelData(0).set(pcm);
  return buf;
}

/** Cuanto dura la reproduccion de una toma con su efecto (el helio la acelera). */
export function playbackDuration(buffer: AudioBuffer, effect: EffectId | null): number {
  return effect === "helio" ? buffer.duration / 1.5 : buffer.duration;
}

/**
 * Reproduce la toma de un jugador, con el sabotaje que le toco en la ruleta. Los
 * bonus (x2, x1.5) no cambian el sonido, solo los puntos.
 */
export function playTake(buffer: AudioBuffer, effect: EffectId | null): number {
  const a = getAudio();
  if (!a) return 0;
  resumeAudio();
  const { ctx, bus } = a;
  const at = ctx.currentTime + 0.05;
  const dur = playbackDuration(buffer, effect);

  if (effect === "pedo") {
    playFart(ctx, bus, at, Math.max(0.6, dur));
    return dur;
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 1.4;
  src.connect(gain);

  if (effect === "helio") src.playbackRate.value = 1.5;

  if (effect === "eco") {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.2;
    const fb = ctx.createGain();
    fb.gain.value = 0.5;
    gain.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(bus);
    gain.connect(bus);
  } else if (effect === "saturado") {
    const shaper = ctx.createWaveShaper();
    const k = 60;
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    shaper.curve = curve;
    const pre = ctx.createGain();
    pre.gain.value = 4;
    const post = ctx.createGain();
    post.gain.value = 0.3;
    gain.connect(pre).connect(shaper).connect(post).connect(bus);
  } else if (effect === "cortado") {
    // Compuerta cuadrada a 7 Hz: la toma sale entrecortada.
    const gate = ctx.createGain();
    gate.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 7;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(gate.gain);
    gain.connect(gate).connect(bus);
    lfo.start(at);
    lfo.stop(at + dur + 0.1);
  } else {
    gain.connect(bus);
  }

  src.start(at);
  return dur;
}

/** El sabotaje estrella: la toma no suena, suena esto. */
function playFart(ctx: AudioContext, out: AudioNode, at: number, dur: number): void {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(95, at);
  osc.frequency.linearRampToValueAtTime(70, at + dur);
  // Trino irregular: dos LFO lentos desafinados sobre la frecuencia.
  for (const [f, depthHz] of [
    [23, 18],
    [9, 12],
  ] as const) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = f;
    const depth = ctx.createGain();
    depth.gain.value = depthHz;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(at);
    lfo.stop(at + dur + 0.05);
  }
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 420;
  lp.Q.value = 6;
  const n = noise(ctx);
  const nGain = ctx.createGain();
  nGain.gain.value = 0.25;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(0.9, at + 0.04);
  env.gain.setValueAtTime(0.9, at + dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(lp);
  n.connect(nGain).connect(lp);
  lp.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.05);
  n.start(at);
  n.stop(at + dur + 0.05);
}
