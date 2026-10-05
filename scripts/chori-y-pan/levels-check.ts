/**
 * Verificacion de los niveles de Chori y Pan: cada nivel tiene un GUION de solucion (que
 * hace cada heroe y cuando) que se corre contra la fisica real, sin pantalla. Si un guion
 * no llega a las dos puertas, el nivel esta roto. Correr despues de tocar un nivel o la
 * fisica:  npx tsx scripts/chori-y-pan/levels-check.ts [id]   (TRACE=1 para ver la traza)
 */
import { solve, type Step } from "./solve";
import type { World } from "../../src/games/chori-y-pan/game/World";
const at = (h: "chori" | "pan", x: number) => (w: World) => Math.abs(w.heroes[h].x + w.heroes[h].w / 2 - x) < 0.6;
const lever = (w: World) => w.levers.every((l) => l.on);

// Subida comun: repisa de la derecha, piso 2 hacia la izquierda, repisa y piso 3.
const climb: Step[] = [
  { jumpAt: 34.6, to: 37 },      // a la repisa de la derecha
  { jumpAt: 36.4, to: 32 },      // al piso 2
  { jumpAt: 28.7, to: 23.5 },    // sobre el chimichurri
  { jumpAt: 16.5, to: 12.8 },    // a la repisa
  { jumpAt: 12.4, to: 8.5 },     // al piso 3
];
const SOL: Record<string, Record<"chori" | "pan", Step[]>> = {
  atrio: {
    chori: [{ go: 9.4 }, { jumpAt: 9.6, to: 14.6 }, { go: 20.5 }, { until: lever }, { go: 31 }, ...climb, { go: 2.5 }],
    pan: [{ jumpAt: 4.6, to: 9.6 }, { go: 15 }, { until: at("chori", 20.5) }, { sleep: 0.5 }, { go: 31 }, ...climb, { go: 5.5 }],
  },
  montacargas: {
    chori: [{ go: 5 }, { until: at("pan", 10.5) }, { go: 6.5 }, { until: lever }, { go: 33.2 }, { jumpAt: 33.3, to: 35.2 }, { jumpAt: 34.4, to: 31.2 }, { jumpAt: 30.4, to: 27.2 }, { jumpAt: 26.4, to: 21.5 }, { go: 15.5 }],
    pan: [{ go: 10.5 }, { until: (w) => w.lifts[0].t === 1 }, { go: 18.5 }],
  },
  cajas: {
    // El Chori empuja la primera caja al boton a; el Pan la segunda al boton b.
    chori: [{ go: 6.2 }, { go: 11.8 }, { until: (w) => w.gates[0].open === 1 }, { go: 10.3 }, { jumpAt: 10.5, to: 15.2 }, { until: (w) => w.gates[1].open === 1 }, { go: 33 },
      { jumpAt: 34.6, to: 37 }, { jumpAt: 36.4, to: 32.6 }, { jumpAt: 31.6, to: 26.5 }, { go: 26.2 }, { jumpAt: 25.6, to: 20.5 }, { go: 16.4 }, { go: 13.6 }, { jumpAt: 13.4, to: 9.6 }, { jumpAt: 9.4, to: 5.6 }, { go: 2.5 }],
    pan: [{ until: (w) => w.gates[0].open === 1 }, { go: 10.3 }, { jumpAt: 10.5, to: 15.6 }, { go: 19.2 }, { go: 25.6 }, { until: (w) => w.gates[1].open === 1 }, { go: 24.4 }, { jumpAt: 24.6, to: 28 }, { go: 33 },
      { jumpAt: 34.6, to: 37 }, { jumpAt: 36.4, to: 32.6 }, { go: 26.2 }, { jumpAt: 25.6, to: 20.5 }, { jumpAt: 19.6, to: 14.4 }, { go: 13.6 }, { jumpAt: 13.4, to: 9.6 }, { jumpAt: 9.4, to: 5.6 }, { go: 5.5 }],
  },
  ventilador: {
    // El Pan sube primero con el viento; arriba empuja la palanca y el ventilador queda prendido.
    pan: [{ go: 13.3 }, { jumpAt: 13.4, to: 18.2 }, { go: 18.9 }, { until: (w) => w.heroes.pan.y + w.heroes.pan.h < 10.6 }, { go: 25.6 }, { jumpAt: 27.3, to: 32 }, { go: 37.5 }],
    chori: [{ until: (w) => Math.abs(w.heroes.pan.x + 0.39 - 18.9) < 0.6 }, { go: 7.5 }, { until: lever }, { go: 10.3 }, { jumpAt: 10.4, to: 14.6 }, { near: 18.9 }, { until: (w) => w.heroes.chori.y + w.heroes.chori.h < 10.6 }, { go: 26 }, { jumpAt: 27.3, to: 32 }, { go: 34.5 }],
  },
  caminos: {
    chori: [{ go: 4.5 }, { until: (w) => w.plates[1].pressed }, { go: 13.2 }, { until: (w) => w.gates[0].open === 1 }, { go: 30.5 }],
    pan: [{ until: (w) => w.gates[1].open === 1 }, { go: 17.5 }, { until: (w) => w.heroes.chori.x > 15.5 }, { go: 26.6 }, { jumpAt: 27.4, to: 32 }, { near: 34.9 }, { until: (w) => w.heroes.pan.y + w.heroes.pan.h < 12.7 }, { go: 32.5 }],
  },
  balanza: {
    pan: [{ go: 6.5 }, { until: (w) => w.lifts[0].t === 1 }, { go: 15.2 }, { until: (w) => w.lifts[1].t === 1 && Math.abs(w.heroes.chori.x + 0.39 - 32.5) < 0.4 }, { go: 13 },
      { until: (w) => w.lifts[1].t === 0 }, { go: 17.2 }, { jumpAt: 17.4, to: 23 }, { go: 28.5 }],
    chori: [{ until: (w) => w.lifts[0].rect.y < 21.4 || Math.abs(w.heroes.pan.x + 0.39 - 6.5) < 0.3 }, { go: 12.5 }, { until: (w) => w.heroes.pan.x > 9.2 && w.heroes.pan.onGround && w.heroes.pan.y + w.heroes.pan.h < 12.1 }, { go: 16.4 }, { jumpAt: 16.6, to: 22.2 },
      { until: (w) => w.lifts[1].t === 1 }, { go: 32.5 }, { until: (w) => w.lifts[1].t === 0 }, { go: 23.5 }, { jumpAt: 22.6, to: 17 }, { go: 10.5 }],
  },
  torre: (() => {
    const up: Step[] = [{ go: 10.8 }, { jumpAt: 11.2, to: 16.2 }, { go: 33.3 }, { jumpAt: 33.4, to: 35.2 }, { jumpAt: 34.4, to: 31.2 }, { jumpAt: 30.4, to: 28.2 }, { jumpAt: 27.4, to: 24.5 }];
    const top: Step[] = [{ go: 5.6 }, { jumpAt: 5.4, to: 3.2 }, { jumpAt: 3.8, to: 7.2 }, { jumpAt: 7.8, to: 10.8 }, { jumpAt: 11, to: 13.6 }];
    return {
      chori: [...up, { go: 18.6 }, { jumpAt: 18.6, to: 13.4 }, ...top, { go: 16.5 }, { until: lever }, { go: 33.5 }],
      pan: [...up, { go: 23.8 }, { jumpAt: 23.7, to: 18.4 }, ...top, { until: (w) => w.plates[0].pressed }, { go: 28.2 }, { go: 36.5 }],
    };
  })(),
  relevo: {
    chori: [{ go: 6.5 }, { until: (w) => w.plates[1].pressed }, { go: 16.5 }, { until: (w) => w.plates[3].pressed }, { go: 24.5 }, { until: lever },
      { near: 27.9 }, { until: (w) => w.heroes.chori.y + w.heroes.chori.h < 9.7 }, { go: 31.5 }, { jumpAt: 31.4, to: 35.6 }, { go: 35.5 }],
    pan: [{ until: (w) => w.plates[0].pressed }, { go: 12.5 }, { until: (w) => w.plates[2].pressed }, { go: 22.5 }, { until: (w) => w.plates[4].pressed },
      { near: 27.9 }, { until: (w) => w.heroes.pan.y + w.heroes.pan.h < 9.7 }, { go: 31.7 }, { go: 37.5 }],
  },
  puente: {
    // El Pan pisa el boton: el ascensor cruza al Chori. El Pan se baja del boton: vuelve vacio.
    // El Pan se sube y el Chori lo trae con la palanca contra la pared.
    chori: [{ go: 11.5 }, { until: (w) => w.lifts[0].t === 1 }, { go: 31.6 }, { until: (w) => w.lifts[0].t === 0 && Math.abs(w.heroes.pan.x + 0.39 - 11.5) < 0.4 }, { go: 38.4 },
      { until: (w) => w.heroes.pan.x > 31.2 && w.heroes.pan.onGround }, { go: 34.5 }],
    pan: [{ until: (w) => Math.abs(w.heroes.chori.x + 0.39 - 11.5) < 0.3 }, { go: 6.5 }, { until: (w) => w.lifts[0].t === 1 && w.heroes.chori.x > 30.6 && w.heroes.chori.onGround }, { go: 8.3 },
      { until: (w) => w.lifts[0].t === 0 }, { go: 11.5 }, { until: (w) => w.lifts[0].t === 1 }, { go: 36.5 }],
  },
  corazon: (() => {
    const feet = (w: World, h: "chori" | "pan") => w.heroes[h].y + w.heroes[h].h;
    const onT3 = (w: World) => w.heroes.chori.x > 8.2 && feet(w, "chori") < 7.1 && w.heroes.chori.onGround;
    return {
      chori: [{ go: 5.2 }, { go: 11.7 }, { until: (w) => w.gates[0].open === 1 }, { go: 10.3 }, { jumpAt: 10.5, to: 15.5 }, { go: 23.2 }, { jumpAt: 23.4, to: 28.2 },
        { until: (w) => w.plates[1].pressed }, { near: 32.9 }, { until: (w) => feet(w, "chori") < 13.7 }, { go: 25.2 }, { go: 27.6 },
        { jumpAt: 27.6, to: 23.6 }, { go: 21.4 }, { jumpAt: 21.6, to: 17.2 }, { go: 8.6 }, { go: 6.5 }, { until: (w) => w.lifts[0].t === 1 },
        { go: 11 }, { until: (w) => Math.abs(w.heroes.pan.x + 0.39 - 8.6) < 0.3 }, { go: 8.4 }, { until: (w) => w.lifts[0].t === 0 && Math.abs(w.heroes.pan.x + 0.39 - 6.5) < 0.3 },
        { go: 11 }, { until: (w) => w.lifts[0].t === 1 }, { go: 15.5 }],
      pan: [{ until: (w) => w.gates[0].open === 1 }, { go: 10.3 }, { jumpAt: 10.5, to: 15.6 }, { go: 23.2 }, { jumpAt: 23.4, to: 28.2 }, { go: 29.5 },
        { until: (w) => w.levers[0].on }, { near: 32.9 }, { until: (w) => feet(w, "pan") < 13.7 }, { go: 25 }, { go: 14.8 },
        { until: (w) => w.heroes.chori.x + 0.39 < 7.6 && w.heroes.chori.onGround && w.lifts[0].t === 0 }, { jumpAt: 14.6, to: 9.9 }, { go: 9.5 },
        { until: onT3 }, { go: 8.6 }, { until: (w) => w.lifts[0].t === 0 }, { go: 6.5 }, { until: (w) => w.lifts[0].t === 1 }, { go: 18.5 }],
    };
  })(),
};
const only = process.argv[2];
for (const [id, s] of Object.entries(SOL)) {
  if (only && id !== only) continue;
  const r = solve(id, s, 90, !!process.env.TRACE);
  console.log(`${r.ok ? "OK  " : "FAIL"} ${id} ${r.t.toFixed(1)}s ${r.why}`);
}
