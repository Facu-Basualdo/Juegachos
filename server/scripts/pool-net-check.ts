/**
 * Verificacion de la capa de red de Pool contra un server REAL en el proceso:
 *   npm run check:pool-net      (lento: ~2-3 min, corre en tiempo real; no esta en check:pool)
 *
 * Levanta el namespace /pool, conecta clientes de socket.io y juega. Comprueba el
 * protocolo, los rechazos, la reconexion, el reemplazo por bot de un desconectado y de un
 * humano inactivo (con el reloj de verdad: 20 s), y que los tramos de `bi:play` se pueden
 * EVALUAR del lado del cliente y empalman con las posiciones del server, que es lo que va
 * a hacer el render. Sale con codigo 1 si algo falla.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { registerPool } from "../src/games/pool.js";
import { chooseBotAction } from "../src/games/pool-bot.js";
import { mulberry32 } from "../src/games/pool-rack.js";
import { BALL_R, MU_ROLL, MU_SLIDE, type BallPos } from "../src/games/pool-physics.js";
import { TURN_MS } from "../src/games/pool-match.js";
import type { BiPlay, BiSegment, BiState } from "../src/protocol.js";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) {
      console.log(`     (tiempo agotado esperando: ${what})`);
      return false;
    }
    await sleep(50);
  }
  return true;
}

// ------------------------------------------------------------------ servidor

const httpServer = createServer();
const server = new Server(httpServer, { cors: { origin: "*" } });
registerPool(server);
await new Promise<void>((r) => httpServer.listen(0, r));
const URL = `http://localhost:${(httpServer.address() as AddressInfo).port}/poolnight`;

// ------------------------------------------------------------------ cliente de prueba

const G = 9.81;
type Pos = [number, number];

/** Posicion de una bola `t` segundos despues del comienzo del tramo: lo que hara el render. */
function evalSegment(seg: BiSegment, t: number): Pos {
  const [, t0, x0, z0, vx0, vz0, wx, , wz, ph] = seg;
  let dt = t - t0;
  let x = x0;
  let z = z0;
  let vx = vx0;
  let vz = vz0;
  if (ph === 0 || ph === 3 || dt <= 0) return [x, z];
  if (ph === 1) {
    const ux = vx + BALL_R * wz;
    const uz = vz - BALL_R * wx;
    const um = Math.hypot(ux, uz);
    if (um > 1e-9) {
      const ts = um / (3.5 * MU_SLIDE * G);
      const h = Math.min(dt, ts);
      const ax = (-MU_SLIDE * G * ux) / um;
      const az = (-MU_SLIDE * G * uz) / um;
      x += vx * h + 0.5 * ax * h * h;
      z += vz * h + 0.5 * az * h * h;
      vx += ax * h;
      vz += az * h;
      dt -= h;
    }
  }
  const s = Math.hypot(vx, vz);
  if (dt > 0 && s > 1e-9) {
    const tr = s / (MU_ROLL * G);
    const h = Math.min(dt, tr);
    const dist = s * h - 0.5 * MU_ROLL * G * h * h;
    x += (vx / s) * dist;
    z += (vz / s) * dist;
  }
  return [x, z];
}

class Client {
  socket: Socket;
  seat = -1;
  state: BiState | null = null;
  plays: BiPlay[] = [];
  /** Estado de las bolas ANTES de cada tiro (para comprobar las que no se movieron). */
  before: number[][] = [];
  rejects: string[] = [];
  aims = 0;
  cues = 0;
  pong: { c: number; t: number } | null = null;
  private acted = new Set<number>();
  private readonly rnd: () => number;

  constructor(
    readonly nick: string,
    roster: string[],
    round: number,
    readonly brain: boolean,
  ) {
    this.rnd = mulberry32(nick.length * 7919 + round);
    this.socket = connect(URL, { transports: ["websocket"], forceNew: true });
    this.socket.on("connect", () => this.socket.emit("bi:join", { code: "PTEST", nickname: nick, roster, round }));
    this.socket.on("bi:init", (m: { seat: number; state: BiState }) => {
      this.seat = m.seat;
      this.state = m.state;
      this.think();
    });
    this.socket.on("bi:state", (s: BiState) => {
      this.state = s;
      this.think();
    });
    this.socket.on("bi:play", (p: BiPlay) => {
      this.before.push(this.state ? [...this.state.balls] : []);
      this.plays.push(p);
      this.state = p.state;
      this.think();
    });
    this.socket.on("bi:reject", (m: { why: string }) => this.rejects.push(m.why));
    this.socket.on("bi:aim", () => this.aims++);
    this.socket.on("bi:cue", () => this.cues++);
    this.socket.on("bi:pong", (m: { c: number; t: number }) => (this.pong = m));
  }

  /** Un humano "razonable": cuando le toca, calcula un tiro con el mismo bot y lo manda. */
  private think(): void {
    const s = this.state;
    if (!this.brain || !s || s.phase !== "playing" || s.shooter !== this.seat || s.balls.length === 0) return;
    if (this.acted.has(s.shots)) return;
    this.acted.add(s.shots);
    const wait = Math.max(0, s.turnStartAt - Date.now()) + 300;
    setTimeout(() => {
      if (!this.state || this.state.shots !== s.shots || this.state.shooter !== this.seat) return;
      const balls: BallPos[] = [];
      for (let i = 0; i < 16; i++) balls.push({ x: s.balls[i * 3], z: s.balls[i * 3 + 1], alive: s.balls[i * 3 + 2] === 1 });
      const a = chooseBotAction(
        { balls, team: (this.seat % 2) as 0 | 1, groupsLeft: s.groupsLeft, cueInHand: s.cueInHand, breakShot: s.breakShot },
        "parejo",
        this.rnd,
      );
      this.socket.emit("bi:shot", {
        a: a.shot.angle,
        p: a.shot.power,
        ox: a.shot.offsetX,
        oy: a.shot.offsetY,
        ...(a.place && s.cueInHand ? { x: a.place.x, z: a.place.z } : {}),
      });
    }, wait);
  }

  close(): void {
    this.socket.disconnect();
  }
}

function lastSegPerBall(p: BiPlay): Map<number, BiSegment> {
  const m = new Map<number, BiSegment>();
  for (const s of p.segs) m.set(s[0], s);
  return m;
}

/** Los tramos de una jugada empalman: evaluar uno en el instante del siguiente da la posicion del siguiente. */
function continuityError(p: BiPlay): { worst: number; pairs: number } {
  const byBall = new Map<number, BiSegment[]>();
  for (const s of p.segs) {
    const l = byBall.get(s[0]) ?? [];
    l.push(s);
    byBall.set(s[0], l);
  }
  let worst = 0;
  let pairs = 0;
  for (const list of byBall.values()) {
    for (let k = 0; k + 1 < list.length; k++) {
      const [ex, ez] = evalSegment(list[k], list[k + 1][1]);
      worst = Math.max(worst, Math.hypot(ex - list[k + 1][2], ez - list[k + 1][3]));
      pairs++;
    }
  }
  return { worst, pairs };
}

// ------------------------------------------------------------------ escenario A: 3 humanos (2v2 con un bot)

console.log("--- escenario A: 3 humanos, 2v2 con un bot de relleno");
const rosterA = ["Ana", "Beto", "Cami"];
const A = rosterA.map((n) => new Client(n, rosterA, 1, true));
{
  const up = await waitFor(() => A.every((c) => c.state?.phase === "playing"), 15000, "todos con la partida en marcha");
  check("al conectarse los 3 la partida larga sola", up);
  const s = A[0].state!;
  check("asientos: 4 (2v2), 3 humanos y 1 bot de relleno", s.perTeam === 2 && s.seats.length === 4 && s.seats.filter((x) => x.nickname === null).length === 1 && s.seats[3].bot, JSON.stringify(s.seats.map((x) => x.nickname)));
  check("cada cliente sabe su asiento", A.map((c) => c.seat).join() === "0,1,2", A.map((c) => c.seat).join());
  check("16 bolas aplanadas y rotura con la blanca en su lugar (no en mano)", s.balls.length === 48 && !s.cueInHand && s.breakShot);
  const untilStart = s.turnStartAt - s.now;
  check("hay cuenta regresiva antes del primer turno (~4 s)", untilStart > 3000 && untilStart <= 4100, `${untilStart} ms`);

  A[0].socket.emit("bi:ping", { c: 42 });
  await waitFor(() => A[0].pong !== null, 3000, "pong");
  check("bi:ping devuelve la hora del server", A[0].pong?.c === 42 && Math.abs((A[0].pong?.t ?? 0) - Date.now()) < 1000);

  // Rechazos: alguien que no tiene el turno, y el que lo tiene pero antes de tiempo.
  const shooter = s.shooter;
  const other = A.find((c) => c.seat !== shooter)!;
  const owner = A.find((c) => c.seat === shooter);
  other.socket.emit("bi:shot", { a: 0, p: 0.5, ox: 0, oy: 0 });
  await waitFor(() => other.rejects.length > 0, 2000, "rechazo not_your_turn");
  check("un tiro de quien no tiene el turno se rechaza", other.rejects[0] === "not_your_turn", other.rejects.join());
  if (owner) {
    owner.socket.emit("bi:shot", { a: 0, p: 0.5, ox: 0, oy: 0 });
    await waitFor(() => owner.rejects.length > 0, 2000, "rechazo too_early");
    check("el que tiene el turno pero antes de la cuenta regresiva: rechazado", owner.rejects[0] === "too_early", owner.rejects.join());
    // La rotura sale de la posicion inicial: ya arrancado el turno, el server rechaza mover la blanca.
    await sleep(Math.max(0, s.turnStartAt - Date.now()) + 60);
    owner.socket.emit("bi:place", { x: -0.9, z: 0.1 });
    await waitFor(() => owner.rejects.length > 1, 2000, "rechazo not_in_hand");
    check("en la rotura el server rechaza mover la blanca (bi:place)", owner.rejects[1] === "not_in_hand", owner.rejects.join());
  } else {
    check("(el primer turno es del bot de relleno: no hay humano al que probarle too_early)", true);
  }
}

{
  const first = await waitFor(() => A[0].plays.length >= 1, 40000, "el primer tiro (la rotura)");
  check("se resuelve la rotura y le llega a todos el mismo `bi:play`", first && A.every((c) => c.plays.length >= 1) && A.every((c) => c.plays[0].id === 1));
  const p = A[0].plays[0];
  check("el tiro trae tramos, eventos y el estado posterior", p.segs.length > 0 && p.ev.length > 0 && p.state.shots === 1 && p.dur > 0, `${p.segs.length} tramos, ${p.ev.length} eventos, ${p.dur.toFixed(1)} s`);
  check("todos arrancan la animacion a una hora comun, posterior al tiro", p.startAt > Date.now() - 2000 && p.nextTurnAt > p.startAt + p.dur * 1000);
  check("el siguiente asiento coincide con el estado", p.next === p.state.shooter);
  const bytes = JSON.stringify(p).length;
  console.log(`     tamaño de la rotura: ${(bytes / 1024).toFixed(1)} KB`);
  check("la rotura entra holgada en un mensaje (< 100 KB)", bytes < 100_000);
}

// Se cae un humano en plena partida: lo cubre un bot, y al volver lo reclama.
let cami = A[2];
{
  await waitFor(() => A[0].plays.length >= 2, 30000, "segundo tiro");
  cami.close();
  await waitFor(() => A[0].state?.seats[2].on === false, 4000, "estado con Cami desconectada");
  const seats = A[0].state!.seats;
  check("al desconectarse queda marcado: no esta y juega un bot", seats[2].on === false && seats[2].bot === true);

  const before = A[0].plays.length;
  const played = await waitFor(() => A[0].plays.slice(before - 1).some((p) => p.seat === 2), 90000, "un tiro del asiento 2 (desconectado)");
  check("el asiento desconectado sigue jugando (por bot) y la partida no se traba", played);

  cami = new Client("Cami", rosterA, 1, true);
  await waitFor(() => cami.state !== null, 5000, "reconexion de Cami");
  check("al reconectar vuelve a su asiento y deja de ser bot", cami.seat === 2 && cami.state?.seats[2].on === true && cami.state?.seats[2].bot === false, `seat ${cami.seat}`);
}

{
  await waitFor(() => A[0].plays.length >= 6 || A[0].state?.phase === "over", 120000, "6 tiros o el final");
  const plays = A[0].plays;
  check("los tiros llegan numerados correlativos", plays.every((p, i) => p.id === i + 1), plays.map((p) => p.id).join());

  // Los tramos son evaluables del lado del cliente y empalman con lo que dice el server.
  let worst = 0;
  let pairs = 0;
  let endMismatch = 0;
  let unmovedMismatch = 0;
  plays.forEach((p, idx) => {
    const c = continuityError(p);
    worst = Math.max(worst, c.worst);
    pairs += c.pairs;
    const last = lastSegPerBall(p);
    const prev = A[0].before[idx];
    for (let b = 0; b < 16; b++) {
      const seg = last.get(b);
      const sx = p.state.balls[b * 3];
      const sz = p.state.balls[b * 3 + 1];
      const alive = p.state.balls[b * 3 + 2];
      if (seg) {
        if (Math.hypot(seg[2] - sx, seg[3] - sz) > 0.0005 && !(seg[9] === 3 && alive === 0)) endMismatch++;
        if ((seg[9] === 3) !== (alive === 0)) endMismatch++;
      } else if (prev && prev.length > 0 && (Math.abs(prev[b * 3] - sx) > 1e-9 || Math.abs(prev[b * 3 + 1] - sz) > 1e-9 || prev[b * 3 + 2] !== alive)) {
        // Una bola que no tiene tramos tiene que seguir donde estaba (salvo la 8 que vuelve al punto de pie).
        if (!(b === 8 && p.respot)) unmovedMismatch++;
      }
    }
  });
  check("los tramos empalman: evaluar uno en el instante del siguiente da su posicion (error < 3 mm)", worst < 0.003, `${pairs} empalmes en ${plays.length} tiros, error maximo ${(worst * 1000).toFixed(2)} mm`);
  check("la posicion final de cada bola en movimiento coincide con el estado del server", endMismatch === 0, `${endMismatch} discrepancias`);
  check("las bolas sin tramos siguen donde estaban", unmovedMismatch === 0, `${unmovedMismatch} discrepancias`);
  check("el apuntado de los bots llega como `bi:aim`", A.some((c) => c.aims > 0), `${A.map((c) => c.aims).join("/")} mensajes`);
}

A.forEach((c) => c.close());
cami.close();
await sleep(300);

// ------------------------------------------------------------------ escenario B: un humano que no hace nada

console.log("--- escenario B: 1v1, uno juega y el otro no toca nada (reloj de 20 s)");
{
  const rosterB = ["Dani", "Eli"];
  const dani = new Client("Dani", rosterB, 2, true);
  const eli = new Client("Eli", rosterB, 2, false);
  await waitFor(() => dani.state?.phase === "playing" && eli.state?.phase === "playing", 15000, "partida B en marcha");
  check("1v1: 2 asientos, sin bots de relleno", dani.state?.perTeam === 1 && dani.state.seats.length === 2 && dani.state.seats.every((s) => s.nickname !== null));
  const turnAtEli = new Map<number, number>();
  const stop = Date.now() + 100_000;
  let idlePlay: BiPlay | null = null;
  while (Date.now() < stop && !idlePlay) {
    const st = dani.state;
    if (st && st.shooter === eli.seat && !turnAtEli.has(st.shots)) turnAtEli.set(st.shots, Math.max(st.turnStartAt, Date.now()));
    idlePlay = dani.plays.find((p) => p.seat === eli.seat) ?? null;
    await sleep(100);
  }
  check("un humano inactivo no traba la partida: su turno lo juega un bot", idlePlay !== null);
  if (idlePlay) {
    const started = turnAtEli.get(idlePlay.id - 1) ?? 0;
    const waited = started > 0 ? idlePlay.startAt - started : 0;
    check(`recien despues de vencer el reloj (~${TURN_MS / 1000} s)`, waited >= TURN_MS - 1500 && waited <= TURN_MS + 4000, `${(waited / 1000).toFixed(1)} s`);
    check("el primer vencimiento no lo deja en piloto automatico todavia", idlePlay.state.seats[eli.seat].bot === false);
  }
  dani.close();
  eli.close();
  await sleep(200);
}

server.close();
httpServer.close();
console.log(`\n${checks - failures}/${checks} chequeos ok`);
process.exit(failures > 0 ? 1 : 0);
