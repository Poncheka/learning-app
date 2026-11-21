-- Topics, prepared ahead of time so a lesson can start within seconds of being picked.
--
-- Preparing a topic is all text and costs a couple of cents: read the sources, keep short
-- fact notes, outline the chapters best-first, and write the one minute opening. No voice
-- is made until a lesson is actually started. The outline does not depend on the session
-- length: a short lesson simply uses the opening and the first few chapters.

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  asked text not null,                 -- the topic as it was typed or proposed
  title text not null,
  hook text not null default '',       -- one line that makes you want to tap it
  interest_id uuid,                    -- which interest suggested it, once interests exist
  status text not null default 'preparing' check (status in ('proposed', 'preparing', 'ready', 'failed', 'hidden')),
  sources jsonb not null default '[]',        -- pages read: title and url
  source_notes jsonb not null default '[]',   -- short fact notes, never whole articles
  outline jsonb not null default '[]',        -- chapters in order, best first; the first is the opening
  opening_script text,                 -- the opening, already written, so only its voice is left to make
  opening_summary text,
  error text,
  proposed_at timestamptz not null default now(),
  prepared_at timestamptz
);

alter table public.topics enable row level security;

alter table public.lessons add column topic_id uuid references public.topics (id);
