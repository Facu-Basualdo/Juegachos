/**
 * Constantes del CLIENTE de Agar. El tuning del juego (mapa, masa, velocidad, zoom)
 * NO esta aca: viaja desde el server en el `ag:init` (ver
 * `server/src/games/agar-config.ts`), asi que no hay nada que duplicar ni que se
 * pueda desincronizar. Lo de aca es solo como se ve y se siente la red de este lado.
 */

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
/** Segundos por etiqueta del countdown. */
export const COUNTDOWN_STEP = 0.75;

/** Tope del dt de un cuadro (s), para que un tab que vuelve no salte de golpe. */
export const MAX_DT = 0.05;

/**
 * Cada cuanto se manda el input aunque no haya cambiado (s). 30/s queda por debajo
 * del rate limit del server (40/s con rafaga de 60).
 */
export const INPUT_INTERVAL = 1 / 30;
/** Un cambio de direccion grande sale antes del envio periodico, pero no mas seguido que esto (s). */
export const INPUT_MIN_GAP = 1 / 30;
/** Cuanto tiene que cambiar el vector (suma de |d|) para contar como giro. */
export const INPUT_TURN_EPS = 0.12;
