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

// ---- Empujon (el alcance y la fuerza los decide el server) ----
/** Enfriamiento local del empujon; espejo del `PUSH_COOLDOWN_MS` del server. */
export const PUSH_COOLDOWN_MS = 1200;
/** Tras un empujon el empujado casi no controla su muñeco, asi el envion lo lleva. */
export const SHOVE_STUN = 0.45;
/** Aceleracion (en vez de GROUND/AIR_ACCEL) mientras dura el aturdimiento. */
export const SHOVE_ACCEL = 1.5;

// ---- Camara ----
/**
 * Camara fija que muestra la pista ENTERA (pedido del programador: hay que ver todo
 * el espacio para elegir a que color correr y a quien empujar). No sigue al muñeco:
 * `fitCamera` calcula la distancia minima que deja entrar las cuatro esquinas con
 * este margen. Mira siempre hacia -Z, asi que la pantalla y el mundo coinciden.
 */
export const CAM_FOV = 55;
/** Inclinacion en horizontal (rad, ~57 grados): se lee el dibujo y la altura del salto. */
export const CAM_PITCH = 1.0;
/** En vertical casi cenital: la pista cuadrada aprovecha mejor la pantalla angosta. */
export const CAM_PITCH_PORTRAIT = 1.25;
/** Borde libre a los costados de la pista, en coordenadas de pantalla (NDC). */
export const CAM_MARGIN = 0.06;
/**
 * Franja de arriba reservada al HUD (ronda + cartel del color, en px): la pista se
 * encuadra debajo, porque el cartel tapaba justo el fondo de la pista cuando hay que
 * elegir a donde correr.
 */
export const CAM_TOP_PX = 200;
/** Franja de abajo libre, en px (en el celu en vertical, los botones). */
export const CAM_BOTTOM_PX = 24;
export const CAM_BOTTOM_PX_PORTRAIT = 150;

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
