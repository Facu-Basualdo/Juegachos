let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

function ready(): { ctx: AudioContext; now: number } | null {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, now: ctx.currentTime };
}

/** Rafaga de ruido filtrado: la base de todo lo que suena a arena. */
function noiseBurst(
  ctx: AudioContext,
  now: number,
  opts: { dur: number; gain: number; type: BiquadFilterType; from: number; to: number },
): void {
  const len = Math.max(1, Math.floor(ctx.sampleRate * opts.dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.setValueAtTime(opts.from, now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), now + opts.dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(opts.gain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(now);
  src.stop(now + opts.dur);
}

function tone(
  ctx: AudioContext,
  now: number,
  opts: { from: number; to: number; dur: number; gain: number; type?: OscillatorType; delay?: number },
): void {
  const t0 = now + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(opts.gain, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

/** Efectos sintetizados (Web Audio), sin assets. */
export class SoundEffects {
  /** Blip de la cuenta regresiva (3 / 2 / 1 / YA) — 750 Hz, compartido del repo. */
  static playCountdownTick(): void {
    const r = ready();
    if (!r) return;
    const { ctx, now } = r;
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

  /** Zapato contra la arena. `solid` = paso bien puesto: suena mas lleno. */
  static playStep(solid: boolean): void {
    const r = ready();
    if (!r) return;
    noiseBurst(r.ctx, r.now, {
      dur: solid ? 0.15 : 0.1,
      gain: solid ? 0.075 : 0.045,
      type: "lowpass",
      from: solid ? 1500 : 2400,
      to: solid ? 220 : 420,
    });
    if (solid) tone(r.ctx, r.now, { from: 130, to: 74, dur: 0.12, gain: 0.05 });
  }

  /** Roce del pie que despega. */
  static playToeOff(): void {
    const r = ready();
    if (!r) return;
    noiseBurst(r.ctx, r.now, { dur: 0.11, gain: 0.03, type: "bandpass", from: 900, to: 2100 });
  }

  /** Derrumbe: el bicho se dobla y da contra el piso. */
  static playFall(): void {
    const r = ready();
    if (!r) return;
    const { ctx, now } = r;
    tone(ctx, now, { from: 320, to: 58, dur: 0.42, gain: 0.075, type: "triangle" });
    noiseBurst(ctx, now, { dur: 0.34, gain: 0.09, type: "lowpass", from: 1100, to: 130 });
    noiseBurst(ctx, now + 0.16, { dur: 0.24, gain: 0.05, type: "lowpass", from: 700, to: 110 });
  }

  /** Campanita al pasar la bandera del record. */
  static playRecord(): void {
    const r = ready();
    if (!r) return;
    const { ctx, now } = r;
    tone(ctx, now, { from: 784, to: 784, dur: 0.2, gain: 0.05 });
    tone(ctx, now, { from: 1046, to: 1046, dur: 0.3, gain: 0.045, delay: 0.09 });
    tone(ctx, now, { from: 1318, to: 1318, dur: 0.42, gain: 0.04, delay: 0.19 });
  }
}
