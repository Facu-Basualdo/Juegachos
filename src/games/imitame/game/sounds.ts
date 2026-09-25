/**
 * Biblioteca de sonidos sintetizados del juego (sin assets): cada sonido es una lista de
 * notas con su contorno de altura, y de esa misma definicion salen el audio (`synth.ts`)
 * y la "partitura" contra la que se puntua (`analysis.ts`): la referencia no se analiza,
 * se lee.
 *
 * Los ids **espejan `SOUND_IDS` de `server/src/games/imitame.ts`** (el server sortea solo
 * el id). Los audios que sube la gente no viven aca: estan en Supabase (`clips.ts`).
 */

export type Timbre = "voz" | "silbido" | "ladrido" | "bip" | "bocina" | "golpe";

export interface Note {
  /** Inicio, en segundos desde el arranque del sonido. */
  t: number;
  /** Duracion, en segundos. */
  d: number;
  /**
   * Contorno de altura en MIDI (60 = do central), repartido parejo a lo largo de la
   * nota: `[62]` es una nota fija, `[62, 70, 60]` sube y baja. `null` = sin altura
   * (un golpe, un aplauso): cuenta para el ritmo pero no para la melodia.
   */
  m: number[] | null;
}

export interface SynthSound {
  id: string;
  pack: string;
  name: string;
  timbre: Timbre;
  notes: Note[];
}

export type Sound = SynthSound;

const beeps = (count: number, gap: number, d: number, pitches: number[]): Note[] =>
  Array.from({ length: count }, (_, i) => ({ t: i * gap, d, m: [pitches[i % pitches.length]] }));

export const SOUNDS: Sound[] = [
  // ---------- Animales ----------
  {
    id: "cucu",
    pack: "Animales",
    name: "El cucu",
    timbre: "silbido",
    notes: [
      { t: 0, d: 0.28, m: [76] },
      { t: 0.34, d: 0.42, m: [72] },
      { t: 1.0, d: 0.28, m: [76] },
      { t: 1.34, d: 0.42, m: [72] },
    ],
  },
  {
    id: "perro",
    pack: "Animales",
    name: "El perro",
    timbre: "ladrido",
    notes: [
      { t: 0, d: 0.17, m: [62, 55] },
      { t: 0.36, d: 0.17, m: [62, 55] },
      { t: 0.72, d: 0.22, m: [63, 54] },
    ],
  },
  { id: "gato", pack: "Animales", name: "El gato", timbre: "voz", notes: [{ t: 0, d: 1.0, m: [62, 70, 66, 60] }] },
  { id: "vaca", pack: "Animales", name: "La vaca", timbre: "voz", notes: [{ t: 0, d: 1.6, m: [55, 55, 50] }] },
  {
    id: "gallo",
    pack: "Animales",
    name: "El gallo",
    timbre: "voz",
    notes: [
      { t: 0, d: 0.15, m: [67] },
      { t: 0.2, d: 0.15, m: [67] },
      { t: 0.42, d: 0.18, m: [72] },
      { t: 0.66, d: 0.9, m: [76, 77, 72] },
    ],
  },
  { id: "lobo", pack: "Animales", name: "El lobo", timbre: "voz", notes: [{ t: 0, d: 2.2, m: [58, 69, 69, 62] }] },
  {
    id: "pato",
    pack: "Animales",
    name: "El pato",
    timbre: "bocina",
    notes: [
      { t: 0, d: 0.22, m: [62, 60] },
      { t: 0.34, d: 0.22, m: [62, 60] },
      { t: 0.7, d: 0.32, m: [62, 57] },
    ],
  },
  {
    id: "buho",
    pack: "Animales",
    name: "El buho",
    timbre: "silbido",
    notes: [
      { t: 0, d: 0.34, m: [64] },
      { t: 0.52, d: 0.24, m: [64] },
      { t: 0.9, d: 0.8, m: [67, 64] },
    ],
  },

  // ---------- Maquinas ----------
  { id: "sirena", pack: "Maquinas", name: "La sirena", timbre: "voz", notes: [{ t: 0, d: 2.4, m: [62, 71, 62, 71, 62] }] },
  { id: "alarma", pack: "Maquinas", name: "La alarma", timbre: "bip", notes: beeps(4, 0.3, 0.16, [76, 71]) },
  {
    id: "bocina",
    pack: "Maquinas",
    name: "La bocina",
    timbre: "bocina",
    notes: [
      { t: 0, d: 0.22, m: [60] },
      { t: 0.38, d: 0.8, m: [60] },
    ],
  },
  { id: "microondas", pack: "Maquinas", name: "El microondas", timbre: "bip", notes: beeps(3, 0.5, 0.3, [79]) },
  {
    id: "timbre",
    pack: "Maquinas",
    name: "El timbre",
    timbre: "silbido",
    notes: [
      { t: 0, d: 0.55, m: [76] },
      { t: 0.62, d: 1.0, m: [72] },
    ],
  },
  {
    id: "moto",
    pack: "Maquinas",
    name: "La moto",
    timbre: "bocina",
    notes: [
      { t: 0, d: 0.4, m: [45, 50] },
      { t: 0.46, d: 1.4, m: [50, 62, 58, 66] },
    ],
  },

  // ---------- Melodias ----------
  {
    id: "quinta",
    pack: "Melodias",
    name: "Ta-ta-ta-taaa",
    timbre: "voz",
    notes: [
      { t: 0, d: 0.18, m: [67] },
      { t: 0.22, d: 0.18, m: [67] },
      { t: 0.44, d: 0.18, m: [67] },
      { t: 0.66, d: 1.1, m: [63] },
    ],
  },
  {
    id: "cumple",
    pack: "Melodias",
    name: "Que los cumplas",
    timbre: "silbido",
    notes: [
      { t: 0, d: 0.22, m: [60] },
      { t: 0.3, d: 0.12, m: [60] },
      { t: 0.45, d: 0.4, m: [62] },
      { t: 0.9, d: 0.4, m: [60] },
      { t: 1.35, d: 0.4, m: [65] },
      { t: 1.8, d: 0.8, m: [64] },
    ],
  },
  {
    id: "suspenso",
    pack: "Melodias",
    name: "Dun dun duuun",
    timbre: "voz",
    notes: [
      { t: 0, d: 0.3, m: [62] },
      { t: 0.4, d: 0.3, m: [63] },
      { t: 0.8, d: 1.4, m: [59, 58] },
    ],
  },
  { id: "risa", pack: "Melodias", name: "Risa malvada", timbre: "voz", notes: beeps(5, 0.24, 0.15, [69, 67, 65, 64, 62]) },
  {
    id: "tirolesa",
    pack: "Melodias",
    name: "La tirolesa",
    timbre: "voz",
    notes: [
      { t: 0, d: 0.24, m: [60] },
      { t: 0.26, d: 0.24, m: [67] },
      { t: 0.52, d: 0.24, m: [60] },
      { t: 0.78, d: 0.24, m: [67] },
      { t: 1.04, d: 0.8, m: [72] },
    ],
  },
  {
    id: "escala",
    pack: "Melodias",
    name: "La escalera",
    timbre: "silbido",
    notes: [...beeps(4, 0.25, 0.2, [60, 62, 64, 65]), { t: 1.0, d: 0.55, m: [67] }],
  },

  // ---------- Ritmo (sin altura: solo cuentan golpes y ritmo) ----------
  {
    id: "palmas",
    pack: "Ritmo",
    name: "Las palmas",
    timbre: "golpe",
    notes: [0, 0.5, 0.75, 1.0, 1.5].map((t) => ({ t, d: 0.09, m: null })),
  },
];

export function soundById(id: string | null): Sound | null {
  if (!id) return null;
  return SOUNDS.find((s) => s.id === id) ?? null;
}

/** Fin del sonido (fin de la ultima nota), en segundos. */
export function soundDuration(sound: SynthSound): number {
  return sound.notes.reduce((end, n) => Math.max(end, n.t + n.d), 0);
}

/** Altura (MIDI) de la nota en el instante `t` (s), o null si no hay nota con altura ahi. */
export function pitchAt(sound: SynthSound, t: number): number | null {
  for (const n of sound.notes) {
    if (t < n.t || t > n.t + n.d || !n.m) continue;
    if (n.m.length === 1) return n.m[0];
    const x = ((t - n.t) / n.d) * (n.m.length - 1);
    const i = Math.min(n.m.length - 2, Math.floor(x));
    return n.m[i] + (n.m[i + 1] - n.m[i]) * (x - i);
  }
  return null;
}
