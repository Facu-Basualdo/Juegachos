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
    as b(game_id text, variant text, ascending boolean)
  cross join lateral (
    (
      select s.player, s.score
      from public.scores s
      where s.game_id = b.game_id and s.variant = b.variant and b.ascending
      order by s.score asc, s.created_at asc, s.id asc
      limit 1
    )
    union all
    (
      select s.player, s.score
      from public.scores s
      where s.game_id = b.game_id and s.variant = b.variant and not b.ascending
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
