import type { Socket } from "socket.io-client";
import type { MtGameover, MtState, MtTake, MtTakeUpload } from "./ImitameTransport";

/**
 * Transporte socket.io contra el namespace `/imitame` del game server. Se conecta
 * con la lib cargada dinamicamente (no pesa en los juegos que no la usan) y anuncia
 * {code, nickname, roster} al conectar. Las tomas viajan como binario (ArrayBuffer),
 * que socket.io manda sin pasarlo a base64.
 */
export class SocketTransport {
  private socket: Socket | null = null;
  private stateCb: (s: MtState) => void = () => {};
  private takeCb: (t: MtTake) => void = () => {};
  private gameoverCb: (r: MtGameover) => void = () => {};

  private readonly serverUrl: string;
  private readonly code: string;
  private readonly nickname: string;
  private readonly roster: string[];

  constructor(serverUrl: string, code: string, nickname: string, roster: string[]) {
    this.serverUrl = serverUrl;
    this.code = code;
    this.nickname = nickname;
    this.roster = roster;
  }

  async connect(): Promise<void> {
    const { io } = await import("socket.io-client");
    const base = this.serverUrl.replace(/\/$/, "");
    const socket = io(`${base}/imitame`, { transports: ["websocket"], reconnection: true });
    this.socket = socket;
    socket.on("connect", () => {
      socket.emit("mt:join", { code: this.code, nickname: this.nickname, roster: this.roster });
    });
    socket.on("mt:state", (s: MtState) => this.stateCb(s));
    socket.on("mt:take", (t: MtTake) => this.takeCb(t));
    socket.on("mt:gameover", (m: MtGameover) => this.gameoverCb(m));
  }

  onState(cb: (s: MtState) => void): void {
    this.stateCb = cb;
  }
  onTake(cb: (t: MtTake) => void): void {
    this.takeCb = cb;
  }
  onGameover(cb: (r: MtGameover) => void): void {
    this.gameoverCb = cb;
  }

  sendTake(take: MtTakeUpload): void {
    this.socket?.emit("mt:take", take);
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
