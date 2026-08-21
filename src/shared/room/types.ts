/** Estado de una sala a lo largo de su vida. */
export type RoomStatus =
  | "lobby"
  | "briefing"
  | "playing"
  | "results"
  | "voting"
  | "finished";

/**
 * Visibilidad de la sala. Las publicas se listan en /rooms/ y cualquiera puede
 * entrar; a las privadas se entra solo con el codigo o el link.
 */
export type RoomVisibility = "public" | "private";

/** Ajustes elegidos por el host al crear la sala. */
export interface RoomSettings {
  /** Cantidad total de rondas (si hay playlist, es playlist.length). */
  totalRounds: number;
  /** Lista explicita de juegos en orden, o null para votar despues de cada ronda. */
  playlist: string[] | null;
}

/** Fila de public.rooms tal como la devuelve Supabase. */
export interface RoomRow {
  code: string;
  host: string;
  status: RoomStatus;
  settings: RoomSettings;
  /** Opcional por compatibilidad con salas creadas antes de la columna. */
  visibility?: RoomVisibility;
  /** timestamptz ISO del ultimo heartbeat de algun cliente de la sala. */
  last_active?: string;
  current_round: number;
  current_game: string | null;
  vote_options: string[] | null;
  /** timestamptz ISO del fin aproximado de la ronda o votacion en curso. */
  deadline: string | null;
  created_at: string;
}

/** Fila del listado de salas publicas abiertas que muestra /rooms/. */
export interface PublicRoom {
  code: string;
  host: string;
  /** Jugadores registrados (room_players), no presencia del canal. */
  players: number;
  settings: RoomSettings;
}

/** Fila de public.room_rounds: que juego salio en cada ronda. */
export interface RoundRow {
  round_no: number;
  game_id: string;
}

/** Fila de public.room_round_scores. */
export interface RoundScoreRow {
  round_no: number;
  player: string;
  score: number;
  /** false = parcial reportado al vencer el tope de tiempo. */
  finished: boolean;
}

/** Fila de public.room_votes. */
export interface VoteRow {
  round_no: number;
  player: string;
  game_id: string;
}

/** Snapshot completo del estado durable de una sala. */
export interface RoomState {
  room: RoomRow;
  /** Nicknames registrados en la sala (room_players). */
  players: string[];
  rounds: RoundRow[];
  scores: RoundScoreRow[];
  votes: VoteRow[];
}

/**
 * "Sin tope de tiempo" para una ronda. Es el valor por defecto de toda la sala:
 * el tope ya no es un ajuste del anfitrion, sino una propiedad de cada juego
 * (`roomTimeLimitSec` en su `meta.ts`). Un juego que no lo declara se juega sin
 * reloj y la ronda cierra cuando todos terminan su partida.
 */
export const NO_TIME_LIMIT = 0;

/** Etiqueta legible del tope de tiempo de una ronda (o "Sin límite" si es 0). */
export function formatRoundTimeLimit(sec: number): string {
  if (sec === NO_TIME_LIMIT) return "Sin límite";
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  if (min === 0) return `${rest} s`;
  return rest === 0 ? `${min} min` : `${min}:${String(rest).padStart(2, "0")} min`;
}
export const DEFAULT_TOTAL_ROUNDS = 5;

/**
 * Cuantos juegos dura una partida de sala. El tope alto es holgado a proposito:
 * la playlist no puede pasarse del roster (la grilla se bloquea en el tope), y
 * sin playlist `pickVoteOptions` sortea con repeticion, asi que ninguna ronda
 * puede quedarse sin candidatos.
 */
export const TOTAL_ROUNDS_OPTIONS = [3, 5, 7, 10, 15, 20] as const;

/** Tope de jugadores por sala. Se rechaza a los jugadores nuevos al llegar a
 * este numero; los ya registrados siempre pueden reingresar (rejoin). */
export const MAX_ROOM_PLAYERS = 8;

/** Cada cuanto un cliente adentro de una sala le hace touch a last_active. */
export const HEARTBEAT_MS = 15_000;

/**
 * Una sala sin heartbeat por mas de esto se considera muerta: no se lista y la
 * purga la borra. Holgado respecto de HEARTBEAT_MS para tolerar pestanas
 * dormidas, navegacion entre juegos y round-trips lentos.
 */
export const ROOM_STALE_MS = 60_000;
