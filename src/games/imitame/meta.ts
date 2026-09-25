import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "imitame",
  title: "Imitame",
  description:
    "Suena un sonido una sola vez (un gato, una sirena, un ta-ta-ta-taaa) y todos lo imitan a la vez con la voz. El jurado mide la melodia, el ritmo y los golpes, no la voz. Despues las tomas suenan una por una para toda la sala y una ruleta reparte puntos dobles y sabotajes: eco, helio, saturado o tu toma cambiada por un pedo. Solo se juega en salas y pide microfono.",
  path: "/games/imitame/",
  controls:
    "Escucha el sonido (suena una vez). Cuando diga YA, imitalo con la voz: tenes una sola toma. Usa auriculares si podes.",
  accent: "#ff4f9a",
  category: "Party",
  order: 395,
  added: "2026-09-24",
  // Sin probar en un telefono todavia: en iOS abrir el micro cambia la salida de audio.
  mobile: false,
};
