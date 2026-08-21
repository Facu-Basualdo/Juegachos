export interface ColorDef {
  name: string;
  hex: string;
}

// Los colores del juego. Los primeros 4 son el set clasico de Stroop; el 5.o y
// 6.o se van sumando con el puntaje (mas opciones = mas dificil).
export const COLORS: ColorDef[] = [
  { name: "ROJO", hex: "#ff3b4e" },
  { name: "VERDE", hex: "#3ee06a" },
  { name: "AZUL", hex: "#3a9dff" },
  { name: "AMARILLO", hex: "#ffd23d" },
  { name: "VIOLETA", hex: "#b475ff" },
  { name: "NARANJA", hex: "#ff913d" },
];

export const START_OPTIONS = 4;
export const MAX_OPTIONS = 6;

// Cuantas opciones (colores) hay segun el puntaje: 4, luego 5, luego 6.
export function optionsFor(score: number): number {
  let n = START_OPTIONS;
  if (score >= 12) n++;
  if (score >= 26) n++;
  return Math.min(n, MAX_OPTIONS);
}

// Probabilidad de que la palabra coincida con la tinta (congruente): asi el
// jugador no puede simplemente "nunca elegir lo que dice".
export const CONGRUENT_CHANCE = 0.22;

// Reloj que drena (segundos). El gain esta calibrado ~ al tiempo de respuesta de
// un Stroop (~0.85s), asi jugar rapido y preciso SOSTIENE el reloj; ser lento o
// errar lo hunde. La barra arranca llena (normaliza contra START_TIME) y MAX_TIME
// da un poco de headroom para banquear en una racha.
export const START_TIME = 9;
export const MAX_TIME = 10;
export const TIME_GAIN = 0.85; // por acierto
export const TIME_PENALTY = 1.4; // por error

export const BEST_KEY = "stroop:best";

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75;
export const MAX_DT = 0.1;
