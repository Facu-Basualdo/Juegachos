import type { Socket } from "socket.io-client";
import type { LsInit, LsShove, LsSnap, LsState } from "./LaserShowProtocol";

/**
 * Transporte socket.io contra el namespace `/lasershow` del game server. La lib se
 * carga con import dinamico (no pesa en los juegos que no la usan) y el join
 * anuncia {code, nickname, roster, round}.
 *
 * La `round` va en el join porque el estado del server esta scopeado por ronda:
 * entre rondas el GameRoom puede sobrevivir con el show de la anterior adentro.
 *
 * socket.io reconecta solo y, al reconectar, se vuelve a mandar el join: el
 * server responde con un `ls:init` completo, que es lo que cura un corte.
 */
export class LaserShowSocket {
  private socket: Socket | null = null;
  private initCb: (init: LsInit) => void = () => {};
  private stateCb: (state: LsState) => void = () => {};
  private snapCb: (snap: LsSnap) => void = () => {};
  private shoveCb: (shove: LsShove) => void = () => {};
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
    const socket = io(`${base}/lasershow`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("ls:join", {
        code: this.code,
        nickname: this.nickname,
        roster: this.roster,
        round: this.round,
      });
    });
    socket.on("ls:init", (init: LsInit) => this.initCb(init));
    socket.on("ls:state", (state: LsState) => this.stateCb(state));
    socket.on("ls:snap", (snap: LsSnap) => this.snapCb(snap));
    socket.on("ls:shove", (shove: LsShove) => this.shoveCb(shove));
    socket.on("ls:pushfx", (msg: { i: number }) => this.pushFxCb(msg.i));
  }

  onInit(cb: (init: LsInit) => void): void {
    this.initCb = cb;
  }

  onState(cb: (state: LsState) => void): void {
    this.stateCb = cb;
  }

  onSnap(cb: (snap: LsSnap) => void): void {
    this.snapCb = cb;
  }

  /** Te empujaron (dirigido). */
  onShove(cb: (shove: LsShove) => void): void {
    this.shoveCb = cb;
  }

  /** Alguien empujo (a todos, para la animacion). */
  onPushFx(cb: (seat: number) => void): void {
    this.pushFxCb = cb;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  sendPos(x: number, y: number, z: number, r: number, f: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("ls:pos", { x: round2(x), y: round2(y), z: round2(z), r: round2(r), f });
  }

  /** Empujo hacia donde miro; el server decide a quien alcanza. */
  sendPush(yaw: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("ls:push", { r: round2(yaw) });
  }

  sendDead(): void {
    this.socket?.emit("ls:dead", {});
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
