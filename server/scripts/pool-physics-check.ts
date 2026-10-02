/**
 * Verificacion de `simulateShot` sin red ni navegador:  npm run check:pool
 * Casos analiticos (se sabe la respuesta) + fuzz con invariantes. Sale con codigo 1 si
 * algo falla. No es un framework de tests: el server no tiene ninguno.
 */
import {
  BALL_COUNT,
  BALL_R,
  CORNER_GAP,
  E_CUSHION,
  HALF_L,
  HALF_W,
  MU_ROLL,
  MU_SLIDE,
  PHASE_ROLL,
  V_MAX,
  simulateShot,
  type BallPos,
  type Shot,
  type ShotResult,
  type StepView,
} from "../src/games/pool-physics.js";
import { makeRack, mulberry32 } from "../src/games/pool-rack.js";

const G = 9.81;
let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

/** Mesa vacia salvo las bolas indicadas ([id, x, z]). */
function table(...placed: [number, number, number][]): BallPos[] {
  const s: BallPos[] = [];
  for (let i = 0; i < BALL_COUNT; i++) s.push({ x: 0, z: 0, alive: false });
  for (const [id, x, z] of placed) s[id] = { x, z, alive: true };
  return s;
}

function shot(angle: number, speed: number, offsetX = 0, offsetY = 0): Shot {
  return { angle, power: speed / V_MAX, offsetX, offsetY };
}

function energy(v: StepView): number {
  let e = 0;
  for (let i = 0; i < BALL_COUNT; i++) {
    if (v.ph[i] === 3) continue;
    e += 0.5 * (v.vx[i] ** 2 + v.vz[i] ** 2) + 0.2 * BALL_R ** 2 * (v.wx[i] ** 2 + v.wy[i] ** 2 + v.wz[i] ** 2);
  }
  return e;
}

// ------------------------------------------------------------------ casos analiticos

console.log("--- casos analiticos");

{
  // Rodadura pura (b = 0.4): frena con MU_ROLL * g. Distancia = v^2 / (2 MU_ROLL g).
  const V = 0.5;
  const r = simulateShot(table([0, -1.0, 0]), shot(0, V, 0, 0.4));
  const expected = -1.0 + (V * V) / (2 * MU_ROLL * G);
  check("rodadura pura: distancia hasta frenar", near(r.final[0].x, expected, 1e-3), `x=${r.final[0].x.toFixed(4)} esperado ${expected.toFixed(4)}`);
  check("rodadura pura: arranca rodando (sin fase de deslizamiento)", r.segments[0].ph === PHASE_ROLL);
}

{
  // Golpe centrado: desliza y pasa a rodar a 5/7 de la velocidad inicial.
  const V = 2;
  const r = simulateShot(table([0, -1.0, 0]), shot(0, V));
  const toRoll = r.segments.find((s) => s.b === 0 && s.ph === PHASE_ROLL);
  const tsExpected = V / (3.5 * MU_SLIDE * G);
  check("deslizamiento: instante en que pasa a rodar", !!toRoll && near(toRoll.t, tsExpected, 1e-4), `t=${toRoll?.t.toFixed(5)} esperado ${tsExpected.toFixed(5)}`);
  const speed = toRoll ? Math.hypot(toRoll.vx, toRoll.vz) : 0;
  check("deslizamiento: rueda a 5/7 de la velocidad inicial", near(speed, (5 / 7) * V, 1e-4), `v=${speed.toFixed(5)} esperado ${((5 / 7) * V).toFixed(5)}`);
}

{
  // Banda de frente, rodando: velocidad de impacto por cinematica, rebote con E_CUSHION.
  const V = 1;
  const r = simulateShot(table([0, 0, 0]), shot(0, V, 0, 0.4));
  const d = HALF_L - BALL_R;
  const vImpact = Math.sqrt(V * V - 2 * MU_ROLL * G * d);
  const ev = r.events.find((e) => e.kind === "cushion");
  check("banda: velocidad de impacto", !!ev && near(ev.speed, vImpact, 1e-3), `v=${ev?.speed.toFixed(5)} esperado ${vImpact.toFixed(5)}`);
  const after = r.segments.find((s) => s.b === 0 && s.t > 0 && near(s.t, ev?.t ?? -1, 1e-9));
  const vAfter = after ? Math.hypot(after.vx, after.vz) : 0;
  check("banda: rebota con la restitucion de la banda", near(vAfter, E_CUSHION * vImpact, 1e-3), `v=${vAfter.toFixed(5)} esperado ${(E_CUSHION * vImpact).toFixed(5)}`);
}

{
  // Seguir y retroceso contra una bola quieta, de frente.
  const contactX = -2 * BALL_R;
  const draw = simulateShot(table([0, -0.5, 0], [1, 0, 0]), shot(0, 3, 0, -0.4));
  check("retroceso: la blanca vuelve detras del punto de contacto", draw.final[0].x < contactX - 0.02, `x=${draw.final[0].x.toFixed(3)}`);
  const follow = simulateShot(table([0, -0.5, 0], [1, 0, 0]), shot(0, 3, 0, 0.4));
  check("seguir: la blanca pasa por donde estaba la bola", follow.final[0].x > 0.05, `x=${follow.final[0].x.toFixed(3)}`);
  const stun = simulateShot(table([0, -0.5, 0], [1, 0, 0]), shot(0, 3, 0, 0));
  check("la bola golpeada sale por la linea del tiro", near(stun.final[1].z, 0, 1e-6) && stun.final[1].x > 0.1);
  check("primer contacto reportado", stun.firstContact === 1);
}

{
  // Troneras: de esquina por la diagonal y del medio de frente.
  const corner = simulateShot(table([0, HALF_L - 0.5, HALF_W - 0.5]), shot(Math.PI / 4, 1.5));
  check("tronera de esquina: la bola entra", corner.pocketed.includes(0) && !corner.final[0].alive);
  const side = simulateShot(table([0, 0, 0]), shot(Math.PI / 2, 1.5));
  check("tronera del medio: la bola entra", side.pocketed.includes(0) && !side.final[0].alive);
  // Un tiro a la banda corta a la altura de la boca, pero fuera de ella, NO entra.
  const miss = simulateShot(table([0, 0, 0.45]), shot(0, 1.5, 0, 0.4));
  check("banda corta lejos de la boca: no entra", miss.final[0].alive);
  void CORNER_GAP;
}

{
  // La energia solo puede bajar y los casos de borde no explotan.
  const r = simulateShot(table([0, -0.3, 0.1], [1, 0.4, 0.1], [2, 0.4 + 2 * BALL_R, 0.1]), shot(0.02, V_MAX));
  check("choque en cadena: termina y sin NaN", !r.timedOut && r.final.every((b) => Number.isFinite(b.x) && Number.isFinite(b.z)));
}

// ------------------------------------------------------------------ fuzz con invariantes

console.log("--- fuzz");

function randomTable(rnd: () => number, count: number): BallPos[] {
  const s = table();
  const placed: [number, number][] = [];
  for (let id = 0; id < count; id++) {
    for (let tries = 0; tries < 200; tries++) {
      const x = (rnd() * 2 - 1) * (HALF_L - 0.06);
      const z = (rnd() * 2 - 1) * (HALF_W - 0.06);
      if (placed.every(([px, pz]) => Math.hypot(px - x, pz - z) > 2 * BALL_R + 0.002)) {
        placed.push([x, z]);
        s[id] = { x, z, alive: true };
        break;
      }
    }
  }
  return s;
}

function sameResult(a: ShotResult, b: ShotResult): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

{
  const rnd = mulberry32(12345);
  const SHOTS = 3000;
  let badNaN = 0;
  let badOverlap = 0;
  let badBounds = 0;
  let badEnergy = 0;
  let timeouts = 0;
  let capHits = 0;
  let nondeterministic = 0;
  let minDist = Infinity;
  let maxEnergyRise = 0;
  let maxDur = 0;
  let sumDur = 0;
  const t0 = performance.now();

  for (let n = 0; n < SHOTS; n++) {
    const state = randomTable(rnd, 2 + Math.floor(rnd() * 14));
    const s: Shot = {
      angle: rnd() * Math.PI * 2,
      power: n % 5 === 0 ? 1 : rnd(),
      offsetX: (rnd() * 2 - 1) * 0.6,
      offsetY: (rnd() * 2 - 1) * 0.6,
    };
    let prevE = -1;
    let nan = false;
    let overlap = false;
    let bounds = false;
    let energyUp = false;
    const result = simulateShot(state, s, {
      onStep: (v) => {
        const e = energy(v);
        if (prevE >= 0 && e > prevE + 1e-7) {
          energyUp = true;
          maxEnergyRise = Math.max(maxEnergyRise, e - prevE);
        }
        prevE = e;
        for (let i = 0; i < BALL_COUNT; i++) {
          if (v.ph[i] === 3) continue;
          if (!Number.isFinite(v.x[i]) || !Number.isFinite(v.z[i]) || !Number.isFinite(v.vx[i])) nan = true;
          if (Math.abs(v.x[i]) > HALF_L + 1e-9 || Math.abs(v.z[i]) > HALF_W + 1e-9) bounds = true;
          for (let j = i + 1; j < BALL_COUNT; j++) {
            if (v.ph[j] === 3) continue;
            const d = Math.hypot(v.x[i] - v.x[j], v.z[i] - v.z[j]);
            if (d < minDist) minDist = d;
            if (d < 2 * BALL_R - 2e-4) overlap = true;
          }
        }
      },
    });
    if (nan) badNaN++;
    if (overlap) badOverlap++;
    if (bounds) badBounds++;
    if (energyUp) badEnergy++;
    if (result.timedOut) timeouts++;
    capHits += result.capHits;
    maxDur = Math.max(maxDur, result.duration);
    sumDur += result.duration;
    if (n % 100 === 0 && !sameResult(result, simulateShot(state, s))) nondeterministic++;
  }
  const ms = performance.now() - t0;

  check(`fuzz ${SHOTS} tiros: sin NaN`, badNaN === 0, `${badNaN}`);
  check("fuzz: ninguna bola solapada ni atravesada (distancia >= 2R - 0.2 mm)", badOverlap === 0, `${badOverlap} tiros, distancia minima ${(minDist * 1000).toFixed(3)} mm (2R = ${(2 * BALL_R * 1000).toFixed(3)} mm)`);
  check("fuzz: ninguna bola fuera de la mesa sin haber entrado a una tronera", badBounds === 0, `${badBounds}`);
  check("fuzz: la energia nunca sube", badEnergy === 0, `${badEnergy} tiros, mayor subida ${maxEnergyRise.toExponential(2)}`);
  check("fuzz: todos terminan por si solos", timeouts === 0, `${timeouts} cortados por tiempo, duracion media ${(sumDur / SHOTS).toFixed(1)} s, maxima ${maxDur.toFixed(1)} s`);
  check("fuzz: el tope de iteraciones por paso nunca se agota", capHits === 0, `${capHits}`);
  check("fuzz: determinista (mismo estado + mismo tiro = mismo resultado)", nondeterministic === 0, `${nondeterministic}`);
  console.log(`     ${SHOTS} tiros en ${ms.toFixed(0)} ms (${(ms / SHOTS).toFixed(2)} ms por tiro)`);
}

// ------------------------------------------------------------------ roturas

console.log("--- roturas");

{
  const BREAKS = 300;
  let potted = 0;
  let cueIn = 0;
  let timeouts = 0;
  let capHits = 0;
  let sumDur = 0;
  let sumMoved = 0;
  let nan = 0;
  let overlap = 0;
  const t0 = performance.now();
  for (let seed = 1; seed <= BREAKS; seed++) {
    const rack = makeRack(seed);
    const cueZ = ((seed % 7) - 3) * 0.02;
    rack[0].z = cueZ;
    let ov = false;
    const r = simulateShot(rack, { angle: 0, power: 1, offsetX: 0, offsetY: 0 }, {
      onStep: (v) => {
        for (let i = 0; i < BALL_COUNT; i++) {
          if (v.ph[i] === 3) continue;
          for (let j = i + 1; j < BALL_COUNT; j++) {
            if (v.ph[j] === 3) continue;
            if (Math.hypot(v.x[i] - v.x[j], v.z[i] - v.z[j]) < 2 * BALL_R - 2e-4) ov = true;
          }
        }
      },
    });
    if (ov) overlap++;
    if (!r.final.every((b) => Number.isFinite(b.x) && Number.isFinite(b.z))) nan++;
    potted += r.pocketed.filter((id) => id !== 0).length;
    if (r.pocketed.includes(0)) cueIn++;
    if (r.timedOut) timeouts++;
    capHits += r.capHits;
    sumDur += r.duration;
    for (let i = 1; i < BALL_COUNT; i++) {
      if (r.final[i].alive && Math.hypot(r.final[i].x - rack[i].x, r.final[i].z - rack[i].z) > 0.01) sumMoved++;
    }
  }
  const ms = performance.now() - t0;
  check(`${BREAKS} roturas a potencia maxima: sin NaN, sin solapes, sin cortes por tiempo`, nan === 0 && overlap === 0 && timeouts === 0 && capHits === 0, `nan=${nan} solapes=${overlap} timeouts=${timeouts} capHits=${capHits}`);
  console.log(`     por rotura: ${(potted / BREAKS).toFixed(2)} bolas embocadas, blanca adentro ${((100 * cueIn) / BREAKS).toFixed(0)}%, ${(sumMoved / BREAKS).toFixed(1)} bolas movidas, ${(sumDur / BREAKS).toFixed(1)} s, ${(ms / BREAKS).toFixed(1)} ms de calculo`);
}

console.log(`\n${checks - failures}/${checks} chequeos ok`);
if (failures > 0) process.exit(1);
