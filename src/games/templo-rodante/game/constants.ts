// ---------------------------------------------------------------------------
// Espacio de autoria fijo: se dibuja siempre contra VIEW_W x VIEW_H y
// Game.render() lo escala/letterboxea a la ventana, asi que la sala mantiene
// sus proporciones y la fisica se siente igual en cualquier pantalla.
// ---------------------------------------------------------------------------
export const VIEW_W = 960;
export const VIEW_H = 620;

/** Tope de dt: un cambio de pestana no puede teletransportar una viga adentro tuyo. */
export const MAX_DT = 1 / 30;

// --- Proyeccion isometrica -------------------------------------------------
// Mundo: x = eje por el que ruedan las vigas, y = profundidad (carriles de
// jugadores), z = altura. Pantalla: sx = O + (x - y) * TILE_HW,
// sy = O + (x + y) * TILE_HH - z * Z_SCALE.
export const TILE_HW = 32;
export const TILE_HH = 17;
export const Z_SCALE = 56;
export const ORIGIN_X = 416;
export const ORIGIN_Y = 205;
/** Altura de los muros del fondo (unidades). */
export const WALL_H = 3.2;
/** Alto del vano por el que entran las vigas: el muro de la izquierda solo
 * existe por ENCIMA de esto, si no taparia el pasillo. */
export const TUNNEL_H = 1.9;

// --- Geometria de la sala (unidades de mundo) ------------------------------
/** Largo de la plataforma en el eje de rodadura. */
export const FLOOR_W = 12;
/** Profundidad de la plataforma (donde se reparten los carriles). */
export const FLOOR_D = 8;
/** Antesala en penumbra a cada lado: por ahi entran y salen las vigas. */
export const PORCH = 2.2;
/** Los corredores estan todos sobre esta x: la viga los cruza a todos a la vez. */
export const RUNNER_X = FLOOR_W / 2;
/** Carriles: el primero y el ultimo jugador se paran en estas profundidades. */
export const LANE_MIN = 1.3;
export const LANE_MAX = 6.7;

// --- Corredor --------------------------------------------------------------
/** Media anchura del cuerpo en el eje de rodadura (mitad del hitbox en x). */
export const RUNNER_HALF = 0.3;
/** Altura de pie / agachado, en unidades de mundo. */
export const STAND_H = 1.0;
export const DUCK_H = 0.48;
/** Altura maxima del salto. Debe quedar por DEBAJO de BEAM_HIGH_TOP: saltar
 * nunca puede ser una forma de pasar por encima de la viga alta. */
export const JUMP_HEIGHT = 1.05;
/** Duracion total del salto (subida + bajada), en segundos. */
export const JUMP_TIME = 0.56;
/** Derivadas de las dos de arriba: parabola exacta. */
export const JUMP_GRAVITY = (8 * JUMP_HEIGHT) / (JUMP_TIME * JUMP_TIME);
export const JUMP_SPEED = (JUMP_GRAVITY * JUMP_TIME) / 2;
/** Un toque corto igual agacha: la agachada dura al menos esto aunque sueltes. */
export const DUCK_MIN = 0.32;

// --- Vigas -----------------------------------------------------------------
/** Media anchura de la viga en el eje de rodadura. */
export const BEAM_HALF = 0.36;
/** Franja de altura que ocupa la viga rasante: se salta. */
export const BEAM_LOW_TOP = 0.58;
/** Franja que ocupa la viga alta: se esquiva agachandose. Su piso esta apenas
 * por encima de DUCK_H y su techo por encima de JUMP_HEIGHT, asi que agacharse
 * es la unica salida. */
export const BEAM_HIGH_BOTTOM = 0.62;
export const BEAM_HIGH_TOP = 1.2;
/** Radio visual del cilindro (mundo). */
export const BEAM_RADIUS = 0.29;
/** Vueltas por unidad recorrida (para los pinchos que giran). */
export const BEAM_SPIN = 1.15;
/** A que distancia del corredor nace una viga. Fija en distancia, no en tiempo:
 * con la velocidad al maximo esto deja ~0.8 s de aviso, que es el piso de lo
 * jugable, y por eso SPEED_MAX no puede subir sin subir tambien esto. */
export const SPAWN_DIST = 8.5;

// --- Rampa de dificultad ---------------------------------------------------
// Sube por escalones discretos (uno cada STEP_SECONDS) en vez de continuo, para
// que cada salto se sienta. Llega al maximo en RAMP_SECONDS y se queda ahi.
export const STEP_SECONDS = 3;
export const RAMP_SECONDS = 75;

/** Velocidad de rodadura (unidades/s). */
export const SPEED_START = 5.6;
export const SPEED_MAX = 10.5;
/** Segundos entre llegadas de viga al corredor. Es el ritmo real del juego: las
 * vigas se agendan por CUANDO te cruzan, no por cuando nacen (ver BeamField). */
export const GAP_START = 1.55;
export const GAP_MIN = 0.7;
/** Variacion aleatoria del hueco, para que no entre en trance. */
export const GAP_JITTER = 0.12;

/** Desde este nivel pueden venir dos vigas del mismo tipo, una por cada lado,
 * llegando juntas: mismo movimiento a hacer, el doble de aparato. */
export const PAIR_FROM_LEVEL = 6;
export const PAIR_CHANCE_MAX = 0.34;

// --- Modo sala: canal efimero de poses -------------------------------------
/** Keepalive: aunque no cambies de pose se reafirma el estado cada tanto, asi un
 * mensaje perdido no te deja agachado para siempre en la pantalla del resto. */
export const NET_KEEPALIVE_MS = 1000;
/** Un rival que no manda nada hace este tiempo se descarta. Generoso a proposito:
 * un hipo de red congela al rival en su ultima pose, no lo borra. */
export const REMOTE_STALE_MS = 6000;

/** Tunica de cada corredor, por orden de asiento en la sala. */
export const TUNIC_COLORS = [
  "#d8452f", // rojo
  "#3f7fd6", // azul
  "#3fae5a", // verde
  "#f2c81e", // amarillo
  "#9b5cd6", // violeta
  "#22c3d6", // cian
  "#ff6fae", // rosa
  "#8de04a", // lima
];

// --- Paleta "Piedra y Brasa" (ver DESIGN.md) -------------------------------
export const C_VOID = "#0a0604";
export const C_DEEP = "#170d08";
export const C_STONE_DARK = "#2b1a10";
export const C_STONE = "#4a2f1c";
export const C_STONE_MID = "#6b4a2f";
export const C_STONE_LIT = "#8a6641";
export const C_STONE_HOT = "#a8804f";
export const C_EMBER = "#ff7a18";
export const C_FLAME = "#ff9d3c";
export const C_WARM = "#ffd9a0";
export const C_SPARK = "#fff0d0";
export const C_BONE = "#e8e2d0";
export const C_BONE_DARK = "#a89b7e";

/** Hash de 32 bits (djb2), para semillas y colores de respaldo. */
export function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** PRNG sembrable (mulberry32): misma semilla, misma secuencia de vigas. */
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

/** Profundidad del carril del jugador `index` en una sala de `total`. */
export function laneFor(index: number, total: number): number {
  if (total <= 1) return (LANE_MIN + LANE_MAX) / 2;
  const i = Math.min(Math.max(index, 0), total - 1);
  return LANE_MIN + (i * (LANE_MAX - LANE_MIN)) / (total - 1);
}
