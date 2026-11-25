-- Already applied to the live project. Kept here so the repo matches the database.
-- The opening of a story on someone's Listen tab can be recorded before they tap it, so it plays at once.
alter table public.topics add column if not exists opening_audio_path text;
alter table public.topics add column if not exists opening_voice text;
alter table public.topics add column if not exists opening_voice_model text;
alter table public.topics add column if not exists opening_shape text;
alter table public.topics add column if not exists opening_seconds int;
insert into public.settings (key, value) values ('record_openings', 'on') on conflict (key) do nothing;
