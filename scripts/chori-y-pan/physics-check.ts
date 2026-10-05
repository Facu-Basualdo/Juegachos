/**
 * Pruebas de la fisica de Chori y Pan (rampas, salto variable, piletas, cajas, botones,
 * palancas, ascensores):  npx tsx scripts/chori-y-pan/physics-check.ts
 */
import { parseLevel, type LevelDef } from "../../src/games/chori-y-pan/game/Level";
import { World, type HeroInput } from "../../src/games/chori-y-pan/game/World";
import { STEP } from "../../src/games/chori-y-pan/game/constants";

const blank = () => Array.from({ length: 24 }, (_, y) => (y === 0 || y === 23 ? "#".repeat(40) : "#" + " ".repeat(38) + "#"));
function put(map: string[], x: number, y: number, s: string) { map[y] = map[y].slice(0, x) + s + map[y].slice(x + s.length); }
const ok = (name: string, cond: boolean, info = "") => console.log(`${cond ? "OK  " : "FAIL"} ${name} ${info}`);
function run(w: World, secs: number, inp: Partial<Record<"chori" | "pan", HeroInput>>) {
  for (let t = 0; t < secs; t += STEP) w.step(STEP, inp);
}
const R: HeroInput = { left: false, right: true, jump: false };
const L: HeroInput = { left: true, right: false, jump: false };
const J: HeroInput = { left: false, right: false, jump: true };
const N: HeroInput = { left: false, right: false, jump: false };

// 1) Caminar, rampa arriba y salto.
{
  const m = blank();
  put(m, 1, 22, "#".repeat(38));
  put(m, 10, 21, "/"); put(m, 11, 21, "#".repeat(5)); put(m, 11, 20, "/"); put(m, 12, 20, "####");
  put(m, 3, 21, "C"); put(m, 30, 21, "P"); put(m, 36, 21, "R"); put(m, 37, 21, "B");
  const w = new World(parseLevel({ id: "t1", name: "t", map: m }));
  run(w, 0.3, {});
  const h = w.heroes.chori;
  ok("arranca apoyado", h.onGround, `y=${(h.y + h.h).toFixed(2)}`);
  run(w, 1.2, { chori: R });
  ok("subio la rampa", h.y + h.h < 21.05, `pie=${(h.y + h.h).toFixed(2)} x=${h.x.toFixed(2)}`);
  run(w, 1.0, { chori: R });
  ok("sigue caminando arriba", h.x > 13, `x=${h.x.toFixed(2)} pie=${(h.y + h.h).toFixed(2)}`);
  const y0 = h.y;
  w.step(STEP, { chori: J });
  let minY = h.y;
  for (let i = 0; i < 120; i++) { w.step(STEP, { chori: J }); minY = Math.min(minY, h.y); }
  ok("salto ~3 celdas", y0 - minY > 2.7 && y0 - minY < 3.4, `alto=${(y0 - minY).toFixed(2)}`);
  run(w, 1, {});
  // salto corto
  const y1 = h.y; w.step(STEP, { chori: J }); for (let i = 0; i < 6; i++) w.step(STEP, { chori: J });
  let min2 = h.y; for (let i = 0; i < 120; i++) { w.step(STEP, { chori: N }); min2 = Math.min(min2, h.y); }
  ok("salto corto mas bajo", y1 - min2 < 1.6, `alto=${(y1 - min2).toFixed(2)}`);
  // bajar la rampa caminando a la izquierda pegado al piso
  let airborne = 0;
  for (let t = 0; t < 2; t += STEP) { w.step(STEP, { chori: L }); if (!h.onGround) airborne++; }
  ok("baja la rampa sin despegarse", airborne < 30, `cuadros en el aire=${airborne} pie=${(h.y + h.h).toFixed(2)}`);
}
// 2) Piletas: Chori cruza brasas, se muere en agua; Pan al reves.
{
  const m = blank();
  put(m, 1, 22, "#".repeat(38));
  put(m, 6, 22, "rrr"); put(m, 14, 22, "www");
  put(m, 2, 21, "C"); put(m, 3, 21, "P"); put(m, 36, 21, "R"); put(m, 37, 21, "B");
  const w = new World(parseLevel({ id: "t2", name: "t", map: m }));
  run(w, 2.0, { chori: R });
  const ev = w.events.filter((e) => e.type === "die");
  ok("Chori cruza brasas y muere en el agua", ev.length === 1 && ev[0].hero === "chori" && (ev[0] as { cause: string }).cause === "water", JSON.stringify(ev));
  const w2 = new World(parseLevel({ id: "t2", name: "t", map: m }));
  run(w2, 1.0, { pan: R });
  ok("Pan muere en las brasas", w2.events.some((e) => e.type === "die" && e.hero === "pan"));
}
// 3) Caja empujada sobre el boton abre la compuerta; palanca sube el ascensor.
{
  const m = blank();
  put(m, 1, 22, "#".repeat(38));
  put(m, 2, 21, "C"); put(m, 6, 21, "P"); put(m, 36, 21, "R"); put(m, 37, 21, "B"); put(m, 9, 21, "x");
  const def: LevelDef = {
    id: "t3", name: "t", map: m,
    plates: [{ x: 13, y: 21, ch: "a" }],
    gates: [{ x: 20, y: 18, w: 1, h: 4, ch: "a", dir: "up" }],
    levers: [{ x: 25, y: 21, ch: "b" }],
    lifts: [{ x: 28, y: 21.5, w: 3, dx: 0, dy: -6, ch: "b" }],
  };
  const w = new World(parseLevel(def));
  run(w, 0.2, {});
  ok("compuerta cerrada", w.gates[0].open === 0);
  const box = w.boxes[0];
  for (let t = 0; t < 4 && box.x + box.w / 2 < 13.5; t += STEP) w.step(STEP, { pan: R });
  run(w, 2, {});
  ok("caja sobre el boton -> compuerta abierta", w.gates[0].open === 1, `caja cx=${(box.x + box.w / 2).toFixed(2)} open=${w.gates[0].open.toFixed(2)}`);
  // Chori salta la caja y va hasta la palanca empujandola a la derecha
  for (let t = 0; t < 4 && w.heroes.chori.x < 25.3; t += STEP) w.step(STEP, { chori: { left: false, right: true, jump: w.heroes.chori.x > 6 && w.heroes.chori.x < 9 } });
  ok("palanca a la derecha", w.levers[0].on, `chori x=${w.heroes.chori.x.toFixed(2)}`);
  run(w, 2.5, {});
  ok("ascensor arriba", w.lifts[0].t === 1, `t=${w.lifts[0].t.toFixed(2)}`);
  // Pan se sube al ascensor bajo y ... (palanca vuelve) el ascensor baja con el Pan arriba
  const w2 = new World(parseLevel(def));
  const pan = w2.heroes.pan;
  pan.x = 28.5; pan.y = 21.5 - pan.h - 0.01;
  run(w2, 0.3, {});
  w2.levers[0].on = true;
  run(w2, 2.5, {});
  ok("el ascensor lleva al Pan arriba", pan.y + pan.h < 16, `pie=${(pan.y + pan.h).toFixed(2)} lift y=${w2.lifts[0].rect.y.toFixed(2)}`);
}
