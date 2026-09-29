/**
 * "Como se juega" de cada juego, en formato de iconos: lo que muestra el briefing de
 * la sala antes de cada ronda (ver `RoomOverlay.showBriefing`). Modulo hoja (sin
 * imports), como `scoring-core.ts`: lo importa el `meta.ts` de cada juego.
 *
 * La idea es que se entienda sin leer: una intro de dos renglones arriba y despues
 * una tarjeta por accion, con el titulo grande (MOVERSE, SALTAR, EMPUJAR...) y abajo
 * los iconos de las teclas, el mouse o el dedo que la hacen. Varios iconos en una
 * accion son ALTERNATIVAS: se dibujan con una "o" entre medio.
 */

/**
 * Iconos disponibles. Teclas:
 *  - `wasd`, `arrows` (las cuatro), `ad`, `arrows-lr`, `ws`, `arrows-ud`,
 *    `arrow-up`, `arrow-down`: los grupos de siempre, dibujados como teclas.
 *  - `space`, `enter`, `esc`: teclas anchas con su nombre.
 *  - `key:F`: una tecla con cualquier texto corto. `keys:1 2 3 4`: varias, separadas
 *    por espacio.
 *  - `keyboard`: escribir con el teclado.
 * Mouse: `click`, `mouse` (moverlo / apuntar), `drag` (arrastrar), `wheel`.
 * Celu: `tap` (tocar), `hold` (mantener apretado), `swipe` (arrastrar el dedo),
 * `tap-sides` (tocar un lado de la pantalla), `joystick` (el que aparece en pantalla).
 * `btn:SALTAR`: un boton en pantalla con ese texto. Otros: `mic` (la voz),
 * `headphones`.
 */
export type HowToIcon =
  | "wasd"
  | "arrows"
  | "ad"
  | "arrows-lr"
  | "ws"
  | "arrows-ud"
  | "arrow-up"
  | "arrow-down"
  | "space"
  | "enter"
  | "esc"
  | "keyboard"
  | "click"
  | "mouse"
  | "drag"
  | "wheel"
  | "tap"
  | "hold"
  | "swipe"
  | "tap-sides"
  | "joystick"
  | "mic"
  | "headphones"
  | `key:${string}`
  | `keys:${string}`
  | `btn:${string}`;

export interface HowToAction {
  /** Una o dos palabras, se muestra en mayusculas: "MOVERSE", "EMPUJAR". */
  title: string;
  /** Alternativas para hacerlo (teclado, mouse, celu). */
  icons: HowToIcon[];
  /** Aclaracion opcional muy corta abajo de los iconos ("mantené apretado"). */
  note?: string;
}

export interface HowTo {
  /** Dos renglones como mucho (~110 caracteres): de que se trata y como se gana. */
  intro: string;
  actions: HowToAction[];
}
