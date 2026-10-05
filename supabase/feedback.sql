-- Feedback de los jugadores (pulgares por juego, bugs, ideas, pedidos de juegos).
-- Ejecutar en el SQL Editor del proyecto Supabase, ademas de schema.sql y rooms.sql.
-- Idempotente: se puede volver a correr. El build no lo usa.
--
-- A diferencia de `scores`, el feedback es PRIVADO: el navegador puede escribir (con la
-- anon key) pero no leer. Se lee desde el panel de Supabase:
--   * Table Editor > feedback (lo ultimo arriba ordenando por created_at), o
--   * SQL Editor:  select * from feedback where kind <> 'like' and kind <> 'dislike'
--                  order by created_at desc;
--                  select * from feedback_votes;   -- pulgares por juego
--
-- Mismo nivel de confianza que el resto del repo: el cliente declara su `client_id` y
-- su nombre, asi que un usuario tecnico puede falsearlos. El limite por cliente es
-- anti-spam casual, no anti-abuso real.

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- 'like' / 'dislike' = pulgar de un juego; el resto lleva texto.
  kind       text not null,
  game_id    text,
  message    text,
  player     text,
  -- Opcional y solo desde la landing: Discord o mail para responder.
  contact    text,
  -- Donde se mando: game over de un juego, resultados de una sala o la landing.
  source     text not null default 'gameover',
  room_code  text,
  -- Id al azar guardado en el navegador (localStorage `mg:client-id`): sirve para
  -- contar un voto por persona y para el limite de envios.
  client_id  text,
  -- Navegador, pantalla, tactil, ruta: lo que hace util un reporte de bug.
  context    jsonb
);

alter table public.feedback drop constraint if exists feedback_kind_ok;
alter table public.feedback add constraint feedback_kind_ok
  check (kind in ('like', 'dislike', 'bug', 'idea', 'game', 'other'));
alter table public.feedback drop constraint if exists feedback_source_ok;
alter table public.feedback add constraint feedback_source_ok
  check (source in ('gameover', 'room', 'landing'));
alter table public.feedback drop constraint if exists feedback_lengths_ok;
alter table public.feedback add constraint feedback_lengths_ok check (
  (game_id is null or char_length(game_id) <= 40)
  and (message is null or char_length(message) <= 1000)
  and (player is null or char_length(player) <= 12)
  and (contact is null or char_length(contact) <= 120)
  and (room_code is null or char_length(room_code) <= 12)
  and (client_id is null or char_length(client_id) <= 64)
  and (context is null or pg_column_size(context) <= 2000)
);
-- Un pulgar no necesita texto; todo lo demas si (al menos 3 letras).
alter table public.feedback drop constraint if exists feedback_message_ok;
alter table public.feedback add constraint feedback_message_ok check (
  kind in ('like', 'dislike') or char_length(btrim(coalesce(message, ''))) >= 3
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_game_idx on public.feedback (game_id, kind);
create index if not exists feedback_client_idx on public.feedback (client_id, created_at);

alter table public.feedback enable row level security;

-- Solo insertar. Sin policy de select: desde el navegador no se lee nada.
drop policy if exists "feedback_insert_public" on public.feedback;
create policy "feedback_insert_public" on public.feedback
  for insert to anon, authenticated with check (true);

-- ---------------------------------------------------------------------------
-- Limite de envios: 20 por cliente cada 10 minutos (cubre votar en varios juegos
-- seguidos; corta a un script que manda en bucle).
-- ---------------------------------------------------------------------------

create or replace function public.feedback_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is not null and (
    select count(*) from public.feedback
    where client_id = new.client_id and created_at > now() - interval '10 minutes'
  ) >= 20 then
    raise exception 'feedback_rate_limited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_rate_limit on public.feedback;
create trigger feedback_rate_limit
  before insert on public.feedback
  for each row execute function public.feedback_rate_limit();

-- ---------------------------------------------------------------------------
-- Votos por juego: el ultimo pulgar de cada cliente (cambiar de opinion no suma dos).
-- `security_invoker`: respeta el RLS de la tabla, asi que desde el navegador tampoco
-- se lee; desde el SQL Editor si.
-- ---------------------------------------------------------------------------

create or replace view public.feedback_votes with (security_invoker = true) as
select
  game_id,
  count(*) filter (where kind = 'like')    as likes,
  count(*) filter (where kind = 'dislike') as dislikes,
  round(100.0 * count(*) filter (where kind = 'like') / nullif(count(*), 0)) as pct_like
from (
  select distinct on (coalesce(client_id, id::text), game_id) game_id, kind
  from public.feedback
  where kind in ('like', 'dislike') and game_id is not null
  order by coalesce(client_id, id::text), game_id, created_at desc
) last_votes
group by game_id
order by count(*) desc;
