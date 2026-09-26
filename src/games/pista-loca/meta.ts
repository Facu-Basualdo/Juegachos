import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "pista-loca",
  title: "Pista Loca",
  description:
    "Una pista de baile de bloques de colores colgada en la nada. Mientras suena la música bailás; cuando se corta, se pide un color y tenés unos segundos para pararte encima antes de que se caiga todo lo demás. Y ojo, que te pueden empujar. Cada ronda hay menos tiempo y el dibujo es más fino. Gana el último en pie. Solo se juega en salas.",
  path: "/games/pista-loca/",
  controls:
    "Movete con WASD o las flechas, saltá con ESPACIO y empujá con F o clic (en el celu: arrastrá el dedo y tocá SALTAR o EMPUJAR). Cuando se corta la música, corré al color que aparece arriba, y si podés, sacá a otro de su bloque.",
  accent: "#f27bb8",
  category: "Party",
  order: 1010,
  added: "2026-09-25",
  mobile: true,
  /**
   * El server termina la partida solo (queda uno en pie, se caen todos o se llega a
   * las 20 rondas), asi que esto es la red por si el server se cae DESPUES de
   * largar. 20 rondas de ~7 s dan ~140 s + congelado y espera del roster.
   */
  roomTimeLimitSec: 180,
};

/** Rondas completas aguantadas. */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${Math.round(n)} ${Math.round(n) === 1 ? "ronda" : "rondas"}`,
};
