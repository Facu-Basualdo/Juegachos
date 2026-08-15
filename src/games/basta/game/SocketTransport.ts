import type { Socket } from "socket.io-client";
import type {
  BastaTransport,
  BtCategoryId,
  BtGameover,
  BtReject,
  BtState,
} from "./BastaTransport";

type Answers = Partial<Record<BtCategoryId, string>>;

/**
 * Transporte socket.io contra el namespace `/basta` del game server. Se conecta
 * con la lib cargada dinamicamente (no se incluye en juegos que no la usan) y
 * anuncia {code, nickname, roster} al conectar; el server fija el orden de los
 * jugadores con el roster (room.players() de Supabase, por joined_at).
 */
export class SocketTransport implements BastaTransport {
  private socket: Socket | null = null;
  private stateCb: (s: BtState) => void = () => {};
  private youCb: (answers: Answers) => void = () => {};
  private gameoverCb: (r: BtGameover) => void = () => {};

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
    const socket = io(`${base}/basta`, {
      transports: ["websocket"],
      reconnection: true,
    });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("bt:join", { code: this.code, nickname: this.nickname, roster: this.roster });
    });
    socket.on("bt:state", (s: BtState) => this.stateCb(s));
    socket.on("bt:you", (m: { answers: Answers }) => this.youCb(m.answers));
    socket.on("bt:gameover", (m: BtGameover) => this.gameoverCb(m));
  }

  onState(cb: (s: BtState) => void): void {
    this.stateCb = cb;
  }
  onYou(cb: (answers: Answers) => void): void {
    this.youCb = cb;
  }
  onGameover(cb: (r: BtGameover) => void): void {
    this.gameoverCb = cb;
  }

  sendFill(answers: Partial<Record<BtCategoryId, string>>): void {
    this.socket?.emit("bt:fill", { answers });
  }
  sendBasta(): void {
    this.socket?.emit("bt:basta", {});
  }
  sendVotes(rejects: BtReject[]): void {
    this.socket?.emit("bt:vote", { rejects });
  }
  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
