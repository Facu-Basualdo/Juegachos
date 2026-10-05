/** Tuning de Minotauro. Las distancias estan en CELDAS del laberinto. */

export const BEST_KEY = "minotauro:best";

// ---- Niveles ("descensos") ----
/** Lado del laberinto en el nivel 1; cada nivel suma 2 celdas, hasta el tope. */
export const SIZE_START = 9;
export const SIZE_STEP = 2;
export const SIZE_MAX = 23;
/** Fraccion de callejones sin salida que se abren: arma vueltas para escaparle al Minotauro. */
export const BRAID = 0.4;

// ---- Jugador ----
/** Segundos por celda caminando y corriendo. */
export const STEP_WALK = 0.15;
export const STEP_RUN = 0.092;

// ---- Ruido (radio en celdas a la redonda) ----
export const NOISE_WALK = 2.0;
export const NOISE_RUN = 6.5;
export const NOISE_BUMP = 4;

// ---- Minotauro ----
/** Duerme al empezar cada nivel (segundos): el primero un poco mas. */
export const SLEEP_FIRST = 8;
export const SLEEP = 4.5;
/** Segundos por celda en cada estado. Persiguiendo se acelera nivel a nivel. */
export const MINO_WANDER = 0.42;
export const MINO_INVESTIGATE = 0.3;
export const MINO_CHASE_START = 0.24;
export const MINO_CHASE_STEP = 0.013;
export const MINO_CHASE_MIN = 0.122;
/** Te ve por un pasillo recto hasta esta distancia. */
export const SIGHT = 5;
/** Sin verte por este tiempo deja de perseguir y pasa a buscarte (s). */
export const LOSE_SIGHT = 0.8;
/** Perdido de vista, sigue al ultimo lugar donde te vio y busca esto antes de rendirse. */
export const SEARCH_TIME = 4;
/**
 * Olfato: si pasa este tiempo sin pista, va directo a donde estas. Es lo que garantiza
 * que la partida termine sola aunque el jugador se quede quieto (salas sin reloj).
 */
export const SMELL_START = 22;
export const SMELL_STEP = 1.2;
export const SMELL_MIN = 10;
/** Te agarra si su posicion interpolada queda a menos de esto. */
export const CATCH_DIST = 0.55;

// ---- Antorcha ----
/** Aceite que se gasta por segundo (nivel 1) y cuanto mas rapido nivel a nivel. */
export const OIL_BURN = 1 / 55;
export const OIL_BURN_STEP = 0.06;
/** Radio de la luz, en celdas, con el aceite vacio y lleno. */
export const LIGHT_MIN = 1.05;
export const LIGHT_MAX = 3.6;
/** Lo que recarga un anfora. */
export const OIL_AMPHORA = 0.45;
/**
 * Sin aceite se pierde la estela (pedido del programador): la memoria de lo recorrido se
 * borra en `MEMORY_FORGET` segundos (menos lo que la brasa sigue alumbrando) y el hilo de
 * Ariadna se enrolla desde la punta vieja, una celda cada `THREAD_FORGET_STEP` segundos.
 * Lo borrado no vuelve con un anfora: hay que volver a recorrerlo.
 */
export const MEMORY_FORGET = 6;
export const THREAD_FORGET_STEP = 0.25;

// ---- Puntaje ----
export const LEVEL_POINTS = 1000;
/** Segundos "de par" por celda del laberinto; lo que sobra suma TIME_POINTS por segundo. */
export const PAR_PER_CELL = 0.2;
export const TIME_POINTS = 15;

// ---- Countdown ----
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 0.75;
/** Duracion del cartel "DESCENSVS N" entre nivel y nivel, en s. */
export const DESCENT_TIME = 2.2;
export const MAX_DT = 0.05;

export function sizeFor(level: number): number {
  return Math.min(SIZE_MAX, SIZE_START + (level - 1) * SIZE_STEP);
}

export function chaseStepFor(level: number): number {
  return Math.max(MINO_CHASE_MIN, MINO_CHASE_START - (level - 1) * MINO_CHASE_STEP);
}

export function smellFor(level: number): number {
  return Math.max(SMELL_MIN, SMELL_START - (level - 1) * SMELL_STEP);
}

export function oilBurnFor(level: number): number {
  return OIL_BURN * (1 + (level - 1) * OIL_BURN_STEP);
}

/** Numero romano (los niveles se nombran asi: DESCENSVS IV). */
export function roman(n: number): string {
  const map: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of map) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out || "N";
}
