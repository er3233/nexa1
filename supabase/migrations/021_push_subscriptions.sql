-- ============================================================
-- 021_push_subscriptions.sql
-- Web Push abonelikleri (PWA badge + kapalıyken bildirim).
-- Idempotent. DROP TABLE / TRUNCATE YOK. RLS açık.
-- ============================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null,
  p256dh      text,
  auth        text,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists push_subscriptions_endpoint_uidx
  on public.push_subscriptions (endpoint);
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

-- Edge Function (service_role) için okunmamış toplam; authenticated çağırmaz.
create or replace function public.get_unread_total_for(uid uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(sum(cnt), 0)::int from (
    select count(msg.*)::int as cnt
    from public.conversation_members m
    join public.messages msg on msg.conversation_id = m.conversation_id
    where m.user_id = uid
      and msg.sender_id <> uid
      and msg.deleted_at is null
      and (m.last_read_at is null or msg.created_at > m.last_read_at)
    group by m.conversation_id
  ) s;
$$;

revoke all on function public.get_unread_total_for(uuid) from public;
revoke all on function public.get_unread_total_for(uuid) from anon;
revoke all on function public.get_unread_total_for(uuid) from authenticated;
grant execute on function public.get_unread_total_for(uuid) to service_role;
