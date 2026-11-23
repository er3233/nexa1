-- Allow clients to see bucket metadata (list/get).
-- Without this, Storage API returns [] even if buckets exist.
-- Idempotent.

drop policy if exists "buckets select for all" on storage.buckets;
create policy "buckets select for all"
  on storage.buckets
  for select
  to public
  using (true);

-- Re-assert buckets exist
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do update set public = excluded.public;
