-- Signals: every thumbs up, thumbs down and "not interested", kept as a running log.
-- They are saved from now on, and start shaping what Pliny suggests in milestone 4.
create table public.signals (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('thumbs_up', 'thumbs_down', 'loved', 'not_for_me', 'not_interested', 'cleared')),
  lesson_id uuid references public.lessons (id) on delete cascade,
  position integer,                     -- the chapter being heard when it was given, if any
  topic_id uuid references public.topics (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.signals enable row level security;

-- Removing a lesson from the Library hides it. Its audio and scripts are kept.
alter table public.lessons add column hidden boolean not null default false;

-- Chapter two onward has to earn the hook. Added to the house view of a good lesson.
update public.settings
set value = value || ' The opening hooks. The chapter straight after it must set the stage before anything else moves: when and where this is, who these people are, what was normal before it happened, and what kind of story this is. If the heart of it is a mystery nobody has solved, say so then, in plain words, and say what the best guesses are. Never leave the listener wondering for minutes what is going on or why they are being told this.',
    updated_at = now()
where key = 'story_brief';
