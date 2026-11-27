-- Explore ideas: measured cost, a smaller stock, and the headline a story was picked from.
-- Nothing here changes a story already made.

-- The headline an idea was offered with. Written once and never overwritten, so a story planned
-- from it can be held to it, and the planner's own title compared with it.
alter table public.topics add column if not exists card text;
-- Which version of the idea writer's instructions made it, and which call.
alter table public.topics add column if not exists prompt_version text;
alter table public.topics add column if not exists batch_id uuid;

-- Ideas that actually came into view in Explore, one row per person and idea.
create table if not exists public.idea_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, topic_id)
);
create index if not exists idea_views_topic on public.idea_views(topic_id);
alter table public.idea_views enable row level security;
-- Safe to run twice.
drop policy if exists "own idea views read" on public.idea_views;
create policy "own idea views read" on public.idea_views for select using (auth.uid() = user_id);

-- The idea call log reads back recent calls per person for the daily cap.
create index if not exists usage_ideas_user_at on public.usage(user_id, at desc) where step = 'ideas';

-- Limits and versions, changeable without a deploy.
insert into public.settings (key, value) values
  ('ideas_kept', '20'),
  ('ideas_refill_below', '10'),
  ('idea_calls_per_day', '8'),
  -- v1 = the prompt in use until now, v2 = the revision, ab = half of batches each.
  ('idea_prompt', 'ab'),
  -- Dollars per million tokens, for the cost log. ESTIMATED from OpenAI's daily cost exports of
  -- 22 and 23 Nov 2026: check against OpenAI's price page and correct here.
  ('prices', '{"gpt-6.1-terra": {"in": 0.75, "cached_in": 0.075, "out": 6.0}}')
on conflict (key) do nothing;

-- The house style's title rule, in the live settings row: any headline shape, and the commonplace
-- test. The same text is the code default in supabase/functions/lesson/house-style.ts.
update public.settings
set value = replace(
  value,
  'Name the single most ridiculous true thing in the story as a thing, not as a sentence. The shape is "The [someone or something] that [did the absurd thing]", with "who" for a person. Good titles: "The disco explosion that forfeited a baseball game", "The warship that sank on its first voyage", "The pope who put a dead pope on trial", "The airline with a waitlist for the moon", "The mummy that received military honors". Do not write a full sentence that starts with "A" or "An": "A warship sank on its first voyage" is the wrong shape, and "The warship that sank on its first voyage" is the right one. When that shape truly does not fit, a "Why" title or a possessive is fine: "Why we drive on the right side of the road", "Australia''s great emu war".',
  'Name the one true thing in the story a stranger would most want explained, in whichever shape says it best: a question ("Why do octopuses carry coconuts?"), "The [someone or something] that [did it]" ("The pope who put a dead pope on trial", "The airline with a waitlist for the moon"), or a short statement ("A disco explosion forfeited a baseball game"). It must be truly strange: an event that happens all the time, like a ship sinking on its first voyage, fails however it is told.'
)
where key = 'story_brief';
update public.settings set value = replace(value, 'One subject, one absurd thing.', 'One subject, one strange thing.') where key = 'story_brief';
