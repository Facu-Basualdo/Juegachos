import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "poolnight",
  title: "Poolnight",
  description:
    "Pool de bar, de noche y en equipos: 1 contra 1, 2 contra 2 o 4 contra 4. Cada equipo tiene sus bolas (lisas o rayadas): embocalas, dejá la 8 para el final y no embocues la blanca. Si faltan jugadores, completan los bots. Solo se juega en salas.",
  path: "/games/poolnight/",
  controls:
    "Apuntá moviendo el mouse (o A / D), mantené el clic y arrastrá hacia atrás para cargar la potencia, soltá para tirar (o W / S y ESPACIO). Tocá la bolita de abajo a la izquierda para dar efecto y C para cambiar de cámara. Si la blanca está en mano, arrastrala y hacé clic para apoyarla.",
  howTo: {
    intro: "Embocá tus bolas (lisas o rayadas) y dejá la 8 para el final: el que la emboca limpia, gana.",
    actions: [
      { title: "Apuntar", icons: ["mouse", "keys:A D", "swipe"], note: "la mira sigue al cursor" },
      { title: "Potencia", icons: ["drag", "keys:W S", "btn:TIRAR"], note: "arrastrá hacia atrás y soltá" },
      { title: "Efecto", icons: ["click", "tap"], note: "tocá la bolita de la esquina" },
      { title: "Cámara", icons: ["key:C", "tap"] },
    ],
  },
  accent: "#ffb54a",
  category: "Party",
  order: 1040,
  added: "2026-10-02",
  // El apuntado tactil esta (arrastrar para apuntar, barra de potencia y boton TIRAR) pero
  // no se probo en un telefono de verdad: poner true despues de probarlo (ver "Jugable en
  // celular" en el CLAUDE.md raiz).
  mobile: false,
  roomsOnly: true,
  /**
   * El server corta solo (6 / 8 / 10 min segun el formato). Esto es la red por si el
   * server se cae DESPUES de largar.
   */
  roomTimeLimitSec: 720,
};

// El puntaje de sala es el resultado del equipo (1 gano, 0 perdio), que no sirve como
// marca: el ranking global cuenta victorias en sala.
export const scoring: GameScoring = {
  direction: "higher",
  ranking: "wins",
};
