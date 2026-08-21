/** Etiquetas y paso del countdown 3/2/1/YA compartido con todo el repo. */
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 700;

/**
 * La URL del game server ya no se lee aca: la resuelve `shared/server-status.ts`
 * (principal, con caida al respaldo si esta configurado). `Game.ts` usa
 * `isGameServerConfigured()` para el cartel de "no disponible" y
 * `resolveGameServerUrl()` al conectar. Sin server configurado el juego no puede
 * funcionar (depende de el para validar palabras contra el diccionario server-side
 * y arbitrar la mecha): es una excepcion deliberada a la regla de degradacion,
 * documentada en el CLAUDE.md del juego.
 */

/**
 * Reacciones: en vez de emojis (prohibidos en el repo) el jugador le cambia la cara
 * a su propio personaje por un instante. El protocolo manda el `id`, nunca un glifo;
 * la cara vive dibujada en el SVG del personaje (`Hud.EMOTE_FACES`). El allowlist
 * esta duplicado en `server/src/games/wordbomb.ts` (regla de decoupling): si se toca
 * uno, tocar el otro.
 *
 * La `key` es el atajo de teclado. Son digitos porque las palabras son solo `[a-zñ]`:
 * un digito nunca es tecleo util, asi que se pueden interceptar incluso durante el
 * turno propio sin romper la escritura.
 */
export const EMOTES = [
  { id: "risa", label: "Risa", key: "1" },
  { id: "sorpresa", label: "Sorpresa", key: "2" },
  { id: "enojo", label: "Enojo", key: "3" },
  { id: "burla", label: "Burla", key: "4" },
  { id: "llanto", label: "Llanto", key: "5" },
] as const;

export type EmoteId = (typeof EMOTES)[number]["id"];

/** Cuanto dura la cara de reaccion antes de volver al estado normal. */
export const EMOTE_MS = 1800;
/**
 * Cooldown local del dock. El server tiene el suyo (1s) y es el que manda; este es
 * un poco mas largo para que el boton nunca se vea habilitado sobre una reaccion que
 * el server va a descartar en silencio.
 */
export const EMOTE_COOLDOWN_MS = 1200;
