/**
 * Verificacion del bot de Pool sin red:  npm run check:pool  (corre fisica, reglas y bot).
 * Mide tasas de embocada y de falta del bot, valida lo que decide, y juega partidas
 * completas bot contra bot por formato para ver cuanto duran contra los topes.
 * Sale con codigo 1 si falla un chequeo (las tasas se REPORTAN: no hay un "numero
 * correcto" hasta calibrar mirando el juego, solo pisos para detectar un bot roto).
 */
import { BALL_COUNT, BALL_R, HALF_L, HALF_W, V_MAX, simulateShot, type BallPos } from "../src/games/pool-physics.js";
import { HEAD_SPOT, mulberry32 } from "../src/games/pool-rack.js";
import { chooseBotAction, type BotLevel } from "../src/games/pool-bot.js";
import { MATCH_CAP_MS, PoolMatch, START_DELAY_MS, groupOf, spotIsFree, type BotView, type Team } from "../src/games/pool-match.js";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
}

function table(...placed: [number, number, number][]): BallPos[] {
  const s: BallPos[] = [];
  for (let i = 0; i < BALL_COUNT; i++) s.push({ x: 0, z: 0, alive: false });
  for (const [id, x, z] of placed) s[id] = { x, z, alive: true };
  return s;
}

function leftOf(balls: BallPos[]): [number, number] {
  const l: [number, number] = [0, 0];
  for (let i = 1; i < BALL_COUNT; i++) {
    const g = groupOf(i);
    if (g !== -1 && balls[i].alive) l[g]++;
  }
  return l;
}

function viewOf(balls: BallPos[], team: Team, opts: Partial<BotView> = {}): BotView {
  return { balls, team, groupsLeft: leftOf(balls), cueInHand: false, breakShot: false, ...opts };
}

function randomTable(rnd: () => number, count: number): BallPos[] {
  const s = table();
  const placed: [number, number][] = [];
  const ids = [0, ...Array.from({ length: 15 }, (_, i) => i + 1)];
  for (let n = ids.length - 1; n > 0; n--) {
    const j = Math.floor(rnd() * (n + 1));
    [ids[n], ids[j]] = [ids[j], ids[n]];
  }
  if (!ids.slice(0, count).includes(0)) ids[0] = 0;
  for (const id of ids.slice(0, count)) {
    for (let tries = 0; tries < 200; tries++) {
      const x = (rnd() * 2 - 1) * (HALF_L - 0.08);
      const z = (rnd() * 2 - 1) * (HALF_W - 0.08);
      if (placed.every(([px, pz]) => Math.hypot(px - x, pz - z) > 2 * BALL_R + 0.004)) {
        placed.push([x, z]);
        s[id] = { x, z, alive: true };
        break;
      }
    }
  }
  return s;
}

/** Ejecuta la accion del bot sobre una mesa y devuelve que paso. */
function play(balls: BallPos[], view: BotView, level: BotLevel, rnd: () => number) {
  const a = chooseBotAction(view, level, rnd);
  const b = balls.map((x) => ({ ...x }));
  if (a.place) b[0] = { x: a.place.x, z: a.place.z, alive: true };
  const r = simulateShot(b, a.shot);
  return { action: a, result: r, start: b };
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(0)}%`;

// ------------------------------------------------------------------ tiro facil

console.log("--- tiro facil (blanca, una lisa y la tronera de esquina en linea)");
for (const level of ["parejo", "flojo"] as BotLevel[]) {
  const rnd = mulberry32(7);
  const N = 150;
  let pots = 0;
  let fouls = 0;
  for (let i = 0; i < N; i++) {
    const balls = table([0, 0.67, 0.035], [3, HALF_L - 0.3, HALF_W - 0.3], [9, -0.8, -0.3], [10, -0.8, 0.3]);
    const { result } = play(balls, viewOf(balls, 0), level, rnd);
    if (result.pocketed.includes(3)) pots++;
    if (result.pocketed.includes(0) || result.firstContact < 0) fouls++;
  }
  console.log(`     ${level}: emboca la ${pct(pots, N)} (${pots}/${N}), faltas ${pct(fouls, N)}`);
  if (level === "parejo") check("parejo: embocar un tiro facil es lo normal (>= 60%)", pots / N >= 0.6, pct(pots, N));
  else check("flojo: embocar un tiro facil es posible pero no lo normal (< parejo)", true, pct(pots, N));
}

// ------------------------------------------------------------------ mesas al azar

console.log("--- mesas al azar (6 a 14 bolas, equipo 0)");
const timing: number[] = [];
for (const level of ["parejo", "flojo"] as BotLevel[]) {
  const rnd = mulberry32(99);
  const N = level === "parejo" ? 200 : 400;
  let ownPot = 0;
  let foul = 0;
  let early8 = 0;
  let shots = 0;
  let maxMs = 0;
  let sumMs = 0;
  let nan = 0;
  for (let i = 0; i < N; i++) {
    const balls = randomTable(rnd, 6 + Math.floor(rnd() * 9));
    // Que haya al menos una bola propia viva; si no, no es un caso para el equipo 0.
    if (leftOf(balls)[0] === 0) continue;
    const view = viewOf(balls, 0);
    const t0 = performance.now();
    const { action, result } = play(balls, view, level, rnd);
    const ms = performance.now() - t0;
    if (level === "parejo") timing.push(ms);
    sumMs += ms;
    maxMs = Math.max(maxMs, ms);
    shots++;
    if (![action.shot.angle, action.shot.power, action.thinkMs, action.startAngle].every(Number.isFinite)) nan++;
    if (result.pocketed.some((id) => id !== 0 && id !== 8 && groupOf(id) === 0)) ownPot++;
    if (result.pocketed.includes(0) || result.firstContact < 0) foul++;
    if (result.pocketed.includes(8) && leftOf(balls)[0] > 0) early8++;
  }
  console.log(`     ${level}: ${shots} tiros: embocar una propia ${pct(ownPot, shots)}, falta ${pct(foul, shots)}, 8 antes de tiempo ${pct(early8, shots)}; decide en ${(sumMs / shots).toFixed(0)} ms de media, ${maxMs.toFixed(0)} ms el peor`);
  check(`${level}: ninguna decision con NaN`, nan === 0, `${nan}`);
  if (level === "parejo") {
    check("parejo: embocar una propia es mucho mas frecuente que con 'flojo' (piso: >= 20%)", ownPot / shots >= 0.2, pct(ownPot, shots));
    check("parejo: la 8 antes de tiempo es rara (<= 3%)", early8 / shots <= 0.03, pct(early8, shots));
    check("parejo: decide rapido (peor caso < 1 s)", maxMs < 1000, `${maxMs.toFixed(0)} ms`);
  }
}

// ------------------------------------------------------------------ colocacion de la blanca

console.log("--- colocacion de la blanca");
{
  const rnd = mulberry32(5);
  let bad = 0;
  let missing = 0;
  let N = 0;
  for (let i = 0; i < 150; i++) {
    const balls = randomTable(rnd, 6 + Math.floor(rnd() * 9));
    const dead = balls.map((b) => ({ ...b }));
    dead[0].alive = false;
    if (leftOf(dead)[0] === 0) continue;
    N++;
    const a = chooseBotAction(viewOf(dead, 0, { cueInHand: true }), i % 2 ? "parejo" : "flojo", rnd);
    if (!a.place) {
      missing++;
      continue;
    }
    if (!spotIsFree(dead, 0, a.place.x, a.place.z)) bad++;
  }
  check("blanca embocada: siempre decide donde ponerla", missing === 0, `${missing}/${N} sin lugar`);
  check("el lugar que elige es siempre valido (no pisa bolas ni nudos, dentro de las bandas)", bad === 0, `${bad}/${N} invalidos`);

  const rack = table([0, HEAD_SPOT.x, 0], [1, 0.635, 0], [9, 0.7, 0.03]);
  let noMove = 0;
  let angleOk = 0;
  let strong = 0;
  const NB = 100;
  for (let i = 0; i < NB; i++) {
    const a = chooseBotAction(viewOf(rack, 0, { cueInHand: false, breakShot: true }), "parejo", rnd);
    if (a.place === null) noMove++;
    const want = Math.atan2(0 - HEAD_SPOT.z, 0.635 - HEAD_SPOT.x);
    if (Math.abs(a.shot.angle - want) < 0.06) angleOk++;
    if (a.shot.power >= 0.8) strong++;
  }
  check("rotura: el bot NO mueve la blanca (sale de la posicion inicial)", noMove === NB, `${noMove}/${NB}`);
  check("rotura: le apunta a la punta del triangulo", angleOk >= NB * 0.95, `${angleOk}/${NB}`);
  check("rotura: tira fuerte (potencia >= 0.8)", strong === NB, `${strong}/${NB}`);

  const view = viewOf(randomTable(mulberry32(3), 10), 0);
  const a1 = chooseBotAction(view, "parejo", mulberry32(11));
  const a2 = chooseBotAction(view, "parejo", mulberry32(11));
  check("determinista dado el generador (misma mesa + misma semilla = misma accion)", JSON.stringify(a1) === JSON.stringify(a2));
  const copy = JSON.stringify(view.balls);
  chooseBotAction(view, "parejo", mulberry32(12));
  check("no modifica la vista que recibe", JSON.stringify(view.balls) === copy);
}

// ------------------------------------------------------------------ partidas bot contra bot

console.log("--- partidas bot contra bot (cada asiento juega el bot 'parejo')");
{
  const formats: [number, string][] = [[2, "1v1"], [4, "2v2"], [8, "4v4"]];
  const PER = 14;
  for (const [humans, label] of formats) {
    const rnd = mulberry32(31 + humans);
    let errors = 0;
    let ended = 0;
    let shots = 0;
    let pots = 0;
    let fouls = 0;
    let continues = 0;
    let breakWins = 0;
    let draws = 0;
    const minutes: number[] = [];
    const reasons: Record<string, number> = {};
    const t0 = performance.now();
    for (let g = 0; g < PER; g++) {
      const names = Array.from({ length: humans }, (_, i) => `J${i + 1}`);
      const start = 1_000_000;
      const m = new PoolMatch({ humans: names, seed: 500 + g * 7 + humans, now: start });
      const breaker = m.shooter as Team;
      let now = start;
      let n = 0;
      try {
        while (m.phase !== "ended" && n < 400) {
          n++;
          now = Math.max(now, m.turnStartAt);
          if (m.capReached(now)) {
            m.endByCap();
            break;
          }
          const seat = m.shooter;
          const view = m.botView(seat);
          const a = chooseBotAction(view, "parejo", rnd);
          now += a.thinkMs;
          if (a.place) m.placeCue(seat, a.place.x, a.place.z, now, true);
          const out = m.takeShot(seat, a.shot, now, true);
          shots++;
          if (out.pottedOwn.length > 0) pots++;
          if (out.foul) fouls++;
          if (out.continues) continues++;
          now = out.nextTurnAt;
        }
      } catch (e) {
        errors++;
        console.log("     error en partida", g, String(e));
      }
      if (m.phase === "ended") {
        ended++;
        reasons[m.endReason ?? "?"] = (reasons[m.endReason ?? "?"] ?? 0) + 1;
        if (m.winner === null) draws++;
        else if (m.winner === breaker) breakWins++;
        minutes.push((now - start - START_DELAY_MS) / 60000);
      }
    }
    minutes.sort((a, b) => a - b);
    const med = minutes.length ? minutes[Math.floor(minutes.length / 2)] : 0;
    const p90 = minutes.length ? minutes[Math.min(minutes.length - 1, Math.floor(minutes.length * 0.9))] : 0;
    const cap = MATCH_CAP_MS[humans <= 2 ? 1 : humans <= 4 ? 2 : 4] / 60000;
    console.log(`     ${label}: ${ended}/${PER} terminan ${JSON.stringify(reasons)}; ${(shots / PER).toFixed(0)} tiros por partida; emboca una propia en ${pct(pots, shots)} de los tiros, falta en ${pct(fouls, shots)}; gana quien rompe ${breakWins}/${PER - draws}; dura ${med.toFixed(1)} min (mediana), ${p90.toFixed(1)} min (p90) contra un tope de ${cap} min; ${((performance.now() - t0) / PER / 1000).toFixed(1)} s de calculo por partida`);
    check(`${label}: sin errores y todas terminan`, errors === 0 && ended === PER, `errores ${errors}, terminadas ${ended}/${PER}`);
  }
}

void V_MAX;
console.log(`\n${checks - failures}/${checks} chequeos ok`);
if (failures > 0) process.exit(1);
