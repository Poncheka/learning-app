alter table public.shares add column if not exists sent_at timestamptz;
update public.shares set sent_at = created_at where sent_at is null;
