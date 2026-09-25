import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "birome",
  title: "Birome",
  description:
    "Sos la punta de una birome cruzando una hoja cuadriculada: mantené apretado para subir, soltá para bajar y colate entre los tachones sin tocar los márgenes. Cada vez va más rápido.",
  path: "/games/birome/",
  controls:
    "Mantené ESPACIO / flecha arriba / click (o el dedo en la pantalla) para subir en diagonal; soltá para bajar. No toques los tachones, los manchones ni los márgenes rojos.",
  accent: "#2f5bd8",
  category: "Arcade",
  order: 980,
  added: "2026-09-24",
  mobile: true,
};

// Puntaje = centimetros de hoja recorridos (mayor es mejor).
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${n} cm`,
};
