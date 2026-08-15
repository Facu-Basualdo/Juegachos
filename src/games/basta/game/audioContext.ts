/**
 * El `AudioContext` compartido del juego. Vive en su propio modulo hoja (sin imports)
 * para que `SoundEffects` y `BastaAudio` lo usen sin cerrar un ciclo entre ellos:
 * `BastaAudio` reproduce el sample y `SoundEffects` es su fallback sintetizado.
 *
 * Arranca `suspended` hasta el primer gesto del usuario, como pide el navegador.
 */
let audioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

export function resumeAudio(ctx: AudioContext): void {
  if (ctx.state === "suspended") void ctx.resume();
}
