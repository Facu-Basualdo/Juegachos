/**
 * Tuning de Luz Roja, Luz Verde. La primera seccion esta DUPLICADA en
 * `server/src/games/luzroja.ts` por la regla de decoupling del repo: si cambia,
 * tocar los dos lados.
 */

// ---- Cancha (espejo del server) ----
/** Linea de largada y de llegada (los jugadores corren hacia -Z). */
export const START_Z = 30;
export const FINISH_Z = -30;
/** Medio ancho jugable de la cancha. */
export const HALF_WIDTH = 14;
export const PREROLL_MS = 3000;
export const MATCH_MS = 45_000;

// ---- Escenario ----
/** Donde esta parada la muñeca y el arbol detras. */
export const DOLL_Z = -37;
export const TREE_Z = -44;
/** Paredes pintadas: medio ancho y fondo del galpon. */
export const WALL_X = 17;
export const WALL_BACK_Z = -50;
export const WALL_FRONT_Z = 40;
export const WALL_HEIGHT = 18;

// ---- Jugador (solo cliente) ----
export const SPEED = 5.5;
/**
 * Respuesta de la velocidad (1/s). Frenar NO es instantaneo: de lleno a quieto se
 * tardan ~0.35 s, y eso es parte de lo dificil (hay que soltar antes de que termine
 * la cancion, no cuando la muñeca ya se dio vuelta).
 */
export const ACCEL = 8.5;
/**
 * Margen desde que se VE el rojo hasta que la muñeca empieza a mirar (ms). En ese
 * tiempo se gira la cabeza; cuando se le prenden los ojos, moverse elimina.
 */
export const TURN_MS = 450;
/** Por encima de esta velocidad (m/s) con los ojos prendidos, quedas eliminado. */
export const MOVE_EPS = 0.25;
export const MAX_DT = 0.1;

// ---- Red (solo cliente) ----
export const POS_SEND_MS = 50;
export const SERVER_GRACE_MS = 12_000;
/** Si el server no confirma el resultado propio en este tiempo, se reporta el local. */
export const CONFIRM_MS = 3000;
export const REMOTE_EASE = 12;

// ---- Camara (fija, como en Derrumbe) ----
export const CAM_BACK = 7.5;
export const CAM_HEIGHT = 4.4;
/** Hacia adonde mira: un punto adelante del jugador, para que la muñeca entre. */
export const CAM_LOOK_AHEAD = 8;
export const CAM_FOV = 60;

// ---- Countdown ----
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 0.75;

/** Franja de cada asiento (el jogging es igual para todos, como en la serie). */
export const SEAT_COLORS = [
  "#e2433b",
  "#3f7fe0",
  "#46b04a",
  "#f2c230",
  "#9b59d0",
  "#f08a2c",
  "#36c2c9",
  "#ef6fae",
] as const;

export function seatColor(seat: number): string {
  return SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}

/** Avance hacia la meta, 0-100 (mismo calculo que el server). */
export function progressOf(z: number): number {
  return Math.max(0, Math.min(99.9, ((START_Z - z) / (START_Z - FINISH_Z)) * 100));
}

/**
 * Numero de jogging (3 cifras) derivado del nickname: igual en todas las pantallas
 * sin tener que viajar por la red.
 */
export function playerNumber(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(((h >>> 0) % 456) + 1).padStart(3, "0");
}
