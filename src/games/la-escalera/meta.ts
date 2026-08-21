import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "la-escalera",
  title: "La Escalera",
  description:
    "Un obrero atrapado en una escalera mecánica que baja hacia un pozo de púas: seguí las flechas del cartel para ganar escalones. Cada error te resbala más cerca del fondo.",
  path: "/games/la-escalera/",
  controls:
    "Flechas (o WASD, o la cruceta en pantalla) para copiar la flecha del cartel. Acertás y subís, errás y resbalás.",
  accent: "#ff7a2a",
  category: "Reflejos",
  order: 420,
  added: "2026-08-20",
  mobile: true,

  roomTimeLimitSec: 120,
};

// Puntaje = escalones ganados (aciertos). Mayor es mejor -> board por defecto,
// asi que no se declara `scoring`.
