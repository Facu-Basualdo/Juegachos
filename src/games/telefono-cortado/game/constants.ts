/** Etiquetas y paso del countdown 3/2/1/YA compartido con todo el repo. */
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 700;

/**
 * La URL del game server la resuelve `shared/server-status.ts` (principal, con caida
 * al respaldo si esta configurado): `Game.ts` usa `isGameServerConfigured()` para el
 * cartel de "no disponible" y `resolveGameServerUrl()` al conectar. Sin server el
 * juego no funciona (el server arbitra las fases y guarda las frases secretas):
 * excepcion deliberada a la regla de degradacion del repo, igual que Basta/Bomba.
 */

/** Resolucion interna del lienzo (lo que se dibuja). */
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 500;

/**
 * El dibujo se manda al server en JPEG reducido, no en el PNG del lienzo: un PNG de
 * 800x500 son cientos de KB en base64 y el server los retransmite a toda la sala en el
 * reveal. A esta escala y calidad cada dibujo queda en ~30-60KB, bien lejos del
 * `maxHttpBufferSize` de socket.io (1MB) y del tope `MAX_IMAGE_CHARS` del sim.
 */
export const EXPORT_WIDTH = 400;
export const EXPORT_HEIGHT = 250;
export const EXPORT_QUALITY = 0.6;

/** Largos maximos (el server los vuelve a acotar). */
export const MAX_PHRASE_LEN = 60;
export const MAX_GUESS_LEN = 60;

/**
 * Paleta del lienzo. Ademas de los primarios trae los que un dibujo rapido pide y la
 * primera version no tenia: gris, piel, celeste, verde oscuro, violeta.
 */
export const PALETTE = [
  "#000000",
  "#7F7F7F",
  "#FFFFFF",
  "#E53935",
  "#FF8800",
  "#FFE033",
  "#43C443",
  "#1B6E2E",
  "#5BC8F5",
  "#1E4FD8",
  "#8E44AD",
  "#FF66C4",
  "#F5C9A0",
  "#884400",
];

/** Grosores de trazo disponibles (en pixeles del lienzo de 800 de ancho). */
export const THICKNESSES = [3, 6, 12, 24];
/** Grosor con el que arranca el lienzo (tiene que ser uno de `THICKNESSES`). */
export const DEFAULT_THICKNESS = 6;

/** Cuantos pasos de deshacer se guardan (cada uno es un ImageData de 800x500, ~1.6MB). */
export const UNDO_LIMIT = 15;

/**
 * Con cuanto margen antes del cierre de la fase se manda solo lo que haya en pantalla
 * (la frase tipeada, el dibujo a medio hacer). Sin esto, el que no llegaba a apretar
 * "Enviar" perdia el dibujo entero y su cadena quedaba sin nada que adivinar. Cubre la
 * latencia y el estrangulamiento de timers de una pestaña en segundo plano (~1s).
 */
export const AUTO_SUBMIT_MARGIN_MS = 2500;

/**
 * Si el server no manda ni un estado en este tiempo, la ronda se da por perdida y se
 * reporta un cero: el juego no declara `roomTimeLimitSec`, asi que sin esto un server
 * caido colgaria la sala.
 */
export const CONNECT_TIMEOUT_MS = 20000;
