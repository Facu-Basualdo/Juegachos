/**
 * Tuning de Pista Loca. La primera seccion esta DUPLICADA en
 * `server/src/games/pistaloca.ts` por la regla de decoupling del repo: si cambia,
 * tocar los dos lados.
 */

// ---- Pista (espejo del server) ----
/** Lado de la pista, en bloques. */
export const GRID = 24;
export const CELLS = GRID * GRID;
export const CENTER = (GRID - 1) / 2;
export const PREROLL_MS = 3000;

// ---- Mundo ----
/** Con los pies por debajo de esto, el jugador cayo al vacio. */
export const DEATH_Y = -12;

// ---- Jugador (solo cliente; misma fisica que Derrumbe) ----
export const SPEED = 5.4;
export const JUMP_VELOCITY = 9;
export const GRAVITY = 30;
export const TERMINAL_VELOCITY = 42;
export const FOOT_RADIUS = 0.3;
export const GROUND_ACCEL = 22;
export const AIR_ACCEL = 7;
export const COYOTE_TIME = 0.09;
export const JUMP_BUFFER = 0.12;
export const PHYSICS_STEP = 1 / 120;
export const MAX_DT = 0.1;

// ---- Red (solo cliente) ----
export const POS_SEND_MS = 50;
export const SERVER_GRACE_MS = 12_000;
export const CONFIRM_MS = 3000;
export const REMOTE_EASE = 14;

// ---- Camara (fija, como en Derrumbe; sin pisos arriba puede ir mas alta) ----
export const CAM_DISTANCE = 11.5;
export const CAM_PITCH = 1.0;
export const CAM_FOV = 60;
export const SPECTATOR_BACK = 26;
export const SPECTATOR_HEIGHT = 24;

// ---- Countdown ----
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 0.75;

/**
 * Lana: diez colores que se distinguen apurado y de lejos (DESIGN.md). El orden es
 * el indice que manda el server en el dibujo.
 */
export const WOOL: readonly { name: string; hex: string }[] = [
  { name: "ROJO", hex: "#d8322c" },
  { name: "NARANJA", hex: "#f08a24" },
  { name: "AMARILLO", hex: "#f7d635" },
  { name: "LIMA", hex: "#86d130" },
  { name: "VERDE", hex: "#2e7d32" },
  { name: "CIAN", hex: "#26b9c9" },
  { name: "AZUL", hex: "#2f4fc9" },
  { name: "VIOLETA", hex: "#8a3fc4" },
  { name: "ROSA", hex: "#f27bb8" },
  { name: "BLANCO", hex: "#f2f2ee" },
];

/** Remera de cada asiento. */
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

/** Celda a mundo: el centro de la pista es el origen. */
export function cellCenter(v: number): number {
  return v - CENTER;
}

/** Mundo a columna/fila (puede caer afuera). */
export function worldToCell(v: number): number {
  return Math.floor(v + CENTER + 0.5);
}
