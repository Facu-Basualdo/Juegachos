-- Biblioteca de audios de Imitame (el "Workshop" del juego): los audios que sube la
-- gente para imitar en las salas. Ejecutar en el SQL Editor del proyecto Supabase
-- (ademas de schema.sql y rooms.sql). Idempotente: se puede correr de nuevo.
--
-- El cliente procesa el audio antes de subirlo (recorta silencios, corta a 3s, baja a
-- ~11 kHz y lo codifica mu-law), asi que `audio` es base64 de 1 byte por muestra: un
-- audio de 3s son ~33 KB, ~44 KB en base64. Ver src/games/imitame/game/clips.ts.
--
-- Mismo nivel de confianza que scores y rooms: anon key + RLS abierta. Cualquiera puede
-- subir y borrar; los checks solo frenan basura y archivos gigantes.

create table if not exists public.imitame_clips (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  uploader   text        not null,
  rate       integer     not null,
  duration   real        not null,
  audio      text        not null,
  created_at timestamptz not null default now(),
  constraint imitame_clips_name_len     check (char_length(name) between 1 and 40),
  constraint imitame_clips_uploader_len check (char_length(uploader) between 1 and 12),
  constraint imitame_clips_rate_ok      check (rate between 3000 and 48000),
  constraint imitame_clips_duration_ok  check (duration > 0 and duration <= 3.5),
  -- ~3.5s a 12 kHz en base64. Frena subir cualquier cosa por la API a mano.
  constraint imitame_clips_audio_len    check (char_length(audio) between 100 and 60000)
);

create index if not exists imitame_clips_created_idx on public.imitame_clips (created_at desc);

alter table public.imitame_clips enable row level security;

drop policy if exists "imitame_clips_select_public" on public.imitame_clips;
create policy "imitame_clips_select_public" on public.imitame_clips
  for select using (true);

drop policy if exists "imitame_clips_insert_public" on public.imitame_clips;
create policy "imitame_clips_insert_public" on public.imitame_clips
  for insert with check (true);

-- Sin esta politica el delete no falla: Postgres filtra la fila y devuelve 0 filas sin
-- error (el mismo gotcha que tuvo el "Expulsar" de las salas). clips.ts lo detecta.
drop policy if exists "imitame_clips_delete_public" on public.imitame_clips;
create policy "imitame_clips_delete_public" on public.imitame_clips
  for delete using (true);
