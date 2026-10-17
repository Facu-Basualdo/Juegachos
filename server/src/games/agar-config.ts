import type { AgArenaKind, AgClientConfig } from "../protocol.js";

/**
 * Agar: TODA la configuracion del juego en un solo lugar.
 *
 * Lo que el cliente necesita para predecir y dibujar (tamano del mapa, formulas de
 * radio / velocidad / zoom, cadencias) NO esta duplicado en `src/games/agar/`: viaja
 * en el `ag:init` (ver `clientConfig`). Asi un cambio de tuning se hace aca, se
 * redeploya el server y los clientes lo toman al conectar, sin tocar el front.
 *
 * Ojo con el heartbeat (`net.pingIntervalMs` / `net.pingTimeoutMs`): socket.io lo
 * configura para el server ENTERO, no por namespace, asi que `index.ts` lo lee de
 * aca y afecta a todos los juegos. Los valores son los defaults de socket.io (25 s /
 * 20 s), que ya mantenian viva la conexion a traves de Cloudflare Tunnel; estan
 * explicitos para que nadie los suba por encima del timeout de inactividad del
 * tunnel (100 s) sin saberlo.
 */

export interface ModeConfig {
  /** Lado del mapa cuadrado, en unidades de mundo. */
  mapSize: number;
  /** Comida que el mapa intenta mantener en todo momento. */
  pelletCount: number;
  /** Bots que completan la arena (0 = sin bots). */
  bots: number;
  /** Los bots se van (al morir) a medida que entran humanos. */
  botsYield: boolean;
  /** Con una sola vida (salas) no hay reaparicion. */
  respawn: boolean;
  /** Masa con la que se gana la ronda (0 = no hay meta, la arena no termina). */
  winMass: number;
  /** Sin cambiar el input este tiempo, la celula se disuelve (libera el lugar / cierra la ronda). */
  afkMs: number;
  /** Cuanto se espera a un jugador desconectado antes de sacarlo del mapa. */
  reconnectGraceMs: number;
}

export const AGAR_CONFIG = {
  sim: {
    /** Paso fijo de la simulacion. */
    tickHz: 40,
    /**
     * Un snapshot cada N pasos: 40 / 2 = 20 Hz. Tiene que ser un multiplo ENTERO del
     * paso (ver "Interpolar sobre el reloj del server" en el CLAUDE.md raiz): por eso
     * no son los 30 Hz / 20 Hz del pedido original, que no encajan.
     */
    snapshotEvery: 2,
    /** Tope de tiempo real absorbido por despertar (si el event loop se atrasa). */
    maxCatchupMs: 150,
    /**
     * Buffer de jitter de los inputs, como en Manchon: cada input rige en
     * `t_cliente + offset + inputBufferMs`, asi dura en el server lo mismo que duro en
     * el cliente y la reconciliacion no tiembla.
     */
    inputBufferMs: 30,
    inputOffsetDrift: 0.005,
  },

  arena: {
    /**
     * Conexiones (jugando o mirando) por arena publica. Al llenarse, el siguiente que
     * entra abre una arena nueva. Las de sala no lo usan: una sala tiene 8 como mucho.
     */
    maxSocketsPerArena: 40,
  },

  /** Arena publica (la de la landing): sin fin, se reaparece al morir. */
  public: {
    mapSize: 5000,
    pelletCount: 900,
    bots: 10,
    botsYield: true,
    respawn: true,
    winMass: 0,
    afkMs: 120_000,
    reconnectGraceMs: 10_000,
  } satisfies ModeConfig,

  /**
   * Arena de sala: una vida, sin tope de tiempo. Termina sola, sin reloj: cuando
   * alguien llega a `winMass`, o cuando ya no queda ningun humano vivo (los bots se
   * comen al que se queda quieto y `afkMs` disuelve al que dejo la pestana abierta).
   */
  room: {
    mapSize: 3200,
    pelletCount: 450,
    // Se quedan aunque la sala este llena: son los que terminan comiendose al que
    // se queda quieto, que es parte de lo que garantiza que la ronda cierre sola.
    bots: 6,
    botsYield: false,
    respawn: false,
    winMass: 1000,
    afkMs: 45_000,
    reconnectGraceMs: 20_000,
  } satisfies ModeConfig,

  cell: {
    startMass: 20,
    /** radio = radiusK * sqrt(masa). */
    radiusK: 6,
    /** velocidad (u/s) = speedBase * masa^-speedExp: 300 u/s al nacer, ~90 con 1000. */
    speedBase: 760,
    speedExp: 0.31,
    maxMass: 20_000,
    /** Por encima de esta masa se pierde `decayPerSec` de la masa por segundo. */
    decayMinMass: 150,
    decayPerSec: 0.002,
  },

  eat: {
    /** Para comerse a otra celula hay que tener al menos esta proporcion de su masa. */
    ratio: 1.25,
    /**
     * "La cubre mayormente": distancia entre centros < R - overlap * r. Con 0.4 el
     * centro de la chica esta bien adentro y le queda afuera menos de un tercio.
     */
    overlap: 0.4,
  },

  pellet: {
    mass: 1,
    /** Solo visual: la comida se come cuando su centro cae adentro de la celula. */
    radius: 7,
    /** Cantidad de colores de comida (el cliente los mapea a su paleta). */
    colors: 6,
    /** Reposicion por paso cuando falta comida (no reaparece toda de golpe). */
    respawnPerTick: 3,
  },

  view: {
    /** Alto del mundo visible (u) con la masa inicial. */
    baseHeight: 1100,
    /** El alto visible crece como (radio / radio inicial)^exp: zoom out al crecer. */
    exp: 0.45,
    /** Alto visible del espectador (antes de entrar o despues de morir). */
    spectatorHeight: 1700,
    /** Proporcion ancho/alto aceptada del cliente (se clampea). */
    minAspect: 0.4,
    maxAspect: 2.6,
    /** Margen del culling sobre lo visible, para que nada aparezca de golpe en el borde. */
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
    fallback: "Celula",
  },

  bots: {
    /** Interruptor general de bots (pisa `bots` de cada modo). */
    enabled: true,
    /** Los bots piensan cada N pasos (40 / 4 = 10 Hz): sobra para su nivel. */
    thinkEvery: 4,
    respawnMs: 2500,
    names: [
      "Bacilo", "Ameba", "Paramecio", "Moho", "Fermento", "Levadura", "Espora", "Coco",
      "Vibrio", "Plancton", "Hongo", "Alga", "Euglena", "Rotifero", "Diatomea", "Liquen",
    ],
  },
};

export type ArenaKind = AgArenaKind;

export function modeConfig(kind: ArenaKind): ModeConfig {
  return kind === "public" ? AGAR_CONFIG.public : AGAR_CONFIG.room;
}

export function clientConfig(kind: ArenaKind): AgClientConfig {
  const mode = modeConfig(kind);
  return {
    kind,
    mapSize: mode.mapSize,
    tickHz: AGAR_CONFIG.sim.tickHz,
    snapshotHz: AGAR_CONFIG.sim.tickHz / AGAR_CONFIG.sim.snapshotEvery,
    startMass: AGAR_CONFIG.cell.startMass,
    radiusK: AGAR_CONFIG.cell.radiusK,
    speedBase: AGAR_CONFIG.cell.speedBase,
    speedExp: AGAR_CONFIG.cell.speedExp,
    pelletRadius: AGAR_CONFIG.pellet.radius,
    viewBase: AGAR_CONFIG.view.baseHeight,
    viewExp: AGAR_CONFIG.view.exp,
    spectatorView: AGAR_CONFIG.view.spectatorHeight,
    winMass: mode.winMass,
    respawn: mode.respawn,
    nameMaxLen: AGAR_CONFIG.names.maxLen,
  };
}

// ---- Formulas (las mismas que reproduce el cliente con los numeros de arriba) ----

export function radiusOf(mass: number): number {
  return AGAR_CONFIG.cell.radiusK * Math.sqrt(mass);
}

export function speedOf(mass: number): number {
  return AGAR_CONFIG.cell.speedBase * Math.pow(mass, -AGAR_CONFIG.cell.speedExp);
}

/** Alto del mundo visible para un jugador con este radio total. */
export function viewHeightOf(radius: number): number {
  const r0 = radiusOf(AGAR_CONFIG.cell.startMass);
  return AGAR_CONFIG.view.baseHeight * Math.pow(Math.max(radius, r0) / r0, AGAR_CONFIG.view.exp);
}
