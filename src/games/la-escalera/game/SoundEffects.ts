let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

function ping(
  type: OscillatorType,
  from: number,
  to: number,
  dur: number,
  gainPeak: number,
  ramp: "lin" | "exp" = "exp",
): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(from, now);
  if (ramp === "lin") osc.frequency.linearRampToValueAtTime(to, now + dur);
  else osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + dur);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.start(now);
  osc.stop(now + dur);
}

function noise(dur: number, fromHz: number, toHz: number, peak: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  const size = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(fromHz, now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), now + dur);
  const gain = ctx.createGain();
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(peak, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.start(now);
  src.stop(now + dur);
}

export class SoundEffects {
  /** Tick del countdown: blip 750 Hz compartido por todo el repo. */
  static playCountdownTick(): void {
    ping("sine", 750, 750, 0.05, 0.08);
  }

  /** Acierto: bota contra el hierro; sube de tono con la racha. */
  static playStep(combo: number): void {
    const k = Math.min(combo, 12);
    ping("square", 320 + k * 26, 190 + k * 20, 0.07, 0.05);
    ping("sine", 640 + k * 40, 900 + k * 40, 0.09, 0.045);
  }

  /** Racha completa: campana corta y dorada. */
  static playCombo(): void {
    ping("sine", 620, 930, 0.16, 0.08);
    ping("sine", 930, 1240, 0.22, 0.045);
  }

  /** Error: la escalera te gana, chirrido corto y sordo. */
  static playSlip(): void {
    ping("sawtooth", 260, 90, 0.22, 0.09, "lin");
    noise(0.16, 900, 240, 0.1);
  }

  /** Se vencio la flecha sin apretar nada: aviso seco. */
  static playTimeout(): void {
    ping("square", 180, 120, 0.14, 0.07, "lin");
  }

  /** El cuerpo llega a las puas: crujido humedo y hierro entrando. */
  static playImpale(): void {
    noise(0.3, 500, 90, 0.26);
    ping("sawtooth", 180, 44, 0.35, 0.16, "lin");
    ping("square", 90, 50, 0.5, 0.12, "lin");
  }

  /** Muerte: caida al pozo y golpe metalico contra las puas. */
  static playDeath(): void {
    ping("sawtooth", 700, 90, 0.4, 0.12, "lin");
    noise(0.24, 1400, 200, 0.18);
    ping("triangle", 120, 38, 0.34, 0.22, "lin");
  }
}
