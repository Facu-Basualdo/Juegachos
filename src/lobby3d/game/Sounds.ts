import { EMOTES, type EmoteId } from "./constants";

/**
 * Sonido de La Feria. Un solo `AudioContext` por pagina.
 *
 * - **Reacciones**: los mismos samples de Bomba Palabra / Cadena de Palabras
 *   (`public/sfx/emotes/<id>.mp3`, ver su README). Es la excepcion del repo a la regla
 *   de sintetizar todo: una risa humana no la hace un oscilador. Copia propia del
 *   `EmoteAudio` de esos juegos (regla de decoupling). Si un mp3 no esta o no
 *   decodifica, suena un blip sintetizado: la reaccion nunca queda muda.
 * - **Final**: cornetas y bengalas (silbido, estallido y chisporroteo), sintetizadas
 *   con Web Audio. Sin sonido la final parecia un velorio (pedido del programador).
 *
 * El contexto arranca `suspended` hasta un gesto del usuario: `unlockAudio` se llama en
 * el primer `pointerdown` / `keydown`.
 */

const EMOTE_URL = "/sfx/emotes/";
/** Los samples son mucho mas fuertes que los osciladores; mismo criterio que Bomba Palabra. */
const SAMPLE_GAIN = 0.45;
const MASTER = 0.8;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
const emoteBuffers = new Map<EmoteId, AudioBuffer>();
let preloaded = false;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);
  }
  return ctx;
}

function out(): AudioNode | null {
  audio();
  return master;
}

/** Destraba el audio (el navegador lo tiene suspendido hasta un gesto). */
export function unlockAudio(): void {
  const c = audio();
  if (c && c.state === "suspended") void c.resume();
}

/** Un segundo de ruido blanco, reusado por las bengalas. */
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

// ---------- Reacciones ----------

/** Baja y decodifica los cinco samples (una vez por pagina). */
export function preloadEmotes(): void {
  if (preloaded) return;
  preloaded = true;
  const c = audio();
  if (!c) return;
  for (const { id } of EMOTES) {
    void (async () => {
      try {
        const res = await fetch(`${EMOTE_URL}${id}.mp3`);
        if (!res.ok) return;
        emoteBuffers.set(id, await c.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // Sin sample (o en dev, donde Vite devuelve el index.html): va el blip sintetizado.
      }
    })();
  }
}

/**
 * Suena una reaccion. `gain` baja las lejanas; `pan` (-1 izquierda .. 1 derecha) las
 * ubica respecto de donde mira uno. Las reacciones se superponen a proposito, como en
 * Bomba Palabra: no se corta la anterior.
 */
export function playEmote(id: EmoteId, gain = 1, pan = 0): void {
  const c = audio();
  const dest = out();
  if (!c || !dest) return;
  unlockAudio();
  const g = c.createGain();
  const p = c.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p);
  p.connect(dest);
  const buffer = emoteBuffers.get(id);
  if (buffer) {
    const src = c.createBufferSource();
    src.buffer = buffer;
    g.gain.value = SAMPLE_GAIN * gain;
    src.connect(g);
    src.start();
    return;
  }
  // Respaldo: dos notas cortas, distintas por reaccion.
  const base = { risa: 520, sorpresa: 440, enojo: 180, burla: 600, llanto: 330 }[id];
  const t = c.currentTime;
  for (let k = 0; k < 2; k++) {
    const o = c.createOscillator();
    o.type = id === "enojo" ? "sawtooth" : "triangle";
    o.frequency.setValueAtTime(base * (k === 0 ? 1 : id === "llanto" ? 0.8 : 1.25), t + k * 0.14);
    const e = c.createGain();
    e.gain.setValueAtTime(0, t + k * 0.14);
    e.gain.linearRampToValueAtTime(0.08 * gain, t + k * 0.14 + 0.02);
    e.gain.exponentialRampToValueAtTime(0.001, t + k * 0.14 + 0.13);
    o.connect(e);
    e.connect(p);
    o.start(t + k * 0.14);
    o.stop(t + k * 0.14 + 0.15);
  }
}

// ---------- Final: cornetas y bengalas ----------

/**
 * Corneta de cumpleaños ("prrrrp"): dos sierras apenas desafinadas, con un tremolo
 * rapido que le da el zumbido de papel, filtradas, y una caida de tono al final.
 */
export function playHorn(delay = 0, pitch = 330, gain = 1): void {
  const c = audio();
  const dest = out();
  if (!c || !dest) return;
  const t = c.currentTime + delay;
  const len = 0.55 + Math.random() * 0.25;
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.09 * gain, t + 0.04);
  env.gain.setValueAtTime(0.09 * gain, t + len - 0.12);
  env.gain.exponentialRampToValueAtTime(0.001, t + len);
  const trem = c.createGain();
  trem.gain.value = 0.6;
  const lfo = c.createOscillator();
  lfo.frequency.value = 24;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.4;
  lfo.connect(lfoGain);
  lfoGain.connect(trem.gain);
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1400;
  filter.Q.value = 1.2;
  for (const detune of [-8, 9]) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.detune.value = detune;
    o.frequency.setValueAtTime(pitch * 0.94, t);
    o.frequency.linearRampToValueAtTime(pitch, t + 0.06);
    o.frequency.setValueAtTime(pitch, t + len - 0.15);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.7, t + len);
    o.connect(trem);
    o.start(t);
    o.stop(t + len + 0.02);
  }
  trem.connect(filter);
  filter.connect(env);
  env.connect(dest);
  lfo.start(t);
  lfo.stop(t + len + 0.02);
}

/** Fanfarria de cornetas desparejas (como un grupo soplando a la vez). */
export function playHornFanfare(): void {
  const pitches = [294, 349, 392, 440, 330];
  pitches.forEach((p, i) => playHorn(i * 0.12 + Math.random() * 0.08, p, 0.9));
  playHorn(0.9, 523, 1);
}

/** Silbido de la bengala subiendo. */
export function playLaunch(gain = 1): void {
  const c = audio();
  const dest = out();
  if (!c || !dest) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 8;
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(3200, t + 0.9);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.12 * gain, t + 0.15);
  env.gain.exponentialRampToValueAtTime(0.001, t + 1);
  src.connect(bp);
  bp.connect(env);
  env.connect(dest);
  src.start(t);
  src.stop(t + 1.05);
}

/** Estallido (grave, con cola) y el chisporroteo despues. */
export function playBurst(gain = 1): void {
  const c = audio();
  const dest = out();
  if (!c || !dest) return;
  const t = c.currentTime;
  const boom = c.createBufferSource();
  boom.buffer = noiseBuffer(c);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(1200, t);
  lp.frequency.exponentialRampToValueAtTime(200, t + 0.8);
  const env = c.createGain();
  env.gain.setValueAtTime(0.5 * gain, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
  boom.connect(lp);
  lp.connect(env);
  env.connect(dest);
  boom.start(t);
  boom.stop(t + 1.15);

  // Chisporroteo: clics cortos de ruido agudo, al azar.
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 3000;
  hp.connect(dest);
  for (let i = 0; i < 18; i++) {
    const at = t + 0.25 + Math.random() * 0.9;
    const s = c.createBufferSource();
    s.buffer = noiseBuffer(c);
    const e = c.createGain();
    e.gain.setValueAtTime(0.12 * gain * Math.random(), at);
    e.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
    s.connect(e);
    e.connect(hp);
    s.start(at, Math.random() * 0.9);
    s.stop(at + 0.04);
  }
}
