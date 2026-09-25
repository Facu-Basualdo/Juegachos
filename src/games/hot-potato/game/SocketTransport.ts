import type { Socket } from "socket.io-client";
import type { HpGameover, HpRejectReason, HpState } from "./HotPotatoProtocol";

const BURST_PINGS = 6;
const BURST_GAP_MS = 150;

/**
 * Transporte socket.io contra el namespace `/hotpotato`. La lib se carga con import
 * dinamico (no pesa en los juegos que no la usan). Anuncia {code, nickname, roster,
 * round} al conectar: el server arma el circulo con el roster y scopea el estado por
 * ronda (la sala puede repetir el juego y el room del server sobrevivir entre rondas).
 */
export class SocketTransport {
  private socket: Socket | null = null;
  private stateCb: (s: HpState) => void = () => {};
  private rejectCb: (n: number, r: HpRejectReason) => void = () => {};
  private pongCb: (c: number, t: number) => void = () => {};
  private gameoverCb: (r: HpGameover) => void = () => {};
  private pingTimer = 0;

  private readonly serverUrl: string;
  private readonly code: string;
  private readonly nickname: string;
  private readonly roster: string[];
  private readonly round: number;
  private readonly pingEveryMs: number;

  constructor(
    serverUrl: string,
    code: string,
    nickname: string,
    roster: string[],
    round: number,
    pingEveryMs: number,
  ) {
    this.serverUrl = serverUrl;
    this.code = code;
    this.nickname = nickname;
    this.roster = roster;
    this.round = round;
    this.pingEveryMs = pingEveryMs;
  }

  async connect(): Promise<void> {
    const { io } = await import("socket.io-client");
    const base = this.serverUrl.replace(/\/$/, "");
    const socket = io(`${base}/hotpotato`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("hp:join", {
        code: this.code,
        nickname: this.nickname,
        roster: this.roster,
        round: this.round,
      });
      // Rafaga de sondeos al conectar: el offset de reloj se queda con el minimo, y
      // con varias muestras ya esta asentado antes de que salga la primera papa.
      for (let i = 0; i < BURST_PINGS; i++) window.setTimeout(() => this.ping(), i * BURST_GAP_MS);
    });
    socket.on("hp:state", (s: HpState) => this.stateCb(s));
    socket.on("hp:reject", (m: { n: number; reason: HpRejectReason }) => this.rejectCb(m.n, m.reason));
    socket.on("hp:pong", (m: { c: number; t: number }) => this.pongCb(m.c, m.t));
    socket.on("hp:gameover", (m: HpGameover) => this.gameoverCb(m));

    // Sondeo en setInterval, no en rAF: el navegador pausa rAF en segundo plano.
    this.pingTimer = window.setInterval(() => this.ping(), this.pingEveryMs);
  }

  private ping(): void {
    if (this.socket?.connected) this.socket.emit("hp:ping", { c: performance.now() });
  }

  onState(cb: (s: HpState) => void): void {
    this.stateCb = cb;
  }
  onReject(cb: (n: number, r: HpRejectReason) => void): void {
    this.rejectCb = cb;
  }
  onPong(cb: (c: number, t: number) => void): void {
    this.pongCb = cb;
  }
  onGameover(cb: (r: HpGameover) => void): void {
    this.gameoverCb = cb;
  }

  pass(n: number, to: string, keys: string, at: number): void {
    this.socket?.emit("hp:pass", { n, to, keys, at });
  }

  dispose(): void {
    window.clearInterval(this.pingTimer);
    this.socket?.disconnect();
    this.socket = null;
  }
}
