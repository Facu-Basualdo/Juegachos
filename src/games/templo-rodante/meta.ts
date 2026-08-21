import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "templo-rodante",
  title: "Templo Rodante",
  description:
    "Atrapado en una cámara de piedra: por los dos extremos vienen rodando vigas con púas. Las rasantes se saltan, las altas se esquivan agachándose, y cada vez vienen más rápido.",
  path: "/games/templo-rodante/",
  controls:
    "Flecha arriba / W (o la mitad de arriba de la pantalla) para saltar la viga rasante; flecha abajo / S (o la mitad de abajo) para agacharte ante la viga alta.",
  accent: "#ff7a18",
  category: "Reflejos",
  order: 970,
  added: "2026-08-20",
  mobile: true,
};

// Puntaje = vigas esquivadas (mayor es mejor).
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${n} vigas`,
};
