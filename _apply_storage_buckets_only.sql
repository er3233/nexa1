-- Storage buckets + policies only (idempotent).
-- Run in SQL Editor if Storage > Buckets is empty after main schema apply.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

create or replace function public.can_access_chat_media(object_name text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  folder text;
  conv   uuid;
begin
  folder := split_part(object_name, '/', 1);
  if folder !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  conv := folder::uuid;
  return public.is_conversation_member(conv, auth.uid());
end;
$$;

grant execute on function public.can_access_chat_media(text) to authenticated;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars insert own folder" on storage.objects;
create policy "avatars insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars update own folder" on storage.objects;
create policy "avatars update own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars delete own folder" on storage.objects;
create policy "avatars delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chat-media read members" on storage.objects;
create policy "chat-media read members" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-media' and public.can_access_chat_media(name));

drop policy if exists "chat-media insert members" on storage.objects;
create policy "chat-media insert members" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and owner = auth.uid()
    and public.can_access_chat_media(name)
  );

drop policy if exists "chat-media update owner" on storage.objects;
create policy "chat-media update owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'chat-media' and owner = auth.uid())
  with check (bucket_id = 'chat-media' and owner = auth.uid());

drop policy if exists "chat-media delete owner or mod" on storage.objects;
create policy "chat-media delete owner or mod" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (owner = auth.uid() or public.is_moderator(auth.uid()))
  );
