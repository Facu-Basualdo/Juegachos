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

/** Paleta del lienzo. */
export const PALETTE = [
  "#000000",
  "#FFFFFF",
  "#FF0000",
  "#00FF00",
  "#0000FF",
  "#FFFF00",
  "#FF8800",
  "#FF00FF",
  "#884400",
];

/** Grosores de trazo disponibles. */
export const THICKNESSES = [2, 5, 10, 20];
