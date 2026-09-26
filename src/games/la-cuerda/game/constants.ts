/**
 * Tuning de La Cuerda. La primera seccion esta DUPLICADA en
 * `server/src/games/lacuerda.ts` por la regla de decoupling del repo: si cambia,
 * tocar los dos lados.
 */

// ---- Recorrido, cuerdas y reloj (espejo del server) ----
/** El puente va hacia -z: la meta es la plataforma que empieza en z = GOAL_Z. */
export const GOAL_Z = -52;
/** Altura del eje de las cuerdas sobre el tablero (que esta en y = 0). */
export const ROPE_AXIS_Y = 5.55;
/** Radio de la cuerda en el medio del puente: abajo pasa a 0.25 m del tablero. */
export const ROPE_R = 5.3;
/** Radio de la mano del muñeco (donde se ata la cuerda) y x de cada mano. */
export const ROPE_HAND_R = 2.2;
export const ROPE_END_X = 7;
/** Grosor de la cuerda (radio). */
export const ROPE_THICK = 0.12;
export const PREROLL_MS = 3000;
export const MATCH_MS = 90_000;
/** Por debajo de esto, caiste al vacio. */
export const FALL_Y = -6;

/**
 * Una cuerda: donde cruza el puente (`z`, el eje que une a sus dos muñecos), su
 * velocidad angular inicial (rad/s) y cuanto acelera (rad/s^2), para que lado gira
 * (`dir` 1: por abajo barre hacia la salida, -1: hacia la meta) y en que angulo esta
 * en la largada (`phase`, 0 = abajo).
 */
export interface Rope {
  z: number;
  w0: number;
  accel: number;
  dir: 1 | -1;
  phase: number;
}

/**
 * Dos cuerdas con 16 m entre ejes (quedan ~6 m de puente seguro entre las dos zonas).
 * La segunda gira al reves, un poco mas rapida y desfasada media vuelta: el ritmo que
 * aprendiste en la primera no sirve para la segunda.
 */
export const ROPES: readonly Rope[] = [
  { z: -20, w0: 2.2, accel: 0.025, dir: 1, phase: Math.PI },
  { z: -36, w0: 2.6, accel: 0.025, dir: -1, phase: 0 },
];

/**
 * Angulo de la cuerda a los `t` ms de la largada (0 = abajo, rozando el tablero).
 * Antes de la largada ya gira a velocidad constante, asi en la cuenta regresiva se
 * lee el ritmo.
 */
export function ropeAngle(rope: Rope, t: number): number {
  const s = t / 1000;
  const turn = s <= 0 ? rope.w0 * s : rope.w0 * s + 0.5 * rope.accel * s * s;
  return rope.phase + rope.dir * turn;
}

/** Velocidad angular de la cuerda a los `t` ms (rad/s, sin signo). */
export function ropeSpeed(rope: Rope, t: number): number {
  return rope.w0 + rope.accel * Math.max(0, t / 1000);
}

/**
 * Radio de la cuerda a la altura `x` del puente: una curva de la mano de un muñeco a
 * la del otro, que se abre en el medio. Sobre el tablero (|x| < 1) es casi ROPE_R.
 */
export function ropeRadius(x: number): number {
  const u = Math.min(1, Math.abs(x) / ROPE_END_X);
  return ROPE_HAND_R + (ROPE_R - ROPE_HAND_R) * Math.sqrt(1 - u * u);
}

/** Metros avanzados desde la salida (0 en la plataforma de salida). */
export function progressOf(z: number): number {
  return Math.max(0, Math.min(-GOAL_Z, -z));
}

// ---- Puente (solo cliente) ----
/** Medio ancho del puente angosto. */
export const BRIDGE_HALF = 0.6;
/** Tramo roto, debajo de la primera cuerda: el puente falta entre estas dos z. */
export const GAP_NEAR = ROPES[0].z - 1;
export const GAP_FAR = ROPES[0].z - 2.6;
/** Plataformas de salida y de meta: anchas, de este fondo. */
export const PAD_HALF = 5;
export const PAD_DEPTH = 7;

// ---- Jugador (solo cliente) ----
export const SPEED = 5.5;
/** Salto de ~2 m: la cuerda pasa a 0.25 m del tablero y en los bordes, mas alto. */
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

// ---- Empujon ----
/** Enfriamiento local del empujon; espejo del `PUSH_COOLDOWN_MS` del server. */
export const PUSH_COOLDOWN_MS = 1500;
/** Cuanto dura el envion de un empujon sin control y cuanto control queda mientras. */
export const SHOVE_STUN = 0.35;
export const SHOVE_ACCEL = 1.5;

// ---- Red (solo cliente) ----
export const POS_SEND_MS = 50;
export const SERVER_GRACE_MS = 12_000;
export const CONFIRM_MS = 3000;
export const REMOTE_EASE = 14;

// ---- Camara ----
/** Tercera persona detras del muñeco (como Marea de Lava). */
export const CAM_DIST = 5.6;
export const CAM_DIST_PORTRAIT = 6.8;
export const CAM_TARGET_H = 1.5;
export const CAM_PITCH = 0.3;
export const CAM_PITCH_MIN = -0.25;
export const CAM_PITCH_MAX = 1.15;
export const CAM_YAW_SPEED = 2.4;
/** Espectador (resuelto): de costado al puente, siguiendo al que va adelante. */
export const CAM_SIDE = 15;
export const CAM_SIDE_PORTRAIT = 22;
export const CAM_FOV = 62;

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
