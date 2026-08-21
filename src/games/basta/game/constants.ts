import type { BtCategoryId } from "./BastaTransport";

/** Etiquetas y paso del countdown 3/2/1/YA compartido con todo el repo. */
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 700;

/**
 * URL del game server autoritativo (socket.io). Sin esta env el juego no puede
 * funcionar: Basta depende del server para arbitrar las fases (llenado, BASTA,
 * votacion, puntaje). A diferencia del resto del repo no degrada a un modo local;
 * sin server muestra "no disponible". Excepcion deliberada a la regla de degradacion
 * (documentada en el CLAUDE.md del juego), igual que Bomba/Cadena.
 */
// La URL la resuelve `shared/server-status.ts` (principal, con caida al respaldo
// si esta configurado): `Game.ts` usa `isGameServerConfigured()` para el cartel de
// "no disponible" y `resolveGameServerUrl()` al conectar.

/** Las 7 categorias, en orden. Los ids **espejan** `CATEGORIES` de `server/src/games/basta.ts`. */
export const CATEGORIES: { id: BtCategoryId; label: string }[] = [
  { id: "nombre", label: "Nombre" },
  { id: "apellido", label: "Apellido" },
  { id: "lugar", label: "Pais / Ciudad" },
  { id: "color", label: "Color" },
  { id: "comida", label: "Comida" },
  { id: "animal", label: "Animal" },
  { id: "cosa", label: "Cosa" },
];
