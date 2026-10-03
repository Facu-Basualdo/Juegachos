import type { Socket } from "socket.io-client";
import type { BiInit, BiPlay, BiRejectReason, BiShot, BiState } from "./PoolProtocol";

/**
 * Transporte socket.io contra el namespace `/poolnight` del game server. La lib se carga con
 * import dinamico (no pesa en los juegos que no la usan) y el join anuncia
 * {code, nickname, roster, round}.
 *
 * La `round` va en el join porque el estado del server esta scopeado por ronda. socket.io
 * reconecta solo y, al reconectar, se vuelve a mandar el join: el server responde con un
 * `bi:init` completo, que es lo que cura un corte.
 */
export class PoolSocket {
  private socket: Socket | null = null;
  private initCb: (m: BiInit) => void = () => {};
  private stateCb: (s: BiState) => void = () => {};
  private playCb: (p: BiPlay) => void = () => {};
  private aimCb: (seat: number, a: number, p: number) => void = () => {};
  private cueCb: (x: number, z: number) => void = () => {};
  private rejectCb: (why: BiRejectReason) => void = () => {};
  private pongCb: (c: number, t: number) => void = () => {};
  private errorCb: (message: string) => void = () => {};

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
    const socket = io(`${base}/poolnight`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("bi:join", { code: this.code, nickname: this.nickname, roster: this.roster, round: this.round });
    });
    socket.on("bi:init", (m: BiInit) => this.initCb(m));
    socket.on("bi:state", (s: BiState) => this.stateCb(s));
    socket.on("bi:play", (p: BiPlay) => this.playCb(p));
    socket.on("bi:aim", (m: { s: number; a: number; p: number }) => this.aimCb(m.s, m.a, m.p));
    socket.on("bi:cue", (m: { x: number; z: number }) => this.cueCb(m.x, m.z));
    socket.on("bi:reject", (m: { why: BiRejectReason }) => this.rejectCb(m.why));
    socket.on("bi:pong", (m: { c: number; t: number }) => this.pongCb(m.c, m.t));
    // "Invalid namespace" = el server esta vivo pero es una version vieja, sin Poolnight.
    socket.on("connect_error", (e: Error) => this.errorCb(e.message));
  }

  onInit(cb: (m: BiInit) => void): void {
    this.initCb = cb;
  }
  onState(cb: (s: BiState) => void): void {
    this.stateCb = cb;
  }
  onPlay(cb: (p: BiPlay) => void): void {
    this.playCb = cb;
  }
  onAim(cb: (seat: number, a: number, p: number) => void): void {
    this.aimCb = cb;
  }
  onCue(cb: (x: number, z: number) => void): void {
    this.cueCb = cb;
  }
  onReject(cb: (why: BiRejectReason) => void): void {
    this.rejectCb = cb;
  }
  onPong(cb: (c: number, t: number) => void): void {
    this.pongCb = cb;
  }
  onError(cb: (message: string) => void): void {
    this.errorCb = cb;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  sendAim(a: number, p: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("bi:aim", { a: round4(a), p: round3(p) });
  }

  sendPlace(x: number, z: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("bi:place", { x: round5(x), z: round5(z) });
  }

  sendShot(shot: BiShot): void {
    if (!this.socket?.connected) return;
    const msg: BiShot = { a: round5(shot.a), p: round4(shot.p), ox: round3(shot.ox), oy: round3(shot.oy) };
    if (shot.x !== undefined && shot.z !== undefined) {
      msg.x = round5(shot.x);
      msg.z = round5(shot.z);
    }
    this.socket.emit("bi:shot", msg);
  }

  sendPing(c: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("bi:ping", { c });
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
function round5(v: number): number {
  return Math.round(v * 100000) / 100000;
}
