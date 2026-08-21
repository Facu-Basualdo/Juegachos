import type { Socket } from "socket.io-client";
import type {
  ImGameover,
  ImpostorTransport,
  ImState,
  ImYou,
} from "./ImpostorTransport";

/**
 * Transporte socket.io contra el namespace `/impostor` del game server. Carga la lib
 * dinamicamente (no pesa en juegos que no la usan) y anuncia {code, nickname, roster}
 * al conectar; el server fija el orden de los jugadores con el roster (room.players()
 * de Supabase, por joined_at).
 */
export class SocketTransport implements ImpostorTransport {
  private socket: Socket | null = null;
  private stateCb: (s: ImState) => void = () => {};
  private youCb: (you: ImYou) => void = () => {};
  private gameoverCb: (r: ImGameover) => void = () => {};

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
    const socket = io(`${base}/impostor`, {
      transports: ["websocket"],
      reconnection: true,
    });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("im:join", { code: this.code, nickname: this.nickname, roster: this.roster });
    });
    socket.on("im:state", (s: ImState) => this.stateCb(s));
    socket.on("im:you", (m: ImYou) => this.youCb(m));
    socket.on("im:gameover", (m: ImGameover) => this.gameoverCb(m));
  }

  onState(cb: (s: ImState) => void): void {
    this.stateCb = cb;
  }
  onYou(cb: (you: ImYou) => void): void {
    this.youCb = cb;
  }
  onGameover(cb: (r: ImGameover) => void): void {
    this.gameoverCb = cb;
  }

  sendClue(word: string): void {
    this.socket?.emit("im:clue", { word });
  }
  sendVote(target: string): void {
    this.socket?.emit("im:vote", { target });
  }
  sendGuess(word: string): void {
    this.socket?.emit("im:guess", { word });
  }
  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
