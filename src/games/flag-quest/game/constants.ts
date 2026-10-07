import { COUNTRIES, lookalikesOf, type Country } from "./countries";

export const BEST_KEY = "flag-quest:best";

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75; // segundos por label

/** Tiempo para responder cada bandera. */
export const ANSWER_MS = 5000;
/** Restante desde el cual la escala del reloj se tine de rojo. */
export const ANSWER_URGENT_MS = 1500;
/** Cuanto queda a la vista la respuesta correcta antes de la bandera siguiente. */
export const FEEDBACK_MS = 1100;

/** Puntos por acierto: base fija + bonus proporcional al tiempo que sobro. */
export const POINTS_BASE = 100;
export const POINTS_SPEED = 100;

export function pointsFor(msLeft: number): number {
  const frac = Math.max(0, Math.min(1, msLeft / ANSWER_MS));
  return POINTS_BASE + Math.round(POINTS_SPEED * frac);
}

/** Solitario: errores (o tiempos vencidos) que terminan la partida. */
export const SOLO_LIVES = 3;
/** Solitario: cada cuantas banderas sube un nivel. */
export const SOLO_LEVEL_EVERY = 6;

/**
 * Sala: 15 banderas fijas, tres de cada nivel, de facil a dificil. Los
 * territorios (nivel 5) quedan para el final.
 */
export const ROOM_TIERS: readonly Country["tier"][] = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5];

/** Tablero del ranking de cada modo (ver `scoring` en meta.ts). */
export const VARIANT_SOLO = "clasico";
export const VARIANT_ROOM = "sala";

export interface Question {
  answer: Country;
  /** Las cuatro opciones, ya mezcladas (la correcta es una de ellas). */
  options: Country[];
}

/** PRNG deterministico y compacto (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de un string a semilla de 32 bits. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Nivel del solitario para la bandera numero `index` (base 0). */
export function soloLevel(index: number): Country["tier"] {
  return Math.min(5, 1 + Math.floor(index / SOLO_LEVEL_EVERY)) as Country["tier"];
}

/**
 * Elige la bandera de un nivel sin repetir las ya usadas en la partida. Si el
 * nivel se agoto, baja a los anteriores; si se agoto todo, vuelve a empezar.
 */
function pickAnswer(tier: Country["tier"], used: Set<string>, rng: () => number): Country {
  for (let t = tier; t >= 1; t--) {
    const pool = COUNTRIES.filter((c) => c.tier === t && !used.has(c.code));
    if (pool.length > 0) return pool[Math.floor(rng() * pool.length)];
  }
  used.clear();
  return pickAnswer(tier, used, rng);
}

/**
 * Las tres opciones incorrectas. Cuanto mas alto el nivel, mas se parecen: en el
 * 1 salen de cualquier lado, desde el 2 una es de la misma region, desde el 3 una
 * es una bandera parecida y desde el 4 todas las que haya parecidas.
 */
function pickDistractors(answer: Country, level: number, rng: () => number): Country[] {
  const chosen: Country[] = [];
  const taken = new Set([answer.code, answer.name]);
  const take = (candidates: Country[], max: number): void => {
    for (const c of candidates) {
      if (chosen.length >= 3 || max <= 0) return;
      if (taken.has(c.code) || taken.has(c.name)) continue;
      taken.add(c.code);
      taken.add(c.name);
      chosen.push(c);
      max--;
    }
  };

  const similar = shuffle(
    lookalikesOf(answer.code).map((code) => COUNTRIES.find((c) => c.code === code)!),
    rng,
  );
  // La region tampoco trae nombres de un nivel muy por encima del de la pregunta.
  const regional = shuffle(
    COUNTRIES.filter((c) => c.region === answer.region && c.tier <= Math.max(3, level + 1)),
    rng,
  );
  // Los nombres de relleno salen de paises conocidos en los niveles bajos: con
  // "Tuvalu" entre las opciones de la bandera de Brasil no se aprende nada.
  const generic = shuffle(
    COUNTRIES.filter((c) => c.tier <= Math.max(2, level)),
    rng,
  );

  if (level >= 4) take(similar, 3);
  else if (level >= 3) take(similar, 1);
  if (level >= 2) take(regional, level >= 4 ? 3 : 1);
  take(generic, 3);
  take(shuffle(COUNTRIES.slice(), rng), 3);
  return chosen;
}

/** Arma una pregunta del nivel dado, marcando la respuesta como usada. */
export function buildQuestion(
  tier: Country["tier"],
  used: Set<string>,
  rng: () => number,
): Question {
  const answer = pickAnswer(tier, used, rng);
  used.add(answer.code);
  const options = shuffle([answer, ...pickDistractors(answer, tier, rng)], rng);
  return { answer, options };
}

/**
 * Las 15 banderas de una ronda de sala. La semilla es `code:round`, asi que todos
 * los jugadores de la ronda ven exactamente las mismas, con las mismas opciones
 * y en el mismo orden.
 */
export function buildRoomQuiz(seed: string): Question[] {
  const rng = mulberry32(hashSeed(`${seed}:flag-quest`));
  const used = new Set<string>();
  return ROOM_TIERS.map((tier) => buildQuestion(tier, used, rng));
}
