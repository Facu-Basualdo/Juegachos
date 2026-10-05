import { getSupabase } from "../supabase";
import {
  ROOM_STALE_MS,
  type PublicRoom,
  type RoomRow,
  type RoomSettings,
  type RoomState,
  type RoomVisibility,
  type RoundRow,
  type RoundScoreRow,
  type VoteRow,
} from "./types";

/**
 * CRUD fino sobre las tablas de salas. Mismo patron que leaderboard.ts: todo
 * es no-op / null si no hay credenciales Supabase, y los errores se loguean y
 * degradan (el caller decide que mostrar).
 *
 * Convencion de autoridad (no enforzada por la DB): solo el host llama a las
 * mutaciones de fase (startRound / closeRound / openVote / finishRoom); cada
 * jugador escribe solo sus propias filas (su score, su voto).
 */

/** Alfabeto sin caracteres ambiguos (sin O/0, sin I/1). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const CODE_PATTERN = /^[A-Z2-9]{6}$/;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Normaliza un codigo tipeado por el usuario (may/min, espacios). */
export function sanitizeCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

function warn(action: string, message: string): void {
  console.warn(`[rooms] ${action}: ${message}`);
}

/** 42703 = undefined_column: la DB todavia no corrio supabase/rooms.sql. */
const UNDEFINED_COLUMN = "42703";

/**
 * True cuando la DB no tiene las columnas visibility / last_active. Lo detecta
 * la primera query que las toca; a partir de ahi las features de salas publicas
 * se apagan solas en vez de errorear en cada llamada.
 */
let legacySchema = false;

/** Enciende el modo legacy avisando una sola vez que falta correr la migracion. */
function markLegacySchema(): void {
  if (legacySchema) return;
  legacySchema = true;
  warn(
    "schema",
    "faltan las columnas visibility/last_active en public.rooms: corre supabase/rooms.sql " +
      "en el SQL Editor. Las salas funcionan igual, pero sin listado de salas publicas, " +
      "sin purga automatica y sin poder expulsar jugadores.",
  );
}

/**
 * Crea la sala y registra al host como jugador. Reintenta ante colision de
 * codigo (PK). Devuelve el codigo, o null si fallo / no hay Supabase.
 *
 * Si la DB no tiene todavia las columnas de salas publicas (no se corrio
 * supabase/rooms.sql), la sala se crea igual sin ellas: sin listado publico ni
 * purga, pero jugable. Crear una sala nunca deberia depender de una migracion
 * pendiente, igual que el resto de los juegos no depende del leaderboard.
 */
export async function createRoom(
  host: string,
  settings: RoomSettings,
  visibility: RoomVisibility = "public",
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomCode();
    const row: Record<string, unknown> = { code, host, settings };
    if (!legacySchema) {
      row.visibility = visibility;
      row.last_active = new Date().toISOString();
    }
    const { error } = await supabase.from("rooms").insert(row);
    if (!error) {
      await supabase.from("room_players").upsert({ code, player: host });
      return code;
    }
    // 23505 = unique_violation (codigo ya usado): probar con otro.
    if (error.code === "23505") continue;
    if (error.code === UNDEFINED_COLUMN && !legacySchema) {
      markLegacySchema();
      attempt--; // el reintento sin columnas no gasta un intento de codigo
      continue;
    }
    warn("createRoom", error.message);
    return null;
  }
  warn("createRoom", "no se pudo generar un codigo libre");
  return null;
}

// ---------- Salas publicas: listado, heartbeat y limpieza ----------

/**
 * Salas publicas a las que se puede entrar ahora mismo: visibles, en el lobby,
 * con al menos un jugador y con heartbeat reciente (las frias son fantasmas de
 * pestanas cerradas; purgeStaleRooms las borra). Las llenas se devuelven igual
 * para poder mostrarlas como tales; el caller decide.
 */
export async function fetchPublicRooms(): Promise<PublicRoom[]> {
  const supabase = getSupabase();
  if (!supabase || legacySchema) return [];

  const cutoff = new Date(Date.now() - ROOM_STALE_MS).toISOString();
  const { data, error } = await supabase
    .from("rooms")
    .select("code, host, settings")
    .eq("visibility", "public")
    .eq("status", "lobby")
    .gt("last_active", cutoff)
    .order("last_active", { ascending: false })
    .limit(30);
  if (error) {
    if (error.code === UNDEFINED_COLUMN) markLegacySchema();
    else warn("fetchPublicRooms", error.message);
    return [];
  }
  const rooms = (data ?? []) as { code: string; host: string; settings: RoomSettings }[];
  if (rooms.length === 0) return [];

  // Conteo de jugadores en una sola query (no hay group by en PostgREST: se
  // traen las filas de esas salas y se cuentan aca; son <= 8 por sala).
  const { data: playerRows, error: playersError } = await supabase
    .from("room_players")
    .select("code")
    .in(
      "code",
      rooms.map((r) => r.code),
    );
  if (playersError) {
    warn("fetchPublicRooms", playersError.message);
    return [];
  }
  const counts = new Map<string, number>();
  for (const row of (playerRows ?? []) as { code: string }[]) {
    counts.set(row.code, (counts.get(row.code) ?? 0) + 1);
  }

  return rooms
    .map((r) => ({ code: r.code, host: r.host, settings: r.settings, players: counts.get(r.code) ?? 0 }))
    .filter((r) => r.players > 0);
}

/** Marca la sala como viva. La llaman los clientes adentro, cada HEARTBEAT_MS. */
export async function touchRoom(code: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || legacySchema) return;
  const { error } = await supabase
    .from("rooms")
    .update({ last_active: new Date().toISOString() })
    .eq("code", code);
  if (!error) return;
  // Sin la columna no hay heartbeat: se apaga en vez de latir contra la pared.
  if (error.code === UNDEFINED_COLUMN) markLegacySchema();
  else warn("touchRoom", error.message);
}

/** Cambia la visibilidad de la sala (solo el host, por convencion). */
export async function setVisibility(code: string, visibility: RoomVisibility): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase || legacySchema) return false;
  const { error } = await supabase.from("rooms").update({ visibility }).eq("code", code);
  if (error) {
    if (error.code === UNDEFINED_COLUMN) markLegacySchema();
    else warn("setVisibility", error.message);
    return false;
  }
  return true;
}

/** Borra la sala entera (cascade a jugadores/rondas/puntajes/votos/tableros). */
export async function deleteRoom(code: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("rooms").delete().eq("code", code);
  if (error) {
    warn("deleteRoom", error.message);
    return false;
  }
  return true;
}

/**
 * Borra las salas sin heartbeat reciente (todos sus clientes se fueron sin
 * avisar: pestana cerrada, browser muerto). Se corre al abrir /rooms/: es
 * barato, no necesita cron y mantiene limpio el listado publico.
 */
export async function purgeStaleRooms(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || legacySchema) return;
  const cutoff = new Date(Date.now() - ROOM_STALE_MS).toISOString();
  const { error } = await supabase.from("rooms").delete().lt("last_active", cutoff);
  if (!error) return;
  if (error.code === UNDEFINED_COLUMN) markLegacySchema();
  else warn("purgeStaleRooms", error.message);
}

/**
 * El jugador se va de la sala: borra su fila de room_players (y lo suyo de la
 * partida). Si era el ultimo, la sala se borra; si era el host y quedan otros,
 * el host pasa al que sigue (por joined_at) para no dejarla sin autoridad.
 */
export async function leaveRoom(code: string, player: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await removePlayerRows(supabase, code, player);

  const { data, error } = await supabase
    .from("room_players")
    .select("player")
    .eq("code", code)
    .order("joined_at");
  if (error) {
    warn("leaveRoom", error.message);
    return;
  }
  const rest = ((data ?? []) as { player: string }[]).map((r) => r.player);
  if (rest.length === 0) {
    await deleteRoom(code);
    return;
  }
  // Si se fue el host, el mas antiguo de los que quedan toma la sala.
  const { data: room } = await supabase.from("rooms").select("host").eq("code", code).maybeSingle();
  if (room && (room as { host: string }).host === player) {
    await takeOverHost(code, rest[0]);
  }
}

export type JoinResult = "ok" | "not-found" | "finished" | "spectator" | "error";

/** Devuelve true si el jugador ya esta registrado (room_players) en la sala. */
async function isRegistered(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  code: string,
  player: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("room_players")
    .select("player")
    .eq("code", code)
    .eq("player", player)
    .maybeSingle();
  return !!data;
}

/**
 * Une (o re-une: upsert sobre la PK) a un jugador a la sala. La validacion de
 * "nick ya conectado" es del lobby via presence, no de aca.
 *
 * Un jugador nuevo (no registrado) solo puede sumarse mientras la sala esta en
 * el lobby: si la partida ya arranco entra como espectador (no se registra en
 * room_players para no frenar el cierre de rondas ni contar en los puntajes),
 * y si ya termino se lo rechaza. Los ya registrados siempre reingresan.
 */
export async function joinRoom(code: string, player: string): Promise<JoinResult> {
  const supabase = getSupabase();
  if (!supabase) return "error";

  const { data, error } = await supabase
    .from("rooms")
    .select("status")
    .eq("code", code)
    .maybeSingle();
  if (error) {
    warn("joinRoom", error.message);
    return "error";
  }
  if (!data) return "not-found";
  if (data.status !== "lobby" && !(await isRegistered(supabase, code, player))) {
    // Sala terminada pero viva ("Jugar otra vez"): los nuevos esperan a que
    // vuelva al lobby. Sala en juego: los nuevos entran como espectadores.
    return data.status === "finished" ? "finished" : "spectator";
  }

  const { error: joinError } = await supabase.from("room_players").upsert({ code, player });
  if (joinError) {
    warn("joinRoom", joinError.message);
    return "error";
  }
  return "ok";
}

/**
 * True cuando la DB no tiene la RPC `room_state` (falta correr supabase/rooms.sql).
 * Se detecta en la primera llamada y desde ahi se lee con los 5 selects de siempre.
 */
let roomStateRpcMissing = false;

/** PGRST202 = la funcion RPC no existe. */
const MISSING_FUNCTION = "PGRST202";

/**
 * Snapshot completo del estado durable de la sala. Va por la RPC `room_state`: una
 * sola llamada (y un snapshot consistente) en vez de 5 selects. Sin la migracion
 * cae a los selects en paralelo, con el mismo resultado.
 */
export async function fetchRoomState(code: string): Promise<RoomState | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  if (!roomStateRpcMissing) {
    const { data, error } = await supabase.rpc("room_state", { p_code: code });
    if (!error) {
      if (!data) return null;
      const s = data as RoomState;
      return {
        room: s.room,
        players: s.players ?? [],
        rounds: s.rounds ?? [],
        scores: s.scores ?? [],
        votes: s.votes ?? [],
      };
    }
    if (error.code !== MISSING_FUNCTION) {
      warn("fetchRoomState", error.message);
      return null;
    }
    roomStateRpcMissing = true;
    warn(
      "schema",
      "falta la funcion public.room_state: corre supabase/rooms.sql en el SQL Editor. " +
        "Las salas andan igual, con 5 consultas por relectura en vez de una.",
    );
  }

  const [roomRes, playersRes, roundsRes, scoresRes, votesRes] = await Promise.all([
    supabase.from("rooms").select("*").eq("code", code).maybeSingle(),
    supabase
      .from("room_players")
      .select("player, joined_at")
      .eq("code", code)
      .order("joined_at")
      .order("player"),
    supabase.from("room_rounds").select("round_no, game_id").eq("code", code).order("round_no"),
    supabase.from("room_round_scores").select("round_no, player, score, finished").eq("code", code),
    supabase.from("room_votes").select("round_no, player, game_id").eq("code", code),
  ]);

  const failed = [roomRes, playersRes, roundsRes, scoresRes, votesRes].find((r) => r.error);
  if (failed?.error) {
    warn("fetchRoomState", failed.error.message);
    return null;
  }
  if (!roomRes.data) return null;

  return {
    room: roomRes.data as RoomRow,
    players: ((playersRes.data ?? []) as { player: string }[]).map((r) => r.player),
    rounds: (roundsRes.data ?? []) as RoundRow[],
    scores: (scoresRes.data ?? []) as RoundScoreRow[],
    votes: (votesRes.data ?? []) as VoteRow[],
  };
}

/**
 * Reporta el puntaje del jugador en una ronda. Upsert idempotente: ante la
 * carrera muerte-vs-timeout el primer reporte del cliente gana (el caller
 * guarda un flag local y no vuelve a llamar).
 */
export async function reportScore(
  code: string,
  roundNo: number,
  player: string,
  score: number,
  finished: boolean,
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!Number.isFinite(score)) return false;

  const safeScore = Math.max(0, Math.min(score, 1e9 - 1));
  const { error } = await supabase
    .from("room_round_scores")
    .upsert({ code, round_no: roundNo, player, score: safeScore, finished });
  if (error) {
    warn("reportScore", error.message);
    return false;
  }
  return true;
}

/** Voto del jugador para el juego de la ronda roundNo (la proxima a jugar). */
export async function castVote(
  code: string,
  roundNo: number,
  player: string,
  gameId: string,
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from("room_votes")
    .upsert({ code, round_no: roundNo, player, game_id: gameId });
  if (error) {
    warn("castVote", error.message);
    return false;
  }
  return true;
}

// ---------- Mutaciones de host ----------
//
// Las que cambian la fila de la sala devuelven esa fila tal como quedo (o null si
// fallo): pedirla con `.select()` no cuesta otra ida y vuelta, y el que escribio la
// manda en el ping, asi los demas aplican la transicion sin tener que releer la DB
// primero (ver RoomChannel.ping). Un `if (ok)` sobre el resultado sigue valiendo.

type RoomPatch = Partial<
  Pick<RoomRow, "status" | "host" | "current_round" | "current_game" | "vote_options" | "deadline">
>;

async function updateRoom(code: string, patch: RoomPatch, action: string): Promise<RoomRow | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from("rooms").update(patch).eq("code", code).select().maybeSingle();
  if (error) {
    warn(action, error.message);
    return null;
  }
  if (!data) {
    warn(action, "la sala no existe");
    return null;
  }
  return data as RoomRow;
}

/**
 * Abre el briefing previo a una ronda: fija el juego y pasa a 'briefing' con un
 * deadline corto (tope de lectura). Ahi cada jugador lee de que va el juego y sus
 * controles, y marca "Listo" (una fila en room_votes con game_id='ready'). El
 * host cierra la fase al vencer el tope o cuando todos los presentes estan listos,
 * y recien entonces arranca a jugar (o abre la votacion de tiempo si esta activa).
 */
export async function startBriefing(
  code: string,
  roundNo: number,
  gameId: string,
  deadline: Date,
): Promise<RoomRow | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { error: roundError } = await supabase
    .from("room_rounds")
    .upsert({ code, round_no: roundNo, game_id: gameId });
  if (roundError) {
    warn("startBriefing", roundError.message);
    return null;
  }

  return updateRoom(
    code,
    {
      status: "briefing",
      current_round: roundNo,
      current_game: gameId,
      vote_options: null,
      deadline: deadline.toISOString(),
    },
    "startBriefing",
  );
}

/**
 * Arranca la ronda roundNo con el juego dado y su deadline (null = sin tope). La fila
 * de room_rounds ya la escribio el briefing de esa ronda (o `startRoundNow`, en La
 * Feria): no se reescribe (era una ida y vuelta mas en la transicion que mas se
 * siente, la que larga la partida).
 */
export async function startRound(
  code: string,
  roundNo: number,
  gameId: string,
  deadline: Date | null,
): Promise<RoomRow | null> {
  return updateRoom(
    code,
    {
      status: "playing",
      current_round: roundNo,
      current_game: gameId,
      vote_options: null,
      deadline: deadline ? deadline.toISOString() : null,
    },
    "startRound",
  );
}

/**
 * Adelanta (o cambia) el deadline de la ronda o votacion en curso. Se usa para
 * comprimir la votacion del proximo juego a pocos segundos cuando ya votaron
 * todos los presentes: no tiene sentido esperar el tope completo.
 */
export async function updateDeadline(code: string, deadline: Date | null): Promise<RoomRow | null> {
  return updateRoom(code, { deadline: deadline ? deadline.toISOString() : null }, "updateDeadline");
}

/**
 * Arranca la ronda roundNo directo, sin briefing (La Feria: al vencer la votacion se
 * va derecho al juego). Registra el juego de la ronda, que en el camino comun lo
 * escribe el briefing.
 */
export async function startRoundNow(
  code: string,
  roundNo: number,
  gameId: string,
  deadline: Date | null,
): Promise<RoomRow | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { error } = await supabase.from("room_rounds").upsert({ code, round_no: roundNo, game_id: gameId });
  if (error) {
    warn("startRoundNow", error.message);
    return null;
  }
  return startRound(code, roundNo, gameId, deadline);
}

/**
 * Cierra la ronda en curso: pasa a la fase de resultados. Cuando reportaron todos,
 * normalmente ya la cerro la DB (trigger `room_close_when_all_reported`); el host
 * llega aca por el tope de tiempo o porque solo faltan desconectados.
 */
export async function closeRound(code: string): Promise<RoomRow | null> {
  return updateRoom(code, { status: "results", deadline: null }, "closeRound");
}

/** Abre la votacion del proximo juego con los candidatos dados. */
export async function openVote(
  code: string,
  options: string[],
  deadline: Date,
): Promise<RoomRow | null> {
  return updateRoom(
    code,
    { status: "voting", vote_options: options, deadline: deadline.toISOString() },
    "openVote",
  );
}

/**
 * Reroll de La Feria: afiches nuevos para la misma votacion, sin votos y con la cuenta
 * de nuevo. Primero se borran los votos: si fuera al reves, un voto a un afiche nuevo
 * emitido en el medio se borraria.
 */
export async function rerollVote(
  code: string,
  voteRound: number,
  options: string[],
  deadline: Date,
): Promise<RoomRow | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { error } = await supabase.from("room_votes").delete().eq("code", code).eq("round_no", voteRound);
  if (error) {
    warn("rerollVote", error.message);
    return null;
  }
  return updateRoom(code, { vote_options: options, deadline: deadline.toISOString() }, "rerollVote");
}

/** Termina la sala: tablero final. */
export async function finishRoom(code: string): Promise<RoomRow | null> {
  return updateRoom(code, { status: "finished", deadline: null, vote_options: null }, "finishRoom");
}

/**
 * Cambia los ajustes de la sala en el lobby (solo el host, por convencion).
 * Permite elegir otros juegos / rondas / tiempo antes de cada partida,
 * incluida la revancha tras "Jugar otra vez".
 */
export async function updateSettings(code: string, settings: RoomSettings): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("rooms").update({ settings }).eq("code", code);
  if (error) {
    warn("updateSettings", error.message);
    return false;
  }
  return true;
}

/**
 * "Jugar otra vez": vuelve la sala al lobby con los mismos jugadores y ajustes,
 * borrando el historial de rondas/puntajes/votos para que los totales arranquen
 * de cero. Todos los clientes vuelven a /rooms/ al ver status='lobby'.
 */
export async function resetRoom(code: string): Promise<RoomRow | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const deletes = await Promise.all([
    supabase.from("room_rounds").delete().eq("code", code),
    supabase.from("room_round_scores").delete().eq("code", code),
    supabase.from("room_votes").delete().eq("code", code),
    supabase.from("room_match_state").delete().eq("code", code),
  ]);
  const failed = deletes.find((r) => r.error);
  if (failed?.error) {
    warn("resetRoom", failed.error.message);
    return null;
  }

  return updateRoom(
    code,
    {
      status: "lobby",
      current_round: 0,
      current_game: null,
      vote_options: null,
      deadline: null,
    },
    "resetRoom",
  );
}

/**
 * Saca todas las filas de un jugador en una sala: su registro y lo que aporto a
 * la partida en curso (puntajes y votos), para que no cuente en los tableros.
 *
 * Devuelve si la fila de room_players realmente desaparecio. El `select()` no es
 * decorativo: sin la policy de delete, RLS filtra el borrado en silencio (0 filas,
 * sin error) y el jugador seguia en la sala. Pedir las filas borradas convierte
 * ese caso en un false en vez de un exito falso.
 */
async function removePlayerRows(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  code: string,
  player: string,
): Promise<boolean> {
  const [playerRes, scoresRes, votesRes] = await Promise.all([
    supabase.from("room_players").delete().eq("code", code).eq("player", player).select("player"),
    supabase.from("room_round_scores").delete().eq("code", code).eq("player", player),
    supabase.from("room_votes").delete().eq("code", code).eq("player", player),
  ]);
  const failed = [playerRes, scoresRes, votesRes].find((r) => r.error);
  if (failed?.error) {
    warn("removePlayerRows", failed.error.message);
    return false;
  }
  return (playerRes.data ?? []).length > 0;
}

/**
 * El anfitrion expulsa a un jugador. El expulsado lo detecta al refrescar (ya no
 * esta en state.players) y sale. Devuelve false si la fila no se borro (p.ej. la
 * policy room_players_delete_public no esta aplicada en la DB), asi la UI puede
 * avisar en vez de simular que lo echo.
 */
export async function kickPlayer(code: string, player: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  return removePlayerRows(supabase, code, player);
}

/** Migracion de host: cualquier jugador toma el control si el host se fue. */
export async function takeOverHost(code: string, player: string): Promise<RoomRow | null> {
  return updateRoom(code, { host: player }, "takeOverHost");
}
