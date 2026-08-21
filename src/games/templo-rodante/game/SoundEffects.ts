let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

/** Rafaga de ruido filtrado: la base de casi todo lo que suena a piedra. */
function noiseBurst(
  ctx: AudioContext,
  now: number,
  opts: { dur: number; gain: number; type: BiquadFilterType; from: number; to: number },
): void {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * opts.dur)), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
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

/** Efectos sintetizados (Web Audio), sin assets. */
export class SoundEffects {
  /** Blip de la cuenta regresiva (3 / 2 / 1 / YA) — 750 Hz, compartido del repo. */
  static playCountdownTick(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();

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

  /** Impulso corto de aire al despegar. */
  static playJump(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    noiseBurst(ctx, now, { dur: 0.16, gain: 0.055, type: "bandpass", from: 620, to: 1900 });
  }

  /** Roce de tela y arena al tirarse al piso. */
  static playDuck(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    noiseBurst(ctx, now, { dur: 0.2, gain: 0.05, type: "lowpass", from: 2400, to: 380 });
  }

  /** Golpe seco de las botas contra la losa. */
  static playLand(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.11);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.start(now);
    osc.stop(now + 0.15);

    noiseBurst(ctx, now, { dur: 0.08, gain: 0.04, type: "lowpass", from: 1100, to: 260 });
  }

  /** La piedra que arranca a rodar cuando una viga entra en la sala. */
  static playRumble(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "triangle";
    osc.frequency.setValueAtTime(92, now);
    osc.frequency.exponentialRampToValueAtTime(64, now + 0.3);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    osc.start(now);
    osc.stop(now + 0.36);

    noiseBurst(ctx, now, { dur: 0.3, gain: 0.028, type: "lowpass", from: 520, to: 150 });
  }

  /** Impacto: la viga te lleva puesto. */
  static playHit(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "square";
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(44, now + 0.42);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
    osc.start(now);
    osc.stop(now + 0.48);

    noiseBurst(ctx, now, { dur: 0.28, gain: 0.11, type: "lowpass", from: 1800, to: 190 });
  }
}
