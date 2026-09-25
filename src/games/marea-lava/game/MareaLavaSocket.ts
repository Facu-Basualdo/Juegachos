import type { Socket } from "socket.io-client";
import type { MlInit, MlSnap, MlState } from "./MareaLavaProtocol";

/**
 * Transporte socket.io contra el namespace `/marealava` del game server. La lib se
 * carga con import dinamico (no pesa en los juegos que no la usan) y el join
 * anuncia {code, nickname, roster, round}.
 *
 * La `round` va en el join porque el estado del server esta scopeado por ronda:
 * entre rondas el GameRoom puede sobrevivir con la torre de la anterior adentro.
 *
 * socket.io reconecta solo y, al reconectar, se vuelve a mandar el join: el
 * server responde con un `ml:init` completo, que es lo que cura un corte.
 */
export class MareaLavaSocket {
  private socket: Socket | null = null;
  private initCb: (init: MlInit) => void = () => {};
  private stateCb: (state: MlState) => void = () => {};
  private snapCb: (snap: MlSnap) => void = () => {};

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
    const socket = io(`${base}/marealava`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("ml:join", {
        code: this.code,
        nickname: this.nickname,
        roster: this.roster,
        round: this.round,
      });
    });
    socket.on("ml:init", (init: MlInit) => this.initCb(init));
    socket.on("ml:state", (state: MlState) => this.stateCb(state));
    socket.on("ml:snap", (snap: MlSnap) => this.snapCb(snap));
  }

  onInit(cb: (init: MlInit) => void): void {
    this.initCb = cb;
  }

  onState(cb: (state: MlState) => void): void {
    this.stateCb = cb;
  }

  onSnap(cb: (snap: MlSnap) => void): void {
    this.snapCb = cb;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  sendPos(x: number, y: number, z: number, r: number, f: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("ml:pos", { x: round2(x), y: round2(y), z: round2(z), r: round2(r), f });
  }

  sendDead(): void {
    this.socket?.emit("ml:dead", {});
  }

  sendTop(): void {
    this.socket?.emit("ml:top", {});
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
