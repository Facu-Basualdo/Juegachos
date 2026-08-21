/** Etiquetas y paso del countdown 3/2/1/YA compartido con todo el repo. */
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 700;

/**
 * URL del game server autoritativo (socket.io). Sin esta env el juego no puede
 * funcionar: Impostor depende del server para repartir roles, arbitrar las fases
 * (revelado, pistas, votacion, adivinanza) y computar el puntaje. A diferencia del
 * resto del repo no degrada a un modo local; sin server muestra "no disponible".
 * Excepcion deliberada a la regla de degradacion (documentada en el CLAUDE.md del
 * juego), igual que Basta / Bomba / Cadena.
 */
// La URL la resuelve `shared/server-status.ts` (principal, con caida al respaldo
// si esta configurado): `Game.ts` usa `isGameServerConfigured()` para el cartel de
// "no disponible" y `resolveGameServerUrl()` al conectar.

/** Largo maximo de una pista / adivinanza (el server tambien acota). */
export const MAX_WORD_LEN = 24;
