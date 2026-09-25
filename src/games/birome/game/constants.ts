/** Vista logica fija; el canvas la escala con bandas para entrar en la ventana. */
export const VIEW_W = 960;
export const VIEW_H = 540;

/** Franja jugable: los dos margenes rojos matan. */
export const FIELD_TOP = 64;
export const FIELD_BOT = 508;

/** Donde queda la punta propia en pantalla (la camara la sigue en X). */
export const PEN_SCREEN_X = 250;
/** Radio de choque de la punta. */
export const PEN_R = 3;

/**
 * Pendiente del trazo: apretado sube, suelto baja, siempre a 45 grados.
 * Es la clave de la red: como la pendiente no depende de la velocidad, el
 * recorrido en el plano queda definido SOLO por los puntos donde el jugador
 * apreto o solto. Ver InkChannel.
 */
export const SLOPE = 1;

/**
 * La velocidad depende de la DISTANCIA, no del tiempo: `v(x) = V0 + ACCEL * x`
 * hasta `V_MAX`. Asi cualquier cliente puede adelantar la punta de un rival
 * desde su ultima posicion conocida sin saber cuando arranco.
 */
export const V0 = 320;
export const ACCEL = 0.012;
export const V_MAX = 640;

export function speedAt(x: number): number {
  return Math.min(V0 + ACCEL * Math.max(0, x), V_MAX);
}

/** Pasos de integracion de a lo sumo esto (s): a 640 px/s son 2.7 px por paso. */
export const SUBSTEP = 1 / 240;
export const MAX_DT = 1 / 20;

/** Pixeles por centimetro de hoja: el puntaje se mide en cm recorridos. */
export const PX_PER_CM = 40;

// --- Recorrido sembrado ---
/** Tramo libre al largar antes del primer tachon. */
export const FIRST_GATE_X = 820;
/** Hueco (alto total) de las compuertas: arranca generoso y se cierra. */
export const GAP_START = 170;
export const GAP_MIN = 92;
/** Distancia a la que el hueco llega al minimo. */
export const GAP_SHRINK_UNTIL = 30000;
/** Separacion entre compuertas. */
export const SPACING_MIN = 290;
export const SPACING_MAX = 500;
/** Holgura minima entre un manchon y el camino factible. */
export const BLOT_CLEARANCE = 38;

// --- Red (sala) ---
/** Cada cuanto se vacia la cola de quiebres (ms). Tope: 8.3 msg/s por jugador,
 * ~67/s con la sala llena, debajo del limite de ~100/s de Realtime. */
export const NET_FLUSH_MS = 120;
/** Keepalive: reafirma la posicion aunque nadie haya apretado nada. */
export const NET_KEEPALIVE_MS = 500;
/** Sin noticias de un rival en este tiempo, se lo borra. */
export const REMOTE_STALE_MS = 6000;
/**
 * A los rivales se los dibuja este tanto en el pasado: asi el quiebre que
 * todavia viaja por la red llega antes de que la punta lo necesite y la linea
 * sale exacta, sin correcciones a la vista. Medido con red simulada (60 s de
 * quiebres cada 120-600 ms): con 0.20 el error es CERO hasta 250 ms + 150 de
 * jitter; con 0.12 ya aparecen saltos de linea a partir de ~250 ms.
 */
export const REMOTE_DELAY_S = 0.2;

// --- Paleta (ver DESIGN.md, "Cuaderno Cuadriculado") ---
export const C_PAPER = "#f7f1e1";
export const C_PAPER_EDGE = "#efe6cf";
export const C_GRID = "#d6e1ee";
export const C_GRID_STRONG = "#bfd0e4";
export const C_MARGIN = "#d9534f";
export const C_MARGIN_SOFT = "rgba(217, 83, 79, 0.10)";
export const C_INK = "#1f2433";
export const C_INK_WASH = "rgba(31, 36, 51, 0.16)";
export const C_BLUE = "#2f5bd8";
export const C_PENCIL = "#2b2b33";

/** Tintas de los rivales, por asiento. El azul es siempre del jugador propio. */
export const RIVAL_INKS = [
  "#d9771e",
  "#2e9e5b",
  "#7a4cc2",
  "#c2448f",
  "#1f8a8a",
  "#8a5a2b",
  "#4a4a55",
  "#b8321f",
];

/** Hash de 32 bits (djb2), para semillas y colores de respaldo. */
export function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** PRNG sembrable (mulberry32): misma semilla, mismo recorrido. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
