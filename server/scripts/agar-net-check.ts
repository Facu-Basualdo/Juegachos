/**
 * Verificacion de la capa de red de Agar contra un server REAL en el proceso:
 *   npm run check:agar-net      (~20 s, en tiempo real)
 *
 * Conecta clientes de socket.io al namespace /agar y comprueba: el init y la config,
 * que el input mueve la celula a la velocidad del server (y que no se puede ir mas
 * rapido mandando un vector largo), el saneado de nombres, el descarte de mensajes
 * invalidos o grandes, el rate limit (corta la conexion), la reconexion con token
 * dentro de la gracia, que una arena llena abre otra, y que la sala agrupa por codigo.
 * Sale con codigo 1 si algo falla.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { registerAgar } from "../src/games/agar.js";
import { AGAR_CONFIG, speedOf } from "../src/games/agar-config.js";
import type { AgInit, AgPlayerInfo, AgSnap } from "../src/protocol.js";

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

// Sin bots: el check mide movimiento y no quiere que se coman a nadie.
AGAR_CONFIG.bots.enabled = false;

const httpServer = createServer();
const server = new Server(httpServer, { cors: { origin: "*" } });
const stats = registerAgar(server);
await new Promise<void>((r) => httpServer.listen(0, r));
const URL = `http://localhost:${(httpServer.address() as AddressInfo).port}/agar`;

class Client {
  readonly socket: Socket;
  init: AgInit | null = null;
  snaps: AgSnap[] = [];
  players = new Map<number, string>();
  spawned = 0;
  disconnected = false;

  constructor() {
    this.socket = connect(URL, { transports: ["websocket"], reconnection: false, forceNew: true });
    this.socket.on("ag:init", (init: AgInit) => {
      this.init = init;
      for (const [id, name] of init.players) this.players.set(id, name);
    });
    this.socket.on("ag:snap", (s: AgSnap) => this.snaps.push(s));
    this.socket.on("ag:players", (m: { add?: AgPlayerInfo[] }) => {
      for (const [id, name] of m.add ?? []) this.players.set(id, name);
    });
    this.socket.on("ag:spawned", () => this.spawned++);
    this.socket.on("disconnect", () => (this.disconnected = true));
  }

  myCell(): [number, number] | null {
    const s = this.snaps.at(-1);
    if (!s || !this.init) return null;
    for (let i = 0; i < s.c.length; i += 5) if (s.c[i + 1] === this.init.me) return [s.c[i + 2], s.c[i + 3]];
    return null;
  }

  close(): void {
    this.socket.disconnect();
  }
}

// ------------------------------------------------------------------ init, spawn, nombre

const a = new Client();
a.socket.emit("ag:join", { mode: "public", aspect: 1.6 });
check("init con la config", await waitFor(() => a.init !== null, 2000) && a.init!.cfg.mapSize === AGAR_CONFIG.public.mapSize);
check("el init trae token de reconexion", /^[0-9a-f]{24}$/.test(a.init?.tk ?? ""));

a.socket.emit("ag:spawn", { name: "<img src=x>Facu‮!!" });
await waitFor(() => a.spawned > 0, 2000);
const myName = a.players.get(a.init!.me);
check("el nombre llega saneado", myName === "img srcxFacu", JSON.stringify(myName));

// ------------------------------------------------------------------ movimiento autoritativo

await waitFor(() => a.myCell() !== null, 2000);
const speed = speedOf(AGAR_CONFIG.cell.startMass);
async function measure(dx: number): Promise<number> {
  const start = a.myCell()!;
  const t0 = Date.now();
  let n = (measure as unknown as { n?: number }).n ?? 0;
  while (Date.now() - t0 < 1000) {
    a.socket.emit("ag:in", [++n, performance.now(), dx, 0, 0]);
    await sleep(33);
  }
  (measure as unknown as { n?: number }).n = n;
  a.socket.emit("ag:in", [++n, performance.now(), 0, 0, 0]);
  (measure as unknown as { n?: number }).n = n;
  await sleep(200);
  const end = a.myCell()!;
  return Math.abs(end[0] - start[0]);
}
// Al centro, para no tocar un borde en la medicion.
const moved = await measure(start0Dir());
function start0Dir(): number {
  const c = a.myCell()!;
  return c[0] < AGAR_CONFIG.public.mapSize / 2 ? 1 : -1;
}
check("el input mueve a la velocidad del server", Math.abs(moved - speed) < speed * 0.2, `${moved.toFixed(0)} u en 1 s (esperado ~${speed.toFixed(0)})`);
const hacked = await measure(start0Dir() * 1.9);
check("un vector mas largo que 1 no va mas rapido", hacked < speed * 1.2, `${hacked.toFixed(0)} u`);
const snapsBefore = a.snaps.length;
a.socket.emit("ag:in", [999999, 0, 50, 0, 0]);
a.socket.emit("ag:in", "basura");
a.socket.emit("ag:in", [1, 2, 3]);
a.socket.emit("ag:join", { mode: "public", aspect: 1 });
await sleep(300);
check("mensajes invalidos se ignoran sin cortar", a.socket.connected && a.snaps.length > snapsBefore);

// ------------------------------------------------------------------ tamano

const b = new Client();
b.socket.emit("ag:join", { mode: "public", aspect: 1.6 });
await waitFor(() => b.init !== null, 2000);
b.socket.emit("ag:spawn", { name: "x".repeat(AGAR_CONFIG.net.maxMessageBytes + 10) });
await sleep(400);
check("un mensaje mas grande que el tope se descarta", b.spawned === 0 && b.socket.connected);

// ------------------------------------------------------------------ rate limit

for (let i = 0; i < 600; i++) b.socket.emit("ag:view", { aspect: 1.5 });
check("una rafaga muy por encima del rate limit corta la conexion", await waitFor(() => b.disconnected, 3000));

// ------------------------------------------------------------------ reconexion

const meBefore = a.init!.me;
const token = a.init!.tk;
a.close();
await sleep(500);
const a2 = new Client();
a2.socket.emit("ag:join", { mode: "public", aspect: 1.6, tk: token });
await waitFor(() => a2.init !== null, 2000);
check("reconectar con el token recupera la celula", a2.init?.me === meBefore && a2.init?.alive === true);
const c = new Client();
c.socket.emit("ag:join", { mode: "public", aspect: 1.6, tk: token });
await waitFor(() => c.init !== null, 2000);
check("el token de un jugador conectado no se puede robar", c.init !== null && c.init.me !== meBefore);

// ------------------------------------------------------------------ arenas llenas

const prevMax = AGAR_CONFIG.arena.maxSocketsPerArena;
AGAR_CONFIG.arena.maxSocketsPerArena = 2; // a2 y c ya llenan la primera
const d = new Client();
d.socket.emit("ag:join", { mode: "public", aspect: 1.6 });
await waitFor(() => d.init !== null, 2000);
check("una arena llena abre otra", stats().arenas === 2, `${stats().arenas} arenas`);
AGAR_CONFIG.arena.maxSocketsPerArena = prevMax;

// ------------------------------------------------------------------ sala

const r1 = new Client();
const r2 = new Client();
const other = new Client();
r1.socket.emit("ag:join", { mode: "room", aspect: 1.6, code: "abcd", round: 1, nickname: "Uno" });
r2.socket.emit("ag:join", { mode: "room", aspect: 1.6, code: "ABCD", round: 1, nickname: "Dos" });
other.socket.emit("ag:join", { mode: "room", aspect: 1.6, code: "ZZZZ", round: 1, nickname: "Tres" });
await waitFor(() => r1.init !== null && r2.init !== null && other.init !== null, 2000);
await sleep(200);
const r1Names = [...r1.players.values()];
check("sala: los del mismo codigo comparten arena", r1Names.includes("Dos") && !r1Names.includes("Tres"), r1Names.join(","));
check("sala: config de sala (mapa chico, una vida)", r1.init?.cfg.kind === "room" && r1.init.cfg.respawn === false);
check("sala: el join sin codigo valido se ignora", await (async () => {
  const bad = new Client();
  bad.socket.emit("ag:join", { mode: "room", aspect: 1, code: "x", round: 1, nickname: "Mal" });
  await sleep(400);
  const ok = bad.init === null;
  bad.close();
  return ok;
})());
const s = stats();
check("el /health no cuenta la arena publica como gente en ronda", s.publicSockets >= 3 && s.roomSockets === 3, JSON.stringify(s));

for (const cl of [a2, c, d, r1, r2, other]) cl.close();
await sleep(200);
server.close();
httpServer.close();
console.log(`\n${checks - failures}/${checks} ok`);
process.exit(failures > 0 ? 1 : 0);
