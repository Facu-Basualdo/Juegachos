import type { Socket } from "socket.io-client";
import type {
  TcChainView,
  TcGameover,
  TcState,
  TcYou,
  TelefonoTransport,
} from "./TelefonoTransport";

/**
 * Transporte socket.io contra el namespace `/telefonocortado` del game server. Se
 * conecta con la lib cargada dinamicamente (no se incluye en juegos que no la usan) y
 * anuncia {code, nickname, roster} al conectar; el server fija el orden de los
 * jugadores con el roster (room.players() de Supabase, por joined_at), que es lo que
 * determina a quien le toca dibujar y adivinar cada cadena.
 */
export class SocketTransport implements TelefonoTransport {
  private socket: Socket | null = null;
  private stateCb: (s: TcState) => void = () => {};
  private youCb: (you: TcYou) => void = () => {};
  private chainCb: (chain: TcChainView) => void = () => {};
  private gameoverCb: (r: TcGameover) => void = () => {};

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
    const socket = io(`${base}/telefonocortado`, {
      transports: ["websocket"],
      reconnection: true,
    });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("tc:join", { code: this.code, nickname: this.nickname, roster: this.roster });
    });
    socket.on("tc:state", (s: TcState) => this.stateCb(s));
    socket.on("tc:you", (m: TcYou) => this.youCb(m));
    socket.on("tc:chain", (m: TcChainView) => this.chainCb(m));
    socket.on("tc:gameover", (m: TcGameover) => this.gameoverCb(m));
  }

  onState(cb: (s: TcState) => void): void {
    this.stateCb = cb;
  }
  onYou(cb: (you: TcYou) => void): void {
    this.youCb = cb;
  }
  onChain(cb: (chain: TcChainView) => void): void {
    this.chainCb = cb;
  }
  onGameover(cb: (r: TcGameover) => void): void {
    this.gameoverCb = cb;
  }

  sendPhrase(text: string): void {
    this.socket?.emit("tc:phrase", { text });
  }
  sendDrawing(image: string): void {
    this.socket?.emit("tc:draw", { image });
  }
  sendGuess(text: string): void {
    this.socket?.emit("tc:guess", { text });
  }
  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
