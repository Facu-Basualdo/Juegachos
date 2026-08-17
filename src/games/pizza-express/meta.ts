import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "pizza-express",
  title: "Pizza Express",
  description:
    "Repartí pizzas en scooter por Cheesetown al atardecer: esquivá autos, pozos y perros mientras le tirás pizzas a los buzones que piden. Cuanto más rápido vas, más se complica.",
  path: "/games/pizza-express/",
  controls:
    "Flechas o A/D (o arrastrá el dedo) para esquivar. Espacio o tocá para lanzar una pizza al buzón que pide. Un choque y se acaba.",
  accent: "#d83a2b",
  category: "Arcade",
  order: 370,
  added: "2026-07-09",
  mobile: true,

  roomTimeLimitSec: 150,
};

// Puntaje = puntos por entregas (con combo). Mayor es mejor → board por defecto,
// así que no se declara `scoring`.
