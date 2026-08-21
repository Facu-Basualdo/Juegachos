/** Fisica del auto (unidades: px, segundos, radianes). Modelo de velocidad
 *  vectorial con agarre lateral: alto grip (trazada limpia) y solo un derrape
 *  sutil a alta velocidad. */
export const ENGINE_ACCEL = 640;
export const BRAKE_DECEL = 1050;
export const MAX_SPEED = 470;
export const MAX_REVERSE = 150;
/** Rozamiento longitudinal (proporcional a la velocidad de avance). */
export const ROLL_DRAG = 0.7;

/** Agarre lateral: tasa de decaimiento (1/s) de la velocidad transversal.
 *  Alto = el auto "muerde" el asfalto y casi no patina. */
export const GRIP_ON = 9.5;
export const GRIP_OFF = 3.0;
/** A tope de velocidad el grip baja esta fraccion, dando un derrape leve. */
export const GRIP_SPEED_FALLOFF = 0.32;

/** Velocidad de giro maxima, alcanzada a velocidad media. */
export const TURN_RATE = 3.0;
/** Velocidad a la que la direccion ya responde al 100%. */
export const TURN_FULL_SPEED = 150;

/** Multiplicadores fuera del asfalto (pasto/arena). */
export const OFFTRACK_SPEED_FACTOR = 0.42;
export const OFFTRACK_ACCEL_FACTOR = 0.5;

/** Boost pads: empuje extra (suave, no instantaneo), tope extra y duracion. */
export const BOOST_ACCEL = 1200;
export const BOOST_MAX_BONUS = 220;
export const BOOST_DURATION = 1.3;

/** Conos: frenada al golpearlos y ventana para no encadenar frenadas. */
export const CONE_SLOW = 0.6;
export const CONE_HIT_COOLDOWN_MS = 350;

/** Barreras: restitucion del rebote (0 = pega y se queda, 1 = rebote total). */
export const BARRIER_RESTITUTION = 0.4;

/** Paredes al borde del asfalto: mantienen el auto en pista (no hay pasto). */
export const WALL_MARGIN = 8;
export const WALL_RESTITUTION = 0.25;

export const CAR_LENGTH = 38;
export const CAR_WIDTH = 20;
/** Radio de colision del auto (aprox. como circulo). */
export const CAR_RADIUS = 15;

export const MAX_DT = 0.05;

/**
 * Cadencia de envio de la posicion propia por el broadcast de Supabase (el
 * fallback sin game server). El trafico del canal es
 * `jugadores x (1000 / NET_SEND_MS)` y la sala llena son 8: a 100ms son 80 msg/s,
 * debajo del tope de ~100/s por canal de Realtime. No bajarlo sin hacer esa
 * multiplicacion (ver el CLAUDE.md raiz, "Canales efimeros").
 */
export const NET_SEND_MS = 100;
/**
 * Cadencia cuando el enlace es el game server (`/carrace`). Ahi no existe el tope
 * por canal de Realtime — el server es propio y un relay de 8 jugadores a 16/s son
 * ~130 mensajes entrando y ~1000 saliendo, nada para socket.io — asi que se puede
 * emitir mas seguido y los autos rivales se ven bastante mas fluidos.
 */
export const NET_SEND_SERVER_MS = 60;
/** Un auto quieto (o ya terminado) repite su snapshot solo cada tanto. */
export const NET_IDLE_MS = 1000;
/** Un auto remoto sin updates por este tiempo se considera desconectado. */
export const REMOTE_STALE_MS = 6000;

export const BEST_KEY = "car-race:best";

/** Paleta de autos; cada jugador recibe un color estable por hash del nick. */
export const CAR_COLORS = [
  "#00f0ff",
  "#ff3f81",
  "#39ff14",
  "#ffd700",
  "#ff8a3d",
  "#a020f0",
  "#ff2a5f",
  "#5ce1a6",
];

/** Hash 32-bit deterministico (djb2) para seeds y colores por nick. */
export function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

export function colorFor(player: string): string {
  return CAR_COLORS[hashStr(player) % CAR_COLORS.length];
}

/** Formatea milisegundos de carrera como "1:02.34". */
export function formatRaceTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
