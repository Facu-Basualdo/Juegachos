/**
 * Contrato de transporte con el game server (namespace `/imitame`). Los tipos
 * espejan `server/src/protocol.ts`; por la regla de decoupling del repo no se
 * comparte modulo entre `src/` y `server/`, asi que si cambia el protocolo hay
 * que tocar los dos lados.
 */

export type MtPhase =
  | "waiting"
  | "intro"
  | "listen"
  | "ready"
  | "record"
  | "upload"
  | "playback"
  | "wheel"
  | "over";

export type EffectId =
  | "doble"
  | "mas"
  | "eco"
  | "saturado"
  | "helio"
  | "cortado"
  | "pedo"
  | "salvado";

export interface MtPlayerView {
  nickname: string;
  connected: boolean;
  total: number;
  /** Ya mando su toma en esta ronda. */
  submitted: boolean;
  /** Lo que le toco en la ruleta anterior: pesa sobre su toma de ESTA ronda. */
  effect: EffectId | null;
}

export interface MtResult {
  nickname: string;
  hasTake: boolean;
  /** Puntaje crudo 0-100 que calculo el cliente (melodia + ritmo + golpes). */
  raw: number;
  mult: number;
  points: number;
  attacks: number;
  rhythm: number;
  melody: number;
}

export interface MtWheel {
  outcome: EffectId;
  target: string;
  /** 0..1: en que punto de la porcion frena la ruleta (igual en todas las pantallas). */
  jitter: number;
}

export interface MtState {
  phase: MtPhase;
  round: number;
  totalRounds: number;
  soundId: string | null;
  clockMs: number | null;
  clockTotalMs: number | null;
  players: MtPlayerView[];
  /** playback: orden en que suenan las tomas. */
  playOrder: string[] | null;
  playIndex: number;
  /** playback: resultados hasta `playIndex` inclusive; wheel: todos. */
  results: MtResult[] | null;
  wheel: MtWheel | null;
}

export interface MtTake {
  round: number;
  nickname: string;
  rate: number;
  audio: ArrayBuffer;
}

export interface MtTakeUpload {
  round: number;
  rate: number;
  /** Toma en mu-law (1 byte por muestra). null = no pudo grabar (sin micro). */
  audio: ArrayBuffer | null;
  raw: number;
  attacks: number;
  rhythm: number;
  melody: number;
}

export interface MtGameover {
  ranking: { nickname: string; place: number; total: number }[];
}
