import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "color-switch",
  title: "Prisma",
  description: "Tu bola cambia de color: cruzá cada anillo giratorio solo por el arco de tu mismo color. Un roce del color equivocado y perdés.",
  path: "/games/color-switch/",
  controls: "Espacio, clic o toque para impulsar la bola hacia arriba y cronometrar el cruce.",
  accent: "#ff3d81",
  category: "Arcade",
  order: 49,
  added: "2026-07-09",
  mobile: true,

};

// Scoring por defecto: { direction: "higher" } (mas anillos = mejor). No se
// declara `export const scoring` a proposito (el default lo cubre).
