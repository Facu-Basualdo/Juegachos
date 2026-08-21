// Caja de juego fija (portrait); el canvas la escala con letterbox.
export const VIEW_W = 480;
export const VIEW_H = 780;

// Clamp de dt para que un hitch no teletransporte la bola a traves de un anillo.
export const MAX_DT = 0.032;

// Fisica de la bola (unidades de vista / segundo). Suave y flotante: cada tap da
// un impulso corto para poder "quedarse" bobeando cerca de un anillo y cronometrar
// el cruce; el hueco de la figura es mas alto que un salto.
export const GRAVITY = 1200;
export const JUMP_VY = -520;
export const BALL_X = VIEW_W / 2;
export const BALL_R = 15;

// La camara sigue a la bola hacia arriba, dejandola a esta fraccion de alto.
export const CAM_RATIO = 0.66;

// Figuras: cada una con N regiones de color (siempre incluyen los 4 colores, asi
// el color de la bola nunca falta). Colision unificada por el radio del borde en
// el punto de cruce (arriba/abajo del centro).
//
// Clave: TODAS las figuras comparten el mismo HUECO INTERIOR usable (`RING_INNER`),
// para que "estar adentro" sea igual de holgado en cualquiera (antes el cuadrado
// tenia el hueco mas chico). El poligono deriva su circunradio de ese hueco:
// apotema = (INNER+OUTER)/2, R = apotema / cos(pi/n) (ver Game.ts). Hueco grande =
// facil quedarse adentro.
//  - Circulo: annulus con N arcos, hueco interior `RING_INNER`.
export const RING_INNER = 138; // radio del hueco interior usable (igual en todas)
export const RING_OUTER = 176; // grosor de banda = OUTER - INNER

// Separacion vertical entre figuras. Arranca generosa (aireado) y se ACHICA con el
// puntaje (mas apretado = mas rapido, menos tiempo muerto entre figuras).
export const RING_SPACING = 700; // separacion al inicio
export const RING_SPACING_MIN = 470; // separacion al maximo de dificultad
export const FIRST_RING_Y = -660;
export const RING_ROT_MIN = 0.62;
export const RING_ROT_MAX = 1.25;

// Dificultad progresiva: la rotacion se acelera, la separacion se achica y se van
// desbloqueando figuras con mas segmentos (mas dificiles) con el puntaje.
export const DIFF_SATURATE = 36; // score al que la dificultad se satura
export const SPEED_MUL_MAX = 2.8; // multiplicador de rotacion al maximo

export type ShapeKind = "circle" | "polygon";
export interface ShapePreset {
  kind: ShapeKind;
  n: number; // regiones de color (arcos o lados)
  minScore: number; // puntaje al que empieza a aparecer
}

// 10 figuras. Mas segmentos = arcos/lados mas finos = timing mas preciso.
export const SHAPES: ShapePreset[] = [
  { kind: "circle", n: 4, minScore: 0 },
  { kind: "polygon", n: 4, minScore: 0 }, // cuadrado
  { kind: "circle", n: 6, minScore: 3 },
  { kind: "polygon", n: 5, minScore: 5 }, // pentagono
  { kind: "polygon", n: 6, minScore: 8 }, // hexagono
  { kind: "circle", n: 8, minScore: 11 },
  { kind: "polygon", n: 7, minScore: 14 }, // heptagono
  { kind: "polygon", n: 8, minScore: 18 }, // octagono
  { kind: "circle", n: 12, minScore: 23 },
  { kind: "polygon", n: 9, minScore: 28 }, // nonagono
];

// Cambiador de color (entre figuras).
export const SWITCH_R = 18;

// Los cuatro colores del espectro (la identidad del juego).
export const COLORS = ["#ff3d81", "#2ee6ff", "#b8ff3d", "#ffb03d"];

export const BG = "#0c0a12";

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75;

export const BEST_KEY = "color-switch:best";
