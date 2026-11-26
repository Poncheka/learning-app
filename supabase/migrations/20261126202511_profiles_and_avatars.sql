create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text check (first_name is null or char_length(first_name) between 1 and 40),
  avatar_path text,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select using (auth.uid() = user_id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = user_id);
create policy "own profile update" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg','image/png','image/heic','image/webp'])
on conflict (id) do nothing;
