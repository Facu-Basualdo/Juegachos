import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "asteroids",
  title: "Asteroides",
  description: "Navega con inercia, rota y dispara a rocas que se parten en este clásico juego de disparos espacial.",
  path: "/games/asteroids/",
  controls: "Flechas o A/D para rotar, W o flecha arriba para impulsar, y espacio o clic para disparar.",
  accent: "#ff3f81",
  category: "Arcade",
  order: 90,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 180,
};
