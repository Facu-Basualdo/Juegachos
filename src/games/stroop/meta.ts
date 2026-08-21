import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "stroop",
  title: "Tinta",
  description: "Aparece el nombre de un color pintado con OTRA tinta: tocá el color de la tinta, no lo que dice la palabra. Contra el reloj.",
  path: "/games/stroop/",
  controls: "Tocá (o teclas 1-6) el color de la TINTA con que está pintada la palabra, ignorando lo que dice.",
  accent: "#ff3b4e",
  category: "Reflejos",
  order: 51,
  added: "2026-07-09",
  mobile: true,

};

// Scoring por defecto: { direction: "higher" } (mas aciertos = mejor). No se
// declara `export const scoring` a proposito (el default lo cubre).
