/**
 * Tuning de Laser Show. La primera seccion esta DUPLICADA en
 * `server/src/games/lasershow.ts` por la regla de decoupling del repo: si cambia,
 * tocar los dos lados.
 */

// ---- Reloj y escenario (espejo del server) ----
export const PREROLL_MS = 3000;
/** Tope duro de la partida; el que sigue en pie llega con este tiempo. */
export const MATCH_MS = 150_000;
/** Vuelta de honor del ultimo en pie. */
export const LAP_MS = 5000;
/** Radio del escenario (el piso es un disco centrado en el origen, tapa en y = 0). */
export const STAGE_R = 8;

// ---- Lasers (solo cliente: el server no los genera) ----
/** Radio de la torre del centro: no se puede pisar. */
export const PYLON_R = 0.9;
/** Donde terminan las barridas: un poco afuera del borde, en los emisores del aro. */
export const SPIN_REACH = STAGE_R + 0.6;
/** Las paredes arrancan y terminan a esta distancia del centro, fuera del escenario. */
export const WALL_SPAN = STAGE_R + 3;
/** Cuanto espera una pared quieta afuera, titilando, antes de arrancar (ms). */
export const WALL_WARN = 700;
/** Altura del centro del haz rasante (se salta) y del alto (se esquiva agachado). */
export const LOW_Y = 0.42;
export const HIGH_Y = 1.3;
/** Radio de un haz, para el choque. */
export const BEAM_R = 0.07;
/** Duracion de la columna de la lluvia de rayos (ms). */
export const ZONE_BLAST = 550;
/** Altura de la columna de la lluvia. */
export const ZONE_TOP = 4.5;

// ---- Jugador (solo cliente) ----
/** Radio del cuerpo, alto parado y alto agachado. */
export const BODY_R = 0.28;
export const BODY_H = 1.7;
export const DUCK_H = 0.9;
export const SPEED = 5.2;
/** Agachado se avanza a este porcentaje de la velocidad. */
export const DUCK_SPEED = 0.45;
/** Salto de ~1.3 m: los pies pasan sobre el rasante ~0.47 s. */
export const JUMP_VELOCITY = 8.5;
export const GRAVITY = 28;
export const TERMINAL_VELOCITY = 40;
export const FOOT_RADIUS = 0.25;
export const GROUND_ACCEL = 22;
export const AIR_ACCEL = 7;
export const COYOTE_TIME = 0.09;
export const JUMP_BUFFER = 0.12;
export const PHYSICS_STEP = 1 / 120;
export const MAX_DT = 0.1;
/** Con los pies por debajo de esto, el jugador cayo del escenario. */
export const DEATH_Y = -10;

// ---- Red (solo cliente) ----
export const POS_SEND_MS = 50;
export const SERVER_GRACE_MS = 12_000;
export const CONFIRM_MS = 3000;
export const REMOTE_EASE = 14;

// ---- Empujon (el alcance y la fuerza los decide el server) ----
/** Enfriamiento local del empujon; espejo del `PUSH_COOLDOWN_MS` del server. */
export const PUSH_COOLDOWN_MS = 1200;
export const SHOVE_STUN = 0.4;
export const SHOVE_ACCEL = 1.5;

// ---- Camara (fija, muestra el escenario entero, como Pista Loca) ----
export const CAM_FOV = 55;
export const CAM_PITCH = 0.95;
export const CAM_PITCH_PORTRAIT = 1.2;
export const CAM_MARGIN = 0.05;
/** Franja de arriba reservada al HUD (reloj + zocalo de la prueba), en px. */
export const CAM_TOP_PX = 150;
export const CAM_BOTTOM_PX = 24;
export const CAM_BOTTOM_PX_PORTRAIT = 160;

// ---- Countdown ----
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 0.75;

// ---- Colores (DESIGN.md "Prime Time") ----
/** Rasante: se salta. */
export const LOW_COLOR = "#ff4a1c";
/** Alto: se esquiva agachado. */
export const HIGH_COLOR = "#3fd8ff";
/** Lluvia de rayos. */
export const ZONE_COLOR = "#ff4fd8";
export const GOLD = "#ffc94a";

/** Color de cada asiento: ninguno se confunde con el rojo, el celeste ni el magenta de los lasers. */
export const SEAT_COLORS = [
  "#ffd23f",
  "#7ee05a",
  "#ff8a2a",
  "#a77bff",
  "#ffffff",
  "#2fb36b",
  "#f6a5c0",
  "#4f6dff",
] as const;

export function seatColor(seat: number): string {
  return SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}

/** Bits de `flags` en las posiciones. */
export const FLAG_GROUNDED = 1;
export const FLAG_MOVING = 2;
export const FLAG_DUCK = 4;
