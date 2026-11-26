create table if not exists public.shares (
  code text primary key check (code ~ '^[a-z0-9]{4,12}$'),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  show_name boolean not null default true,
  created_at timestamptz not null default now(),
  opened integer not null default 0
);
create index if not exists shares_lesson on public.shares(lesson_id);
create unique index if not exists shares_one_per_lesson on public.shares(lesson_id, user_id);
alter table public.shares enable row level security;
create policy "own shares read" on public.shares for select using (auth.uid() = user_id);

alter table public.topics add column if not exists slug text;
create unique index if not exists topics_slug on public.topics(slug) where slug is not null;

alter table public.waitlist add column if not exists code text;
alter table public.waitlist add column if not exists referred_by text;
alter table public.waitlist add column if not exists interests text[];
alter table public.waitlist add column if not exists story_slug text;
create unique index if not exists waitlist_code on public.waitlist(code) where code is not null;
