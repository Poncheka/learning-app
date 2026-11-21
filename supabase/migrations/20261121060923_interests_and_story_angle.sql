-- Interests: the tags Jeff types in, which Pliny turns into topic suggestions.
-- And the angle: one sentence per topic saying what its story is really about.

create table public.interests (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  parent_id uuid references public.interests (id),   -- for sub-topics, once tags are expanded
  weight numeric not null default 1,                 -- raised and lowered by listening, from milestone 4
  source text not null default 'typed' check (source in ('typed', 'suggested', 'expanded')),
  hidden boolean not null default false,             -- removed tags are hidden, not deleted
  last_boosted timestamptz,
  created_at timestamptz not null default now()
);

alter table public.interests enable row level security;

-- The question or tension a lesson is about, chosen before anything is outlined.
alter table public.topics add column angle text;
alter table public.lessons add column angle text;

insert into public.settings (key, value, note) values
  (
    'story_brief',
    'Tell it like the best dinner-table storyteller you know, not like an encyclopedia. Find the angle first: the question that makes someone lean in. Why did anyone want this? Who thought it was madness, and why were they almost right? What was at stake, who paid for it, who got rich, who got hurt? What did it change that we still live with? What is the strangest true thing about it? Lead with people, motives, conflict and consequences. Describe how something was physically done only when the how is itself astonishing, and then give it as one clear picture, not a procedure. Skip anything a listener could have guessed. About once a minute the listener should think: wait, really?',
    'What makes a Pliny lesson interesting. Given to the planner when it chooses a topic''s angle and chapters, and to the writer for every chapter. Changes apply to topics prepared and chapters written after the change.'
  ),
  (
    'interest_suggestions',
    '[]',
    'Tags Pliny suggests on the Interests screen. Rewritten whenever the tags change.'
  );
