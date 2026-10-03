/**
 * Contrato con el game server (namespace `/poolnight`, prefijo `bi:`). Espeja los tipos `Bi*`
 * de `server/src/protocol.ts`; por la regla de decoupling no se comparte modulo entre
 * `src/` y `server/`, asi que si cambia el protocolo hay que tocar los dos lados. Toda hora
 * es del reloj del SERVER, en ms.
 */

export type BiPhase = "waiting" | "playing" | "over";
export type BiEndReason = "eight" | "early_eight" | "scratch_eight" | "cap";

export interface BiSeat {
  team: 0 | 1;
  nickname: string | null;
  bot: boolean;
  on: boolean;
}

export interface BiState {
  phase: BiPhase;
  perTeam: 1 | 2 | 4;
  seats: BiSeat[];
  /** 16 bolas aplanadas: [x, z, vivo (0 o 1), ...]. Vacio antes de la largada. */
  balls: number[];
  shooter: number;
  cueInHand: boolean;
  breakShot: boolean;
  groupsLeft: [number, number];
  turnStartAt: number;
  deadline: number;
  capAt: number;
  now: number;
  shots: number;
  winner: 0 | 1 | null;
  endReason: BiEndReason | null;
  places: [number, number] | null;
}

/** [bola, t, x, z, vx, vz, wx, wy, wz, fase]; fase 0 quieta, 1 desliza, 2 rueda, 3 embocada. */
export type BiSegment = [number, number, number, number, number, number, number, number, number, number];

/** [t, tipo, bolaA, bolaB, velocidad, x, z]; tipo 0 taco, 1 bola, 2 banda, 3 tronera. */
export type BiEvent = [number, number, number, number, number, number, number];

export const EV_CUE = 0;
export const EV_BALL = 1;
export const EV_CUSHION = 2;
export const EV_POCKET = 3;

export interface BiPlay {
  id: number;
  seat: number;
  startAt: number;
  dur: number;
  segs: BiSegment[];
  ev: BiEvent[];
  foul: "scratch" | "no_contact" | null;
  own: number[];
  opp: number[];
  eight: boolean;
  respot: boolean;
  continues: boolean;
  next: number;
  hand: boolean;
  ended: { winner: 0 | 1 | null; reason: BiEndReason } | null;
  nextTurnAt: number;
  state: BiState;
}

export type BiRejectReason =
  | "not_your_turn"
  | "too_early"
  | "bad_spot"
  | "cue_not_placed"
  | "not_in_hand"
  | "bad_shot"
  | "not_playing"
  | "ended";

export interface BiInit {
  seat: number;
  state: BiState;
}

export interface BiShot {
  a: number;
  p: number;
  ox: number;
  oy: number;
  x?: number;
  z?: number;
}
