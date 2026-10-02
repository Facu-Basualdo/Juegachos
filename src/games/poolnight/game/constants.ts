/**
 * Constantes de Poolnight. La fisica NO vive aca: la resuelve el server (`simulateShot`) y
 * el cliente solo evalua los tramos que recibe. Lo que SI se duplica del server (por la
 * regla de decoupling del repo: no se comparte modulo entre `src/` y `server/`) es lo
 * minimo para evaluar un tramo y para validar la blanca en mano del lado del cliente. Si
 * cambia el tuning de `server/src/games/pool-physics.ts`, tocar los dos lados.
 */

// ---- Mesa (metros) ----
export const BALL_R = 0.028575;
export const HALF_L = 1.27;
export const HALF_W = 0.635;

/** Linea de cabeza: la blanca de la rotura no puede pasar de aca. */
export const FOOT_X = HALF_L / 2;

// ---- Fisica (espejo del server, solo para evaluar tramos) ----
export const G = 9.81;
export const MU_SLIDE = 0.2;
export const MU_ROLL = 0.01;
export const SPIN_Y_DECEL = 12;
export const V_MAX = 7;
export const MAX_OFFSET = 0.5;

/**
 * La potencia que ve el jugador (la barra, de 0 a 1) NO es lineal con la velocidad del tiro:
 * es una curva exponencial, asi la mitad de abajo de la barra da tiros suaves y precisos y la
 * fuerza de verdad queda para el final. Con exponente 2.2: 30% de la barra = 0.07 de V_MAX
 * (0.5 m/s), 50% = 0.22 (1.5 m/s), 70% = 0.46 (3.2 m/s), 100% = 7 m/s. Con la barra lineal,
 * un tiro "tranquilo" ya salia a 3.5 m/s y casi nada se podia jugar suave.
 */
export const POWER_EXPONENT = 2.2;

/** De la potencia de la barra (0 a 1) a la fraccion de V_MAX que se le pide al server. */
export function barToShotPower(bar: number): number {
  return Math.pow(Math.max(0, Math.min(1, bar)), POWER_EXPONENT);
}

// ---- Troneras (espejo del server) ----
const POCKET_SCALE = 1.15;
export const CORNER_GAP = 0.082 * POCKET_SCALE;
export const SIDE_GAP = 0.0635 * POCKET_SCALE;
export const KNUCKLE_R = 0.006;

// ---- Anatomia de la mesa (una de 9 pies, reglamento WPA; la dibuja Table.ts) ----

/** Ancho del almohadon: de la nariz (el borde del paño, donde rebota la bola) a la madera. */
export const CUSHION_W = 0.05;
/** Tope de la baranda de madera sobre el paño. Una mesa real anda por los 4.5-5 cm. */
export const RAIL_H = 0.048;
/**
 * Corte de cada almohadon en las bocas: el angulo interior entre la nariz y el corte es de 142
 * grados en las esquinas y de 104 en el medio (reglamento). Como es mayor a 90, el corte se
 * inclina HACIA la tronera: la boca (entre las narices) es mas ancha que la garganta (entre las
 * caras traseras). `k` es cuanto avanza el corte hacia la tronera por cada metro hacia atras.
 */
export const FACING_K_CORNER = 1 / Math.tan(((180 - 142) * Math.PI) / 180);
export const FACING_K_SIDE = 1 / Math.tan(((180 - 104) * Math.PI) / 180);

/** El agujero de cada tronera: un circulo que pasa justo por el fondo de los dos cortes de su boca. */
export interface PocketHole {
  x: number;
  z: number;
  r: number;
}
/** Cuanto se corre el centro del agujero hacia afuera del paño (esquinas: en diagonal). */
const CORNER_HOLE_OFF = 0.035;
const SIDE_HOLE_OFF = 0.085;
const CORNER_HOLE_R = Math.hypot(-CORNER_GAP + FACING_K_CORNER * CUSHION_W - CORNER_HOLE_OFF, CUSHION_W - CORNER_HOLE_OFF);
const SIDE_HOLE_R = Math.hypot(SIDE_GAP - FACING_K_SIDE * CUSHION_W, CUSHION_W - SIDE_HOLE_OFF);
export const POCKET_HOLES: PocketHole[] = [
  { x: HALF_L + CORNER_HOLE_OFF, z: HALF_W + CORNER_HOLE_OFF, r: CORNER_HOLE_R },
  { x: -(HALF_L + CORNER_HOLE_OFF), z: HALF_W + CORNER_HOLE_OFF, r: CORNER_HOLE_R },
  { x: -(HALF_L + CORNER_HOLE_OFF), z: -(HALF_W + CORNER_HOLE_OFF), r: CORNER_HOLE_R },
  { x: HALF_L + CORNER_HOLE_OFF, z: -(HALF_W + CORNER_HOLE_OFF), r: CORNER_HOLE_R },
  { x: 0, z: HALF_W + SIDE_HOLE_OFF, r: SIDE_HOLE_R },
  { x: 0, z: -(HALF_W + SIDE_HOLE_OFF), r: SIDE_HOLE_R },
];

/** Los nudos de las troneras (x, z), de a pares: las puntas de banda que bordean cada boca. */
export const KNUCKLES: number[] = [];
for (const sx of [1, -1]) {
  for (const sz of [1, -1]) {
    KNUCKLES.push(sx * (HALF_L - CORNER_GAP), sz * HALF_W);
    KNUCKLES.push(sx * HALF_L, sz * (HALF_W - CORNER_GAP));
  }
}
for (const sz of [1, -1]) {
  KNUCKLES.push(SIDE_GAP, sz * HALF_W, -SIDE_GAP, sz * HALF_W);
}

// ---- Relojes (espejo del server, solo para la cuenta regresiva) ----
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
/** Segundos por etiqueta: el server da 4 s entre el arranque y el primer turno. */
export const COUNTDOWN_STEP = 1;
export const START_DELAY_MS = 4000;
/** Si el server no contesta en este tiempo, se da por caido. */
export const SERVER_GRACE_MS = 12000;

// ---- Colores (ver DESIGN.md: "Paño y Humo") ----
export const TEAM_COLORS = ["#3aa0ff", "#ff8a2e"] as const;
export const TEAM_NAMES = ["LISAS", "RAYADAS"] as const;

export const BALL_COLORS: string[] = [
  "#f3ecd8", // 0 blanca (marfil)
  "#f2c230", // 1
  "#1f4fc0", // 2
  "#d02a22", // 3
  "#5a2a8a", // 4
  "#ee7a1c", // 5
  "#1b7a3c", // 6
  "#7a1a1a", // 7
  "#101010", // 8
];

/** Color de la bola `id` (las rayadas 9-15 repiten el de 1-7). */
export function ballColor(id: number): string {
  if (id === 0) return BALL_COLORS[0];
  if (id === 8) return BALL_COLORS[8];
  return BALL_COLORS[id > 8 ? id - 8 : id];
}

export function groupOf(id: number): 0 | 1 | -1 {
  if (id >= 1 && id <= 7) return 0;
  if (id >= 9 && id <= 15) return 1;
  return -1;
}

// ---- Camaras ----
export const CAM_FOV_PLAN = 38;
export const CAM_FOV_AIM = 50;
