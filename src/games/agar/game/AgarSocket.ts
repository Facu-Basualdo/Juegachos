import type { Socket } from "socket.io-client";
import type { AgDead, AgInit, AgInput, AgJoin, AgPlayerInfo, AgSnap, AgTop } from "./AgarProtocol";

/**
 * Transporte socket.io contra el namespace `/agar`. La lib se carga con import
 * dinamico (no pesa en los juegos que no la usan).
 *
 * Reconexion: la hace socket.io solo. Al volver a conectar se repite el `ag:join`
 * con el token de la sesion (arena publica) o el nickname de la sala, y el server
 * le devuelve su celula si sigue dentro de la gracia de reconexion.
 */
export class AgarSocket {
  private socket: Socket | null = null;

  private initCb: (init: AgInit) => void = () => {};
  private snapCb: (snap: AgSnap) => void = () => {};
  private playersCb: (msg: { add?: AgPlayerInfo[]; del?: number[] }) => void = () => {};
  private topCb: (top: AgTop) => void = () => {};
  private spawnedCb: (msg: { mass: number }) => void = () => {};
  private deadCb: (dead: AgDead) => void = () => {};
  private overCb: (msg: { winner: string; mass: number }) => void = () => {};
  private statusCb: (connected: boolean) => void = () => {};

  /** Token que manda el server para recuperar el jugador tras un corte. */
  private token: string | null = null;

  private readonly serverUrl: string;
  private readonly join: () => AgJoin;

  constructor(serverUrl: string, join: () => AgJoin) {
    this.serverUrl = serverUrl;
    this.join = join;
  }

  async connect(): Promise<void> {
    const { io } = await import("socket.io-client");
    const base = this.serverUrl.replace(/\/$/, "");
    const socket = io(`${base}/agar`, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    this.socket = socket;

    socket.on("connect", () => {
      const msg = this.join();
      if (msg.mode === "public" && this.token) msg.tk = this.token;
      socket.emit("ag:join", msg);
      this.statusCb(true);
    });
    socket.on("disconnect", () => this.statusCb(false));
    socket.on("connect_error", () => this.statusCb(false));

    socket.on("ag:init", (init: AgInit) => {
      this.token = init.tk;
      this.initCb(init);
    });
    socket.on("ag:snap", (snap: AgSnap) => this.snapCb(snap));
    socket.on("ag:players", (msg: { add?: AgPlayerInfo[]; del?: number[] }) => this.playersCb(msg));
    socket.on("ag:top", (top: AgTop) => this.topCb(top));
    socket.on("ag:spawned", (msg: { mass: number }) => this.spawnedCb(msg));
    socket.on("ag:dead", (dead: AgDead) => this.deadCb(dead));
    socket.on("ag:over", (msg: { winner: string; mass: number }) => this.overCb(msg));
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  onInit(cb: (init: AgInit) => void): void {
    this.initCb = cb;
  }
  onSnap(cb: (snap: AgSnap) => void): void {
    this.snapCb = cb;
  }
  onPlayers(cb: (msg: { add?: AgPlayerInfo[]; del?: number[] }) => void): void {
    this.playersCb = cb;
  }
  onTop(cb: (top: AgTop) => void): void {
    this.topCb = cb;
  }
  onSpawned(cb: (msg: { mass: number }) => void): void {
    this.spawnedCb = cb;
  }
  onDead(cb: (dead: AgDead) => void): void {
    this.deadCb = cb;
  }
  onOver(cb: (msg: { winner: string; mass: number }) => void): void {
    this.overCb = cb;
  }
  onStatus(cb: (connected: boolean) => void): void {
    this.statusCb = cb;
  }

  spawn(name: string): void {
    this.socket?.emit("ag:spawn", { name });
  }

  sendInput(input: AgInput): void {
    this.socket?.emit("ag:in", input);
  }

  sendView(aspect: number): void {
    this.socket?.emit("ag:view", { aspect: Math.round(aspect * 100) / 100 });
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
