import type { VbArenaKind, VbClientConfig } from "../protocol.js";

/**
 * Viborita (slither.io): TODA la configuracion del juego en un solo lugar.
 *
 * Lo que el cliente necesita para predecir y dibujar (tamano del mapa, formulas de
 * radio / largo / giro / velocidad / zoom) NO esta duplicado en `src/games/viborita/`:
 * viaja en el `vb:init` (ver `clientConfig`). Las formulas si estan escritas en los
 * dos lados (son cuatro lineas), pero los numeros salen de aca.
 *
 * Ojo con el heartbeat (`net.pingIntervalMs` / `net.pingTimeoutMs`): socket.io lo
 * configura para el server ENTERO, no por namespace, asi que `index.ts` lo lee de
 * aca y afecta a todos los juegos. Son los defaults de socket.io (25 s / 20 s),
 * explicitos para que nadie los suba por encima del timeout de inactividad de
 * Cloudflare Tunnel (100 s) sin saberlo.
 */

export interface ModeConfig {
  /** Radio del mapa circular, en unidades de mundo. Tocar el borde mata. */
  mapRadius: number;
  /** Comida "natural" que el mapa intenta mantener (la de los muertos y el turbo va aparte). */
  pelletCount: number;
  /** Bots que completan la arena (0 = sin bots). */
  bots: number;
  /** Los bots se van (al morir) a medida que entran humanos. */
  botsYield: boolean;
  /** Con una sola vida (salas) no hay reaparicion. */
  respawn: boolean;
  /** Largo con el que se gana la ronda (0 = no hay meta, la arena no termina). */
  winMass: number;
  /** Sin cambiar el input este tiempo, la viborita se disuelve (red de seguridad). */
  afkMs: number;
  /** Cuanto se espera a un jugador desconectado antes de sacarlo del mapa. */
  reconnectGraceMs: number;
}

export const VIBORITA_CONFIG = {
  sim: {
    /** Paso fijo de la simulacion. */
    tickHz: 40,
    /** Un snapshot cada N pasos (40 / 2 = 20 Hz). Tiene que ser un multiplo ENTERO del paso. */
    snapshotEvery: 2,
    /** Tope de tiempo real absorbido por despertar (si el event loop se atrasa). */
    maxCatchupMs: 150,
    /**
     * Buffer de jitter de los inputs, como en Manchon: cada input rige en
     * `t_cliente + offset + inputBufferMs`, asi dura en el server lo mismo que en el
     * cliente y la reconciliacion no tiembla.
     */
    inputBufferMs: 30,
    inputOffsetDrift: 0.005,
  },

  arena: {
    /** Conexiones (jugando o mirando) por arena publica. Al llenarse se abre otra. */
    maxSocketsPerArena: 40,
  },

  /** Arena publica (la de la landing): sin fin, se reaparece al morir. */
  public: {
    mapRadius: 3000,
    pelletCount: 1100,
    bots: 10,
    botsYield: true,
    respawn: true,
    winMass: 0,
    afkMs: 120_000,
    reconnectGraceMs: 10_000,
  } satisfies ModeConfig,

  /**
   * Arena de sala: una vida, sin tope de tiempo. Termina sola: alguien llega a
   * `winMass`, o no queda ningun humano vivo. El que no toca nada sigue derecho y se
   * estrella contra el borde (el mapa mide menos de 20 s de punta a punta); los bots
   * le cortan el paso al que da vueltas, y `afkMs` es la ultima red.
   */
  room: {
    mapRadius: 1800,
    pelletCount: 450,
    bots: 5,
    botsYield: false,
    respawn: false,
    winMass: 600,
    afkMs: 45_000,
    reconnectGraceMs: 20_000,
  } satisfies ModeConfig,

  snake: {
    /** Masa (= largo que muestra el juego) al aparecer. */
    startMass: 10,
    /** radio del cuerpo = rBase + rK * sqrt(masa): engorda despacio. */
    rBase: 9,
    rK: 0.6,
    /** largo del cuerpo (u) = lenBase + lenK * masa. */
    lenBase: 60,
    lenK: 3,
    /** Velocidad normal y con turbo (u/s). */
    speed: 230,
    boostSpeed: 470,
    /** Giro maximo (rad/s) = turnBase / (1 + masa / turnMassK): las largas doblan mas abierto. */
    turnBase: 4.4,
    turnMassK: 900,
    maxMass: 20_000,
    /** La cabeza come comida a esta distancia: radio * mouthK + radio de la comida. */
    mouthK: 1.5,
    /**
     * Choque: la cabeza propia contra un segmento ajeno a menos de
     * r_ajeno + r_propio * crashK. Menos de 1 = la nariz tiene que entrar un poco, que
     * es lo que hace que "pasar rozando" no mate.
     */
    crashK: 0.6,
    /** Separacion entre los segmentos que se chequean en los choques (fraccion del radio). */
    segmentSpacingK: 0.8,
  },

  boost: {
    /** Con menos masa que esta no se puede acelerar. */
    minMass: 15,
    /** Cada cuanto el turbo cobra (ms). */
    tickMs: 150,
    /** Lo que cobra cada vez: fraccion de la masa, con un minimo. */
    costFrac: 0.012,
    costMin: 0.8,
    /** De lo que se pierde, cuanto queda como comida detras de la cola. */
    dropFrac: 0.6,
  },

  pellet: {
    /** Comida natural. */
    mass: 1,
    /** Mismos 12 colores que las viboritas: la comida de un muerto es de su color. */
    colors: 12,
    /** Reposicion por paso cuando falta comida natural. */
    respawnPerTick: 3,
    /** Al morir, el cuerpo se convierte en comida: fraccion de la masa que se devuelve. */
    deathDropFrac: 0.7,
    /** Masa de cada bocado que deja un muerto (se reparte a lo largo del cuerpo). */
    deathDropMin: 2,
    deathDropMax: 10,
    /** Tope de comida "extra" (muertos y turbo) en el mapa, para cuidar al server. */
    maxDrops: 2500,
  },

  view: {
    /** Alto del mundo visible (u) con la masa inicial. */
    baseHeight: 1000,
    /** El alto visible crece como (radio / radio inicial)^exp: zoom out al crecer. */
    exp: 0.9,
    /** Alto visible del espectador (antes de entrar o despues de morir). */
    spectatorHeight: 1500,
    minAspect: 0.4,
    maxAspect: 2.6,
    /** Margen del culling sobre lo visible. */
    cullMargin: 1.2,
  },

  net: {
    pingIntervalMs: 25_000,
    pingTimeoutMs: 20_000,
    /** Tope por mensaje entrante (JSON serializado). Los legitimos rondan los 40 bytes. */
    maxMessageBytes: 256,
    /** Token bucket por conexion: capacidad y recarga por segundo. El cliente manda <= 30/s. */
    rateCapacity: 60,
    rateRefillPerSec: 40,
    /** Mensajes descartados (por rate o invalidos) en 10 s antes de cortar la conexion. */
    maxStrikes: 200,
    /** Minimo entre morir y volver a aparecer (el cliente ya espera la cuenta 3/2/1). */
    spawnCooldownMs: 1000,
  },

  names: {
    maxLen: 12,
    fallback: "Viborita",
  },

  bots: {
    /** Interruptor general de bots (pisa `bots` de cada modo). */
    enabled: true,
    /** Los bots piensan cada N pasos (40 / 4 = 10 Hz). */
    thinkEvery: 4,
    respawnMs: 2500,
    names: [
      "Culebra", "Yarara", "Boa", "Coral", "Mamba", "Anaconda", "Pitón", "Cobra",
      "Lombriz", "Anguila", "Cascabel", "Ñandurie", "Viborón", "Serpentina", "Gusanito", "Ciempiés",
    ],
  },
};

export type ArenaKind = VbArenaKind;

export function modeConfig(kind: ArenaKind): ModeConfig {
  return kind === "public" ? VIBORITA_CONFIG.public : VIBORITA_CONFIG.room;
}

export function clientConfig(kind: ArenaKind): VbClientConfig {
  const mode = modeConfig(kind);
  const s = VIBORITA_CONFIG.snake;
  return {
    kind,
    mapRadius: mode.mapRadius,
    tickHz: VIBORITA_CONFIG.sim.tickHz,
    snapshotHz: VIBORITA_CONFIG.sim.tickHz / VIBORITA_CONFIG.sim.snapshotEvery,
    startMass: s.startMass,
    rBase: s.rBase,
    rK: s.rK,
    lenBase: s.lenBase,
    lenK: s.lenK,
    speed: s.speed,
    boostSpeed: s.boostSpeed,
    turnBase: s.turnBase,
    turnMassK: s.turnMassK,
    boostMinMass: VIBORITA_CONFIG.boost.minMass,
    viewBase: VIBORITA_CONFIG.view.baseHeight,
    viewExp: VIBORITA_CONFIG.view.exp,
    spectatorView: VIBORITA_CONFIG.view.spectatorHeight,
    winMass: mode.winMass,
    respawn: mode.respawn,
    nameMaxLen: VIBORITA_CONFIG.names.maxLen,
  };
}

// ---- Formulas (las mismas que reproduce el cliente con los numeros de arriba) ----

export function radiusOf(mass: number): number {
  return VIBORITA_CONFIG.snake.rBase + VIBORITA_CONFIG.snake.rK * Math.sqrt(mass);
}

export function bodyLengthOf(mass: number): number {
  return VIBORITA_CONFIG.snake.lenBase + VIBORITA_CONFIG.snake.lenK * mass;
}

export function turnRateOf(mass: number): number {
  return VIBORITA_CONFIG.snake.turnBase / (1 + mass / VIBORITA_CONFIG.snake.turnMassK);
}

export function pelletRadiusOf(mass: number): number {
  return 4 + Math.sqrt(mass) * 2;
}

/** Alto del mundo visible para una viborita de esta masa. */
export function viewHeightOf(mass: number): number {
  const r0 = radiusOf(VIBORITA_CONFIG.snake.startMass);
  return VIBORITA_CONFIG.view.baseHeight * Math.pow(Math.max(radiusOf(mass), r0) / r0, VIBORITA_CONFIG.view.exp);
}

/**
 * Avanza una cabeza `dt` segundos girando hacia `target` a `omega` rad/s como mucho
 * y a velocidad `v`. Integracion EXACTA (arco de circulo hasta alinearse, despues
 * recta), asi el resultado no depende de en cuantos pedazos se parta el tiempo: el
 * server lo corre a pasos de 25 ms, el cliente por cuadro y la reconciliacion por
 * tramos de input, y los tres dan lo mismo. Duplicada en `src/games/viborita/game/motion.ts`.
 */
export function advanceHead(
  h: { x: number; y: number; a: number },
  target: number,
  omega: number,
  v: number,
  dt: number,
): void {
  if (dt <= 0) return;
  const diff = wrapAngle(target - h.a);
  const turnTime = omega > 0 ? Math.abs(diff) / omega : Infinity;
  const arcTime = Math.min(dt, turnTime);
  if (arcTime > 1e-9 && diff !== 0) {
    const s = diff > 0 ? 1 : -1;
    const a1 = h.a + s * omega * arcTime;
    const k = v / (s * omega);
    h.x += k * (Math.sin(a1) - Math.sin(h.a));
    h.y -= k * (Math.cos(a1) - Math.cos(h.a));
    h.a = turnTime <= dt ? target : a1;
  }
  const straight = dt - (diff !== 0 ? arcTime : 0);
  if (straight > 0) {
    h.x += Math.cos(h.a) * v * straight;
    h.y += Math.sin(h.a) * v * straight;
  }
  h.a = wrapAngle(h.a);
}

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
