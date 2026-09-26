import type { RoomMode } from "../../../shared/room/roomMode";

/** Lo unico de la sala que usa Dalgona. */
export type RoomLink = Pick<RoomMode, "me" | "players" | "round" | "reportScore" | "broadcastLive" | "onLive">;

/**
 * Sala falsa SOLO para desarrollo: `?dev=NICK&roster=A,B,C&code=TEST`, una pestaña
 * por nickname con el mismo `code` y `roster`. Los mensajes en vivo viajan por un
 * `BroadcastChannel` entre pestañas del mismo navegador (no hay game server ni
 * Supabase de por medio). Arranca sola al segundo, como haria el `onStart` de
 * RoomMode, y el puntaje va a la consola y a `window.__dalgonaScore`.
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
  const bus = new BroadcastChannel(`dalgona-dev-${params.get("code") ?? "DEVTEST"}`);
  const cbs: ((player: string, data: Record<string, number | string | boolean>) => void)[] = [];
  bus.onmessage = (e: MessageEvent) => {
    const msg = e.data as { player: string; data: Record<string, number | string | boolean> };
    if (msg?.player && msg.player !== me) for (const cb of cbs) cb(msg.player, msg.data);
  };
  window.setTimeout(onStart, 1000);
  return {
    me,
    players: () => roster,
    round: () => round,
    reportScore: (score: number) => {
      console.info(`[dalgona dev] ${me} reporta ${score}`);
      (window as unknown as { __dalgonaScore?: number }).__dalgonaScore = score;
    },
    broadcastLive: (data) => bus.postMessage({ player: me, data }),
    onLive: (cb) => cbs.push(cb),
  };
}
