-- Wikipedia's Unusual articles list as optional Explore idea candidates. Off until the
-- "idea_wiki_pool" setting is changed. Nothing here changes a story already made.

-- The candidate pool, shared by everyone. Filled from Wikipedia's API by the shelf function, with no model.
create table if not exists public.idea_candidates (
  -- Wikipedia's own page id, so a renamed article is still the same candidate.
  page_id bigint primary key,
  title text not null,
  url text not null,
  -- The list's one-line description (Wikipedia text, CC BY-SA 4.0). Shown to the idea writer only.
  blurb text not null default '',
  source text not null default 'wikipedia_unusual_articles',
  -- Where it came from: the list subpage and the heading it sits under.
  list_page text not null,
  section text,
  fetched_at timestamptz not null default now(),
  -- In the pool now. Rows dropped from the pool stay, with their history.
  in_pool boolean not null default true,
  offered integer not null default 0,
  last_offered_at timestamptz,
  -- The idea made from it, once the idea writer takes it. It is not offered again after that.
  topic_id uuid references public.topics(id) on delete set null
);
create index if not exists idea_candidates_pool on public.idea_candidates(in_pool) where topic_id is null;
-- Read and written only by the server.
alter table public.idea_candidates enable row level security;

-- Where an idea came from: "ai" or "wikipedia_unusual_articles", and which candidate. Null for ideas from before the pilot.
alter table public.topics add column if not exists origin text;
alter table public.topics add column if not exists candidate_page_id bigint;

insert into public.settings (key, value) values
  -- off, ab (half of idea batches carry candidates, the rest are the control) or on.
  ('idea_wiki_pool', 'off'),
  -- The pilot stops offering candidates after this many Wikipedia batches.
  ('idea_wiki_pilot_batches', '30'),
  ('idea_wiki_per_line', '4'),
  ('idea_wiki_pool_size', '200'),
  -- Who may fill the pool by hand (the shelf's refresh_candidates action). Comma-separated user ids. Jeff's account.
  ('admin_user_ids', 'e3c56c32-2d9d-42d8-a2af-750150b661f9')
on conflict (key) do nothing;
