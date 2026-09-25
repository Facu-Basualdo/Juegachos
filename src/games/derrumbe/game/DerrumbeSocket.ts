import type { Socket } from "socket.io-client";
import type { DrInit, DrSnap, DrState } from "./DerrumbeProtocol";

/**
 * Transporte socket.io contra el namespace `/derrumbe` del game server. La lib se
 * carga con import dinamico (no pesa en los juegos que no la usan) y el join
 * anuncia {code, nickname, roster, round}.
 *
 * La `round` va en el join porque el estado del server esta scopeado por ronda:
 * entre rondas el GameRoom puede sobrevivir con el piso de la anterior adentro.
 *
 * socket.io reconecta solo y, al reconectar, se vuelve a mandar el join: el
 * server responde con un `dr:init` completo, que es lo que cura un corte.
 */
export class DerrumbeSocket {
  private socket: Socket | null = null;
  private initCb: (init: DrInit) => void = () => {};
  private stateCb: (state: DrState) => void = () => {};
  private snapCb: (snap: DrSnap) => void = () => {};

  private readonly serverUrl: string;
  private readonly code: string;
  private readonly nickname: string;
  private readonly roster: string[];
  private readonly round: number;

  constructor(serverUrl: string, code: string, nickname: string, roster: string[], round: number) {
    this.serverUrl = serverUrl;
    this.code = code;
    this.nickname = nickname;
    this.roster = roster;
    this.round = round;
  }

  async connect(): Promise<void> {
    const { io } = await import("socket.io-client");
    const base = this.serverUrl.replace(/\/$/, "");
    const socket = io(`${base}/derrumbe`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("dr:join", {
        code: this.code,
        nickname: this.nickname,
        roster: this.roster,
        round: this.round,
      });
    });
    socket.on("dr:init", (init: DrInit) => this.initCb(init));
    socket.on("dr:state", (state: DrState) => this.stateCb(state));
    socket.on("dr:snap", (snap: DrSnap) => this.snapCb(snap));
  }

  onInit(cb: (init: DrInit) => void): void {
    this.initCb = cb;
  }

  onState(cb: (state: DrState) => void): void {
    this.stateCb = cb;
  }

  onSnap(cb: (snap: DrSnap) => void): void {
    this.snapCb = cb;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  sendPos(x: number, y: number, z: number, r: number, f: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("dr:pos", { x: round2(x), y: round2(y), z: round2(z), r: round2(r), f });
  }

  sendSteps(cells: number[]): void {
    if (cells.length === 0 || !this.socket?.connected) return;
    this.socket.emit("dr:step", { c: cells });
  }

  sendDead(): void {
    this.socket?.emit("dr:dead", {});
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
