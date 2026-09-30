/**
 * Mensajes del namespace `/lobby` del game server. Copia de los tipos `Lb*` de
 * `server/src/protocol.ts` (regla de decoupling: `src/` y `server/` no comparten
 * modulos). Si cambia el protocolo, tocar los dos lados.
 */

export interface LbPos {
  /** Nickname del emisor (lo pone el server). */
  p: string;
  x: number;
  y: number;
  z: number;
  /** Hacia donde mira (radianes, alrededor de Y). */
  r: number;
  /** Bits: 1 = apoyado, 2 = caminando. */
  f: number;
}

export interface LbPlayer extends LbPos {
  look: number;
}

/** Record de la torre de la sala: quien tiene la corona y en cuanto subio. */
export interface LbCrown {
  p: string;
  ms: number;
}
