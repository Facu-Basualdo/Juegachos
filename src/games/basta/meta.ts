import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "basta",
  title: "Basta",
  description:
    "Basta / Tutti Frutti: sale una letra y llenas 7 categorias (Nombre, Apellido, Pais, Color, Comida, Animal, Cosa) con palabras que empiecen con ella. El primero que completa grita BASTA y corta a todos; despues se votan las respuestas y suman los que quedan de pie. Solo se juega en salas.",
  path: "/games/basta/",
  controls:
    "Llena las 7 categorias con palabras que empiecen con la letra. Toca BASTA cuando completes todas. Al final, tacha las respuestas que no valgan.",
  accent: "#2f5bd8",
  category: "Party",
  order: 380,
  added: "2026-07-10",
};
