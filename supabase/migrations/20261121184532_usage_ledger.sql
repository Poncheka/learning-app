-- Every model call the server makes, so cost is measured rather than estimated.
-- Later this is also what per-person daily caps will be counted from.
create table if not exists public.usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  step text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_tokens integer not null default 0
);
alter table public.usage enable row level security;
create index if not exists usage_at_idx on public.usage (at);
