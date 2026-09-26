import type { Socket } from "socket.io-client";
import type { LcInit, LcShove, LcSnap, LcState } from "./LaCuerdaProtocol";

/**
 * Transporte socket.io contra el namespace `/lacuerda` del game server. La lib se
 * carga con import dinamico (no pesa en los juegos que no la usan) y el join
 * anuncia {code, nickname, roster, round}.
 *
 * La `round` va en el join porque el estado del server esta scopeado por ronda:
 * entre rondas el GameRoom puede sobrevivir con la partida anterior adentro.
 *
 * socket.io reconecta solo y, al reconectar, se vuelve a mandar el join: el
 * server responde con un `lc:init` completo, que es lo que cura un corte.
 */
export class LaCuerdaSocket {
  private socket: Socket | null = null;
  private initCb: (init: LcInit) => void = () => {};
  private stateCb: (state: LcState) => void = () => {};
  private snapCb: (snap: LcSnap) => void = () => {};
  private shoveCb: (shove: LcShove) => void = () => {};
  private pushFxCb: (seat: number) => void = () => {};

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
    const socket = io(`${base}/lacuerda`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("lc:join", {
        code: this.code,
        nickname: this.nickname,
        roster: this.roster,
        round: this.round,
      });
    });
    socket.on("lc:init", (init: LcInit) => this.initCb(init));
    socket.on("lc:state", (state: LcState) => this.stateCb(state));
    socket.on("lc:snap", (snap: LcSnap) => this.snapCb(snap));
    socket.on("lc:shove", (shove: LcShove) => this.shoveCb(shove));
    socket.on("lc:pushfx", (msg: { i: number }) => this.pushFxCb(msg.i));
  }

  onInit(cb: (init: LcInit) => void): void {
    this.initCb = cb;
  }

  onState(cb: (state: LcState) => void): void {
    this.stateCb = cb;
  }

  onSnap(cb: (snap: LcSnap) => void): void {
    this.snapCb = cb;
  }

  onShove(cb: (shove: LcShove) => void): void {
    this.shoveCb = cb;
  }

  onPushFx(cb: (seat: number) => void): void {
    this.pushFxCb = cb;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  sendPos(x: number, y: number, z: number, r: number, f: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("lc:pos", { x: round2(x), y: round2(y), z: round2(z), r: round2(r), f });
  }

  /** Empujon hacia `yaw` (hacia donde mira el muñeco). */
  sendPush(yaw: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("lc:push", { r: round2(yaw) });
  }

  sendDead(): void {
    this.socket?.emit("lc:dead", {});
  }

  sendGoal(): void {
    this.socket?.emit("lc:goal", {});
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
