import type { Socket } from "socket.io-client";
import type { AgDead, AgInit, AgInput, AgJoin, AgPlayerInfo, AgSnap, AgTop } from "./AgarProtocol";

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

  private readonly up = new LagLine();
  private readonly down = new LagLine();

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
      this.send("ag:join", msg);
      this.statusCb(true);
    });
    socket.on("disconnect", () => this.statusCb(false));
    socket.on("connect_error", () => this.statusCb(false));

    // Todo lo que llega pasa por la linea de bajada (latencia simulada, si hay).
    const recv = <T>(event: string, cb: (msg: T) => void) =>
      socket.on(event, (msg: T) => this.down.run(() => cb(msg)));
    recv<AgInit>("ag:init", (init) => {
      this.token = init.tk;
      this.initCb(init);
    });
    recv<AgSnap>("ag:snap", (snap) => this.snapCb(snap));
    recv<{ add?: AgPlayerInfo[]; del?: number[] }>("ag:players", (msg) => this.playersCb(msg));
    recv<AgTop>("ag:top", (top) => this.topCb(top));
    recv<{ mass: number }>("ag:spawned", (msg) => this.spawnedCb(msg));
    recv<AgDead>("ag:dead", (dead) => this.deadCb(dead));
    recv<{ winner: string; mass: number }>("ag:over", (msg) => this.overCb(msg));
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

  /** Todo lo que sale pasa por la linea de subida (latencia simulada, si hay). */
  private send(event: string, payload: unknown): void {
    const socket = this.socket;
    if (!socket) return;
    this.up.run(() => socket.emit(event, payload));
  }

  spawn(name: string): void {
    this.send("ag:spawn", { name });
  }

  sendInput(input: AgInput): void {
    this.send("ag:in", input);
  }

  sendView(aspect: number): void {
    this.send("ag:view", { aspect: Math.round(aspect * 100) / 100 });
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
