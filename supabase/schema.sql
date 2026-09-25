-- Esquema de la base de datos para el ranking global de los MiniGames.
-- Ejecutar una vez en el SQL Editor del proyecto Supabase.
-- Este archivo es solo para setup/reproducibilidad; el build no lo usa.

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  game_id    text             not null,
  variant    text             not null default '',   -- p.ej. tamano de sliding-puzzle ("3"/"4"/"5")
  player     text             not null,
  score      double precision not null,               -- double: sirve para enteros y para reaction-time (ms)
  created_at timestamptz      not null default now(),
  constraint player_len   check (char_length(player) between 1 and 12),
  constraint score_finite check (score = score)        -- descarta NaN
);

create index if not exists scores_board_idx on public.scores (game_id, variant, score);

alter table public.scores enable row level security;

-- Lectura publica del ranking.
drop policy if exists "scores_select_public" on public.scores;
create policy "scores_select_public" on public.scores
  for select using (true);

-- Insercion anonima con validaciones minimas (anti-basura, no anti-cheat real).
-- Nota: al insertar desde el cliente con la anon key, un usuario tecnico puede
-- falsear puntajes. Es aceptable para minijuegos; si algun dia importa, mover el
-- insert a una funcion serverless que valide.
drop policy if exists "scores_insert_public" on public.scores;
create policy "scores_insert_public" on public.scores
  for insert with check (
    char_length(player) between 1 and 12
    and score >= 0 and score < 1e9
  );

-- ---------------------------------------------------------------------------
-- Historial de partidas + rankings mensuales.
--
-- `scores` dejo de guardar solo los puntajes que entraban al Top 10: ahora es el
-- HISTORIAL de partidas terminadas (una fila por partida de cada jugador con
-- nombre, jugada solo o en sala). Los rankings se derivan de ahi:
--   * mejor puntaje de cada jugador (una fila por jugador, no diez del mismo),
--   * historico o desde el 1ro del mes (hora Argentina, lo calcula el cliente),
--   * o cantidad de victorias en sala para los juegos solo-sala de puntaje por
--     puesto (Bomba Palabra, Basta, Impostor, ...).
--
-- Columnas nuevas (todas con default, asi las filas viejas quedan como "solo"):
--   source  'solo' | 'room'
--   place   puesto final en la partida de sala (1 = gano); null en solo
--   players cuantos jugadores compitieron en esa partida; null en solo
-- Idempotente: se puede volver a correr.
-- ---------------------------------------------------------------------------

alter table public.scores add column if not exists source  text not null default 'solo';
alter table public.scores add column if not exists place   int;
alter table public.scores add column if not exists players int;

alter table public.scores drop constraint if exists source_ok;
alter table public.scores add constraint source_ok check (source in ('solo', 'room'));
alter table public.scores drop constraint if exists place_ok;
alter table public.scores add constraint place_ok
  check (place is null or (place >= 1 and players is not null and place <= players and players <= 64));

-- Ranking mensual: filtra por fecha dentro de un tablero.
create index if not exists scores_board_time_idx on public.scores (game_id, variant, created_at);
-- Ranking de victorias: solo las filas ganadoras.
create index if not exists scores_wins_idx on public.scores (game_id, created_at) where place = 1;

drop policy if exists "scores_insert_public" on public.scores;
create policy "scores_insert_public" on public.scores
  for insert with check (
    char_length(player) between 1 and 12
    and score >= 0 and score < 1e9
    and source in ('solo', 'room')
  );

-- Top N de un tablero: el MEJOR puntaje de cada jugador, historico
-- (p_since null) o desde una fecha. Desempate estable: a igual puntaje, primero
-- el que lo hizo antes (mismo criterio que game_leaders).
create or replace function public.leaderboard_best(
  p_game_id   text,
  p_variant   text,
  p_ascending boolean,
  p_since     timestamptz default null,
  p_limit     int default 10
)
returns table (player text, score double precision, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select best.player, best.score, best.created_at
  from (
    select distinct on (s.player) s.player, s.score, s.created_at, s.id
    from public.scores s
    where s.game_id = p_game_id
      and s.variant = p_variant
      and (p_since is null or s.created_at >= p_since)
    order by
      s.player,
      case when p_ascending then s.score end asc,
      case when not p_ascending then s.score end desc,
      s.created_at asc,
      s.id asc
  ) as best
  order by
    case when p_ascending then best.score end asc,
    case when not p_ascending then best.score end desc,
    best.created_at asc,
    best.id asc
  limit least(greatest(p_limit, 1), 100)
$$;

grant execute on function public.leaderboard_best(text, text, boolean, timestamptz, int)
  to anon, authenticated;

-- Top N por victorias de sala (1er puesto contra al menos otro jugador). A igual
-- cantidad, primero el que llego antes a esa cantidad.
create or replace function public.leaderboard_wins(
  p_game_id text,
  p_since   timestamptz default null,
  p_limit   int default 10
)
returns table (player text, score double precision, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select s.player, count(*)::double precision as score, max(s.created_at) as created_at
  from public.scores s
  where s.game_id = p_game_id
    and s.place = 1
    and s.players >= 2
    and (p_since is null or s.created_at >= p_since)
  group by s.player
  order by count(*) desc, max(s.created_at) asc
  limit least(greatest(p_limit, 1), 100)
$$;

grant execute on function public.leaderboard_wins(text, timestamptz, int)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Salon de la fama: lider (#1) de cada tablero, resuelto en la base.
--
-- El cliente manda la lista de tableros representativos que quiere consultar
-- (`[{"game_id":"snake","variant":"","ascending":false}, ...]`, la direccion sale
-- de GAME_SCORING en el front) y recibe una fila por tablero con su lider. Evita
-- que la landing y /fame/ se bajen la tabla `scores` entera para calcularlo en el
-- navegador: cada tablero resuelve con un limit 1 sobre scores_board_idx.
--
-- Desempate estable (mismo criterio que fetchTop en el cliente): a igual puntaje
-- gana el que lo hizo primero (created_at, luego id).
-- ---------------------------------------------------------------------------

create or replace function public.game_leaders(boards jsonb)
returns table (game_id text, variant text, player text, score double precision)
language sql
stable
security invoker
set search_path = public
as $$
  select b.game_id, b.variant, top.player, top.score
  from jsonb_to_recordset(boards)
    as b(game_id text, variant text, ascending boolean, wins boolean)
  cross join lateral (
    -- Juegos que rankean por victorias de sala: lidera el que mas gano.
    (
      select s.player, count(*)::double precision as score
      from public.scores s
      where s.game_id = b.game_id and coalesce(b.wins, false)
        and s.place = 1 and s.players >= 2
      group by s.player
      order by count(*) desc, max(s.created_at) asc
      limit 1
    )
    union all
    (
      select s.player, s.score
      from public.scores s
      where s.game_id = b.game_id and s.variant = b.variant
        and b.ascending and not coalesce(b.wins, false)
      order by s.score asc, s.created_at asc, s.id asc
      limit 1
    )
    union all
    (
      select s.player, s.score
      from public.scores s
      where s.game_id = b.game_id and s.variant = b.variant
        and not b.ascending and not coalesce(b.wins, false)
      order by s.score desc, s.created_at asc, s.id asc
      limit 1
    )
  ) as top
$$;

grant execute on function public.game_leaders(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Popularidad: contador de partidas por juego para ordenar la landing (mas
-- jugados primero). Se incrementa al abrir un juego desde la landing.
-- ---------------------------------------------------------------------------

create table if not exists public.game_plays (
  game_id    text        primary key,
  plays      bigint      not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.game_plays enable row level security;

-- Lectura publica del conteo (la landing lo lee para ordenar).
drop policy if exists "game_plays_select_public" on public.game_plays;
create policy "game_plays_select_public" on public.game_plays
  for select using (true);

-- Incremento atomico via RPC. `security definer` evita tener que abrir insert/
-- update por RLS: el cliente solo puede sumar de a uno, no fijar valores.
-- Mismo nivel de confianza que `scores` (spoofable con la anon key, aceptable
-- para minijuegos).
create or replace function public.increment_game_plays(p_game_id text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.game_plays (game_id, plays, updated_at)
  values (p_game_id, 1, now())
  on conflict (game_id)
  do update set plays = public.game_plays.plays + 1, updated_at = now();
$$;

grant execute on function public.increment_game_plays(text) to anon, authenticated;
