import type { Socket } from "socket.io-client";

/**
 * Mensajes de Chori y Pan con el game server (namespace `/choripan`, prefijo `cp:`).
 * DUPLICADOS de `server/src/games/choripan.ts` por la regla de decoupling: si cambia
 * el protocolo, tocar los dos lados.
 */
export type CpRole = "chori" | "pan" | "both" | "bettor" | "none";

export interface CpYou {
  role: CpRole;
  pair: number;
  round: number;
}

export interface CpPairView {
  id: number;
  chori: string;
  pan: string;
  /** Sala en la que va (3 = termino). */
  level: number;
  /** Ms de la carrera menos las gemas (-1 si no termino). */
  time: number;
  deaths: number;
  gems: number;
  on: boolean;
}

export interface CpState {
  phase: "waiting" | "bet" | "race" | "done";
  round: number;
  /** Hora del server (para el offset de reloj). */
  t: number;
  levels: string[];
  betEnd: number;
  raceStart: number;
  raceEnd: number;
  bettors: string[];
  bets: Record<string, number>;
  pairs: CpPairView[];
}

export interface CpPeer {
  pair: number;
  n: string;
  r: "chori" | "pan";
  lv: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  f: number;
  g: number;
  a: number;
}

export interface CpMech {
  pair: number;
  lv: number;
  ch: string;
  levers: [number, number][];
}

type Handlers = {
  you: (m: CpYou) => void;
  state: (m: CpState) => void;
  peer: (m: CpPeer) => void;
  mech: (m: CpMech) => void;
  box: (m: { pair: number; lv: number; i: number; x: number; y: number }) => void;
  gem: (m: { pair: number; lv: number; i: number }) => void;
  reset: (m: { pair: number; lv: number; who: string; cause: string }) => void;
  level: (m: { pair: number; lv: number }) => void;
};

/** Transporte socket.io contra `/choripan`. socket.io reconecta solo y se vuelve a anunciar. */
export class ChoriSocket {
  private socket: Socket | null = null;
  private readonly on: Partial<Handlers> = {};
  private readonly url: string;
  private readonly join: { code: string; nickname: string; roster: string[]; round: number };
  connected = false;

  constructor(url: string, join: { code: string; nickname: string; roster: string[]; round: number }) {
    this.url = url;
    this.join = join;
  }

  handle<K extends keyof Handlers>(event: K, cb: Handlers[K]): void {
    this.on[event] = cb;
  }

  async connect(): Promise<void> {
    const { io } = await import("socket.io-client");
    const socket = io(`${this.url.replace(/\/$/, "")}/choripan`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;
    socket.on("connect", () => {
      this.connected = true;
      socket.emit("cp:join", this.join);
    });
    socket.on("disconnect", () => (this.connected = false));
    for (const k of ["you", "state", "peer", "mech", "box", "gem", "reset", "level"] as const) {
      socket.on(`cp:${k}`, (m: unknown) => {
        const cb = this.on[k] as ((msg: unknown) => void) | undefined;
        cb?.(m);
      });
    }
  }

  send(event: string, payload: Record<string, unknown>): void {
    if (this.socket?.connected) this.socket.emit(event, payload);
  }

  close(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
