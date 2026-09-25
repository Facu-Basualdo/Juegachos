/**
 * Tuning de Derrumbe. Las constantes de geometria y de reglas estan DUPLICADAS en
 * `server/src/games/derrumbe.ts` por la regla de decoupling del repo: si cambia
 * algo de la primera seccion, tocar los dos lados.
 */

// ---- Geometria (espejo del server) ----
/** Lado de la grilla de cada piso, en bloques. */
export const GRID = 25;
/** Pisos apilados. El 0 es el de arriba. */
export const LAYERS = 4;
/** El piso es un circulo: entra toda celda cuyo centro cae a esta distancia del medio. */
export const ARENA_RADIUS = 12.4;
/**
 * Distancia vertical entre la tapa de un piso y la del siguiente. Es alta a
 * proposito: la camara fija va arriba del muñeco y tiene que quedar SIEMPRE por
 * debajo de la losa del piso de arriba (ver CAM_DISTANCE).
 */
export const LAYER_GAP = 11;
export const CENTER = (GRID - 1) / 2;
export const CELLS_PER_LAYER = GRID * GRID;
export const CELL_COUNT = CELLS_PER_LAYER * LAYERS;
/** Mecha de un bloque pisado, en ms. */
export const FALL_DELAY_MS = 500;
/** Congelado inicial del server (el countdown 3/2/1/YA). */
export const PREROLL_MS = 3000;
/** Tope duro de la partida en el server. */
export const MATCH_MAX_MS = 120_000;

// ---- Mundo ----
/** Altura de la lava. */
export const LAVA_Y = -9;
/** Con los pies por debajo de esto el jugador esta muerto. */
export const DEATH_Y = -7.2;

// ---- Jugador (solo cliente) ----
export const SPEED = 5.2;
export const JUMP_VELOCITY = 9.2;
export const GRAVITY = 30;
export const TERMINAL_VELOCITY = 42;
/** Radio de la huella: todo bloque que toca se cae (ver `Player.footprint`). */
export const FOOT_RADIUS = 0.3;
/** Aceleracion hacia la velocidad pedida, en el piso y en el aire. */
export const GROUND_ACCEL = 22;
export const AIR_ACCEL = 7;
/** Margen para saltar despues de pisar el borde (coyote time), en s. */
export const COYOTE_TIME = 0.09;
/** Un salto apretado un toque antes de aterrizar igual sale, en s. */
export const JUMP_BUFFER = 0.12;
/** Paso maximo de la fisica: un frame largo se parte en pedazos de esto. */
export const PHYSICS_STEP = 1 / 120;
/** Frame mas largo que se simula entero (la fisica igual se parte en PHYSICS_STEP). */
export const MAX_DT = 0.1;

// ---- Red (solo cliente) ----
/** Cadencia de envio de la posicion propia. Sobre el game server no hay tope. */
export const POS_SEND_MS = 50;
/** Sin un solo mensaje del server despues de este tiempo, se da por perdido. */
export const SERVER_GRACE_MS = 12_000;
/** Si el server no confirma la muerte propia en este tiempo, se reporta la local. */
export const DEATH_CONFIRM_MS = 3000;
/** Una celda que el server da por entera se restaura solo si se predijo hace mas que esto. */
export const RESTORE_AFTER_MS = 1500;
/** Suavizado de los rivales hacia su ultimo snapshot (ease exponencial). */
export const REMOTE_EASE = 14;

// ---- Camara ----
/**
 * Camara FIJA: siempre detras (+Z) y arriba del muñeco, nunca gira. Asi "arriba" en
 * la pantalla es siempre la misma direccion y el joystick del celu puede ir en
 * cualquier lado.
 *
 * Restriccion: la altura de la camara sobre los pies (1.1 + DISTANCE * sin(PITCH),
 * ~9.3) tiene que quedar por debajo de la losa del piso de arriba (LAYER_GAP - 1 =
 * 10). Si no, estando en un piso de abajo la camara queda adentro del de arriba y
 * lo tiene delante de todo. Con la inclinacion alta, el borde superior del cuadro
 * sigue mirando hacia abajo (incluso con el FOV abierto del celu en vertical), asi
 * que el piso de arriba nunca entra en pantalla.
 */
export const CAM_DISTANCE = 10;
/** Inclinacion (rad, ~54 grados): alta, para ver el piso alrededor del muñeco. */
export const CAM_PITCH = 0.95;
export const CAM_FOV = 62;
/** Espectador: vista fija de todo el piso desde el mismo lado. */
export const SPECTATOR_BACK = 30;
export const SPECTATOR_HEIGHT = 24;

// ---- Countdown ----
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 0.75;

/** Remera de cada asiento (ver DESIGN.md: el unico color personal del juego). */
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

/** Altura de la tapa de un piso. */
export function surfaceY(layer: number): number {
  return (LAYERS - 1 - layer) * LAYER_GAP;
}

export function cellIndex(layer: number, x: number, z: number): number {
  return layer * CELLS_PER_LAYER + z * GRID + x;
}

/** Celda a mundo: el centro del piso es el origen. */
export function cellCenterX(x: number): number {
  return x - CENTER;
}

/** Mundo a columna/fila de la grilla (puede caer afuera). */
export function worldToCell(v: number): number {
  return Math.floor(v + CENTER + 0.5);
}
