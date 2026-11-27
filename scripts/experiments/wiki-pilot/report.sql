-- Wikipedia Unusual articles pilot report. Read only.

-- 1. blind: headlines to rate, without their source. A stable random order from the topic id.
with pilot as (
  select t.id, t.card, t.title, t.origin, t.batch_id, u.raw->'ideas'->'wiki'->>'arm' as arm
  from topics t
  join usage u on u.step = 'ideas' and u.raw->'ideas'->>'batch_id' = t.batch_id::text
  where u.raw->'ideas'->'wiki' is not null
)
select row_number() over (order by md5(id::text)) as "ID", coalesce(card, title) as "Headline", null as "Rating", null as "Notes"
from pilot order by 1;

-- 2. key: which arm and origin each ID came from. Open only after rating.
with pilot as (
  select t.id, t.asked, t.origin, t.candidate_page_id, t.batch_id, u.raw->'ideas'->'wiki'->>'arm' as arm
  from topics t
  join usage u on u.step = 'ideas' and u.raw->'ideas'->>'batch_id' = t.batch_id::text
  where u.raw->'ideas'->'wiki' is not null
)
select row_number() over (order by md5(id::text)) as "ID", arm, origin, asked as subject, candidate_page_id, batch_id
from pilot order by 1;

-- 3. batches: cost and tokens per arm, from the cost log.
select raw->'ideas'->'wiki'->>'arm' as arm,
  count(*) as batches,
  sum((raw->'ideas'->>'kept')::int) as ideas_kept,
  sum((raw->'ideas'->'wiki'->>'offered')::int) as candidates_offered,
  sum(jsonb_array_length(coalesce(raw->'ideas'->'wiki'->'selected', '[]'))) as candidates_taken,
  sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
  round(sum((raw->'ideas'->>'cost_usd')::numeric), 4) as cost_usd,
  round(sum((raw->'ideas'->>'cost_usd')::numeric) / nullif(sum((raw->'ideas'->>'kept')::int), 0), 5) as cost_per_kept_idea
from usage where step = 'ideas' and raw->'ideas'->'wiki' is not null
group by 1 order by 1;

-- 4. funnel: what happened to each idea, per arm and origin.
with pilot as (
  select t.*, u.raw->'ideas'->'wiki'->>'arm' as arm
  from topics t
  join usage u on u.step = 'ideas' and u.raw->'ideas'->>'batch_id' = t.batch_id::text
  where u.raw->'ideas'->'wiki' is not null
)
select arm, origin, count(*) as kept,
  count(*) filter (where exists (select 1 from idea_views v where v.topic_id = p.id)) as seen,
  count(*) filter (where p.queued_at is not null) as queued,
  count(*) filter (where exists (select 1 from dismissals d where d.topic_id = p.id)) as dismissed,
  count(*) filter (where p.status = 'ready') as made,
  count(*) filter (where (p.review->>'headline_holds')::boolean) as kept_headline
from pilot p group by 1, 2 order by 1, 2;
