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
  ramp: "lin" | "exp" = "exp"
): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
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

export class SoundEffects {
  /** Countdown tick — shared 750 Hz blip. */
  static playCountdownTick(): void {
    ping("sine", 750, 750, 0.05, 0.08);
  }

  /** Wing flap: soft airy whoosh. */
  static playFlap(): void {
    ping("triangle", 420, 260, 0.1, 0.05);
  }

  /** Wall bounce: a dull iron knock. */
  static playBounce(): void {
    ping("square", 200, 120, 0.09, 0.07);
    ping("sine", 90, 60, 0.14, 0.06, "lin");
  }

  /** Relic collected: a dark bell chime. */
  static playCandy(): void {
    ping("sine", 520, 780, 0.14, 0.09);
    ping("sine", 780, 1040, 0.2, 0.05);
  }

  /** Death: impaled — a harsh metallic screech into a low thud. */
  static playDeath(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    // Metallic screech.
    ping("sawtooth", 900, 120, 0.35, 0.12, "lin");
    // Noise burst (impact).
    const bufferSize = ctx.sampleRate * 0.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.18);
    const gain = ctx.createGain();
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    noise.start(now);
    noise.stop(now + 0.2);
    // Low sub thud.
    ping("triangle", 130, 40, 0.3, 0.22, "lin");
  }
}
