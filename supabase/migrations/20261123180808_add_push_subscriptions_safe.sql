-- 021'in yeni, boş push nesneleri için veri koruyan kurulumu.
-- Nesneler beklenmedik biçimde mevcutsa durur; hiçbir şeyi değiştirmez.
begin;
do $$
begin
  if to_regclass('public.push_subscriptions') is not null
     or to_regprocedure('public.get_unread_total_for(uuid)') is not null then
    raise exception 'Push nesnesi zaten mevcut; mevcut şemayı inceleyin ve bu migrationı uygulamayın';
  end if;
end $$;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text,
  auth text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index push_subscriptions_endpoint_uidx on public.push_subscriptions(endpoint);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_subscriptions_update_own on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

create function public.get_unread_total_for(uid uuid)
returns integer language sql security definer stable set search_path = public
as $$
  select coalesce(sum(cnt), 0)::int from (
    select count(msg.*)::int as cnt
    from public.conversation_members m
    join public.messages msg on msg.conversation_id = m.conversation_id
    where m.user_id = uid and msg.sender_id <> uid and msg.deleted_at is null
      and (m.last_read_at is null or msg.created_at > m.last_read_at)
    group by m.conversation_id
  ) s;
$$;
revoke all on function public.get_unread_total_for(uuid) from public, anon, authenticated;
grant execute on function public.get_unread_total_for(uuid) to service_role;
commit;
