import type { RoomMode } from "../../../shared/room/roomMode";

/** Lo unico de la sala que usa Telefono Cortado. */
export type RoomLink = Pick<RoomMode, "code" | "me" | "players" | "round" | "reportScore">;

/**
 * Sala falsa SOLO para desarrollo (copiada de `pista-loca`, por la regla de
 * decoupling): `?dev=NICK&roster=A,B,C&code=TEST` juega contra el game server local
 * sin Supabase, que es la unica forma de probar la partida con varias pestañas sin
 * crear salas en la base real. Arranca sola al segundo (como haria el `onStart` de
 * RoomMode) y el puntaje va a la consola.
 *
 * `import.meta.env.DEV` es false en el build, asi que en produccion esto devuelve
 * siempre null y Vite lo elimina.
 */
export function devRoom(onStart: () => void): RoomLink | null {
  if (!import.meta.env.DEV) return null;
  const params = new URLSearchParams(window.location.search);
  const me = params.get("dev");
  if (!me) return null;
  const roster = (params.get("roster") ?? me).split(",").filter(Boolean);
  const round = Number(params.get("round") ?? 1);
  window.setTimeout(onStart, 1000);
  return {
    code: params.get("code") ?? "DEVTEST",
    me,
    players: () => roster,
    round: () => round,
    reportScore: (score: number) => {
      console.info(`[telefono-cortado dev] ${me} reporta ${score}`);
      (window as unknown as { __tcScore?: number }).__tcScore = score;
    },
  };
}
