import type { Socket } from "socket.io-client";
import type { LrInit, LrSnap, LrState } from "./LuzRojaProtocol";

/**
 * Transporte socket.io contra el namespace `/luzroja`. La lib se carga con import
 * dinamico y el join anuncia {code, nickname, roster, round} (la ronda scopea el
 * estado del server). Al reconectar se vuelve a mandar el join y el server responde
 * con un `lr:init` completo.
 */
export class LuzRojaSocket {
  private socket: Socket | null = null;
  private initCb: (init: LrInit) => void = () => {};
  private stateCb: (state: LrState) => void = () => {};
  private snapCb: (snap: LrSnap) => void = () => {};
  private teaseCb: () => void = () => {};

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
    const socket = io(`${base}/luzroja`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;
    socket.on("connect", () => {
      socket.emit("lr:join", { code: this.code, nickname: this.nickname, roster: this.roster, round: this.round });
    });
    socket.on("lr:init", (init: LrInit) => this.initCb(init));
    socket.on("lr:state", (state: LrState) => this.stateCb(state));
    socket.on("lr:snap", (snap: LrSnap) => this.snapCb(snap));
    socket.on("lr:tease", () => this.teaseCb());
  }

  onInit(cb: (init: LrInit) => void): void {
    this.initCb = cb;
  }

  onState(cb: (state: LrState) => void): void {
    this.stateCb = cb;
  }

  onSnap(cb: (snap: LrSnap) => void): void {
    this.snapCb = cb;
  }

  onTease(cb: () => void): void {
    this.teaseCb = cb;
  }

  sendPos(x: number, z: number, r: number, moving: boolean): void {
    if (!this.socket?.connected) return;
    this.socket.emit("lr:pos", { x: round2(x), z: round2(z), r: round2(r), m: moving ? 1 : 0 });
  }

  sendOut(): void {
    this.socket?.emit("lr:out", {});
  }

  sendFinish(): void {
    this.socket?.emit("lr:fin", {});
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
