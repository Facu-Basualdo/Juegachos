/**
 * Contrato de transporte con el game server (namespace `/pong`). Los tipos
 * espejan `server/src/protocol.ts`; por la regla de decoupling del repo no se
 * comparte modulo entre `src/` y `server/`, asi que si cambia el protocolo hay
 * que tocar los dos lados.
 */

export interface PongBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  hits: number;
}

export type PongPhase = "countdown" | "playing" | "over";

export interface PongMatchState {
  /** Lado de ESTE jugador: "p1" = paleta izquierda, "p2" = paleta derecha. */
  side: "p1" | "p2";
  /** Reloj de la simulacion del server (ms) al que corresponde este estado; avanza
   *  de a pasos fijos. Es la linea de tiempo de la interpolacion (ver `pushSnap`).
   *  OPCIONAL solo por compatibilidad con un server viejo todavia no redeployado:
   *  si falta, el cliente cae a la hora de llegada del paquete (peor, tiembla). */
  t?: number;
  phase: PongPhase;
  ball: PongBall;
  p1Y: number;
  p2Y: number;
  p1Score: number;
  p2Score: number;
  /** El rival de ESTE jugador es la IA del server (impar sin pareja o ausente). */
  vsAi: boolean;
}

export interface PongTransport {
  onState(cb: (state: PongMatchState) => void): void;
  /** Manda la Y de la paleta propia (coord de vista). */
  sendPaddle(y: number): void;
  dispose(): void;
}
