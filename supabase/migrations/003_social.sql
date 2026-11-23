-- ============================================================
-- 003_social.sql — Kullanıcı engelleme ve şikâyetler. Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- blocked_users
-- ------------------------------------------------------------
create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

do $$ begin
  alter table public.blocked_users
    add constraint blocked_users_not_self_chk check (blocker_id <> blocked_id);
exception when duplicate_object then null; end $$;

create index if not exists blocked_users_pair_idx on public.blocked_users (blocker_id, blocked_id);

-- ------------------------------------------------------------
-- reports
-- ------------------------------------------------------------
create table if not exists public.reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null references auth.users (id) on delete cascade,
  reported_user_id  uuid references auth.users (id) on delete set null,
  message_id        uuid references public.messages (id) on delete set null,
  conversation_id   uuid references public.conversations (id) on delete set null,
  reason            text not null,
  details           text,
  status            text not null default 'open',
  resolved_by       uuid references auth.users (id) on delete set null,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$ begin
  alter table public.reports
    add constraint reports_status_chk check (status in ('open', 'reviewing', 'resolved', 'dismissed'));
exception when duplicate_object then null; end $$;

create index if not exists reports_status_created_idx on public.reports (status, created_at desc);

drop trigger if exists trg_reports_updated_at on public.reports;
create trigger trg_reports_updated_at before update on public.reports
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Engelleme kontrolü (SECURITY DEFINER)
-- ------------------------------------------------------------
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.blocked_users enable row level security;
alter table public.reports       enable row level security;

-- blocked_users: yalnızca engelleyen kişi kendi kayıtlarını yönetir/görür.
drop policy if exists blocked_select_own on public.blocked_users;
create policy blocked_select_own on public.blocked_users
  for select to authenticated using (blocker_id = auth.uid());

drop policy if exists blocked_insert_own on public.blocked_users;
create policy blocked_insert_own on public.blocked_users
  for insert to authenticated with check (blocker_id = auth.uid());

drop policy if exists blocked_delete_own on public.blocked_users;
create policy blocked_delete_own on public.blocked_users
  for delete to authenticated using (blocker_id = auth.uid());

-- reports: kullanıcı kendi şikâyetini oluşturur/görür; moderatör+admin hepsini görür.
drop policy if exists reports_insert_reporter on public.reports;
create policy reports_insert_reporter on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists reports_select_own_or_mod on public.reports;
create policy reports_select_own_or_mod on public.reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_moderator(auth.uid()));

-- Şikâyet durumunu yalnızca moderatör/admin günceller.
drop policy if exists reports_update_mod on public.reports;
create policy reports_update_mod on public.reports
  for update to authenticated
  using (public.is_moderator(auth.uid()))
  with check (public.is_moderator(auth.uid()));

-- ------------------------------------------------------------
-- get_or_create_direct_conversation: engelli çiftlerde sohbet açma
-- (002'deki fonksiyonu engelleme kontrolüyle güncelle)
-- ------------------------------------------------------------
create or replace function public.get_or_create_direct_conversation(other_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  conv uuid;
begin
  if me is null then
    raise exception 'Yetkisiz istek';
  end if;
  if other_id = me then
    raise exception 'Kendinizle sohbet açamazsınız';
  end if;
  if not exists (select 1 from public.profiles where id = other_id) then
    raise exception 'Kullanıcı bulunamadı';
  end if;
  if public.is_blocked_pair(me, other_id) then
    raise exception 'Bu kullanıcıyla sohbet başlatılamaz (engelleme mevcut)';
  end if;

  select c.id into conv
  from public.conversations c
  where coalesce(c.type, 'direct') = 'direct'
    and exists (select 1 from public.conversation_members m1 where m1.conversation_id = c.id and m1.user_id = me)
    and exists (select 1 from public.conversation_members m2 where m2.conversation_id = c.id and m2.user_id = other_id)
    and (select count(*) from public.conversation_members m3 where m3.conversation_id = c.id) = 2
  limit 1;

  if conv is not null then
    return conv;
  end if;

  insert into public.conversations (type, is_group, created_by)
  values ('direct', false, me)
  returning id into conv;

  insert into public.conversation_members (conversation_id, user_id, member_role) values (conv, me, 'owner');
  insert into public.conversation_members (conversation_id, user_id, member_role) values (conv, other_id, 'member');

  return conv;
end;
$$;

grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
