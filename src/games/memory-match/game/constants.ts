/** Mejor marca local del modo solo: tiempo (segundos) y movimientos. */
export const BEST_TIME_KEY = "memory_match_best_time";
export const BEST_MOVES_KEY = "memory_match_best_moves";
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA!"];
export const COUNTDOWN_STEP = 0.8; // seconds per label
export const MAX_DT = 0.1; // clamp delta time to avoid large jumps

/** Cuanto quedan visibles dos cartas que no eran par antes de voltearse. */
export const REVEAL_HOLD_MS = 900;

/** Inactividad del jugador de turno antes de que el host lo saltee (sala). */
export const AFK_SKIP_MS = 20000;

/**
 * Lo mismo, pero para un jugador **desconectado**: no va a mover nunca, asi que
 * no tiene sentido reservarle la ventana AFK completa en cada vuelta de turnos.
 */
export const AFK_ABSENT_SKIP_MS = 3000;

/** Poll de respaldo del estado compartido (ademas del broadcast "sync"). */
export const MATCH_POLL_MS = 5000;
