/**
 * El `AudioContext` del juego y su bus de salida. Modulo hoja (sin imports) para que
 * synth, efectos y grabadora lo compartan sin ciclos.
 *
 * Todo lo que suena pasa por `bus` -> `analyser` -> destino: el analizador es lo que
 * mueve la boca del muñeco mientras suena la referencia o la toma de alguien.
 *
 * En este juego el audio no es decoracion, es el juego: si el contexto queda
 * `suspended` (el navegador no dio permiso de sonar), nadie escucha el sonido a
 * imitar. `installUnlock` lo despierta con el primer gesto en cualquier lado de la
 * pagina — en fase de captura sobre `window`, porque el `RoomOverlay` de la sala corta
 * la propagacion en su raiz y su boton "Listo" es justamente el primer toque que hay.
 */
let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let levelBuf: Float32Array<ArrayBuffer> | null = null;

export function getAudio(): { ctx: AudioContext; bus: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    bus = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    levelBuf = new Float32Array(analyser.fftSize);
    bus.connect(analyser);
    analyser.connect(ctx.destination);
  }
  return { ctx, bus: bus! };
}

export function resumeAudio(): void {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

export function audioRunning(): boolean {
  return getAudio()?.ctx.state === "running";
}

export function installUnlock(onChange: () => void): void {
  const unlock = () => {
    const a = getAudio();
    if (!a) return;
    if (a.ctx.state !== "running") void a.ctx.resume().then(onChange);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  getAudio()?.ctx.addEventListener("statechange", onChange);
}

/** Nivel (RMS, 0..~0.5) de lo que esta sonando ahora por el bus. */
export function outputLevel(): number {
  if (!analyser || !levelBuf) return 0;
  analyser.getFloatTimeDomainData(levelBuf);
  let sum = 0;
  for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
  return Math.sqrt(sum / levelBuf.length);
}
