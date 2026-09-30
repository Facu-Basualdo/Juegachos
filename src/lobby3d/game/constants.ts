/**
 * Medidas y tuning de la Isla. El mundo usa metros: un muñeco mide ~1.7.
 * Norte = -Z (hacia donde mira la camara), este = +X.
 */

// ---------- Isla ----------
/** Radio de la tapa de pasto. */
export const ISLAND_RADIUS = 17;
/** Hasta donde se puede caminar; mas alla, se cae de la isla. */
export const WALK_RADIUS = 16.3;

/** Galeria de portadas: semicirculo al norte, de cara al centro. */
export const GALLERY_RADIUS = 13;
/** Apertura total del semicirculo (radianes), centrado en el norte. */
export const GALLERY_SPAN = (220 * Math.PI) / 180;
/** Lado de cada portada enmarcada. */
export const FRAME_SIZE = 2.5;
/** Altura del centro de la portada. */
export const FRAME_Y = 2.25;

/** Portales: un hexagono en el piso delante de cada portada. */
export const PORTAL_RADIUS_RING = 10.2;
export const PORTAL_RADIUS = 1.2;

/** Plaza central (piedra) y su pedestal. */
export const PLAZA_RADIUS = 3.4;
export const PEDESTAL_RADIUS = 0.9;

/** Plataforma LISTO, al sur del centro. */
export const READY_X = 0;
export const READY_Z = 6.8;
export const READY_RADIUS = 1.9;
export const READY_HEIGHT = 0.3;

/** Donde aparece cada uno (se reparte en ronda alrededor de este punto). */
export const SPAWN_Z = 10.5;

// ---------- Muñeco ----------
export const SPEED = 6.4;
export const GROUND_ACCEL = 34;
export const AIR_ACCEL = 11;
export const JUMP_VELOCITY = 9.4;
export const GRAVITY = 27;
export const TERMINAL_VELOCITY = 40;
/** Cuanto sube solo al caminar contra un escalon (la plataforma LISTO mide 0.3). */
export const STEP_UP = 0.45;
/** Radio del cuerpo para chocar con arboles, marcos y el pedestal. */
export const BODY_RADIUS = 0.38;
/** Caido de la isla por debajo de esto, reaparece arriba. */
export const RESPAWN_Y = -26;
export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER = 0.12;
export const PHYSICS_STEP = 1 / 120;
export const MAX_DT = 0.1;

// ---------- Camara (primera persona) ----------
/** Altura de los ojos sobre los pies (el muñeco mide ~1.9 con la cabeza). */
export const EYE_HEIGHT = 1.55;
export const CAM_FOV = 72;
/** En vertical (celular) el FOV es vertical: se abre para no ver por un tubo. */
export const CAM_FOV_PORTRAIT = 82;
/** Tope de mirar arriba / abajo (radianes). */
export const PITCH_LIMIT = 1.35;
/** Mirada al entrar: un poco hacia abajo, a la galeria. */
export const START_PITCH = -0.12;
/** Balanceo de la camara al caminar (metros). */
export const HEAD_BOB = 0.045;
/** Distancia maxima para apuntar y tocar un portal o la plataforma. */
export const AIM_RANGE = 18;

// ---------- Red ----------
/** Cadencia del envio de la posicion propia (~15/s) mientras cambia. */
export const POS_SEND_MS = 66;
/** Quieto, se reafirma la posicion cada tanto (el que llega tarde la necesita). */
export const POS_IDLE_MS = 1000;
/** Suavizado exponencial de los muñecos ajenos hacia su ultimo snapshot. */
export const REMOTE_EASE = 12;
/** Un salto mas grande que esto entre snapshots es un teletransporte (reaparecio). */
export const REMOTE_SNAP_DIST = 6;

export const FLAG_GROUNDED = 1;
export const FLAG_MOVING = 2;

// ---------- Hora del dia ----------
/** Hora del lobby (media mañana). La partida la lleva hasta el atardecer; la final es de noche. */
export const DAY_LOBBY = 0.2;
export const DAY_LAST_ROUND = 0.9;
export const DAY_FINAL = 1;
/** Segundos que tarda el cielo en llegar a su nueva hora. */
export const DAY_EASE = 0.35;

/** Remeras por asiento (DESIGN.md). */
export const SEAT_COLORS = [
  "#ff6b6b",
  "#4dabf7",
  "#ffd43b",
  "#69db7c",
  "#b197fc",
  "#ff922b",
  "#f783ac",
  "#3bc9db",
];

export function seatColor(seat: number): string {
  return SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}

/** Reacciones (texto, sin emojis): teclas 1-4 o el boton en el celu. */
export const EMOTES = ["Hola", "GG", "Jaja", "Vamos"];
/** Cuanto dura el globo de una reaccion. */
export const EMOTE_MS = 2600;

/** Accesorios elegibles (indice = `look`). */
export const LOOKS = ["Sin gorro", "Gorra", "Gorro de fiesta", "Vincha"];
