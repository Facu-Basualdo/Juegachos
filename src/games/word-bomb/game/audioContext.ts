/**
 * El `AudioContext` de la pagina, compartido por los efectos sintetizados
 * (`SoundEffects`) y los samples de las reacciones (`EmoteAudio`). Es un modulo hoja
 * (no importa nada) a proposito: si el contexto viviera dentro de `SoundEffects`,
 * `EmoteAudio` tendria que importarlo de ahi y `SoundEffects` importar `EmoteAudio`
 * para el fallback, cerrando un ciclo de imports.
 *
 * Un solo contexto por pagina: los navegadores limitan cuantos se pueden abrir, y
 * mezclar dos haria que el volumen de los samples no se pueda comparar con el de los
 * osciladores.
 */
let audioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

/** El contexto arranca `suspended` hasta que hay un gesto del usuario. */
export function resumeAudio(ctx: AudioContext): void {
  if (ctx.state === "suspended") void ctx.resume();
}
