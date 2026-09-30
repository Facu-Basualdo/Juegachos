import type { Socket } from "socket.io-client";
import type { LbCrown, LbPlayer, LbPos } from "./LobbyProtocol";

/**
 * Transporte contra el namespace `/lobby` del game server (un relay puro, ver
 * `server/src/games/lobby.ts`). socket.io se carga con import dinamico y
 * reconecta solo; al reconectar se vuelve a mandar el join y el server contesta
 * con un `lb:init` con los que ya estan.
 */
export class LobbySocket {
  private socket: Socket | null = null;
  private initCb: (players: LbPlayer[], crown: LbCrown | null) => void = () => {};
  private pongCb: (c: number, t: number) => void = () => {};
  private summitCb: (c: LbCrown) => void = () => {};
  private crownCb: (c: LbCrown) => void = () => {};
  private hiCb: (p: string, look: number) => void = () => {};
  private byeCb: (p: string) => void = () => {};
  private posCb: (pos: LbPos) => void = () => {};
  private emoteCb: (p: string, e: number) => void = () => {};

  private readonly serverUrl: string;
  private readonly code: string;
  private readonly nickname: string;
  private readonly look: number;
  private rosterFn: () => string[];

  constructor(serverUrl: string, code: string, nickname: string, look: number, roster: () => string[]) {
    this.serverUrl = serverUrl;
    this.code = code;
    this.nickname = nickname;
    this.look = look;
    this.rosterFn = roster;
  }

  async connect(): Promise<void> {
    const { io } = await import("socket.io-client");
    const base = this.serverUrl.replace(/\/$/, "");
    const socket = io(`${base}/lobby`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("lb:join", {
        code: this.code,
        nickname: this.nickname,
        roster: this.rosterFn(),
        look: this.look,
      });
    });
    socket.on("lb:init", (msg: { players: LbPlayer[]; crown?: LbCrown | null }) =>
      this.initCb(msg.players ?? [], msg.crown ?? null),
    );
    socket.on("lb:pong", (msg: { c: number; t: number }) => this.pongCb(msg.c, msg.t));
    socket.on("lb:summit", (msg: LbCrown) => this.summitCb(msg));
    socket.on("lb:crown", (msg: LbCrown) => this.crownCb(msg));
    socket.on("lb:hi", (msg: { p: string; look: number }) => this.hiCb(msg.p, msg.look));
    socket.on("lb:bye", (msg: { p: string }) => this.byeCb(msg.p));
    socket.on("lb:pos", (msg: LbPos) => this.posCb(msg));
    socket.on("lb:emote", (msg: { p: string; e: number }) => this.emoteCb(msg.p, msg.e));
  }

  onInit(cb: (players: LbPlayer[], crown: LbCrown | null) => void): void {
    this.initCb = cb;
  }

  /** Respuesta al ping: `c` es la hora local del envio, `t` la del server. */
  onPong(cb: (c: number, t: number) => void): void {
    this.pongCb = cb;
  }

  onSummit(cb: (c: LbCrown) => void): void {
    this.summitCb = cb;
  }

  onCrown(cb: (c: LbCrown) => void): void {
    this.crownCb = cb;
  }

  ping(): void {
    if (!this.socket?.connected) return;
    this.socket.emit("lb:ping", { c: Date.now() });
  }

  sendTop(ms: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("lb:top", { ms });
  }

  onHi(cb: (p: string, look: number) => void): void {
    this.hiCb = cb;
  }

  onBye(cb: (p: string) => void): void {
    this.byeCb = cb;
  }

  onPos(cb: (pos: LbPos) => void): void {
    this.posCb = cb;
  }

  onEmote(cb: (p: string, e: number) => void): void {
    this.emoteCb = cb;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  sendPos(x: number, y: number, z: number, r: number, f: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("lb:pos", { x, y, z, r, f });
  }

  sendEmote(e: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("lb:emote", { e });
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
