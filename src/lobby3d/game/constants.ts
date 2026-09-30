/**
 * Medidas y tuning de La Feria. El mundo usa metros: un muñeco mide ~1.75.
 * Norte = -Z (hacia donde se mira al entrar), este = +X.
 */

// ---------- Claro ----------
/** Radio del alambrado: nadie sale de aca (y el mundo no tiene bordes para caerse). */
export const FENCE_RADIUS = 24;
/** Radio del piso dibujado (un poco mas alla del alambrado, hasta el bosque). */
export const GROUND_RADIUS = 34;

/** Carteleras con los afiches: semicirculo al norte, de cara al centro. */
export const GALLERY_RADIUS = 13;
/** Apertura total del semicirculo (radianes), centrado en el norte. */
export const GALLERY_SPAN = (220 * Math.PI) / 180;
/** Lado de cada afiche. */
export const FRAME_SIZE = 2.5;
/** Altura del centro del afiche. */
export const FRAME_Y = 2.25;

/** Portales: una chapa en el piso delante de cada afiche. */
export const PORTAL_RADIUS_RING = 10.2;
export const PORTAL_RADIUS = 1.2;

/** Televisor del centro (sobre un cajon). */
export const TV_RADIUS = 0.8;

/** Escenario LISTO, al sur del centro. */
export const READY_X = 0;
export const READY_Z = 6.8;
export const READY_HALF = 1.7;
export const READY_HEIGHT = 0.3;

/** Donde aparece cada uno (se reparte en ronda alrededor de este punto). */
export const SPAWN_Z = 10.5;

// ---------- La Torre (parkour) ----------
/** Centro del mastil, al suroeste (lejos de las carteleras y del spawn). */
export const TOWER_X = -9.5;
export const TOWER_Z = 13.5;
/** Radio del espiral de plataformas alrededor del mastil. */
export const TOWER_R = 4.5;
/** Una carrera mas corta que esto es imposible: el server la descarta. */
export const MIN_CLIMB_MS = 15_000;

// ---------- Muñeco ----------
export const SPEED = 6.2;
export const GROUND_ACCEL = 34;
export const AIR_ACCEL = 12;
export const JUMP_VELOCITY = 9.4;
export const GRAVITY = 27;
export const TERMINAL_VELOCITY = 28;
/** Escalon que se sube solo caminando (el escenario LISTO mide 0.3). */
export const STEP_UP = 0.45;
export const BODY_RADIUS = 0.3;
export const BODY_HEIGHT = 1.75;
/** Tiempo sin control despues de que te empuja un barredor o un gancho. */
export const KNOCK_LOCK = 0.4;
export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER = 0.12;
export const PHYSICS_STEP = 1 / 120;
export const MAX_DT = 0.1;

// ---------- Camara (primera persona) ----------
/** Altura de los ojos sobre los pies. */
export const EYE_HEIGHT = 1.55;
export const CAM_FOV = 72;
/** En vertical (celular) el FOV es vertical: se abre para no ver por un tubo. */
export const CAM_FOV_PORTRAIT = 82;
/** Tope de mirar arriba / abajo (radianes). */
export const PITCH_LIMIT = 1.4;
/** Mirada al entrar: un poco hacia abajo, a las carteleras. */
export const START_PITCH = -0.08;
/** Balanceo de la camara al caminar (metros). */
export const HEAD_BOB = 0.045;
/** Distancia maxima para apuntar y tocar un portal o el escenario. */
export const AIM_RANGE = 18;

// ---------- Red ----------
/** Cadencia del envio de la posicion propia (~15/s) mientras cambia. */
export const POS_SEND_MS = 66;
/** Quieto, se reafirma la posicion cada tanto (el que llega tarde la necesita). */
export const POS_IDLE_MS = 1000;
/** Cada cuanto se re-mide el reloj del server (lo que se mueve depende de el). */
export const CLOCK_PING_MS = 4000;
/** Suavizado exponencial de los muñecos ajenos hacia su ultimo snapshot. */
export const REMOTE_EASE = 12;
/** Un salto mas grande que esto entre snapshots es un teletransporte. */
export const REMOTE_SNAP_DIST = 6;

export const FLAG_GROUNDED = 1;
export const FLAG_MOVING = 2;

// ---------- La noche ----------
/** "Cuanto empeoro" la noche: el lobby arranca abierto, la ultima ronda casi negra, la final roja. */
export const DREAD_LOBBY = 0;
export const DREAD_LAST_ROUND = 0.85;
export const DREAD_FINAL = 1;
/** Velocidad a la que la noche llega a su nuevo estado. */
export const DREAD_EASE = 0.35;

/** Remeras por asiento (DESIGN.md: apagadas pero distinguibles). */
export const SEAT_COLORS = [
  "#c0504d",
  "#4f81bd",
  "#d8b83a",
  "#6aa84f",
  "#8e7cc3",
  "#d9822b",
  "#c27ba0",
  "#45a5b5",
];

export function seatColor(seat: number): string {
  return SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}

/**
 * Reacciones: las mismas cinco de Bomba Palabra / Cadena de Palabras, con sus audios
 * (`public/sfx/emotes/<id>.mp3`). Teclas 1-5 o los botones. El indice es lo que viaja
 * por la red (`lb:emote.e`), asi que **el orden no se cambia**; el server acepta 0..7.
 * Sin emojis: la cara se dibuja en canvas (`emoteFaceTexture`).
 */
export const EMOTES = [
  { id: "risa", label: "Risa" },
  { id: "sorpresa", label: "Sorpresa" },
  { id: "enojo", label: "Enojo" },
  { id: "burla", label: "Burla" },
  { id: "llanto", label: "Llanto" },
] as const;

export type EmoteId = (typeof EMOTES)[number]["id"];
/** Cooldown de las reacciones (el server tiene el suyo de 0.9 s y descarta el resto). */
export const EMOTE_COOLDOWN_MS = 1000;
/** Cuanto dura el globo de una reaccion. */
export const EMOTE_MS = 2600;

/** Accesorios elegibles (indice = `look`). */
export const LOOKS = ["Sin nada", "Gorra", "Gorro de fiesta", "Vincha", "Galera"];
