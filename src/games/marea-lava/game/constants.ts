/**
 * Tuning de Marea de Lava. La primera seccion esta DUPLICADA en
 * `server/src/games/marealava.ts` por la regla de decoupling del repo: si cambia,
 * tocar los dos lados.
 */

// ---- Torre y lava (espejo del server) ----
/** Altura de la cima. */
export const TOP_Y = 80;
export const LAVA_START_Y = -6;
export const LAVA_V0 = 0.5;
export const LAVA_ACCEL = 0.012;
export const PREROLL_MS = 3000;
export const MATCH_MS = 120_000;

/** Altura de la lava a los `t` ms de la largada (misma funcion que el server). */
export function lavaY(t: number): number {
  const s = Math.max(0, t) / 1000;
  return LAVA_START_Y + LAVA_V0 * s + 0.5 * LAVA_ACCEL * s * s;
}

// ---- Pared (solo cliente) ----
/** Medio ancho de la pared trepable y profundidad de las plataformas. */
export const WALL_HALF = 9.5;
export const DEPTH_HALF = 2.6;
/** Plano de la pared del fondo. */
export const WALL_Z = -4.2;

// ---- Jugador (solo cliente) ----
export const SPEED = 5.5;
/** Salto mas alto que en Derrumbe (~2 m): la torre se sube de a saltos. */
export const JUMP_VELOCITY = 11;
export const GRAVITY = 30;
export const TERMINAL_VELOCITY = 40;
export const GROUND_ACCEL = 22;
export const AIR_ACCEL = 9;
export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER = 0.14;
export const PHYSICS_STEP = 1 / 120;
export const MAX_DT = 0.1;
/** Medio ancho de la caja del jugador y su alto. */
export const BODY_HALF = 0.3;
export const BODY_HEIGHT = 1.8;

// ---- Red (solo cliente) ----
export const POS_SEND_MS = 50;
export const SERVER_GRACE_MS = 12_000;
export const CONFIRM_MS = 3000;
export const REMOTE_EASE = 14;

// ---- Camara (fija, de frente a la pared) ----
export const CAM_BACK = 14;
/** En vertical se aleja: si no, la pared no entra a lo ancho. */
export const CAM_BACK_PORTRAIT = 22;
export const CAM_FOV = 60;

// ---- Countdown ----
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 0.75;

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
