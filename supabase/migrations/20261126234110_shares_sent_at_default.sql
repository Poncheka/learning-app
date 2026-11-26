-- Links made by older app versions, which do not say whether they were sent, count as sent.
-- The current app says so on every link, including the ones it makes ahead (sent_at null).
alter table public.shares alter column sent_at set default now();
