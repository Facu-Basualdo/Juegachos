/** Ejecutor de guiones de solucion contra `World` (lo usa levels-check.ts). */
import { parseLevel, type Hero } from "../../src/games/chori-y-pan/game/Level";
import { LEVELS } from "../../src/games/chori-y-pan/game/levels";
import { World, type HeroInput } from "../../src/games/chori-y-pan/game/World";
import { STEP } from "../../src/games/chori-y-pan/game/constants";

/** Pasos del guion de un heroe. `x` en centro de celda (coordenada del centro del heroe). */
export type Step =
  | { go: number }
  | { near: number }
  | { jumpAt: number; to: number }
  | { until: (w: World) => boolean }
  | { sleep: number }
  | { hop: true };

interface Runner { steps: Step[]; i: number; t: number; phase: number; holdJump: number; }

function cx(w: World, h: Hero) { const b = w.heroes[h]; return b.x + b.w / 2; }

function inputFor(w: World, h: Hero, r: Runner, dt: number): HeroInput {
  const N: HeroInput = { left: false, right: false, jump: false };
  while (r.i < r.steps.length) {
    const s = r.steps[r.i];
    const b = w.heroes[h];
    if ("go" in s) {
      const d = s.go - cx(w, h);
      if (Math.abs(d) < 0.12 && b.onGround && Math.abs(b.vx) < 3) { r.i++; continue; }
      if (Math.abs(d) < 0.12) return N;
      // frena antes de pasarse
      const brake = Math.abs(d) < Math.abs(b.vx) * Math.abs(b.vx) / (2 * 85) + 0.05 && Math.sign(b.vx) === Math.sign(d);
      return { left: d < 0 && !brake, right: d > 0 && !brake, jump: false };
    }
    if ("near" in s) {
      const d = s.near - cx(w, h);
      if (Math.abs(d) < 0.25) { r.i++; continue; }
      return { left: d < 0, right: d > 0, jump: false };
    }
    if ("jumpAt" in s) {
      const dir = Math.sign(s.to - s.jumpAt);
      if (r.phase === 0) {
        const past = dir > 0 ? cx(w, h) >= s.jumpAt : cx(w, h) <= s.jumpAt;
        if (past && b.onGround) { r.phase = 1; r.holdJump = 0.3; }
        else {
          const d = s.jumpAt - cx(w, h);
          return { left: d < 0, right: d > 0, jump: false };
        }
      }
      if (r.phase === 1) {
        r.holdJump -= dt;
        const arrived = dir > 0 ? cx(w, h) >= s.to : cx(w, h) <= s.to;
        if (r.holdJump < 0 && b.onGround) { r.phase = 0; r.i++; continue; }
        return { left: dir < 0 && !arrived, right: dir > 0 && !arrived, jump: r.holdJump > 0 };
      }
    }
    if ("hop" in s) {
      if (r.phase === 0) { r.phase = 1; r.holdJump = 0.3; }
      r.holdJump -= dt;
      if (r.holdJump < 0 && b.onGround) { r.phase = 0; r.i++; continue; }
      return { left: false, right: false, jump: r.holdJump > 0 };
    }
    if ("until" in s) { if (s.until(w)) { r.i++; continue; } return N; }
    if ("sleep" in s) { r.t += dt; if (r.t >= s.sleep) { r.t = 0; r.i++; continue; } return N; }
  }
  return N;
}

export function solve(id: string, script: Record<Hero, Step[]>, maxT = 90, trace = false): { ok: boolean; t: number; why: string } {
  const def = LEVELS.find((l) => l.id === id)!;
  const w = new World(parseLevel(def));
  const run: Record<Hero, Runner> = {
    chori: { steps: script.chori, i: 0, t: 0, phase: 0, holdJump: 0 },
    pan: { steps: script.pan, i: 0, t: 0, phase: 0, holdJump: 0 },
  };
  let t = 0; let lastLog = -1;
  while (t < maxT) {
    w.step(STEP, { chori: inputFor(w, "chori", run.chori, STEP), pan: inputFor(w, "pan", run.pan, STEP) });
    t += STEP;
    const die = w.events.find((e) => e.type === "die");
    if (die) return { ok: false, t, why: `murio ${JSON.stringify(die)} en paso chori#${run.chori.i} pan#${run.pan.i} chori=${cx(w, "chori").toFixed(2)},${(w.heroes.chori.y + w.heroes.chori.h).toFixed(2)} pan=${cx(w, "pan").toFixed(2)},${(w.heroes.pan.y + w.heroes.pan.h).toFixed(2)}` };
    w.events.length = 0;
    if (w.cleared) return { ok: true, t, why: `gemas restantes ${w.gemsLeft.size}` };
    if (trace && Math.floor(t * 2) !== lastLog) { lastLog = Math.floor(t * 2); console.log(t.toFixed(1), "cajas", w.boxes.map((b) => b.x.toFixed(2)).join("/"), "gates", w.gates.map((g) => g.open.toFixed(2)).join("/"), "chori", run.chori.i, cx(w, "chori").toFixed(2), (w.heroes.chori.y + w.heroes.chori.h).toFixed(2), "pan", run.pan.i, cx(w, "pan").toFixed(2), (w.heroes.pan.y + w.heroes.pan.h).toFixed(2)); }
  }
  return { ok: false, t, why: `no termino: chori paso ${run.chori.i} en ${cx(w, "chori").toFixed(2)},${(w.heroes.chori.y + w.heroes.chori.h).toFixed(2)} | pan paso ${run.pan.i} en ${cx(w, "pan").toFixed(2)},${(w.heroes.pan.y + w.heroes.pan.h).toFixed(2)}` };
}
