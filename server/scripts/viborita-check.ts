/**
 * Chequeos de Viborita sin red (la arena con un host falso y pasos a mano):
 *   npm run check:viborita
 *
 * Cubre la integracion del giro (exacta, independiente del paso), que el cuerpo no
 * dependa del tamano del paso, la spatial hash, comer, choques (contra otra, de
 * frente, contra el borde, contra uno mismo no), turbo, sala, culling y bots. Sale con
 * codigo 1 si algo falla.
 */
import { SpatialHash } from "../src/games/viborita-grid.js";
import { Arena, Snake, type ArenaHost, type Player } from "../src/games/viborita-arena.js";
import { VIBORITA_CONFIG as C, advanceHead, bodyLengthOf, radiusOf, turnRateOf } from "../src/games/viborita-config.js";
import { sanitizeName } from "../src/games/viborita.js";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
}

const TICK_MS = 1000 / C.sim.tickHz;
// Las reglas se prueban sin bots; los bots tienen su seccion propia.
C.bots.enabled = false;

type Sent = { socketId: string; event: string; payload: unknown };
function makeArena(kind: "public" | "room"): { arena: Arena; sent: Sent[] } {
  const sent: Sent[] = [];
  const host: ArenaHost = {
    emit: (socketId, event, payload) => sent.push({ socketId, event, payload }),
    onEmpty: () => {},
  };
  const arena = new Arena(`T-${kind}`, kind, host);
  clearInterval((arena as unknown as { loop: ReturnType<typeof setInterval> }).loop);
  return { arena, sent };
}
function step(arena: Arena, n = 1): void {
  const a = arena as unknown as { simTime: number; stepNo: number; step(): void };
  for (let i = 0; i < n; i++) {
    a.simTime += TICK_MS;
    a.stepNo++;
    a.step();
  }
}
/** Pone una viborita nueva, derecha, con la cabeza en (x, y) mirando a `a`. */
function place(arena: Arena, player: Player, x: number, y: number, a: number, mass: number): Snake {
  const snake = new Snake(9000 + player.id, player, x, y, a, mass);
  snake.sampleSegments();
  player.snake = snake;
  player.angle = a;
  player.boost = false;
  player.peak = Math.max(player.peak, mass);
  (arena as unknown as { rebuildSegments(): void }).rebuildSegments();
  return snake;
}
function clearPellets(arena: Arena): void {
  const a = arena as unknown as {
    pelletHash: SpatialHash<{ x: number; y: number }>;
    mode: { pelletCount: number };
    naturalPellets: number;
    dropPellets: number;
  };
  arena.pellets.clear();
  a.pelletHash.clear();
  a.mode.pelletCount = 0;
  a.naturalPellets = 0;
  a.dropPellets = 0;
}
function human(arena: Arena, id: string, name: string): Player {
  const p = arena.addHuman(id, name, 1.6);
  p.lastActiveAt = Infinity; // que la inactividad no interfiera con lo que se prueba
  return p;
}

// ------------------------------------------------------------------ giro exacto

{
  const omega = turnRateOf(10);
  const run = (parts: number[]) => {
    const h = { x: 0, y: 0, a: 0 };
    for (const dt of parts) advanceHead(h, 2.5, omega, 230, dt);
    return h;
  };
  const one = run([1]);
  const many = run(Array.from({ length: 40 }, () => 0.025));
  const odd = run([0.013, 0.2, 0.0004, 0.31, 0.07, 0.4066]);
  const err = Math.max(Math.hypot(one.x - many.x, one.y - many.y), Math.hypot(one.x - odd.x, one.y - odd.y));
  check("giro: el resultado no depende de como se parta el tiempo", err < 1e-6, `${err.toExponential(1)} u`);
  const h = { x: 0, y: 0, a: 0 };
  advanceHead(h, Math.PI, omega, 230, 0.1);
  check("giro: no dobla mas que el maximo por segundo", Math.abs(Math.abs(h.a) - omega * 0.1) < 1e-9, `${h.a.toFixed(3)} rad`);
  check("giro: las largas doblan mas abierto", turnRateOf(2000) < turnRateOf(10) / 2);
}

// ------------------------------------------------------------------ cuerpo

{
  // La misma trayectoria registrada a 25 ms y a 5 ms tiene que dar el mismo cuerpo.
  const { arena } = makeArena("public");
  const p = human(arena, "x", "X");
  const build = (dtMs: number) => {
    const s = new Snake(1, p, 1000, 1000, 0, 200);
    let t = 0;
    while (t < 3000) {
      const target = t < 1500 ? 1.4 : -2.2;
      advanceHead(s, target, turnRateOf(s.mass), 230, dtMs / 1000);
      s.pushHead(t);
      t += dtMs;
    }
    const pts: [number, number][] = [];
    s.walkBody(12, s.bodyLength, (x, y) => pts.push([x, y]));
    return pts;
  };
  const a = build(25);
  const b = build(5);
  let maxDiff = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) maxDiff = Math.max(maxDiff, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
  check("cuerpo: no depende del tamano del paso", maxDiff < 1, `${maxDiff.toFixed(2)} u de diferencia maxima`);
  const expected = Math.floor(bodyLengthOf(200) / 12) + 1;
  check("cuerpo: mide lo que dice su masa", Math.abs(a.length - expected) <= 1, `${a.length} puntos (esperado ${expected})`);
}

{
  // El cuerpo que arma el CLIENTE con las cabezas de los snapshots (20 Hz) contra el
  // del server (estela a 40 Hz). Se usa el Trail real del cliente: es lo que dibuja.
  const { Trail } = await import("../../src/games/viborita/game/Trail.ts");
  const { arena } = makeArena("public");
  const p = human(arena, "x", "X");
  const s = new Snake(1, p, 1000, 1000, 0, 300);
  const trail = new Trail();
  const seed: number[] = [];
  s.walkBody(12, s.bodyLength, (x, y) => seed.push(x, y));
  trail.seed(seed, 0);
  let t = 0;
  for (let i = 0; i < 40 * 6; i++) {
    const target = Math.sin(t / 700) * 3; // zigzag con curvas cerradas
    advanceHead(s, target, turnRateOf(s.mass), i % 80 < 30 ? 470 : 230, 0.025);
    s.pushHead(t);
    t += 25;
    if (i % 2 === 1) trail.push(t, s.x, s.y);
  }
  const drawn: number[] = [];
  trail.body(s.x, s.y, Infinity, s.bodyLength, drawn);
  let worst = 0;
  s.walkBody(10, s.bodyLength - 10, (x, y) => {
    let best = Infinity;
    for (let i = 0; i + 3 < drawn.length; i += 2) {
      const ax = drawn[i], ay = drawn[i + 1], bx = drawn[i + 2], by = drawn[i + 3];
      const vx = bx - ax, vy = by - ay;
      const k = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
      best = Math.min(best, Math.hypot(ax + vx * k - x, ay + vy * k - y));
    }
    worst = Math.max(worst, best);
  });
  check("cuerpo: el que dibuja el cliente coincide con el del server", worst < 1.5, `${worst.toFixed(2)} u de desvio maximo (radio ${radiusOf(300).toFixed(0)})`);
}

// ------------------------------------------------------------------ spatial hash

{
  const hash = new SpatialHash<{ x: number; y: number; id: number }>(5000, 120);
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
  check("spatial hash: consulta igual a fuerza bruta (200 rectangulos)", mismatches === 0);
}

// ------------------------------------------------------------------ comer y chocar

{
  const { arena } = makeArena("public");
  check("la comida arranca llena", arena.pellets.size === C.public.pelletCount, `${arena.pellets.size}`);
  const p = human(arena, "s1", "Ana");
  arena.spawn(p, "Ana");
  const target = [...arena.pellets.values()][0];
  place(arena, p, target.x - 2, target.y, 0, 10);
  step(arena);
  check("comer suma largo", p.mass > 10 && !arena.pellets.has(target.id), `masa ${p.mass}`);
}

{
  const { arena, sent } = makeArena("public");
  clearPellets(arena);
  const R = arena.R;
  const victim = human(arena, "s1", "Victima");
  const wall = human(arena, "s2", "Pared");
  arena.spawn(victim, "Victima");
  arena.spawn(wall, "Pared");
  // La pared: una viborita larga que sube con el cuerpo cruzando y = R; la victima va
  // derecho hacia ese cuerpo.
  place(arena, wall, R, R - 300, -Math.PI / 2, 150);
  place(arena, victim, R - 120, R, 0, 20);
  let steps = 0;
  while (victim.alive && steps < 60) {
    wall.angle = -Math.PI / 2;
    step(arena);
    steps++;
  }
  const dead = sent.find((m) => m.socketId === "s1" && m.event === "vb:dead")?.payload as { by: string; reason: string } | undefined;
  check("chocar la cabeza contra otro cuerpo mata", !victim.alive && wall.alive && dead?.by === "Pared" && dead.reason === "crash", JSON.stringify(dead));
  const drops = [...arena.pellets.values()].filter((p) => p.drop);
  const dropped = drops.reduce((n, p) => n + p.mass, 0);
  check("el muerto deja su cuerpo como comida", Math.abs(dropped - 20 * C.pellet.deathDropFrac) < 0.5, `${dropped.toFixed(1)} de masa en ${drops.length} bocados`);
}

{
  const { arena } = makeArena("public");
  clearPellets(arena);
  const R = arena.R;
  const p = human(arena, "s1", "Rulo");
  arena.spawn(p, "Rulo");
  // Larga dando vueltas cerradas: se cruza con su propio cuerpo y no muere.
  place(arena, p, R, R, 0, 400);
  for (let i = 0; i < 200; i++) {
    p.angle = p.snake!.a + 2;
    step(arena);
  }
  check("chocar con el propio cuerpo no mata", p.alive);
}

{
  const { arena } = makeArena("public");
  clearPellets(arena);
  const R = arena.R;
  const a = human(arena, "s1", "A");
  const b = human(arena, "s2", "B");
  arena.spawn(a, "A");
  arena.spawn(b, "B");
  place(arena, a, R - 60, R, 0, 30);
  place(arena, b, R + 60, R, Math.PI, 30);
  step(arena, 20);
  check("de frente mueren las dos", !a.alive && !b.alive);
}

{
  const { arena, sent } = makeArena("room");
  clearPellets(arena);
  const p = human(arena, "r1", "Quieto");
  arena.spawn(p, "Quieto");
  p.lastActiveAt = 0; // este si es el caso de inactividad
  // Sin input sigue derecho: tiene que estrellarse contra el borde, sin reloj.
  let steps = 0;
  while (p.alive && steps < 40 * 30) {
    step(arena);
    steps++;
  }
  const dead = sent.find((m) => m.event === "vb:dead")?.payload as { reason: string } | undefined;
  check("sala: el que no toca nada se estrella contra el borde", !p.alive && dead?.reason === "wall", `${(steps / 40).toFixed(1)} s`);
  check("sala: una sola vida", !arena.spawn(p, "Quieto"));
}

// ------------------------------------------------------------------ compensacion de lag

{
  // A le cruza adelante a B, perpendicular, 70 u delante de la cabeza de B. A tarda
  // ~0.36 s en atravesar la franja por donde pasa B; en ese tiempo la cabeza REAL de B
  // llega a esa x, asi que en el presente A mete la cabeza en el cuerpo de B. En lo que
  // A veia (B 200 ms = 46 u atras), B no llegaba: el cruce era limpio.
  const run = (viewLag: number) => {
    const { arena } = makeArena("public");
    clearPellets(arena);
    const R = arena.R;
    const a = human(arena, "s1", "Corta");
    const b = human(arena, "s2", "Rival");
    arena.spawn(a, "Corta");
    arena.spawn(b, "Rival");
    // Un segundo de historial yendo derecho, sin cruzarse: despues B queda con la
    // cabeza en (R, R) yendo a +x, y A en (R + 70, R + 60) yendo hacia arriba.
    place(arena, b, R - 230, R, 0, 60);
    place(arena, a, R + 70, R + 290, -Math.PI / 2, 60);
    const go = () => {
      a.angle = -Math.PI / 2;
      b.angle = 0;
      a.boost = b.boost = false;
      a.viewLag = viewLag;
    };
    for (let i = 0; i < 40; i++) {
      go();
      step(arena);
    }
    let steps = 0;
    while (a.alive && steps < 30) {
      go();
      step(arena);
      steps++;
    }
    return { aAlive: a.alive, bAlive: b.alive };
  };
  const now = run(0);
  const lagged = run(200);
  check("lag: sin compensar, el que corta tarde se muere", !now.aAlive, JSON.stringify(now));
  check("lag: compensado, sobrevive el cruce que en su pantalla era limpio", lagged.aAlive, JSON.stringify(lagged));
  const { arena } = makeArena("public");
  const p = human(arena, "s9", "Tramposo");
  arena.spawn(p, "Tramposo");
  p.lastActiveAt = Infinity;
  step(arena, 400); // 10 s de simulacion
  // Dice que estaba viendo el instante 0, o sea 10 s atras: tiene que quedar en el tope.
  arena.input(p, 1, 0, 0, false, 0);
  step(arena, 3);
  check("lag: el atraso declarado tiene tope", p.viewLag === C.lagComp.maxRewindMs, `${p.viewLag} ms`);
}

// ------------------------------------------------------------------ turbo

{
  const { arena } = makeArena("public");
  clearPellets(arena);
  const R = arena.R;
  const a = human(arena, "s1", "Normal");
  const b = human(arena, "s2", "Turbo");
  arena.spawn(a, "Normal");
  arena.spawn(b, "Turbo");
  const sa = place(arena, a, R - 1000, R - 500, 0, 100);
  const sb = place(arena, b, R - 1000, R + 500, 0, 100);
  b.boost = true;
  step(arena, 40);
  const da = sa.x - (R - 1000);
  const db = sb.x - (R - 1000);
  check("turbo: va al doble de velocidad", db > da * 1.8, `${da.toFixed(0)} vs ${db.toFixed(0)} u en 1 s`);
  check("turbo: cuesta largo", sb.mass < 100 && sa.mass === 100, `masa ${sb.mass.toFixed(1)}`);
  check("turbo: deja comida detras", [...arena.pellets.values()].some((p) => p.drop));
  sb.mass = C.boost.minMass - 1;
  const before = sb.x;
  step(arena, 40);
  check("turbo: con poca masa no anda", sb.x - before < C.snake.speed * 1.1 && sb.mass === C.boost.minMass - 1);
}

{
  const { arena, sent } = makeArena("room");
  clearPellets(arena);
  const p = human(arena, "r1", "Uno");
  arena.spawn(p, "Uno");
  place(arena, p, arena.R, arena.R, 0, C.room.winMass + 5);
  step(arena);
  check("sala: llegar a la meta termina la arena", sent.some((m) => m.event === "vb:over"));
}

// ------------------------------------------------------------------ culling

{
  const { arena, sent } = makeArena("public");
  clearPellets(arena);
  const R = arena.R;
  const me = human(arena, "s1", "Yo");
  const far = human(arena, "s2", "Lejos");
  const long = human(arena, "s3", "Larga");
  arena.spawn(me, "Yo");
  arena.spawn(far, "Lejos");
  arena.spawn(long, "Larga");
  place(arena, me, R, R, 0, 10);
  place(arena, far, R + 2000, R, 0, 10);
  // Cabeza bien afuera de la vista, pero el cuerpo largo cruza por al lado mio.
  place(arena, long, R - 200, R - 1500, -Math.PI / 2, 600);
  const broadcast = () => (arena as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
  type Snap = { s: number[]; k?: number[] };
  const last = () => sent.filter((m) => m.socketId === "s1" && m.event === "vb:snap").at(-1)?.payload as Snap;
  const owners = (s: Snap) => s.s.filter((_, i) => i % 7 === 1);
  broadcast();
  let snap = last();
  check("culling: no veo la del otro lado del mapa", owners(snap).includes(me.id) && !owners(snap).includes(far.id));
  check("culling: veo una larga aunque tenga la cabeza afuera", owners(snap).includes(long.id));
  const keyIds: number[] = [];
  for (let i = 0; i < (snap.k?.length ?? 0); ) {
    keyIds.push(snap.k![i]);
    i += 2 + snap.k![i + 1] * 2;
  }
  check("culling: el cuerpo entero viaja la primera vez", keyIds.includes(long.snake!.id));
  broadcast();
  snap = last();
  check("culling: despues solo viajan las cabezas", !snap.k);
}

// ------------------------------------------------------------------ bots

C.bots.enabled = true;
{
  const { arena } = makeArena("public");
  check("bots: la arena publica arranca con sus bots", arena.botCount === C.public.bots, `${arena.botCount}`);
  // Un minuto de arena solo con bots: tienen que sobrevivir bastante (no suicidarse).
  let deaths = 0;
  const wasAlive = new Map<number, boolean>();
  for (let i = 0; i < 40 * 60; i++) {
    step(arena);
    for (const b of arena.players.values()) {
      if (wasAlive.get(b.id) && !b.alive) deaths++;
      wasAlive.set(b.id, b.alive);
    }
  }
  const perBotMinute = deaths / C.public.bots;
  check("bots: no se suicidan a cada rato", perBotMinute < 1.5, `${deaths} muertes en 1 min entre ${C.public.bots} bots`);
  const biggest = Math.max(...[...arena.players.values()].map((p) => p.mass));
  check("bots: crecen comiendo", biggest > C.snake.startMass * 3, `el mas largo: ${biggest.toFixed(0)}`);
}
C.bots.enabled = false;

// ------------------------------------------------------------------ nombres

check("nombre: saca simbolos y recorta", sanitizeName("  <b>Hola</b>\u0000 mundo!!!  ") === "bHolab mundo");
check("nombre: acepta acentos y enie", sanitizeName("Ñandú") === "Ñandú");
check("nombre: tope de largo", sanitizeName("a".repeat(50)).length === C.names.maxLen);
void radiusOf;

console.log(`\n${checks - failures}/${checks} ok`);
process.exit(failures > 0 ? 1 : 0);
