-- The interest a topic grew out of, shown small in the Library and on the player.
-- "Off the map" marks a topic that wandered outside the listener's tags on purpose.
alter table public.topics add column tag text;
