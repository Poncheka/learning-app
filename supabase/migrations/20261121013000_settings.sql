-- Things Jeff tunes by ear, kept in the database so changing one needs no redeploy.
-- The lesson function reads these each time it voices a chapter and falls back to its
-- built-in defaults if a row is missing or empty.

create table public.settings (
  key text primary key,
  value text not null,
  note text,                            -- what this setting is for, in plain words
  updated_at timestamptz not null default now()
);

-- Same rule as the other tables: row level security on, no policies, edge functions only.
alter table public.settings enable row level security;

insert into public.settings (key, value, note) values
  (
    'narrator_direction',
    'You are telling a friend something fascinating you just learned, across a kitchen table. Relaxed and conversational, not a presenter and not a documentary announcer. Pace: slow and easy, well under normal talking speed. Take your time. Let each sentence finish, pause for a beat before the next one, and pause longer between ideas. Tone: warm, low-key, a little amused at the surprising parts. Keep exactly the same voice, pace and energy from the first word to the last. Never rushed, never performed.',
    'How the narrator should sound: who they are, their pace and their tone. Sent to the voice model with every chapter.'
  ),
  (
    'voice',
    'cedar',
    'Which built-in OpenAI voice reads the lesson. One of: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar.'
  );
