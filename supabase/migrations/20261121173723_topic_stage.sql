-- Preparing a topic now happens in two steps, each a separate request, because one request
-- doing everything was running into the two and a half minute limit and being cut off.
-- stage says where a topic being prepared has got to: null (planning under way), 'planned'
-- (plan saved, waiting to be reviewed and opened) or 'finishing' (review and opening under way).
alter table public.topics add column stage text;
-- One topic was cut off mid-preparation and left stuck. Mark it so it is not counted as under way.
update public.topics set status = 'failed', error = 'Preparing took too long and was stopped.' where status = 'preparing';
