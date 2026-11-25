-- Already applied to the live project. Kept here so the repo matches the database.
-- How well each finished story has done, across everyone. Read by the server only.
create or replace function public.topic_scores()
returns table(topic_id uuid, listeners int, likes int, passes int, swipes int, lengths int, score numeric)
language sql stable security definer set search_path = public as $$
with heard as (
  select l.topic_id, count(distinct l.user_id) n from lessons l
  where l.topic_id is not null and (l.heard_position > 0 or l.finished_at is not null)
  group by 1),
whole as (
  select l.topic_id, count(distinct l.chosen_minutes) n from lessons l
  where l.topic_id is not null
    and exists (select 1 from segments s where s.lesson_id = l.id)
    and not exists (select 1 from segments s where s.lesson_id = l.id and s.status <> 'ready')
  group by 1),
said as (
  select distinct on (s.user_id, coalesce(l.topic_id, s.topic_id)) coalesce(l.topic_id, s.topic_id) topic_id, s.type
  from signals s left join lessons l on l.id = s.lesson_id
  where s.type in ('loved', 'thumbs_up', 'thumbs_down', 'not_for_me', 'cleared', 'not_interested')
    and coalesce(l.topic_id, s.topic_id) is not null
  order by s.user_id, coalesce(l.topic_id, s.topic_id), s.created_at desc),
votes as (
  select topic_id,
    count(*) filter (where type in ('loved', 'thumbs_up')) likes,
    count(*) filter (where type in ('thumbs_down', 'not_for_me')) passes,
    count(*) filter (where type = 'not_interested') swipes
  from said group by 1)
select t.id,
  coalesce(h.n, 0)::int, coalesce(v.likes, 0)::int, coalesce(v.passes, 0)::int, coalesce(v.swipes, 0)::int, coalesce(w.n, 0)::int,
  (3 * coalesce(v.likes, 0) + coalesce(h.n, 0) + coalesce(w.n, 0) - 2 * coalesce(v.passes, 0) - 0.5 * coalesce(v.swipes, 0))::numeric
from topics t
left join heard h on h.topic_id = t.id
left join whole w on w.topic_id = t.id
left join votes v on v.topic_id = t.id
where t.status = 'ready';
$$;
revoke all on function public.topic_scores() from public, anon, authenticated;
grant execute on function public.topic_scores() to service_role;

-- Finished stories someone picked in Explore. They go to the front of that person's Listen tab.
create table if not exists public.wants (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);
alter table public.wants enable row level security;
create policy "own wants" on public.wants for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
