import type { Socket } from "socket.io-client";
import type { VbDead, VbInit, VbInput, VbJoin, VbPlayerInfo, VbSnap, VbTop } from "./ViboritaProtocol";

/**
 * Simulador de latencia para probar en local: `?lag=150&jitter=40` en la URL.
 *
 * `lag` es la ida y vuelta (ms): se agrega la mitad a cada mensaje que sale y la mitad
 * a cada uno que llega, mas un extra al azar de 0 a `jitter` en cada sentido. Los
 * mensajes nunca se adelantan entre si (como en TCP, que es lo que va debajo del
 * WebSocket). Va aca y no en las devtools porque el "throttling" de red del navegador
 * no afecta a los WebSockets.
 */
const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
const LAG_MS = Math.max(0, Number(params?.get("lag")) || 0);
const JITTER_MS = Math.max(0, Number(params?.get("jitter")) || 0);

class LagLine {
  private last = 0;

  run(fn: () => void): void {
    if (LAG_MS === 0 && JITTER_MS === 0) {
      fn();
      return;
    }
    const now = performance.now();
    const at = Math.max(now + LAG_MS / 2 + Math.random() * JITTER_MS, this.last);
    this.last = at;
    setTimeout(fn, at - now);
  }
}

/**
 * Transporte socket.io contra el namespace `/viborita`. La lib se carga con import
 * dinamico (no pesa en los juegos que no la usan).
 *
 * Reconexion: la hace socket.io solo. Al volver a conectar se repite el `vb:join` con
 * el token de la sesion (arena publica) o el nickname de la sala, y el server le
 * devuelve su viborita si sigue dentro de la gracia de reconexion.
 */
export class ViboritaSocket {
  private socket: Socket | null = null;

  private initCb: (init: VbInit) => void = () => {};
  private snapCb: (snap: VbSnap) => void = () => {};
  private playersCb: (msg: { add?: VbPlayerInfo[]; del?: number[] }) => void = () => {};
  private topCb: (top: VbTop) => void = () => {};
  private spawnedCb: () => void = () => {};
  private deadCb: (dead: VbDead) => void = () => {};
  private overCb: (msg: { winner: string; mass: number }) => void = () => {};
  private statusCb: (connected: boolean) => void = () => {};

  private readonly up = new LagLine();
  private readonly down = new LagLine();

  /** Token que manda el server para recuperar el jugador tras un corte. */
  private token: string | null = null;

  private readonly serverUrl: string;
  private readonly join: () => VbJoin;

  constructor(serverUrl: string, join: () => VbJoin) {
    this.serverUrl = serverUrl;
    this.join = join;
  }

  async connect(): Promise<void> {
    const { io } = await import("socket.io-client");
    const base = this.serverUrl.replace(/\/$/, "");
    const socket = io(`${base}/viborita`, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    this.socket = socket;

    socket.on("connect", () => {
      const msg = this.join();
      if (msg.mode === "public" && this.token) msg.tk = this.token;
      this.send("vb:join", msg);
      this.statusCb(true);
    });
    socket.on("disconnect", () => this.statusCb(false));
    socket.on("connect_error", () => this.statusCb(false));

    // Todo lo que llega pasa por la linea de bajada (latencia simulada, si hay).
    const recv = <T>(event: string, cb: (msg: T) => void) =>
      socket.on(event, (msg: T) => this.down.run(() => cb(msg)));
    recv<VbInit>("vb:init", (init) => {
      this.token = init.tk;
      this.initCb(init);
    });
    recv<VbSnap>("vb:snap", (snap) => this.snapCb(snap));
    recv<{ add?: VbPlayerInfo[]; del?: number[] }>("vb:players", (msg) => this.playersCb(msg));
    recv<VbTop>("vb:top", (top) => this.topCb(top));
    recv<{ mass: number }>("vb:spawned", () => this.spawnedCb());
    recv<VbDead>("vb:dead", (dead) => this.deadCb(dead));
    recv<{ winner: string; mass: number }>("vb:over", (msg) => this.overCb(msg));
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  onInit(cb: (init: VbInit) => void): void {
    this.initCb = cb;
  }
  onSnap(cb: (snap: VbSnap) => void): void {
    this.snapCb = cb;
  }
  onPlayers(cb: (msg: { add?: VbPlayerInfo[]; del?: number[] }) => void): void {
    this.playersCb = cb;
  }
  onTop(cb: (top: VbTop) => void): void {
    this.topCb = cb;
  }
  onSpawned(cb: () => void): void {
    this.spawnedCb = cb;
  }
  onDead(cb: (dead: VbDead) => void): void {
    this.deadCb = cb;
  }
  onOver(cb: (msg: { winner: string; mass: number }) => void): void {
    this.overCb = cb;
  }
  onStatus(cb: (connected: boolean) => void): void {
    this.statusCb = cb;
  }

  /** Todo lo que sale pasa por la linea de subida (latencia simulada, si hay). */
  private send(event: string, payload: unknown): void {
    const socket = this.socket;
    if (!socket) return;
    this.up.run(() => socket.emit(event, payload));
  }

  spawn(name: string): void {
    this.send("vb:spawn", { name });
  }

  sendInput(input: VbInput): void {
    this.send("vb:in", input);
  }

  sendView(aspect: number): void {
    this.send("vb:view", { aspect: Math.round(aspect * 100) / 100 });
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
