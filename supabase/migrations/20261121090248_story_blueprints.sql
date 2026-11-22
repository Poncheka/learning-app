-- The storytelling overhaul. A topic now carries its story discovery (what makes it worth
-- telling) and the editorial review of its plan. Each chapter carries its blueprint: the
-- situation it opens on, the discovery it delivers and the turn. Each written chapter
-- carries the result of its fact check.
alter table public.topics add column story jsonb, add column review jsonb;
alter table public.lessons add column story jsonb;
alter table public.segments add column blueprint jsonb, add column review jsonb;
