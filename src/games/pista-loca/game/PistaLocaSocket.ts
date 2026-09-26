import type { Socket } from "socket.io-client";
import type { PlInit, PlShove, PlSnap, PlState } from "./PistaLocaProtocol";

/**
 * Transporte socket.io contra el namespace `/pistaloca` del game server. La lib se
 * carga con import dinamico (no pesa en los juegos que no la usan) y el join
 * anuncia {code, nickname, roster, round}.
 *
 * La `round` va en el join porque el estado del server esta scopeado por ronda:
 * entre rondas el GameRoom puede sobrevivir con la pista de la anterior adentro.
 *
 * socket.io reconecta solo y, al reconectar, se vuelve a mandar el join: el
 * server responde con un `pl:init` completo, que es lo que cura un corte.
 */
export class PistaLocaSocket {
  private socket: Socket | null = null;
  private initCb: (init: PlInit) => void = () => {};
  private stateCb: (state: PlState) => void = () => {};
  private snapCb: (snap: PlSnap) => void = () => {};
  private shoveCb: (shove: PlShove) => void = () => {};
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
    const socket = io(`${base}/pistaloca`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("pl:join", {
        code: this.code,
        nickname: this.nickname,
        roster: this.roster,
        round: this.round,
      });
    });
    socket.on("pl:init", (init: PlInit) => this.initCb(init));
    socket.on("pl:state", (state: PlState) => this.stateCb(state));
    socket.on("pl:snap", (snap: PlSnap) => this.snapCb(snap));
    socket.on("pl:shove", (shove: PlShove) => this.shoveCb(shove));
    socket.on("pl:pushfx", (msg: { i: number }) => this.pushFxCb(msg.i));
  }

  onInit(cb: (init: PlInit) => void): void {
    this.initCb = cb;
  }

  onState(cb: (state: PlState) => void): void {
    this.stateCb = cb;
  }

  onSnap(cb: (snap: PlSnap) => void): void {
    this.snapCb = cb;
  }

  /** Te empujaron (dirigido). */
  onShove(cb: (shove: PlShove) => void): void {
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
    this.socket.emit("pl:pos", { x: round2(x), y: round2(y), z: round2(z), r: round2(r), f });
  }

  /** Empujo hacia donde miro; el server decide a quien alcanza. */
  sendPush(yaw: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit("pl:push", { r: round2(yaw) });
  }

  sendDead(): void {
    this.socket?.emit("pl:dead", {});
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
