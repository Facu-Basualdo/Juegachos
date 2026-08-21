-- Esquema de las salas multijugador (party rooms) de los MiniGames.
-- Ejecutar una vez en el SQL Editor del proyecto Supabase (ademas de schema.sql).
-- Este archivo es solo para setup/reproducibilidad; el build no lo usa.
--
-- Modelo de confianza: igual que public.scores, todo se lee y escribe desde el
-- cliente con la anon key. Un usuario tecnico puede falsear salas o puntajes;
-- aceptable para minijuegos entre amigos. El "host" de una sala es autoritativo
-- por convencion del cliente, no por enforcement de la DB.

-- Una fila por sala. Solo el host la actualiza (por convencion).
create table if not exists public.rooms (
  code          text primary key,                 -- 6 chars, alfabeto A-Z2-9 sin ambiguos (sin O/0/I/1)
  host          text not null,                    -- nickname del anfitrion
  status        text not null default 'lobby',    -- lobby|briefing|playing|results|voting|finished ('time_voting' quedo como legacy)
  settings      jsonb not null default '{}',      -- { totalRounds, playlist: string[]|null }
  visibility    text not null default 'public',   -- public = listada en /rooms/; private = solo por codigo/link
  last_active   timestamptz not null default now(), -- heartbeat de los clientes; las salas frias se purgan
  current_round int  not null default 0,
  current_game  text,
  vote_options  text[],                           -- candidatos durante 'voting' (ids de juego)
  deadline      timestamptz,                      -- fin aproximado de la ronda o votacion en curso
  created_at    timestamptz not null default now(),
  constraint code_format check (code ~ '^[A-Z2-9]{6}$'),
  constraint host_len    check (char_length(host) between 1 and 12),
  constraint status_ok   check (status in ('lobby','briefing','playing','results','voting','time_voting','finished')),
  constraint visibility_ok check (visibility in ('public','private'))
);

-- Migracion idempotente del CHECK de status para salas ya creadas (agrega
-- 'briefing'). create table ... if not exists no toca tablas existentes.
-- 'time_voting' sigue permitido aunque el cliente ya no lo escriba: sacarlo del
-- CHECK haria fallar el ALTER si alguna sala vieja quedo parada en ese estado.
alter table public.rooms drop constraint if exists status_ok;
alter table public.rooms add constraint status_ok
  check (status in ('lobby','briefing','playing','results','voting','time_voting','finished'));

-- Migracion idempotente de las salas publicas / privadas y del heartbeat.
alter table public.rooms add column if not exists visibility text not null default 'public';
alter table public.rooms add column if not exists last_active timestamptz not null default now();
alter table public.rooms drop constraint if exists visibility_ok;
alter table public.rooms add constraint visibility_ok check (visibility in ('public','private'));

-- Listado de salas publicas abiertas: filtra por visibility + status y ordena
-- por actividad, asi que este es el indice que sirve a fetchPublicRooms.
create index if not exists rooms_public_open_idx
  on public.rooms (visibility, status, last_active desc);

-- Jugadores registrados en cada sala. El upsert sobre la PK es el rejoin.
create table if not exists public.room_players (
  code      text not null references public.rooms(code) on delete cascade,
  player    text not null,
  joined_at timestamptz not null default now(),
  primary key (code, player),
  constraint player_len check (char_length(player) between 1 and 12)
);

-- Historial de rondas: que juego salio en cada ronda. Necesario para recomputar
-- puntos (cada juego tiene su direction) y para excluir juegos ya jugados del
-- pool de votacion.
create table if not exists public.room_rounds (
  code     text not null references public.rooms(code) on delete cascade,
  round_no int  not null,
  game_id  text not null,
  primary key (code, round_no)
);

-- Puntaje de cada jugador en cada ronda. finished=false marca un parcial
-- reportado al vencer el tope de tiempo (no comparable en juegos "lower").
create table if not exists public.room_round_scores (
  code       text not null references public.rooms(code) on delete cascade,
  round_no   int  not null,
  player     text not null,
  score      double precision not null,
  finished   boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (code, round_no, player),
  constraint player_len check (char_length(player) between 1 and 12),
  constraint score_sane check (score = score and score >= 0 and score < 1e9)
);

-- Voto de cada jugador para el juego de la ronda round_no (la proxima a jugar).
create table if not exists public.room_votes (
  code     text not null references public.rooms(code) on delete cascade,
  round_no int  not null,
  player   text not null,
  game_id  text not null,
  primary key (code, round_no, player),
  constraint player_len check (char_length(player) between 1 and 12)
);

-- Estado de partida compartido (juegos de tablero comun, p.ej. Memoria): una
-- fila por (sala, ronda, tablero) con el estado completo del juego en jsonb. La
-- columna version implementa concurrencia optimista: cada escritura hace
-- update ... where version = <esperada> e incrementa; si no matchea, el
-- cliente refetchea. Solo escribe el jugador de turno (o el host para
-- destrabar), por convencion del cliente como todo lo demas. La columna board
-- permite varios tableros simultaneos en una misma ronda (Conecta 4 empareja a
-- todos los jugadores en duelos 1v1: un tablero por pareja). Los juegos de un
-- solo tablero (Memoria, Ta-Te-Ti, Topos) usan siempre board = 0.
create table if not exists public.room_match_state (
  code       text not null references public.rooms(code) on delete cascade,
  round_no   int  not null,
  board      int  not null default 0,
  state      jsonb not null,
  version    int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (code, round_no, board)
);

-- Migracion idempotente para salas creadas antes de la columna board: la agrega
-- y reescribe la PK para incluirla (los tableros multiples de Conecta 4).
alter table public.room_match_state add column if not exists board int not null default 0;
alter table public.room_match_state drop constraint if exists room_match_state_pkey;
alter table public.room_match_state add constraint room_match_state_pkey primary key (code, round_no, board);

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_rounds enable row level security;
alter table public.room_round_scores enable row level security;
alter table public.room_votes enable row level security;
alter table public.room_match_state enable row level security;

-- Lectura publica de todo (los codigos de sala son el unico "secreto").
drop policy if exists "rooms_select_public" on public.rooms;
create policy "rooms_select_public" on public.rooms
  for select using (true);

drop policy if exists "room_players_select_public" on public.room_players;
create policy "room_players_select_public" on public.room_players
  for select using (true);

drop policy if exists "room_rounds_select_public" on public.room_rounds;
create policy "room_rounds_select_public" on public.room_rounds
  for select using (true);

drop policy if exists "room_round_scores_select_public" on public.room_round_scores;
create policy "room_round_scores_select_public" on public.room_round_scores
  for select using (true);

drop policy if exists "room_votes_select_public" on public.room_votes;
create policy "room_votes_select_public" on public.room_votes
  for select using (true);

drop policy if exists "room_match_state_select_public" on public.room_match_state;
create policy "room_match_state_select_public" on public.room_match_state
  for select using (true);

-- Escritura anonima con validaciones minimas (los checks de tabla ya cubren
-- formato y rangos). Updates: solo rooms (transiciones del host) y
-- room_round_scores / room_votes (upserts idempotentes del propio jugador).
drop policy if exists "rooms_insert_public" on public.rooms;
create policy "rooms_insert_public" on public.rooms
  for insert with check (true);

drop policy if exists "rooms_update_public" on public.rooms;
create policy "rooms_update_public" on public.rooms
  for update using (true) with check (true);

drop policy if exists "room_players_insert_public" on public.room_players;
create policy "room_players_insert_public" on public.room_players
  for insert with check (true);

drop policy if exists "room_players_update_public" on public.room_players;
create policy "room_players_update_public" on public.room_players
  for update using (true) with check (true);

drop policy if exists "room_rounds_insert_public" on public.room_rounds;
create policy "room_rounds_insert_public" on public.room_rounds
  for insert with check (true);

-- El cliente usa upsert (insert ... on conflict do update) al reintentar.
drop policy if exists "room_rounds_update_public" on public.room_rounds;
create policy "room_rounds_update_public" on public.room_rounds
  for update using (true) with check (true);

drop policy if exists "room_round_scores_insert_public" on public.room_round_scores;
create policy "room_round_scores_insert_public" on public.room_round_scores
  for insert with check (true);

drop policy if exists "room_round_scores_update_public" on public.room_round_scores;
create policy "room_round_scores_update_public" on public.room_round_scores
  for update using (true) with check (true);

drop policy if exists "room_votes_insert_public" on public.room_votes;
create policy "room_votes_insert_public" on public.room_votes
  for insert with check (true);

drop policy if exists "room_votes_update_public" on public.room_votes;
create policy "room_votes_update_public" on public.room_votes
  for update using (true) with check (true);

drop policy if exists "room_match_state_insert_public" on public.room_match_state;
create policy "room_match_state_insert_public" on public.room_match_state
  for insert with check (true);

drop policy if exists "room_match_state_update_public" on public.room_match_state;
create policy "room_match_state_update_public" on public.room_match_state
  for update using (true) with check (true);

-- Expulsar a un jugador (el host borra su fila) y salir de una sala (el propio
-- jugador borra la suya). Sin esta policy el delete de room_players no falla:
-- RLS lo filtra en silencio (0 filas afectadas, sin error), y el expulsado se
-- quedaba en la sala. Es lo que rompia "Expulsar".
drop policy if exists "room_players_delete_public" on public.room_players;
create policy "room_players_delete_public" on public.room_players
  for delete using (true);

-- Borrado de salas: al quedar vacias (ultimo jugador que se va) y en la purga
-- de salas frias (sin heartbeat). El on delete cascade arrastra el resto.
drop policy if exists "rooms_delete_public" on public.rooms;
create policy "rooms_delete_public" on public.rooms
  for delete using (true);

-- "Jugar otra vez": al terminar, el host resetea la sala al lobby borrando el
-- historial de rondas/puntajes/votos (los jugadores registrados se conservan).
drop policy if exists "room_rounds_delete_public" on public.room_rounds;
create policy "room_rounds_delete_public" on public.room_rounds
  for delete using (true);

drop policy if exists "room_round_scores_delete_public" on public.room_round_scores;
create policy "room_round_scores_delete_public" on public.room_round_scores
  for delete using (true);

drop policy if exists "room_votes_delete_public" on public.room_votes;
create policy "room_votes_delete_public" on public.room_votes
  for delete using (true);

drop policy if exists "room_match_state_delete_public" on public.room_match_state;
create policy "room_match_state_delete_public" on public.room_match_state
  for delete using (true);

-- Limpieza de salas muertas. Cada cliente adentro de una sala le hace touch a
-- last_active cada ~15s (touchRoom), y al entrar a /rooms/ se corre purgeStaleRooms(),
-- que borra las salas sin heartbeat reciente (ROOM_STALE_MS). Ademas leaveRoom()
-- borra la sala apenas se va su ultimo jugador. Esto alcanza para que el listado
-- publico no muestre salas fantasma; si algun dia sobra basura se puede forzar:
--   delete from public.rooms where last_active < now() - interval '1 hour';
-- El on delete cascade arrastra players/rounds/scores/votes/match_state.

-- Nota: el "Salon de la fama" (/fame/) NO usa ninguna tabla: es un ranking
-- derivado en vivo de public.scores (ver src/shared/leaders.ts). Si en una
-- iteracion anterior se creo public.champions + increment_champion_wins, ya no
-- se usan y se pueden borrar:  drop function if exists public.increment_champion_wins(text); drop table if exists public.champions;
