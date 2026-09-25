/** Etiquetas y paso del countdown 3/2/1/YA compartido con todo el repo. */
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 700;

/**
 * Flechas de la secuencia, en el mismo alfabeto que el server ("U" "D" "L" "R").
 * `keys` son las teclas que la marcan (flechas y WASD); `rot` gira el chevron.
 */
export const ARROWS = {
  U: { keys: ["ArrowUp", "w", "W"], rot: 0, label: "arriba" },
  R: { keys: ["ArrowRight", "d", "D"], rot: 90, label: "derecha" },
  D: { keys: ["ArrowDown", "s", "S"], rot: 180, label: "abajo" },
  L: { keys: ["ArrowLeft", "a", "A"], rot: 270, label: "izquierda" },
} as const;

export type Arrow = keyof typeof ARROWS;

/** Tecla -> flecha. */
export const KEY_TO_ARROW: ReadonlyMap<string, Arrow> = new Map(
  (Object.keys(ARROWS) as Arrow[]).flatMap((a) => ARROWS[a].keys.map((k) => [k, a] as const)),
);

/** Cada cuanto se sondea el reloj del server (`hp:ping`). Barato: un numero ida y vuelta. */
export const PING_EVERY_MS = 1000;
/**
 * Correccion del offset de reloj hacia arriba, por muestra (fraccion del error).
 * Baja de golpe (un paquete rapido es buena informacion) y sube de a poco, igual que
 * PONG, para no seguirle el jitter a cada paquete lento.
 */
export const CLOCK_DRIFT_RATE = 0.01;
/**
 * Si un pase optimista no se resuelve en este tiempo (ni aceptado ni rechazado), se
 * descarta y la papa vuelve a la mano. Solo pasa si el mensaje se perdio en una
 * reconexion del socket.
 */
export const PENDING_TIMEOUT_MS = 1500;
/** Cuanto tarda la papa en volar de un jugador a otro (debe coincidir con `--flight` del CSS). */
export const FLIGHT_MS = 160;
/** El termometro entra en zona roja (tic-tac rapido, papa temblando) desde aca. */
export const HEAT_HOT = 0.6;
