/** Tuning de El Cohete. Todo lo que mueve el balance esta aca (ver CLAUDE.md). */

export const BEST_KEY = "el-cohete:best";

// ---------- Partida ----------

/** Fichas con las que se arranca. El puntaje son las fichas al final. */
export const START_CHIPS = 1000;
/** Vuelos por partida. */
export const FLIGHTS = 4;
/** Apuesta minima y las fichas del paño (cada una FIJA la apuesta; hay ademas "todo"). */
export const MIN_BET = 10;
export const CHIP_VALUES = [50, 100, 250, 500] as const;
/** Apuesta con la que arranca la partida. */
export const FIRST_BET = 100;

// ---------- Vuelo ----------

/** El multiplicador es m(t) = e^(GROWTH * t): x2 a los 6.3 s, x5 a los 14.6 s, x10 a los 21 s. */
export const GROWTH = 0.11;
/**
 * Curva de explosion: P(llegar a xN) = EDGE / N. Con EDGE < 1 hay un 3% de vuelos
 * que explotan en la plataforma (x1.00) y el resto sigue la cola larga de siempre.
 * Explota sin aviso: es timba (decision del programador, ver CLAUDE.md).
 */
export const EDGE = 0.97;
/** Tope del multiplicador (y por lo tanto del largo de un vuelo: ~35 s). */
export const MAX_CRASH = 50;

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
