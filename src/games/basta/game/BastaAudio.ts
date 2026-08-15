import { getAudioContext, resumeAudio } from "./audioContext";

/**
 * Sample real (mp3) del grito de BASTA. Es la excepcion a la regla de sintetizar todo
 * con Web Audio, por el mismo motivo que las reacciones de Bomba Palabra: el momento en
 * que alguien corta la ronda es el golpe de efecto del juego y un oscilador no lo da.
 *
 * El archivo vive en `public/sfx/basta/basta.mp3` (ver su README) y se sirve estatico,
 * sin pasar por el bundle. Se precarga una vez por pagina — se baja, se decodifica a
 * `AudioBuffer` y queda en memoria — asi suena en el instante en que llega el `bt:state`
 * de la fase `grace`, y no medio segundo despues.
 *
 * **Degrada**: si el mp3 no esta, no baja o no decodifica, `play()` devuelve `false` y
 * `SoundEffects.playBasta()` cae al campanazo sintetizado. Nunca queda mudo.
 */

/** Servido desde `public/`, asi que la URL es absoluta desde la raiz del sitio. */
const URL = "/sfx/basta/basta.mp3";
/** El sample viene mucho mas fuerte que los osciladores del juego (pico <= 0.12). */
const SAMPLE_GAIN = 0.5;

let buffer: AudioBuffer | null = null;
let preloaded = false;

export class BastaAudio {
  /**
   * Dispara la descarga del sample. Idempotente: llamarla de nuevo no vuelve a bajar
   * nada. Conviene llamarla apenas se sabe que se va a jugar (no al primer BASTA), para
   * que ya este decodificado cuando alguien corte.
   */
  static preload(): void {
    if (preloaded) return;
    preloaded = true;
    void (async () => {
      const ctx = getAudioContext();
      if (!ctx) return;
      try {
        const res = await fetch(URL);
        if (!res.ok) return; // 404 en prod: no hay sample, va el sintetizado
        buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        // Silencioso a proposito: el fallback sintetizado ya cubre el caso. Cae aca la
        // red caida, un mp3 corrupto, y tambien el archivo faltante en `npm run dev`,
        // donde Vite responde 200 con el index.html y es el decode el que falla.
      }
    })();
  }

  /** Reproduce el grito. Devuelve `false` si no esta listo, y el llamador sintetiza. */
  static play(): boolean {
    const ctx = getAudioContext();
    if (!ctx || !buffer) return false;
    resumeAudio(ctx);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = SAMPLE_GAIN;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    return true;
  }
}
