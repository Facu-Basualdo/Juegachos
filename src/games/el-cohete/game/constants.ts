/** Tuning de El Cohete. Todo lo que mueve el balance esta aca (ver CLAUDE.md). */

export const BEST_KEY = "el-cohete:best";

// ---------- Partida ----------

/** Fichas con las que se arranca. El puntaje son las fichas al final. */
export const START_CHIPS = 1000;
/** Vuelos por partida. */
export const FLIGHTS = 10;
/** Apuesta minima y escalones de los botones de fichas. */
export const MIN_BET = 10;
export const CHIP_VALUES = [10, 50, 100, 500] as const;
/** Apuesta con la que arranca la partida. */
export const FIRST_BET = 100;

// ---------- Vuelo ----------

/** El multiplicador es m(t) = e^(GROWTH * t): x2 a los 6.3 s, x5 a los 14.6 s, x10 a los 21 s. */
export const GROWTH = 0.11;
/**
 * Curva de explosion: P(llegar a xN) = EDGE / N. Con EDGE < 1 hay un 3% de vuelos
 * que explotan en la plataforma (x1.00) y el resto sigue la cola larga de siempre.
 */
export const EDGE = 0.97;
/** Tope del multiplicador (y por lo tanto del largo de un vuelo: ~35 s). */
export const MAX_CRASH = 50;

// ---------- Avisos ----------

/**
 * Antes de explotar el motor tose con humo NEGRO durante `warnFor(crash)` segundos:
 * largo en multiplicadores bajos y cada vez mas corto (x2: 0.45 s, x3: 0.36 s, x5:
 * 0.25 s, x10: 0.15 s). Distinguir humo negro de blanco es una reaccion de eleccion
 * (~0.35-0.45 s en una persona), asi que leyendo el humo se escapa con seguridad
 * hasta ~x2, a la par hacia x3 y nunca despues de ~x5: arriba de eso la decision es
 * pura codicia. Medido con bots: ver la tabla en CLAUDE.md.
 */
export const WARN_MAX = 0.6;
export const WARN_SLOPE = 0.22;
export const WARN_MIN = 0.15;
/**
 * Amagues: toses con humo BLANCO, que no explotan. Llegan al azar (proceso de
 * Poisson) a `FAKE_RATE` por segundo de vuelo y duran `FAKE_DUR`. Castigan al que se
 * baja con cualquier tos sin mirar el color.
 */
export const FAKE_RATE = 0.3;
export const FAKE_DUR = 0.3;
/** Ni un amague antes de esto (el despegue ya es bastante ruido). */
export const FAKE_MIN_T = 1.0;
/** Ni un amague pegado al aviso real: confundiria las dos senales. */
export const FAKE_GAP = 0.6;

export function warnFor(crash: number): number {
  return Math.max(WARN_MIN, Math.min(WARN_MAX, WARN_MAX - WARN_SLOPE * Math.log(Math.max(1, crash))));
}

// ---------- Ritmo ----------

/** Ventana de apuestas en sala (fija: todos vuelan a la vez). */
export const BET_TIME = 7;
/** Ventana de apuestas jugando solo (apostar despega en el acto). */
export const SOLO_BET_TIME = 14;
/** Despues de la explosion, antes de abrir la siguiente apuesta. */
export const AFTER_TIME = 2.8;
/** Desde que se aprieta APOSTAR (solo) hasta que despega. */
export const SOLO_LAUNCH_DELAY = 0.8;

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 0.75;
export const MAX_DT = 0.05;

// ---------- Sala ----------

/** Cada cuanto se manda el estado propio si no cambio nada (keepalive, s). */
export const LIVE_KEEPALIVE = 2;
