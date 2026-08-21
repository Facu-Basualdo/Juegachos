/**
 * Contrato del enlace de sala de Neon Drift, con dos implementaciones
 * intercambiables:
 *
 * - [RaceSocket](RaceSocket.ts): el game server (namespace `/carrace`). Es el
 *   camino por defecto cuando hay `VITE_GAME_SERVER_URL`.
 * - [RaceChannel](RaceChannel.ts): broadcast efimero de Supabase. Es el fallback
 *   cuando no hay game server configurado.
 *
 * **La eleccion es por configuracion, nunca en runtime.** Toda la sala tiene que
 * terminar en el MISMO enlace o los jugadores quedan en carreras separadas sin
 * verse — que es peor que no ver a nadie, porque no se nota. Como la env es la
 * misma para todos los clientes del deploy, decidir por config hace que todos
 * coincidan; caer al otro transporte porque a uno le fallo la conexion romperia
 * justamente eso. Si el game server esta configurado pero caido, no se ven los
 * rivales y la carrera sigue (la votacion cae al `tallyWinner` determinista, que
 * da el mismo circuito en todos los clientes).
 *
 * Los tipos espejan `server/src/protocol.ts` (`CrPos` y compania); por la regla de
 * decoupling del repo no se comparte modulo entre `src/` y `server/`, asi que si
 * cambia el protocolo hay que tocar los dos lados.
 */

/** Snapshot de posicion que cada cliente emite varias veces por segundo. */
export interface RacePayload {
  /** Nickname del emisor. */
  p: string;
  x: number;
  y: number;
  /** Angulo del auto en radianes. */
  a: number;
  /** Vuelta actual (0-based). */
  l: number;
  /** Progreso dentro de la vuelta ∈ [0,1). */
  s: number;
  /** True cuando el emisor ya cruzo la meta final. */
  f: boolean;
}

/** Voto de un jugador por un circuito, antes de largar (fase de votacion). */
export interface VotePayload {
  /** Nickname del emisor. */
  p: string;
  /** Indice del circuito votado. */
  m: number;
}

/** Circuito ganador que anuncia el anfitrion al cerrar la votacion. */
export interface MapPayload {
  /** Indice del circuito elegido. */
  m: number;
}

/** Enlace de sala: posiciones en vivo + votacion de circuito. */
export interface RaceLink {
  send(payload: RacePayload): void;
  sendVote(payload: VotePayload): void;
  sendMap(payload: MapPayload): void;
  onPos(cb: (p: RacePayload) => void): void;
  onVote(cb: (v: VotePayload) => void): void;
  onMap(cb: (m: MapPayload) => void): void;
  dispose(): void;
}
