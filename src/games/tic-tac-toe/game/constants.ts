/** Mejor racha local del modo solo (victorias seguidas contra la IA). */
export const BEST_KEY = "tic-tac-toe:best";

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75; // segundos por numero
export const MAX_DT = 0.1; // clamp del delta para evitar saltos al volver de pestana

/** Pausa antes de que la IA juegue, para que su jugada se perciba (ms). */
export const AI_THINK_MS = 480;

/** Cuanto queda visible el resultado de una partida solo antes de la siguiente (ms). */
export const SOLO_RESULT_MS = 1500;

/** Inactividad del jugador de turno antes de que el host mueva por el (sala). */
export const AFK_MOVE_MS = 25000;

/**
 * Lo mismo, pero cuando el jugador de turno esta **desconectado**: no va a mover
 * nunca, asi que no tiene sentido reservarle la ventana AFK completa por jugada.
 */
export const AFK_ABSENT_MOVE_MS = 5000;

/** Poll de respaldo del estado compartido (ademas del broadcast "sync"). */
export const MATCH_POLL_MS = 5000;
