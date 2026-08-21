import type { RoomMode } from "./roomMode";

/**
 * Persistencia de la partida en curso dentro de una ronda de sala, para que un
 * F5 no la reinicie.
 *
 * Sin esto, al recargar la pagina `RoomMode` ve la ronda todavia en "playing",
 * dispara `onStart` y el juego arranca de cero: tablero nuevo, movimientos en 0
 * y —lo peor— el cronometro desde 0. En los juegos "lower" (Lights Out, Numerix,
 * Torres de Hanoi) eso no es solo una molestia sino una ventaja: el que recarga
 * reporta un tiempo medido desde su ultima recarga y le gana a todos los que
 * jugaron la ronda entera.
 *
 * Va en `sessionStorage` a proposito: sobrevive al reload de la pestana pero no
 * se filtra a otra pestana ni a la proxima sesion. La clave incluye la ronda y
 * el juego, asi que la ronda siguiente arranca limpia sola.
 *
 * El tiempo NO se guarda como acumulado sino como `startedAt` (epoch): al
 * restaurar se recalcula contra el reloj de pared, de modo que recargar tampoco
 * sirva para pausar el cronometro.
 */

const PREFIX = "mg:room-run:";

/**
 * Segunda red contra un snapshot de otra partida (la primera es `clearRoomRuns`):
 * mas viejo que esto, se descarta. Una ronda sin tope de tiempo puede durar
 * bastante, asi que el margen es holgado — solo apunta a snapshots olvidados en la
 * pestana de una partida anterior.
 */
const MAX_RUN_AGE_MS = 30 * 60_000;

/** Lo que se guarda: el payload del juego mas cuando se escribio. */
interface Envelope {
  at: number;
  data: unknown;
}

function runKey(room: RoomMode, gameId: string): string {
  return `${PREFIX}${room.code}:${room.round()}:${gameId}`;
}

/** Guarda el estado de la partida en curso (pisa el anterior). */
export function saveRoomRun(room: RoomMode, gameId: string, data: unknown): void {
  try {
    const envelope: Envelope = { at: Date.now(), data };
    sessionStorage.setItem(runKey(room, gameId), JSON.stringify(envelope));
  } catch {
    // sessionStorage lleno o bloqueado: se juega igual, solo se pierde el resume.
  }
}

/** Estado guardado de esta ronda, o null si no hay (o esta corrupto / vencido). */
export function loadRoomRun<T>(room: RoomMode, gameId: string): T | null {
  try {
    const raw = sessionStorage.getItem(runKey(room, gameId));
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Envelope;
    if (!envelope || typeof envelope.at !== "number" || envelope.data == null) return null;
    if (Date.now() - envelope.at > MAX_RUN_AGE_MS) return null;
    return envelope.data as T;
  } catch {
    return null;
  }
}

/** Borra el estado guardado (al terminar la partida de la ronda). */
export function clearRoomRun(room: RoomMode, gameId: string): void {
  try {
    sessionStorage.removeItem(runKey(room, gameId));
  } catch {
    // idem saveRoomRun
  }
}

/**
 * Borra TODOS los snapshots de una sala. Lo llama `RoomMode` cuando la sala vuelve
 * al lobby o termina la partida.
 *
 * Es necesario porque `resetRoom` ("Volver a la sala") borra las rondas y la
 * partida siguiente vuelve a numerar desde la ronda 1: sin esta purga, la clave
 * `code:1:game` de la revancha encontraria el snapshot de la ronda 1 anterior y
 * retomaria una partida vieja, con un `startedAt` de hace media hora.
 */
export function clearRoomRuns(code: string): void {
  try {
    const prefix = `${PREFIX}${code}:`;
    const stale = Object.keys(sessionStorage).filter((k) => k.startsWith(prefix));
    for (const k of stale) sessionStorage.removeItem(k);
  } catch {
    // idem saveRoomRun
  }
}

/** Segundos transcurridos desde `startedAt` (epoch ms), segun el reloj de pared. */
export function elapsedSince(startedAt: number): number {
  return Math.max(0, (Date.now() - startedAt) / 1000);
}
