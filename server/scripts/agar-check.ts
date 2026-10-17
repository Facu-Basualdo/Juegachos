/**
 * Chequeos de Agar sin red (la arena con un host falso y pasos a mano):
 *   npm run check:agar
 *
 * Cubre la spatial hash contra fuerza bruta, la regla de comer (proporcion y
 * "la cubre mayormente"), comida, muerte, meta de la sala, inactividad, y el
 * administrador / validacion de red. Sale con codigo 1 si algo falla.
 */
import { SpatialHash } from "../src/games/agar-grid.js";
import { Arena, type ArenaHost, type Player } from "../src/games/agar-arena.js";
import { AGAR_CONFIG, radiusOf } from "../src/games/agar-config.js";
import { sanitizeName } from "../src/games/agar.js";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
}

const TICK_MS = 1000 / AGAR_CONFIG.sim.tickHz;
// Las reglas se prueban sin bots (que andarian comiendose a los de prueba); los bots
// tienen su seccion propia, que los vuelve a prender.
AGAR_CONFIG.bots.enabled = false;

type Sent = { socketId: string; event: string; payload: unknown };
function makeArena(kind: "public" | "room"): { arena: Arena; sent: Sent[] } {
  const sent: Sent[] = [];
  const host: ArenaHost = {
    emit: (socketId, event, payload) => sent.push({ socketId, event, payload }),
    onEmpty: () => {},
  };
  const arena = new Arena(`T-${kind}`, kind, host);
  // Se apaga el timer: los pasos se dan a mano.
  clearInterval((arena as unknown as { loop: ReturnType<typeof setInterval> }).loop);
  return { arena, sent };
}
// Los pasos a mano reproducen lo que hace `tick` (acceso a privados solo en el check).
function step(arena: Arena, n = 1): void {
  const a = arena as unknown as { simTime: number; stepNo: number; step(): void };
  for (let i = 0; i < n; i++) {
    a.simTime += TICK_MS;
    a.stepNo++;
    a.step();
  }
}
function place(player: Player, x: number, y: number, mass: number): void {
  const cell = player.cells[0];
  cell.x = x;
  cell.y = y;
  cell.mass = mass;
  player.peak = Math.max(player.peak, mass);
}
function clearPellets(arena: Arena): void {
  const a = arena as unknown as { pelletHash: SpatialHash<{ x: number; y: number }>; mode: { pelletCount: number } };
  arena.pellets.clear();
  a.pelletHash.clear();
  a.mode.pelletCount = 0;
}

// ------------------------------------------------------------------ spatial hash

{
  const hash = new SpatialHash<{ x: number; y: number; id: number }>(5000, 200);
  const items = Array.from({ length: 3000 }, (_, id) => ({ x: Math.random() * 5000, y: Math.random() * 5000, id }));
  for (const it of items) hash.insert(it);
  let mismatches = 0;
  for (let q = 0; q < 200; q++) {
    const x0 = Math.random() * 5000 - 300;
    const y0 = Math.random() * 5000 - 300;
    const x1 = x0 + Math.random() * 900;
    const y1 = y0 + Math.random() * 900;
    const got = new Set<number>();
    hash.query(x0, y0, x1, y1, (it) => got.add(it.id));
    const want = items.filter((it) => it.x >= x0 && it.x <= x1 && it.y >= y0 && it.y <= y1);
    if (want.length !== got.size || want.some((it) => !got.has(it.id))) mismatches++;
  }
  check("spatial hash: consulta igual a fuerza bruta (200 rectangulos)", mismatches === 0, `${mismatches} distintas`);
  for (const it of items.slice(0, 1500)) hash.remove(it);
  let left = 0;
  hash.query(-1, -1, 5001, 5001, () => left++);
  check("spatial hash: remove", left === 1500, `${left}`);
}

// ------------------------------------------------------------------ comida y comer

{
  const { arena } = makeArena("public");
  check("la comida arranca llena", arena.pellets.size === AGAR_CONFIG.public.pelletCount, `${arena.pellets.size}`);

  const a = arena.addHuman("sa", "Ana", 1.6);
  arena.spawn(a, "Ana");
  const target = [...arena.pellets.values()][0];
  place(a, target.x, target.y, 20);
  step(arena);
  check("comer un pellet suma masa", a.cells[0].mass > 20 && !arena.pellets.has(target.id), `masa ${a.cells[0].mass.toFixed(1)}`);
}

{
  const { arena, sent } = makeArena("public");
  clearPellets(arena);
  const big = arena.addHuman("s1", "Grande", 1.6);
  const small = arena.addHuman("s2", "Chica", 1.6);
  arena.spawn(big, "Grande");
  arena.spawn(small, "Chica");

  // Proporcion insuficiente: 60 contra 50 (1.2 < 1.25), aunque esten encimadas.
  place(big, 1000, 1000, 60);
  place(small, 1000, 1000, 50);
  step(arena);
  check("no come con menos de 1.25x de masa", small.alive && big.cells[0].mass === 60);

  // Suficiente masa pero solo se tocan: no la cubre.
  place(big, 1000, 1000, 100);
  place(small, 1000 + radiusOf(100), 1000, 50);
  step(arena);
  check("no come si solo se tocan", small.alive);

  // Justo afuera del alcance (R - 0.4 r) no; un poco adentro si.
  const reach = radiusOf(100) - AGAR_CONFIG.eat.overlap * radiusOf(50);
  place(big, 1000, 1000, 100);
  place(small, 1000 + reach + 1, 1000, 50);
  step(arena);
  check("no come justo afuera de R - 0.4r", small.alive);
  place(small, 1000 + reach - 1, 1000, 50);
  step(arena);
  check("come si la cubre mayormente", !small.alive && Math.round(big.cells[0].mass) === 150, `masa ${big.cells[0].mass}`);
  const dead = sent.find((m) => m.socketId === "s2" && m.event === "ag:dead")?.payload as { by: string; peak: number } | undefined;
  check("la victima recibe ag:dead con quien la comio", dead?.by === "Grande" && dead.peak === 50, JSON.stringify(dead));
  check("no se reaparece en el mismo instante", !arena.spawn(small, "Chica"));
  step(arena, Math.ceil(AGAR_CONFIG.net.spawnCooldownMs / TICK_MS) + 1);
  check("en la publica se puede volver a aparecer", arena.spawn(small, "Chica"));
}

{
  const { arena, sent } = makeArena("room");
  clearPellets(arena);
  const p = arena.addHuman("r1", "Uno", 1.6);
  arena.spawn(p, "Uno");
  place(p, 500, 500, AGAR_CONFIG.room.winMass + 5);
  step(arena);
  check("sala: llegar a la meta termina la arena", sent.some((m) => m.event === "ag:over"));
  const x = p.cells[0].x;
  p.dx = 1;
  step(arena, 10);
  check("sala: terminada queda congelada", p.cells[0].x === x);
}

{
  const { arena } = makeArena("room");
  clearPellets(arena);
  const p = arena.addHuman("r1", "Uno", 1.6);
  arena.spawn(p, "Uno");
  place(p, 500, 500, 20);
  const big = arena.addHuman("r2", "Dos", 1.6);
  arena.spawn(big, "Dos");
  place(big, 520, 500, 200);
  step(arena);
  check("sala: una sola vida", !p.alive && !arena.spawn(p, "Uno"));
}

{
  const { arena, sent } = makeArena("room");
  clearPellets(arena);
  const p = arena.addHuman("r1", "Quieto", 1.6);
  arena.spawn(p, "Quieto");
  step(arena, Math.ceil(AGAR_CONFIG.room.afkMs / TICK_MS) + 2);
  const dead = sent.find((m) => m.event === "ag:dead")?.payload as { reason: string } | undefined;
  check("sala: el inactivo se disuelve (la ronda puede cerrar)", !p.alive && dead?.reason === "afk");
}

// ------------------------------------------------------------------ culling

{
  const { arena, sent } = makeArena("public");
  const a = arena.addHuman("s1", "Cerca", 16 / 9);
  const b = arena.addHuman("s2", "Lejos", 16 / 9);
  arena.spawn(a, "Cerca");
  arena.spawn(b, "Lejos");
  place(a, 500, 500, 20);
  place(b, 4500, 4500, 20);
  const broadcast = () => (arena as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
  type Snap = { c: number[]; pa?: number[]; pd?: number[] };
  const lastSnap = (id: string) =>
    sent.filter((m) => m.socketId === id && m.event === "ag:snap").at(-1)?.payload as Snap;

  sent.length = 0;
  broadcast();
  let snap = lastSnap("s1");
  const ids = (s: Snap) => s.c.filter((_, i) => i % 5 === 0);
  check("culling: veo mi celula y no la del otro lado del mapa", ids(snap).includes(a.cells[0].id) && !ids(snap).includes(b.cells[0].id));
  const hh = (AGAR_CONFIG.view.baseHeight / 2) * AGAR_CONFIG.view.cullMargin;
  const hw = hh * (16 / 9);
  const pa = snap.pa ?? [];
  let outside = 0;
  for (let i = 0; i < pa.length; i += 4) if (Math.abs(pa[i + 1] - 500) > hw || Math.abs(pa[i + 2] - 500) > hh) outside++;
  check("culling: solo comida adentro de la vista", pa.length > 0 && outside === 0 && pa.length / 4 < arena.pellets.size, `${pa.length / 4} de ${arena.pellets.size}`);

  sent.length = 0;
  broadcast();
  snap = lastSnap("s1");
  check("culling: la comida ya enviada no se repite", !snap.pa && !snap.pd);

  place(a, 4400, 4400, 20);
  sent.length = 0;
  broadcast();
  snap = lastSnap("s1");
  check("culling: al moverme sale la comida vieja y aparece el vecino", (snap.pd?.length ?? 0) > 0 && ids(snap).includes(b.cells[0].id));
}

// ------------------------------------------------------------------ bots

AGAR_CONFIG.bots.enabled = true;
{
  const { arena } = makeArena("public");
  check("bots: la arena publica arranca con sus bots", arena.botCount === AGAR_CONFIG.public.bots, `${arena.botCount}`);
  const h = arena.addHuman("h1", "Humano", 1.6);
  for (const bot of arena.players.values()) if (bot.bot) bot.cells = []; // mueren todos
  for (const bot of arena.players.values()) if (bot.bot) bot.deadAt = -1e9;
  step(arena, AGAR_CONFIG.sim.tickHz + 1);
  check("bots: al entrar un humano, uno cede su lugar", arena.botCount === AGAR_CONFIG.public.bots - 1, `${arena.botCount}`);
  void h;
}
{
  const { arena } = makeArena("room");
  clearPellets(arena);
  // Solo un bot y un humano quieto: el bot lo tiene que encontrar y comer.
  for (const p of [...arena.players.values()]) if (p.bot) arena.players.delete(p.id);
  (arena as unknown as { addBot(): void }).addBot();
  const bot = [...arena.players.values()].find((p) => p.bot)!;
  const idle = arena.addHuman("r1", "Quieto", 1.6);
  arena.spawn(idle, "Quieto");
  place(bot, 1000, 1000, 120);
  place(idle, 1300, 1150, 20);
  let steps = 0;
  while (idle.alive && steps < 40 * 20) {
    step(arena);
    steps++;
  }
  check("bots: se comen al que se queda quieto", !idle.alive, `${(steps / 40).toFixed(1)} s`);
}
{
  const { arena } = makeArena("public");
  clearPellets(arena);
  for (const p of [...arena.players.values()]) if (p.bot) arena.players.delete(p.id);
  (arena as unknown as { addBot(): void }).addBot();
  const bot = [...arena.players.values()].find((p) => p.bot)!;
  const big = arena.addHuman("h1", "Grande", 1.6);
  arena.spawn(big, "Grande");
  place(bot, 1000, 1000, 30);
  place(big, 1150, 1000, 400);
  const d0 = Math.hypot(bot.cells[0].x - 1150, bot.cells[0].y - 1000);
  step(arena, 40);
  const d1 = bot.alive ? Math.hypot(bot.cells[0].x - big.cells[0].x, bot.cells[0].y - big.cells[0].y) : 0;
  check("bots: huyen del que se los puede comer", bot.alive && d1 > d0, `${d0.toFixed(0)} -> ${d1.toFixed(0)}`);
}
AGAR_CONFIG.bots.enabled = false;

// ------------------------------------------------------------------ nombres

check("nombre: saca simbolos y recorta", sanitizeName("  <b>Hola</b>\u0000 mundo!!!  ") === "bHolab mundo", sanitizeName("  <b>Hola</b>\u0000 mundo!!!  "));
check("nombre: acepta acentos y enie", sanitizeName("Ñandú") === "Ñandú");
check("nombre: tope de largo", sanitizeName("a".repeat(50)).length === AGAR_CONFIG.names.maxLen);
check("nombre: no-string da vacio", sanitizeName(42) === "" && sanitizeName(undefined) === "");

console.log(`\n${checks - failures}/${checks} ok`);
process.exit(failures > 0 ? 1 : 0);
