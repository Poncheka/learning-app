-- Already applied to the live project. Kept here so the repo matches the database.
-- How loud each quarter second of a chapter is, as one digit (0 silent to 9 loud) per slice.
-- Read from the saved recording, so the player can draw the narrator's real voice.
alter table public.segments add column if not exists shape text;
