/**
 * Verificacion de la capa de red de Viborita contra un server REAL en el proceso:
 *   npm run check:viborita-net      (~15 s, en tiempo real)
 *
 * Conecta clientes de socket.io al namespace /viborita y comprueba: el init y la
 * config, que el input mueve la viborita a la velocidad del server (y que el turbo
 * no anda sin masa), el saneado de nombres, el descarte de mensajes invalidos o
 * grandes, el rate limit (corta la conexion), la reconexion con token dentro de la
 * gracia, que una arena llena abre otra, y que la sala agrupa por codigo. Sale con
 * codigo 1 si algo falla.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { registerViborita } from "../src/games/viborita.js";
import { VIBORITA_CONFIG as C } from "../src/games/viborita-config.js";
import type { VbInit, VbPlayerInfo, VbSnap } from "../src/protocol.js";
import { decodeSnap } from "../../src/games/viborita/game/ViboritaCodec.ts";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(25);
  }
  return true;
}

// Sin bots: el check mide movimiento y no quiere que nadie se cruce.
C.bots.enabled = false;

const httpServer = createServer();
const server = new Server(httpServer, { cors: { origin: "*" } });
const stats = registerViborita(server);
await new Promise<void>((r) => httpServer.listen(0, r));
const URL = `http://localhost:${(httpServer.address() as AddressInfo).port}/viborita`;

class Client {
  readonly socket: Socket;
  init: VbInit | null = null;
  snaps: VbSnap[] = [];
  players = new Map<number, string>();
  spawned = 0;
  disconnected = false;
  seq = 0;

  constructor() {
    this.socket = connect(URL, { transports: ["websocket"], reconnection: false, forceNew: true });
    this.socket.on("vb:init", (init: VbInit) => {
      this.init = init;
      for (const [id, name] of init.players) this.players.set(id, name);
    });
    // Binario: se decodifica con el codec del cliente.
    this.socket.on("vb:snap", (data: ArrayBuffer) => {
      const s: VbSnap | null = decodeSnap(data);
      if (s) this.snaps.push(s);
    });
    this.socket.on("vb:players", (m: { add?: VbPlayerInfo[] }) => {
      for (const [id, name] of m.add ?? []) this.players.set(id, name);
    });
    this.socket.on("vb:spawned", () => this.spawned++);
    this.socket.on("disconnect", () => (this.disconnected = true));
  }

  /** `[x, y, angulo, masa]` de la viborita propia en el ultimo snapshot. */
  mine(): [number, number, number, number] | null {
    const s = this.snaps.at(-1);
    if (!s || !this.init) return null;
    for (let i = 0; i < s.s.length; i += 7) {
      if (s.s[i + 1] === this.init.me) return [s.s[i + 2], s.s[i + 3], s.s[i + 4] / 1000, s.s[i + 5] / 10];
    }
    return null;
  }

  input(angle: number, boost: 0 | 1): void {
    this.socket.emit("vb:in", [++this.seq, performance.now(), angle, boost, -1]);
  }

  close(): void {
    this.socket.disconnect();
  }
}

// ------------------------------------------------------------------ init, spawn, nombre

const a = new Client();
a.socket.emit("vb:join", { mode: "public", aspect: 1.6 });
check("init con la config", (await waitFor(() => a.init !== null, 2000)) && a.init!.cfg.mapRadius === C.public.mapRadius);
check("el init trae token de reconexion", /^[0-9a-f]{24}$/.test(a.init?.tk ?? ""));

a.socket.emit("vb:spawn", { name: "<img src=x>Facu‮!!" });
await waitFor(() => a.spawned > 0, 2000);
check("el nombre llega saneado", a.players.get(a.init!.me) === "img srcxFacu", JSON.stringify(a.players.get(a.init!.me)));

// ------------------------------------------------------------------ movimiento autoritativo

await waitFor(() => a.mine() !== null, 2000);
/** Avanza 0.6 s apuntando hacia el centro y mide cuanto se movio. */
async function measure(boost: 0 | 1): Promise<number> {
  const R = C.public.mapRadius;
  const start = a.mine()!;
  const toCenter = Math.atan2(R - start[1], R - start[0]);
  // Primero se alinea (el giro tiene tope), despues se mide.
  for (let i = 0; i < 25; i++) {
    a.input(toCenter, 0);
    await sleep(33);
  }
  const from = a.mine()!;
  const t0 = Date.now();
  while (Date.now() - t0 < 600) {
    a.input(toCenter, boost);
    await sleep(33);
  }
  await sleep(150);
  const to = a.mine()!;
  return Math.hypot(to[0] - from[0], to[1] - from[1]) / ((Date.now() - t0) / 1000);
}
const v = await measure(0);
check("el input mueve a la velocidad del server", Math.abs(v - C.snake.speed) < C.snake.speed * 0.25, `${v.toFixed(0)} u/s (esperado ~${C.snake.speed})`);
const vb = await measure(1);
check("con la masa inicial el turbo no anda", vb < C.snake.speed * 1.25, `${vb.toFixed(0)} u/s`);

const before = a.snaps.length;
a.socket.emit("vb:in", [999999, 0, 50, 0, -1]);
a.socket.emit("vb:in", [999998, 0, 1, 7, -1]);
a.socket.emit("vb:in", [999997, 0, 1, 0, "x"]);
a.socket.emit("vb:in", "basura");
a.socket.emit("vb:in", [1, 2, 3]);
a.socket.emit("vb:join", { mode: "public", aspect: 1 });
await sleep(300);
check("mensajes invalidos se ignoran sin cortar", a.socket.connected && a.snaps.length > before);

// ------------------------------------------------------------------ tamano y rate limit

const b = new Client();
b.socket.emit("vb:join", { mode: "public", aspect: 1.6 });
await waitFor(() => b.init !== null, 2000);
b.socket.emit("vb:spawn", { name: "x".repeat(C.net.maxMessageBytes + 10) });
await sleep(400);
check("un mensaje mas grande que el tope se descarta", b.spawned === 0 && b.socket.connected);
for (let i = 0; i < 600; i++) b.socket.emit("vb:view", { aspect: 1.5 });
check("una rafaga muy por encima del rate limit corta la conexion", await waitFor(() => b.disconnected, 3000));

// ------------------------------------------------------------------ reconexion

const meBefore = a.init!.me;
const token = a.init!.tk;
a.close();
await sleep(400);
const a2 = new Client();
a2.socket.emit("vb:join", { mode: "public", aspect: 1.6, tk: token });
await waitFor(() => a2.init !== null, 2000);
check("reconectar con el token recupera la viborita", a2.init?.me === meBefore && a2.init?.alive === true);
const c = new Client();
c.socket.emit("vb:join", { mode: "public", aspect: 1.6, tk: token });
await waitFor(() => c.init !== null, 2000);
check("el token de un jugador conectado no se puede robar", c.init !== null && c.init.me !== meBefore);
await waitFor(() => a2.snaps.some((s) => s.k && s.k.length > 0), 2000);
check("al reconectar vuelve a recibir los cuerpos enteros", a2.snaps.some((s) => (s.k?.length ?? 0) > 0));

// ------------------------------------------------------------------ arenas llenas

const prevMax = C.arena.maxSocketsPerArena;
C.arena.maxSocketsPerArena = 2; // a2 y c ya llenan la primera
const d = new Client();
d.socket.emit("vb:join", { mode: "public", aspect: 1.6 });
await waitFor(() => d.init !== null, 2000);
check("una arena llena abre otra", stats().arenas === 2, `${stats().arenas} arenas`);
C.arena.maxSocketsPerArena = prevMax;

// ------------------------------------------------------------------ sala

const r1 = new Client();
const r2 = new Client();
const other = new Client();
r1.socket.emit("vb:join", { mode: "room", aspect: 1.6, code: "abcd", round: 1, nickname: "Uno" });
r2.socket.emit("vb:join", { mode: "room", aspect: 1.6, code: "ABCD", round: 1, nickname: "Dos" });
other.socket.emit("vb:join", { mode: "room", aspect: 1.6, code: "ZZZZ", round: 1, nickname: "Tres" });
await waitFor(() => r1.init !== null && r2.init !== null && other.init !== null, 2000);
await sleep(200);
const names = [...r1.players.values()];
check("sala: los del mismo codigo comparten arena", names.includes("Dos") && !names.includes("Tres"), names.join(","));
check("sala: config de sala (mapa chico, una vida)", r1.init?.cfg.kind === "room" && r1.init.cfg.respawn === false);
const s = stats();
check("el /health no cuenta la arena publica como gente en ronda", s.publicSockets >= 3 && s.roomSockets === 3, JSON.stringify(s));

for (const cl of [a2, c, d, r1, r2, other]) cl.close();
await sleep(200);
server.close();
httpServer.close();
console.log(`\n${checks - failures}/${checks} ok`);
process.exit(failures > 0 ? 1 : 0);
