-- Milestone 2: one lesson, made of chapters ("segments"), each written and voiced on its own.
--
-- A lesson is one topic played for a chosen length. A segment is one chapter of it, and is
-- the unit of everything: planned, written, voiced, saved and played on its own.
-- The other four tables in the plan (interests, topics, plays, signals) come with milestones 3 and 4.

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  topic text not null,                 -- what was asked for, as typed or tapped
  title text not null,                 -- the title the planner gave it
  chosen_minutes integer not null check (chosen_minutes between 1 and 120),
  status text not null default 'planned' check (status in ('planned', 'playing', 'finished', 'failed')),
  covered_summary text not null default '',   -- running recap, so later chapters do not repeat earlier ones
  source_notes jsonb not null default '[]',   -- short fact notes pulled from the sources, never whole articles
  sources jsonb not null default '[]',        -- the pages those notes came from: title and url
  writer_model text,
  started_at timestamptz not null default now()
);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  position integer not null check (position >= 1),
  title text not null,                 -- the chapter title shown on screen
  target_minutes integer not null check (target_minutes between 1 and 15),
  brief text not null default '',      -- the planner's one line on what this chapter is for
  fact_ids jsonb not null default '[]',       -- which of the lesson's source_notes this chapter is built on
  script text,
  summary text,                        -- what this chapter ended up covering
  source_refs jsonb not null default '[]',    -- the sources this chapter's script drew on
  audio_path text,                     -- path inside the lesson-audio bucket
  duration_sec numeric,
  status text not null default 'planned' check (status in ('planned', 'writing', 'voicing', 'ready', 'failed')),
  error text,
  writer_model text,
  voice_model text,
  voice text,
  hidden boolean not null default false,      -- hide, never delete: the archive stays complete
  claimed_at timestamptz,              -- when a function started work on it, so stuck work can be retried
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lesson_id, position)
);

-- Row level security is on with no policies, on purpose. There is no sign-in yet, so
-- nothing can read or write these tables except the edge functions, which use the secret key.
alter table public.lessons enable row level security;
alter table public.segments enable row level security;

-- Saved audio, one mp3 per segment. Private: the edge function hands out short-lived links.
insert into storage.buckets (id, name, public)
values ('lesson-audio', 'lesson-audio', false)
on conflict (id) do nothing;
