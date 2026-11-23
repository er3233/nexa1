-- ============================================================
-- Nexa Chat — KONSOLİDE ŞEMA (tam, üretim seviyesi)
-- Tamamen idempotenttir; tek seferde çalıştırılabilir.
--
-- KULLANIM:
--   • YENİ/BOŞ proje  → yalnızca bu dosyayı çalıştırmak yeterli.
--   • MEVCUT proje    → migrations/001..006 dosyalarını sırayla çalıştırın
--                        (bu dosya onların birleşimidir).
--
-- Yıkıcı işlem YOKTUR (DROP TABLE / TRUNCATE yok).
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- TEMEL TABLOLAR
-- ============================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique,
  display_name text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  title      text,
  is_group   boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references auth.users (id) on delete cascade,
  content         text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz
);

-- Recursion önleyen üyelik kontrolü
create or replace function public.is_conversation_member(conv uuid, uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv and m.user_id = uid
  );
$$;

-- ============================================================
-- 001 — PROFİL / ROL / AYARLAR
-- ============================================================
alter table public.profiles add column if not exists avatar_url   text;
alter table public.profiles add column if not exists role         text not null default 'user';
alter table public.profiles add column if not exists status       text;
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists is_online    boolean not null default false;
alter table public.profiles add column if not exists banned_at    timestamptz;
alter table public.profiles add column if not exists ban_reason   text;

do $$ begin
  alter table public.profiles add constraint profiles_role_chk check (role in ('user','moderator','admin'));
exception when duplicate_object then null; end $$;

create unique index if not exists profiles_username_key on public.profiles (username);

create table if not exists public.user_settings (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  theme                    text not null default 'dark',
  language                 text not null default 'tr',
  notifications_enabled    boolean not null default true,
  read_receipts_enabled    boolean not null default true,
  last_seen_visibility     text not null default 'contacts',
  profile_photo_visibility text not null default 'everyone',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
do $$ begin
  alter table public.user_settings add constraint user_settings_last_seen_vis_chk
    check (last_seen_visibility in ('everyone','contacts','nobody'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.user_settings add constraint user_settings_photo_vis_chk
    check (profile_photo_visibility in ('everyone','contacts','nobody'));
exception when duplicate_object then null; end $$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin');
$$;
create or replace function public.is_moderator(uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.role in ('admin','moderator'));
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

create or replace function public.normalize_profile()
returns trigger language plpgsql as $$
begin
  if new.username is not null then new.username := nullif(lower(trim(new.username)), ''); end if;
  return new;
end; $$;
drop trigger if exists trg_profiles_normalize on public.profiles;
create trigger trg_profiles_normalize before insert or update on public.profiles
  for each row execute function public.normalize_profile();

create or replace function public.protect_profile_privileged()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then
    new.role := old.role; new.banned_at := old.banned_at; new.ban_reason := old.ban_reason;
  end if;
  return new;
end; $$;
drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_privileged();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare base_name text; uname text;
begin
  base_name := coalesce(nullif(lower(trim(new.raw_user_meta_data ->> 'username')), ''), split_part(new.email, '@', 1));
  uname := base_name;
  if exists (select 1 from public.profiles where username = uname) then
    uname := base_name || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  insert into public.profiles (id, username, display_name)
  values (new.id, uname, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), base_name))
  on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles      enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists user_settings_select_self on public.user_settings;
create policy user_settings_select_self on public.user_settings for select to authenticated using (user_id = auth.uid());
drop policy if exists user_settings_insert_self on public.user_settings;
create policy user_settings_insert_self on public.user_settings for insert to authenticated with check (user_id = auth.uid());
drop policy if exists user_settings_update_self on public.user_settings;
create policy user_settings_update_self on public.user_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into public.user_settings (user_id)
select p.id from public.profiles p
left join public.user_settings s on s.user_id = p.id
where s.user_id is null on conflict (user_id) do nothing;

grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_moderator(uuid) to authenticated;

-- ============================================================
-- 002 — MESAJLAŞMA
-- ============================================================
alter table public.conversations add column if not exists type            text;
alter table public.conversations add column if not exists avatar_url      text;
alter table public.conversations add column if not exists last_message_at timestamptz;
alter table public.conversations add column if not exists updated_at      timestamptz not null default now();
update public.conversations set type = case when is_group then 'group' else 'direct' end where type is null;
alter table public.conversations alter column type set default 'direct';
do $$ begin
  alter table public.conversations add constraint conversations_type_chk check (type in ('direct','group'));
exception when duplicate_object then null; end $$;
update public.conversations c set last_message_at = coalesce(
  (select max(m.created_at) from public.messages m where m.conversation_id = c.id), c.created_at)
 where last_message_at is null;

alter table public.conversation_members add column if not exists member_role          text not null default 'member';
alter table public.conversation_members add column if not exists muted_until          timestamptz;
alter table public.conversation_members add column if not exists archived_at          timestamptz;
alter table public.conversation_members add column if not exists last_read_message_id uuid;
alter table public.conversation_members add column if not exists last_read_at         timestamptz;
do $$ begin
  alter table public.conversation_members add constraint conversation_members_role_chk check (member_role in ('member','admin','owner'));
exception when duplicate_object then null; end $$;

alter table public.messages add column if not exists reply_to_id  uuid references public.messages (id) on delete set null;
alter table public.messages add column if not exists message_type text not null default 'text';
alter table public.messages add column if not exists metadata     jsonb not null default '{}'::jsonb;
alter table public.messages add column if not exists edited_at    timestamptz;
alter table public.messages add column if not exists updated_at   timestamptz;
do $$ begin
  alter table public.messages add constraint messages_type_chk check (message_type in ('text','image','video','audio','file','system'));
exception when duplicate_object then null; end $$;

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create or replace function public.message_conversation_id(msg uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select conversation_id from public.messages where id = msg;
$$;

create table if not exists public.typing_indicators (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  updated_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists messages_conversation_created_idx  on public.messages (conversation_id, created_at);
create index if not exists messages_reply_to_idx              on public.messages (reply_to_id);
create index if not exists conversation_members_user_conv_idx on public.conversation_members (user_id, conversation_id);
create index if not exists conversation_members_user_idx      on public.conversation_members (user_id);
create index if not exists conversations_last_message_idx     on public.conversations (last_message_at desc);
create index if not exists message_reactions_message_idx      on public.message_reactions (message_id);

create or replace function public.on_message_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at, updated_at = now() where id = new.conversation_id;
  return new;
end; $$;
drop trigger if exists trg_on_message_insert on public.messages;
create trigger trg_on_message_insert after insert on public.messages
  for each row execute function public.on_message_insert();

alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.message_reactions    enable row level security;
alter table public.typing_indicators    enable row level security;

drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member on public.conversations for select to authenticated
  using (created_by = auth.uid() or public.is_conversation_member(id, auth.uid()));
drop policy if exists conversations_insert_creator on public.conversations;
create policy conversations_insert_creator on public.conversations for insert to authenticated with check (created_by = auth.uid());

drop policy if exists members_select_member on public.conversation_members;
create policy members_select_member on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists members_insert on public.conversation_members;
create policy members_insert on public.conversation_members for insert to authenticated
  with check (user_id = auth.uid() or public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists members_delete_self on public.conversation_members;
create policy members_delete_self on public.conversation_members for delete to authenticated using (user_id = auth.uid());

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete to authenticated using (sender_id = auth.uid());

drop policy if exists reactions_select_member on public.message_reactions;
create policy reactions_select_member on public.message_reactions for select to authenticated
  using (public.is_conversation_member(public.message_conversation_id(message_id), auth.uid()));
drop policy if exists reactions_insert_member on public.message_reactions;
create policy reactions_insert_member on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.is_conversation_member(public.message_conversation_id(message_id), auth.uid()));
drop policy if exists reactions_delete_own on public.message_reactions;
create policy reactions_delete_own on public.message_reactions for delete to authenticated using (user_id = auth.uid());

drop policy if exists typing_select_member on public.typing_indicators;
create policy typing_select_member on public.typing_indicators for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists typing_upsert_self on public.typing_indicators;
create policy typing_upsert_self on public.typing_indicators for insert to authenticated
  with check (user_id = auth.uid() and public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists typing_update_self on public.typing_indicators;
create policy typing_update_self on public.typing_indicators for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists typing_delete_self on public.typing_indicators;
create policy typing_delete_self on public.typing_indicators for delete to authenticated using (user_id = auth.uid());

create or replace function public.mark_conversation_read(conv uuid, msg uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_member(conv, auth.uid()) then raise exception 'Bu konuşmanın üyesi değilsiniz'; end if;
  update public.conversation_members set last_read_at = now(), last_read_message_id = coalesce(msg, last_read_message_id)
   where conversation_id = conv and user_id = auth.uid();
end; $$;
create or replace function public.set_conversation_muted(conv uuid, until timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_member(conv, auth.uid()) then raise exception 'Bu konuşmanın üyesi değilsiniz'; end if;
  update public.conversation_members set muted_until = until where conversation_id = conv and user_id = auth.uid();
end; $$;
create or replace function public.set_conversation_archived(conv uuid, archived boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_member(conv, auth.uid()) then raise exception 'Bu konuşmanın üyesi değilsiniz'; end if;
  update public.conversation_members set archived_at = case when archived then now() else null end
   where conversation_id = conv and user_id = auth.uid();
end; $$;
create or replace function public.get_unread_counts()
returns table (conversation_id uuid, unread integer)
language sql security definer stable set search_path = public as $$
  select m.conversation_id, count(msg.*)::int
  from public.conversation_members m
  join public.messages msg on msg.conversation_id = m.conversation_id
  where m.user_id = auth.uid() and msg.sender_id <> auth.uid() and msg.deleted_at is null
    and (m.last_read_at is null or msg.created_at > m.last_read_at)
  group by m.conversation_id;
$$;

grant execute on function public.mark_conversation_read(uuid, uuid) to authenticated;
grant execute on function public.set_conversation_muted(uuid, timestamptz) to authenticated;
grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;
grant execute on function public.get_unread_counts() to authenticated;
grant execute on function public.message_conversation_id(uuid) to authenticated;
-- ============================================================
-- 003 — SOSYAL (engelleme + şikâyet)
-- ============================================================
create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
do $$ begin
  alter table public.blocked_users add constraint blocked_users_not_self_chk check (blocker_id <> blocked_id);
exception when duplicate_object then null; end $$;
create index if not exists blocked_users_pair_idx on public.blocked_users (blocker_id, blocked_id);

create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid references auth.users (id) on delete set null,
  message_id       uuid references public.messages (id) on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  reason           text not null,
  details          text,
  status           text not null default 'open',
  resolved_by      uuid references auth.users (id) on delete set null,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
do $$ begin
  alter table public.reports add constraint reports_status_chk check (status in ('open','reviewing','resolved','dismissed'));
exception when duplicate_object then null; end $$;
create index if not exists reports_status_created_idx on public.reports (status, created_at desc);
drop trigger if exists trg_reports_updated_at on public.reports;
create trigger trg_reports_updated_at before update on public.reports
  for each row execute function public.set_updated_at();

create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.blocked_users
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

alter table public.blocked_users enable row level security;
alter table public.reports       enable row level security;

drop policy if exists blocked_select_own on public.blocked_users;
create policy blocked_select_own on public.blocked_users for select to authenticated using (blocker_id = auth.uid());
drop policy if exists blocked_insert_own on public.blocked_users;
create policy blocked_insert_own on public.blocked_users for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists blocked_delete_own on public.blocked_users;
create policy blocked_delete_own on public.blocked_users for delete to authenticated using (blocker_id = auth.uid());

drop policy if exists reports_insert_reporter on public.reports;
create policy reports_insert_reporter on public.reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists reports_select_own_or_mod on public.reports;
create policy reports_select_own_or_mod on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_moderator(auth.uid()));
drop policy if exists reports_update_mod on public.reports;
create policy reports_update_mod on public.reports for update to authenticated
  using (public.is_moderator(auth.uid())) with check (public.is_moderator(auth.uid()));

-- direct conversation RPC (engelleme kontrolü dahil)
create or replace function public.get_or_create_direct_conversation(other_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  if other_id = me then raise exception 'Kendinizle sohbet açamazsınız'; end if;
  if not exists (select 1 from public.profiles where id = other_id) then raise exception 'Kullanıcı bulunamadı'; end if;
  if public.is_blocked_pair(me, other_id) then raise exception 'Bu kullanıcıyla sohbet başlatılamaz (engelleme mevcut)'; end if;
  select c.id into conv from public.conversations c
  where coalesce(c.type,'direct') = 'direct'
    and exists (select 1 from public.conversation_members m1 where m1.conversation_id = c.id and m1.user_id = me)
    and exists (select 1 from public.conversation_members m2 where m2.conversation_id = c.id and m2.user_id = other_id)
    and (select count(*) from public.conversation_members m3 where m3.conversation_id = c.id) = 2
  limit 1;
  if conv is not null then return conv; end if;
  insert into public.conversations (type, is_group, created_by) values ('direct', false, me) returning id into conv;
  insert into public.conversation_members (conversation_id, user_id, member_role) values (conv, me, 'owner');
  insert into public.conversation_members (conversation_id, user_id, member_role) values (conv, other_id, 'member');
  return conv;
end; $$;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

-- ============================================================
-- 004 — ADMIN / DENETİM / MODERASYON
-- ============================================================
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id    uuid references auth.users (id) on delete set null,
  action      text not null,
  target_type text,
  target_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);
alter table public.admin_audit_logs enable row level security;
drop policy if exists audit_select_admin on public.admin_audit_logs;
create policy audit_select_admin on public.admin_audit_logs for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.log_admin_action(p_action text, p_target_type text, p_target_id uuid, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
end; $$;

create or replace function public.admin_ban_user(target uuid, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  if target = auth.uid() then raise exception 'Kendinizi yasaklayamazsınız'; end if;
  update public.profiles set banned_at = now(), ban_reason = reason where id = target;
  perform public.log_admin_action('ban_user', 'profile', target, jsonb_build_object('reason', reason));
end; $$;
create or replace function public.admin_unban_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  update public.profiles set banned_at = null, ban_reason = null where id = target;
  perform public.log_admin_action('unban_user', 'profile', target, '{}'::jsonb);
end; $$;
create or replace function public.admin_set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  if new_role not in ('user','moderator','admin') then raise exception 'Geçersiz rol'; end if;
  update public.profiles set role = new_role where id = target;
  perform public.log_admin_action('set_role', 'profile', target, jsonb_build_object('role', new_role));
end; $$;
create or replace function public.admin_soft_delete_message(msg uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moderator(auth.uid()) then raise exception 'Yetki yok (moderatör gerekli)'; end if;
  update public.messages set deleted_at = now(), updated_at = now() where id = msg;
  perform public.log_admin_action('soft_delete_message', 'message', msg, '{}'::jsonb);
end; $$;
create or replace function public.admin_review_report(report_id uuid, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moderator(auth.uid()) then raise exception 'Yetki yok (moderatör gerekli)'; end if;
  if new_status not in ('open','reviewing','resolved','dismissed') then raise exception 'Geçersiz durum'; end if;
  update public.reports set status = new_status,
    resolved_by = case when new_status in ('resolved','dismissed') then auth.uid() else null end,
    resolved_at = case when new_status in ('resolved','dismissed') then now() else null end
   where id = report_id;
  perform public.log_admin_action('review_report', 'report', report_id, jsonb_build_object('status', new_status));
end; $$;
create or replace function public.admin_list_users(search text default null, lim integer default 50, off integer default 0)
returns setof public.profiles language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_moderator(auth.uid()) then raise exception 'Yetki yok (moderatör gerekli)'; end if;
  return query select * from public.profiles p
    where search is null or p.username ilike '%'||search||'%' or p.display_name ilike '%'||search||'%'
    order by p.created_at desc limit greatest(1, least(lim, 200)) offset greatest(0, off);
end; $$;
create or replace function public.admin_list_reports(status_filter text default null, lim integer default 50, off integer default 0)
returns setof public.reports language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_moderator(auth.uid()) then raise exception 'Yetki yok (moderatör gerekli)'; end if;
  return query select * from public.reports r
    where status_filter is null or r.status = status_filter
    order by r.created_at desc limit greatest(1, least(lim, 200)) offset greatest(0, off);
end; $$;

grant execute on function public.admin_ban_user(uuid, text) to authenticated;
grant execute on function public.admin_unban_user(uuid) to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_soft_delete_message(uuid) to authenticated;
grant execute on function public.admin_review_report(uuid, text) to authenticated;
grant execute on function public.admin_list_users(text, integer, integer) to authenticated;
grant execute on function public.admin_list_reports(text, integer, integer) to authenticated;

-- ============================================================
-- 005 — STORAGE
-- ============================================================
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', false) on conflict (id) do nothing;

create or replace function public.can_access_chat_media(object_name text)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare folder text; conv uuid;
begin
  folder := split_part(object_name, '/', 1);
  if folder !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  conv := folder::uuid;
  return public.is_conversation_member(conv, auth.uid());
end; $$;
grant execute on function public.can_access_chat_media(text) to authenticated;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars insert own folder" on storage.objects;
create policy "avatars insert own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars update own folder" on storage.objects;
create policy "avatars update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars delete own folder" on storage.objects;
create policy "avatars delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chat-media read members" on storage.objects;
create policy "chat-media read members" on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and public.can_access_chat_media(name));
drop policy if exists "chat-media insert members" on storage.objects;
create policy "chat-media insert members" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and owner = auth.uid() and public.can_access_chat_media(name));
drop policy if exists "chat-media update owner" on storage.objects;
create policy "chat-media update owner" on storage.objects for update to authenticated
  using (bucket_id = 'chat-media' and owner = auth.uid()) with check (bucket_id = 'chat-media' and owner = auth.uid());
drop policy if exists "chat-media delete owner or mod" on storage.objects;
create policy "chat-media delete owner or mod" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media' and (owner = auth.uid() or public.is_moderator(auth.uid())));

-- ============================================================
-- 006 — REALTIME
-- ============================================================
do $$
declare t text; tables text[] := array['messages','message_reactions','typing_indicators','conversation_members'];
begin
  foreach t in array tables loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then null; end;
  end loop;
end $$;

alter table public.messages             replica identity full;
alter table public.message_reactions    replica identity full;
alter table public.typing_indicators    replica identity full;
alter table public.conversation_members replica identity full;

-- ============================================================
-- 007 — HESAP ONAYI + KULLANICI YÖNETİMİ + KULLANICI ARAMA
-- (Bu bölüm önceki tanımların üzerine yazar; en sonda çalışır.)
-- ============================================================
alter table public.profiles add column if not exists approval_status     text;
alter table public.profiles add column if not exists approved_at         timestamptz;
alter table public.profiles add column if not exists approved_by         uuid references public.profiles (id) on delete set null;
alter table public.profiles add column if not exists rejected_at         timestamptz;
alter table public.profiles add column if not exists rejection_reason    text;
alter table public.profiles add column if not exists deactivated_at      timestamptz;
alter table public.profiles add column if not exists deactivated_by      uuid references public.profiles (id) on delete set null;
alter table public.profiles add column if not exists deactivation_reason text;

update public.profiles set approval_status = 'approved', approved_at = coalesce(approved_at, now())
 where approval_status is null;
alter table public.profiles alter column approval_status set default 'pending';
alter table public.profiles alter column approval_status set not null;
do $$ begin
  alter table public.profiles add constraint profiles_approval_status_chk check (approval_status in ('pending','approved','rejected'));
exception when duplicate_object then null; end $$;
create index if not exists profiles_approval_status_idx on public.profiles (approval_status);
create index if not exists profiles_deactivated_idx on public.profiles (deactivated_at);
do $$ begin
  create extension if not exists pg_trgm;
  create index if not exists profiles_username_trgm_idx     on public.profiles using gin (username gin_trgm_ops);
  create index if not exists profiles_display_name_trgm_idx on public.profiles using gin (display_name gin_trgm_ops);
exception when others then raise notice 'pg_trgm yok: %', sqlerrm; end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare base_name text; uname text;
begin
  base_name := coalesce(nullif(lower(trim(new.raw_user_meta_data ->> 'username')), ''), split_part(new.email, '@', 1));
  uname := base_name;
  if exists (select 1 from public.profiles where username = uname) then
    uname := base_name || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  insert into public.profiles (id, username, display_name, approval_status)
  values (new.id, uname, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), base_name), 'pending')
  on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end; $$;

create or replace function public.protect_profile_privileged()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then
    new.role := old.role; new.banned_at := old.banned_at; new.ban_reason := old.ban_reason;
    new.approval_status := old.approval_status; new.approved_at := old.approved_at; new.approved_by := old.approved_by;
    new.rejected_at := old.rejected_at; new.rejection_reason := old.rejection_reason;
    new.deactivated_at := old.deactivated_at; new.deactivated_by := old.deactivated_by; new.deactivation_reason := old.deactivation_reason;
  end if;
  return new;
end; $$;

create or replace function public.is_approved_user(uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = uid and p.approval_status = 'approved' and p.banned_at is null and p.deactivated_at is null);
$$;
grant execute on function public.is_approved_user(uuid) to authenticated;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_approved_user(auth.uid()));

drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member on public.conversations for select to authenticated
  using (public.is_approved_user(auth.uid()) and (created_by = auth.uid() or public.is_conversation_member(id, auth.uid())));
drop policy if exists conversations_insert_creator on public.conversations;
create policy conversations_insert_creator on public.conversations for insert to authenticated
  with check (created_by = auth.uid() and public.is_approved_user(auth.uid()));

drop policy if exists members_select_member on public.conversation_members;
create policy members_select_member on public.conversation_members for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists members_insert on public.conversation_members;
create policy members_insert on public.conversation_members for insert to authenticated
  with check (public.is_approved_user(auth.uid()) and (user_id = auth.uid() or public.is_conversation_member(conversation_id, auth.uid())));

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages for update to authenticated
  using (sender_id = auth.uid() and public.is_approved_user(auth.uid())) with check (sender_id = auth.uid());
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete to authenticated
  using (sender_id = auth.uid() and public.is_approved_user(auth.uid()));

drop policy if exists reactions_select_member on public.message_reactions;
create policy reactions_select_member on public.message_reactions for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(public.message_conversation_id(message_id), auth.uid()));
drop policy if exists reactions_insert_member on public.message_reactions;
create policy reactions_insert_member on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved_user(auth.uid()) and public.is_conversation_member(public.message_conversation_id(message_id), auth.uid()));

drop policy if exists typing_select_member on public.typing_indicators;
create policy typing_select_member on public.typing_indicators for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists typing_upsert_self on public.typing_indicators;
create policy typing_upsert_self on public.typing_indicators for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists typing_update_self on public.typing_indicators;
create policy typing_update_self on public.typing_indicators for update to authenticated
  using (user_id = auth.uid() and public.is_approved_user(auth.uid())) with check (user_id = auth.uid());

create or replace function public.get_or_create_direct_conversation(other_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  if not public.is_approved_user(me) then raise exception 'Hesabınız onaylı değil'; end if;
  if other_id = me then raise exception 'Kendinizle sohbet açamazsınız'; end if;
  if not exists (select 1 from public.profiles where id = other_id) then raise exception 'Kullanıcı bulunamadı'; end if;
  if not public.is_approved_user(other_id) then raise exception 'Bu kullanıcı ile sohbet başlatılamaz'; end if;
  if public.is_blocked_pair(me, other_id) then raise exception 'Bu kullanıcıyla sohbet başlatılamaz (engelleme mevcut)'; end if;
  select c.id into conv from public.conversations c
  where coalesce(c.type,'direct') = 'direct'
    and exists (select 1 from public.conversation_members m1 where m1.conversation_id = c.id and m1.user_id = me)
    and exists (select 1 from public.conversation_members m2 where m2.conversation_id = c.id and m2.user_id = other_id)
    and (select count(*) from public.conversation_members m3 where m3.conversation_id = c.id) = 2
  limit 1;
  if conv is not null then return conv; end if;
  insert into public.conversations (type, is_group, created_by) values ('direct', false, me) returning id into conv;
  insert into public.conversation_members (conversation_id, user_id, member_role) values (conv, me, 'owner');
  insert into public.conversation_members (conversation_id, user_id, member_role) values (conv, other_id, 'member');
  return conv;
end; $$;

create or replace function public.search_approved_users(search_text text, result_limit int default 20)
returns table (id uuid, username text, display_name text, avatar_url text, status text)
language plpgsql security definer stable set search_path = public as $$
declare
  me  uuid := auth.uid();
  q   text := trim(both from coalesce(search_text, ''));
  lim int  := least(greatest(coalesce(result_limit, 20), 1), 20);
begin
  if left(q, 1) = '@' then
    q := trim(both from substring(q from 2));
  end if;
  if me is null or not public.is_approved_user(me) then return; end if;
  if char_length(q) < 2 then return; end if;
  return query
    select p.id, p.username, p.display_name, p.avatar_url, p.status
    from public.profiles p
    where p.id <> me and p.approval_status = 'approved' and p.banned_at is null and p.deactivated_at is null
      and not public.is_blocked_pair(me, p.id)
      and (p.username ilike '%'||q||'%' or p.display_name ilike '%'||q||'%')
    order by (lower(p.username) = lower(q)) desc, (p.username ilike q||'%') desc, p.username asc
    limit lim;
end; $$;
grant execute on function public.search_approved_users(text, int) to authenticated;

create or replace function public.admin_list_pending_users()
returns table (id uuid, username text, display_name text, email text, created_at timestamptz, approval_status text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  return query select p.id, p.username, p.display_name, u.email::text, p.created_at, p.approval_status
    from public.profiles p join auth.users u on u.id = p.id
    where p.approval_status = 'pending' order by p.created_at asc;
end; $$;

create or replace function public.admin_approve_user(target_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  update public.profiles set approval_status = 'approved', approved_at = now(), approved_by = auth.uid(),
    rejected_at = null, rejection_reason = null where id = target_user_id;
  update public.notifications set is_read = true
    where type = 'account_application' and entity_id = target_user_id and is_read = false;
  perform public.log_admin_action('approve_user', 'profile', target_user_id, '{}'::jsonb);
end; $$;

create or replace function public.admin_reject_user(target_user_id uuid, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  if target_user_id = auth.uid() then raise exception 'Kendi hesabınızı reddedemezsiniz'; end if;
  update public.profiles set approval_status = 'rejected', rejected_at = now(), rejection_reason = reason,
    approved_at = null, approved_by = null where id = target_user_id;
  update public.notifications set is_read = true
    where type = 'account_application' and entity_id = target_user_id and is_read = false;
  perform public.log_admin_action('reject_user', 'profile', target_user_id, jsonb_build_object('reason', reason));
end; $$;

create or replace function public.active_admin_count()
returns integer language sql security definer stable set search_path = public as $$
  select count(*)::int from public.profiles where role = 'admin' and banned_at is null and deactivated_at is null;
$$;

drop function if exists public.admin_list_users(text, integer, integer);
create or replace function public.admin_list_users(search_text text default null, status_filter text default null, page_size int default 25, page_offset int default 0)
returns table (id uuid, username text, display_name text, email text, avatar_url text, role text,
  approval_status text, banned_at timestamptz, ban_reason text, deactivated_at timestamptz,
  deactivation_reason text, rejection_reason text, created_at timestamptz, total_count bigint)
language plpgsql security definer stable set search_path = public as $$
declare q text := nullif(trim(coalesce(search_text,'')),''); lim int := least(greatest(coalesce(page_size,25),1),100);
  off int := greatest(coalesce(page_offset,0),0); sf text := nullif(trim(coalesce(status_filter,'')),'');
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  return query
    select p.id, p.username, p.display_name, u.email::text, p.avatar_url, p.role,
      p.approval_status, p.banned_at, p.ban_reason, p.deactivated_at, p.deactivation_reason,
      p.rejection_reason, p.created_at, count(*) over()::bigint
    from public.profiles p join auth.users u on u.id = p.id
    where (q is null or p.username ilike '%'||q||'%' or p.display_name ilike '%'||q||'%' or u.email ilike '%'||q||'%')
      and (sf is null
        or (sf = 'pending' and p.approval_status = 'pending')
        or (sf = 'approved' and p.approval_status = 'approved' and p.banned_at is null and p.deactivated_at is null)
        or (sf = 'rejected' and p.approval_status = 'rejected')
        or (sf = 'deactivated' and p.deactivated_at is not null)
        or (sf = 'banned' and p.banned_at is not null))
    order by p.created_at desc limit lim offset off;
end; $$;

create or replace function public.admin_deactivate_user(target_user_id uuid, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  if target_user_id = auth.uid() then raise exception 'Kendi hesabınızı devre dışı bırakamazsınız'; end if;
  select role into target_role from public.profiles where id = target_user_id;
  if target_role = 'admin' and public.active_admin_count() <= 1 then raise exception 'Son aktif admini devre dışı bırakamazsınız'; end if;
  update public.profiles set deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = reason where id = target_user_id;
  perform public.log_admin_action('deactivate_user', 'profile', target_user_id, jsonb_build_object('reason', reason));
end; $$;

create or replace function public.admin_reactivate_user(target_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  update public.profiles set deactivated_at = null, deactivated_by = null, deactivation_reason = null where id = target_user_id;
  perform public.log_admin_action('reactivate_user', 'profile', target_user_id, '{}'::jsonb);
end; $$;

create or replace function public.admin_ban_user(target uuid, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  if target = auth.uid() then raise exception 'Kendinizi yasaklayamazsınız'; end if;
  select role into target_role from public.profiles where id = target;
  if target_role = 'admin' and public.active_admin_count() <= 1 then raise exception 'Son aktif admini yasaklayamazsınız'; end if;
  update public.profiles set banned_at = now(), ban_reason = reason where id = target;
  perform public.log_admin_action('ban_user', 'profile', target, jsonb_build_object('reason', reason));
end; $$;

grant execute on function public.admin_list_pending_users() to authenticated;
grant execute on function public.admin_approve_user(uuid) to authenticated;
grant execute on function public.admin_reject_user(uuid, text) to authenticated;
grant execute on function public.admin_list_users(text, text, int, int) to authenticated;
grant execute on function public.admin_deactivate_user(uuid, text) to authenticated;
grant execute on function public.admin_reactivate_user(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
alter table public.profiles replica identity full;

-- ============================================================
-- 008 — MESAJLAŞMA İSTEĞİ SİSTEMİ
-- ============================================================
create table if not exists public.message_requests (
  id              uuid primary key default gen_random_uuid(),
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  receiver_id     uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'pending',
  message_preview text,
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at      timestamptz not null default now(),
  responded_at    timestamptz,
  updated_at      timestamptz not null default now()
);
do $$ begin
  alter table public.message_requests add constraint message_requests_not_self_chk check (sender_id <> receiver_id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.message_requests add constraint message_requests_status_chk check (status in ('pending','accepted','rejected','cancelled'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.message_requests add constraint message_requests_preview_len_chk check (message_preview is null or char_length(message_preview) <= 300);
exception when duplicate_object then null; end $$;
create unique index if not exists message_requests_unique_pending on public.message_requests (sender_id, receiver_id) where status = 'pending';
create index if not exists message_requests_receiver_status_idx on public.message_requests (receiver_id, status, created_at desc);
create index if not exists message_requests_sender_status_idx   on public.message_requests (sender_id, status, created_at desc);
drop trigger if exists trg_message_requests_updated_at on public.message_requests;
create trigger trg_message_requests_updated_at before update on public.message_requests
  for each row execute function public.set_updated_at();

alter table public.message_requests enable row level security;
drop policy if exists message_requests_select_own on public.message_requests;
create policy message_requests_select_own on public.message_requests for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

create or replace function public.find_direct_conversation(a uuid, b uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select c.id from public.conversations c
  where coalesce(c.type, 'direct') = 'direct'
    and exists (select 1 from public.conversation_members m1 where m1.conversation_id = c.id and m1.user_id = a)
    and exists (select 1 from public.conversation_members m2 where m2.conversation_id = c.id and m2.user_id = b)
    and (select count(*) from public.conversation_members m3 where m3.conversation_id = c.id) = 2
  limit 1;
$$;
grant execute on function public.find_direct_conversation(uuid, uuid) to authenticated;

create or replace function public.send_message_request(receiver_user_id uuid, preview text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid; existing uuid; new_id uuid;
  clean_preview text := nullif(btrim(coalesce(preview, '')), '');
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if receiver_user_id = me then raise exception 'Kendinize istek gönderemezsiniz'; end if;
  if not exists (select 1 from public.profiles where id = receiver_user_id) then raise exception 'Kullanıcı bulunamadı'; end if;
  if not public.is_approved_user(receiver_user_id) then raise exception 'Bu kullanıcıya istek gönderilemez'; end if;
  if public.is_blocked_pair(me, receiver_user_id) then raise exception 'Bu kullanıcıyla iletişim kurulamaz'; end if;
  if clean_preview is not null and char_length(clean_preview) > 300 then clean_preview := left(clean_preview, 300); end if;
  conv := public.find_direct_conversation(me, receiver_user_id);
  if conv is not null then return jsonb_build_object('type','existing_conversation','conversation_id',conv,'request_id',null); end if;
  select id into existing from public.message_requests where sender_id = me and receiver_id = receiver_user_id and status = 'pending' limit 1;
  if existing is not null then return jsonb_build_object('type','already_pending','conversation_id',null,'request_id',existing); end if;
  if exists (select 1 from public.message_requests where sender_id = me and receiver_id = receiver_user_id and status = 'rejected'
      and responded_at is not null and responded_at > now() - interval '1 hour') then
    raise exception 'Bu kullanıcıya kısa süre önce istek gönderdiniz. Lütfen sonra tekrar deneyin.';
  end if;
  insert into public.message_requests (sender_id, receiver_id, status, message_preview)
  values (me, receiver_user_id, 'pending', clean_preview) returning id into new_id;
  return jsonb_build_object('type','request_sent','conversation_id',null,'request_id',new_id);
end; $$;

create or replace function public.list_incoming_message_requests()
returns table (id uuid, sender_id uuid, username text, display_name text, avatar_url text, message_preview text, created_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  return query select r.id, r.sender_id, p.username, p.display_name, p.avatar_url, r.message_preview, r.created_at
    from public.message_requests r join public.profiles p on p.id = r.sender_id
    where r.receiver_id = me and r.status = 'pending' and not public.is_blocked_pair(me, r.sender_id)
    order by r.created_at desc;
end; $$;

create or replace function public.list_outgoing_message_requests()
returns table (id uuid, receiver_id uuid, username text, display_name text, avatar_url text, status text, message_preview text, created_at timestamptz, responded_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  return query select r.id, r.receiver_id, p.username, p.display_name, p.avatar_url, r.status, r.message_preview, r.created_at, r.responded_at
    from public.message_requests r join public.profiles p on p.id = r.receiver_id
    where r.sender_id = me order by r.created_at desc limit 50;
end; $$;

create or replace function public.accept_message_request(request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.message_requests%rowtype; conv uuid;
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  select * into r from public.message_requests where id = request_id for update;
  if not found then raise exception 'İstek bulunamadı'; end if;
  if r.receiver_id <> me then raise exception 'Bu isteği kabul edemezsiniz'; end if;
  if r.status <> 'pending' then raise exception 'İstek zaten yanıtlanmış'; end if;
  if public.is_blocked_pair(me, r.sender_id) then raise exception 'Bu kullanıcıyla iletişim kurulamaz'; end if;
  conv := public.get_or_create_direct_conversation(r.sender_id);
  update public.message_requests set status = 'accepted', conversation_id = conv, responded_at = now() where id = request_id;
  return conv;
end; $$;

create or replace function public.reject_message_request(request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.message_requests%rowtype;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select * into r from public.message_requests where id = request_id for update;
  if not found then raise exception 'İstek bulunamadı'; end if;
  if r.receiver_id <> me then raise exception 'Bu isteği reddedemezsiniz'; end if;
  if r.status <> 'pending' then raise exception 'İstek zaten yanıtlanmış'; end if;
  update public.message_requests set status = 'rejected', responded_at = now() where id = request_id;
end; $$;

create or replace function public.cancel_message_request(request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.message_requests%rowtype;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select * into r from public.message_requests where id = request_id for update;
  if not found then raise exception 'İstek bulunamadı'; end if;
  if r.sender_id <> me then raise exception 'Bu isteği iptal edemezsiniz'; end if;
  if r.status <> 'pending' then raise exception 'İstek zaten yanıtlanmış'; end if;
  update public.message_requests set status = 'cancelled', responded_at = now() where id = request_id;
end; $$;

create or replace function public.get_message_request_count()
returns integer language sql security definer stable set search_path = public as $$
  select count(*)::int from public.message_requests where receiver_id = auth.uid() and status = 'pending';
$$;

grant execute on function public.send_message_request(uuid, text)  to authenticated;
grant execute on function public.list_incoming_message_requests()  to authenticated;
grant execute on function public.list_outgoing_message_requests()  to authenticated;
grant execute on function public.accept_message_request(uuid)      to authenticated;
grant execute on function public.reject_message_request(uuid)      to authenticated;
grant execute on function public.cancel_message_request(uuid)      to authenticated;
grant execute on function public.get_message_request_count()       to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.message_requests;
exception when duplicate_object then null; end $$;
alter table public.message_requests replica identity full;

-- ============================================================
-- 009 — BİREBİR WEBRTC SESLİ/GÖRÜNTÜLÜ ARAMA
-- ============================================================
create table if not exists public.call_sessions (
  id              uuid primary key default gen_random_uuid(),
  caller_id       uuid not null references public.profiles (id) on delete cascade,
  receiver_id     uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  call_type       text not null default 'audio',
  status          text not null default 'ringing',
  started_at      timestamptz not null default now(),
  answered_at     timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$ begin
  alter table public.call_sessions add constraint call_sessions_type_chk check (call_type in ('audio','video'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.call_sessions add constraint call_sessions_status_chk check (status in ('ringing','accepted','rejected','cancelled','ended','missed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.call_sessions add constraint call_sessions_not_self_chk check (caller_id <> receiver_id);
exception when duplicate_object then null; end $$;
create index if not exists call_sessions_receiver_idx on public.call_sessions (receiver_id, status, created_at desc);
create index if not exists call_sessions_caller_idx   on public.call_sessions (caller_id, status, created_at desc);
drop trigger if exists trg_call_sessions_updated_at on public.call_sessions;
create trigger trg_call_sessions_updated_at before update on public.call_sessions
  for each row execute function public.set_updated_at();

create table if not exists public.call_signals (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid not null references public.call_sessions (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  signal_type text not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);
do $$ begin
  alter table public.call_signals add constraint call_signals_type_chk check (signal_type in ('offer','answer','ice_candidate'));
exception when duplicate_object then null; end $$;
create index if not exists call_signals_call_idx on public.call_signals (call_id, created_at asc);

create or replace function public.is_call_participant(cid uuid, uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.call_sessions c where c.id = cid and (c.caller_id = uid or c.receiver_id = uid));
$$;
grant execute on function public.is_call_participant(uuid, uuid) to authenticated;

alter table public.call_sessions enable row level security;
drop policy if exists call_sessions_select_participant on public.call_sessions;
create policy call_sessions_select_participant on public.call_sessions for select to authenticated
  using (caller_id = auth.uid() or receiver_id = auth.uid());

alter table public.call_signals enable row level security;
drop policy if exists call_signals_select_participant on public.call_signals;
create policy call_signals_select_participant on public.call_signals for select to authenticated
  using (public.is_call_participant(call_id, auth.uid()));
drop policy if exists call_signals_insert_participant on public.call_signals;
create policy call_signals_insert_participant on public.call_signals for insert to authenticated
  with check (sender_id = auth.uid() and public.is_approved_user(auth.uid()) and public.is_call_participant(call_id, auth.uid()));

create or replace function public.expire_stale_calls()
returns void language sql security definer set search_path = public as $$
  update public.call_sessions set status = 'missed', ended_at = now()
  where status = 'ringing' and started_at < now() - interval '45 seconds';

  update public.call_sessions set status = 'ended', ended_at = coalesce(ended_at, now())
  where status = 'accepted'
    and coalesce(answered_at, started_at) < now() - interval '15 minutes';
$$;
grant execute on function public.expire_stale_calls() to authenticated;

create or replace function public.start_call(receiver_user_id uuid, conversation_id uuid, call_type text default 'audio')
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); new_id uuid; ct text := lower(coalesce(call_type,'audio'));
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız arama için uygun değil'; end if;
  if receiver_user_id = me then raise exception 'Kendinizi arayamazsınız'; end if;
  if ct not in ('audio','video') then ct := 'audio'; end if;
  if not public.is_approved_user(receiver_user_id) then raise exception 'Bu kullanıcı aranamaz'; end if;
  if public.is_blocked_pair(me, receiver_user_id) then raise exception 'Bu kullanıcıyla iletişim kurulamaz'; end if;
  if conversation_id is null or public.find_direct_conversation(me, receiver_user_id) is distinct from conversation_id then
    raise exception 'Geçerli bir birebir sohbet gerekiyor';
  end if;
  perform public.expire_stale_calls();

  update public.call_sessions
     set status = case when status = 'ringing' then 'missed' else 'ended' end,
         ended_at = now()
   where status in ('ringing', 'accepted')
     and (caller_id = me or receiver_id = me)
     and started_at < now() - interval '45 seconds';

  if exists (select 1 from public.call_sessions where status in ('ringing','accepted')
      and (caller_id = me or receiver_id = me or caller_id = receiver_user_id or receiver_id = receiver_user_id)) then
    raise exception 'Zaten aktif bir çağrı var';
  end if;
  insert into public.call_sessions (caller_id, receiver_id, conversation_id, call_type, status)
  values (me, receiver_user_id, conversation_id, ct, 'ringing') returning id into new_id;
  return new_id;
end; $$;

create or replace function public.accept_call(call_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.call_sessions%rowtype;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select * into r from public.call_sessions where id = call_id for update;
  if not found then raise exception 'Çağrı bulunamadı'; end if;
  if r.receiver_id <> me then raise exception 'Bu çağrıyı kabul edemezsiniz'; end if;
  if r.status <> 'ringing' then raise exception 'Çağrı artık aktif değil'; end if;
  update public.call_sessions set status = 'accepted', answered_at = now() where id = call_id;
end; $$;

create or replace function public.reject_call(call_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.call_sessions%rowtype;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select * into r from public.call_sessions where id = call_id for update;
  if not found then raise exception 'Çağrı bulunamadı'; end if;
  if r.receiver_id <> me then raise exception 'Bu çağrıyı reddedemezsiniz'; end if;
  if r.status <> 'ringing' then raise exception 'Çağrı artık aktif değil'; end if;
  update public.call_sessions set status = 'rejected', ended_at = now() where id = call_id;
  delete from public.call_signals where call_id = r.id;
end; $$;

create or replace function public.cancel_call(call_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.call_sessions%rowtype;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select * into r from public.call_sessions where id = call_id for update;
  if not found then raise exception 'Çağrı bulunamadı'; end if;
  if r.caller_id <> me then raise exception 'Bu çağrıyı iptal edemezsiniz'; end if;
  if r.status <> 'ringing' then raise exception 'Çağrı artık aktif değil'; end if;
  update public.call_sessions set status = 'cancelled', ended_at = now() where id = call_id;
  delete from public.call_signals where call_id = r.id;
end; $$;

create or replace function public.end_call(call_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.call_sessions%rowtype;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select * into r from public.call_sessions where id = call_id for update;
  if not found then raise exception 'Çağrı bulunamadı'; end if;
  if r.caller_id <> me and r.receiver_id <> me then raise exception 'Bu çağrıyı sonlandıramazsınız'; end if;
  if r.status in ('ended','rejected','cancelled','missed') then return; end if;
  update public.call_sessions set status = 'ended', ended_at = now() where id = call_id;
  delete from public.call_signals where call_id = r.id;
end; $$;

create or replace function public.mark_missed_call(call_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.call_sessions%rowtype;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select * into r from public.call_sessions where id = call_id for update;
  if not found then raise exception 'Çağrı bulunamadı'; end if;
  if r.caller_id <> me and r.receiver_id <> me then raise exception 'Yetkisiz istek'; end if;
  if r.status <> 'ringing' then return; end if;
  update public.call_sessions set status = 'missed', ended_at = now() where id = call_id;
  delete from public.call_signals where call_id = r.id;
end; $$;

grant execute on function public.start_call(uuid, uuid, text) to authenticated;
grant execute on function public.accept_call(uuid)  to authenticated;
grant execute on function public.reject_call(uuid)  to authenticated;
grant execute on function public.cancel_call(uuid)  to authenticated;
grant execute on function public.end_call(uuid)     to authenticated;
grant execute on function public.mark_missed_call(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.call_sessions;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.call_signals;
exception when duplicate_object then null; end $$;
alter table public.call_sessions replica identity full;
alter table public.call_signals replica identity full;

-- ============================================================
-- 010 — UYGULAMA İÇİ BİLDİRİMLER (admin başvuru bildirimi)
-- ============================================================
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  type         text not null,
  title        text not null,
  body         text,
  entity_id    uuid,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, is_read, created_at desc);
create unique index if not exists notifications_dedupe_idx
  on public.notifications (recipient_id, type, entity_id);

alter table public.notifications enable row level security;
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
  using (recipient_id = auth.uid());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create or replace function public.notify_admins_new_application()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, title, body, entity_id)
  select a.id, new.id, 'account_application', 'Yeni hesap başvurusu',
         coalesce(nullif(new.display_name, ''), new.username, 'Bir kullanıcı') || ' onay bekliyor', new.id
  from public.profiles a
  where a.role = 'admin' and a.banned_at is null and a.deactivated_at is null
  on conflict (recipient_id, type, entity_id) do nothing;
  return new;
end; $$;

drop trigger if exists trg_notify_admins_new_application on public.profiles;
create trigger trg_notify_admins_new_application
  after insert on public.profiles
  for each row when (new.approval_status = 'pending')
  execute function public.notify_admins_new_application();

-- Taze kurulumda pending kullanıcı yoktur; mevcut DB için 010 migration backfill yapar.
insert into public.notifications (recipient_id, actor_id, type, title, body, entity_id)
select a.id, p.id, 'account_application', 'Yeni hesap başvurusu',
       coalesce(nullif(p.display_name, ''), p.username, 'Bir kullanıcı') || ' onay bekliyor', p.id
from public.profiles p
cross join public.profiles a
where p.approval_status = 'pending'
  and a.role = 'admin' and a.banned_at is null and a.deactivated_at is null
on conflict (recipient_id, type, entity_id) do nothing;

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
alter table public.notifications replica identity full;

-- ============================================================
-- 011 — CANLI YAZIM + SOHBET KİLİDİ
-- ============================================================
alter table public.conversation_members
  add column if not exists live_typing_enabled boolean not null default false;

create or replace function public.set_live_typing_enabled(conversation_id uuid, enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; grp boolean; cnt int;
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_conversation_member(conv, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  select (coalesce(c.type,'direct') = 'group' or c.is_group) into grp from public.conversations c where c.id = conv;
  select count(*) into cnt from public.conversation_members m where m.conversation_id = conv;
  if coalesce(grp,false) or cnt <> 2 then
    raise exception 'Canlı yazım yalnızca birebir sohbetlerde kullanılabilir';
  end if;
  update public.conversation_members set live_typing_enabled = coalesce(enabled, false)
   where conversation_members.conversation_id = conv and conversation_members.user_id = me;
end; $$;

create or replace function public.get_live_typing_status(conversation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; other uuid; grp boolean; cnt int; me_en boolean; other_en boolean; eligible boolean;
begin
  if me is null or not public.is_conversation_member(conv, me) then
    return jsonb_build_object('eligible', false, 'me_enabled', false, 'other_enabled', false, 'active', false);
  end if;
  select (coalesce(c.type,'direct') = 'group' or c.is_group) into grp from public.conversations c where c.id = conv;
  select count(*) into cnt from public.conversation_members m where m.conversation_id = conv;
  select m.user_id into other from public.conversation_members m where m.conversation_id = conv and m.user_id <> me limit 1;
  select m.live_typing_enabled into me_en    from public.conversation_members m where m.conversation_id = conv and m.user_id = me;
  select m.live_typing_enabled into other_en from public.conversation_members m where m.conversation_id = conv and m.user_id = other;
  eligible := (not coalesce(grp,false)) and cnt = 2 and other is not null
              and public.is_approved_user(me) and public.is_approved_user(other)
              and not public.is_blocked_pair(me, other);
  return jsonb_build_object('eligible', eligible, 'me_enabled', coalesce(me_en,false),
    'other_enabled', coalesce(other_en,false), 'active', eligible and coalesce(me_en,false) and coalesce(other_en,false));
end; $$;

grant execute on function public.set_live_typing_enabled(uuid, boolean) to authenticated;
grant execute on function public.get_live_typing_status(uuid) to authenticated;

create table if not exists public.conversation_locks (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  pin_hash        text,
  pin_salt        text,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  unlocked_until  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
drop trigger if exists trg_conversation_locks_updated_at on public.conversation_locks;
create trigger trg_conversation_locks_updated_at before update on public.conversation_locks
  for each row execute function public.set_updated_at();

alter table public.conversation_locks enable row level security;
drop policy if exists locks_select_own on public.conversation_locks;
create policy locks_select_own on public.conversation_locks for select to authenticated using (user_id = auth.uid());
revoke all on public.conversation_locks from authenticated;
revoke all on public.conversation_locks from anon;
grant select (user_id, conversation_id, failed_attempts, locked_until, unlocked_until, created_at, updated_at)
  on public.conversation_locks to authenticated;

create or replace function public.chat_lock_ok(conv uuid, uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (
    select 1 from public.conversation_locks l
    where l.user_id = uid and l.conversation_id = conv and l.pin_hash is not null
      and (l.unlocked_until is null or l.unlocked_until <= now())
  );
$$;
grant execute on function public.chat_lock_ok(uuid, uuid) to authenticated;

create or replace function public.set_conversation_pin(conversation_id uuid, pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; p text := pin; salt text;
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_conversation_member(conv, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  if p is null or p !~ '^[0-9]{4}$' then raise exception 'PIN tam olarak 4 rakam olmalıdır'; end if;
  salt := extensions.gen_salt('bf');
  insert into public.conversation_locks (user_id, conversation_id, pin_hash, pin_salt, failed_attempts, locked_until, unlocked_until)
  values (me, conv, extensions.crypt(p, salt), salt, 0, null, now() + interval '10 minutes')
  on conflict (user_id, conversation_id) do update
    set pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt,
        failed_attempts = 0, locked_until = null, unlocked_until = now() + interval '10 minutes', updated_at = now();
end; $$;

create or replace function public.verify_conversation_pin(conversation_id uuid, pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; p text := pin; r public.conversation_locks%rowtype; ok boolean; new_failed int; new_locked timestamptz;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select * into r from public.conversation_locks where user_id = me and conversation_id = conv for update;
  if not found or r.pin_hash is null then
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('success', false, 'remaining_attempts', 0, 'locked_until', r.locked_until);
  end if;
  ok := (p is not null and p ~ '^[0-9]{4}$' and extensions.crypt(p, r.pin_hash) = r.pin_hash);
  if ok then
    update public.conversation_locks set failed_attempts = 0, locked_until = null, unlocked_until = now() + interval '10 minutes', updated_at = now()
     where user_id = me and conversation_id = conv;
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  else
    new_failed := r.failed_attempts + 1;
    new_locked := case when new_failed >= 5 then now() + interval '15 minutes' else null end;
    update public.conversation_locks
       set failed_attempts = case when new_failed >= 5 then 0 else new_failed end, locked_until = new_locked, updated_at = now()
     where user_id = me and conversation_id = conv;
    return jsonb_build_object('success', false, 'remaining_attempts', greatest(0, 5 - new_failed), 'locked_until', new_locked);
  end if;
end; $$;

create or replace function public.lock_conversation_now(conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  update public.conversation_locks set unlocked_until = null, updated_at = now()
   where user_id = me and conversation_id = conv and pin_hash is not null;
end; $$;

create or replace function public.remove_conversation_pin(conversation_id uuid, pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; p text := pin; r public.conversation_locks%rowtype;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select * into r from public.conversation_locks where user_id = me and conversation_id = conv for update;
  if not found or r.pin_hash is null then
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('success', false, 'remaining_attempts', 0, 'locked_until', r.locked_until);
  end if;
  if p is not null and p ~ '^[0-9]{4}$' and extensions.crypt(p, r.pin_hash) = r.pin_hash then
    delete from public.conversation_locks where user_id = me and conversation_id = conv;
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  else
    update public.conversation_locks
       set failed_attempts = least(r.failed_attempts + 1, 5),
           locked_until = case when r.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end, updated_at = now()
     where user_id = me and conversation_id = conv;
    return jsonb_build_object('success', false, 'remaining_attempts', greatest(0, 5 - (r.failed_attempts + 1)), 'locked_until', null);
  end if;
end; $$;

create or replace function public.force_remove_conversation_lock(conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id;
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Yetkisiz istek'; end if;
  if not public.is_conversation_member(conv, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  delete from public.conversation_locks where user_id = me and conversation_id = conv;
end; $$;

create or replace function public.get_conversation_lock_status(conversation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; r public.conversation_locks%rowtype; has_pin boolean; locked boolean; unlocked boolean;
begin
  if me is null then return jsonb_build_object('has_pin', false, 'locked', false, 'unlocked', true); end if;
  select * into r from public.conversation_locks where user_id = me and conversation_id = conv;
  has_pin := found and r.pin_hash is not null;
  locked  := has_pin and r.locked_until is not null and r.locked_until > now();
  unlocked := has_pin and r.unlocked_until is not null and r.unlocked_until > now();
  return jsonb_build_object('has_pin', has_pin, 'locked', locked,
    'locked_until', case when has_pin then r.locked_until else null end,
    'unlocked', unlocked, 'unlocked_until', case when has_pin then r.unlocked_until else null end,
    'failed_attempts', coalesce(r.failed_attempts,0), 'remaining_attempts', greatest(0, 5 - coalesce(r.failed_attempts,0)),
    'requires_pin', has_pin and not (r.unlocked_until is not null and r.unlocked_until > now()));
end; $$;

create or replace function public.get_locked_conversation_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select l.conversation_id from public.conversation_locks l
  where l.user_id = auth.uid() and l.pin_hash is not null
    and (l.unlocked_until is null or l.unlocked_until <= now());
$$;

grant execute on function public.set_conversation_pin(uuid, text)     to authenticated;
grant execute on function public.verify_conversation_pin(uuid, text)  to authenticated;
grant execute on function public.lock_conversation_now(uuid)          to authenticated;
grant execute on function public.remove_conversation_pin(uuid, text)  to authenticated;
grant execute on function public.force_remove_conversation_lock(uuid) to authenticated;
grant execute on function public.get_conversation_lock_status(uuid)   to authenticated;
grant execute on function public.get_locked_conversation_ids()        to authenticated;

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid())
         and public.chat_lock_ok(conversation_id, auth.uid()));
drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_approved_user(auth.uid())
              and public.is_conversation_member(conversation_id, auth.uid()) and public.chat_lock_ok(conversation_id, auth.uid()));
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages for update to authenticated
  using (sender_id = auth.uid() and public.is_approved_user(auth.uid()) and public.chat_lock_ok(conversation_id, auth.uid()))
  with check (sender_id = auth.uid());
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete to authenticated
  using (sender_id = auth.uid() and public.is_approved_user(auth.uid()) and public.chat_lock_ok(conversation_id, auth.uid()));

do $$
begin
  begin execute 'alter table realtime.messages enable row level security'; exception when others then null; end;
  execute 'drop policy if exists nx_live_typing_read on realtime.messages';
  execute 'drop policy if exists nx_live_typing_write on realtime.messages';
  execute 'drop policy if exists nx_live_draft_read on realtime.messages';
  execute 'drop policy if exists nx_live_draft_send on realtime.messages';
  execute $p$ create policy nx_live_draft_read on realtime.messages for select to authenticated
    using ((select realtime.topic()) like 'live-draft:%'
      and public.is_conversation_member(nullif(split_part((select realtime.topic()), ':', 2), '')::uuid, auth.uid())) $p$;
  execute $p$ create policy nx_live_draft_send on realtime.messages for insert to authenticated
    with check ((select realtime.topic()) like 'live-draft:%'
      and public.is_conversation_member(nullif(split_part((select realtime.topic()), ':', 2), '')::uuid, auth.uid())
      and public.is_approved_user(auth.uid())) $p$;
exception when others then raise warning 'Realtime Authorization politikaları uygulanamadı: %. Canlı yazım private kanalı çalışmayabilir.', sqlerrm;
end $$;

-- ============================================================
-- 013 — GÜVENİLİR CANLI TASLAK (live_drafts) + KİLİT TANILAMA
-- ============================================================
create table if not exists public.live_drafts (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  text            text not null,
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '5 seconds'),
  primary key (conversation_id, sender_id)
);
create index if not exists live_drafts_conv_idx on public.live_drafts (conversation_id, expires_at);

create or replace function public.is_live_draft_eligible(conv uuid, uid uuid default auth.uid())
returns boolean language plpgsql security definer stable set search_path = public as $$
declare other uuid; grp boolean; cnt int; me_en boolean; other_en boolean;
begin
  if uid is null or not public.is_approved_user(uid) then return false; end if;
  if not public.is_conversation_member(conv, uid) then return false; end if;
  select (coalesce(c.type,'direct') = 'group' or c.is_group) into grp from public.conversations c where c.id = conv;
  select count(*)::int into cnt from public.conversation_members m where m.conversation_id = conv;
  if coalesce(grp, false) or cnt <> 2 then return false; end if;
  select m.user_id into other from public.conversation_members m where m.conversation_id = conv and m.user_id <> uid limit 1;
  if other is null or not public.is_approved_user(other) then return false; end if;
  if public.is_blocked_pair(uid, other) then return false; end if;
  select m.live_typing_enabled into me_en from public.conversation_members m where m.conversation_id = conv and m.user_id = uid;
  select m.live_typing_enabled into other_en from public.conversation_members m where m.conversation_id = conv and m.user_id = other;
  return coalesce(me_en, false) and coalesce(other_en, false);
end; $$;
grant execute on function public.is_live_draft_eligible(uuid, uuid) to authenticated;

create or replace function public.cleanup_expired_live_drafts()
returns void language sql security definer set search_path = public as $$
  delete from public.live_drafts where expires_at < now();
$$;
grant execute on function public.cleanup_expired_live_drafts() to authenticated;

create or replace function public.upsert_live_draft(conversation_id uuid, draft_text text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; clean text := nullif(btrim(coalesce(draft_text, '')), '');
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_live_draft_eligible(conv, me) then raise exception 'Canlı yazım bu sohbette aktif değil (iki taraf da açmalı)'; end if;
  perform public.cleanup_expired_live_drafts();
  if clean is null then
    delete from public.live_drafts where live_drafts.conversation_id = conv and sender_id = me;
    return;
  end if;
  if char_length(clean) > 2000 then clean := left(clean, 2000); end if;
  insert into public.live_drafts (conversation_id, sender_id, text, updated_at, expires_at)
  values (conv, me, clean, now(), now() + interval '5 seconds')
  on conflict (conversation_id, sender_id) do update
    set text = excluded.text, updated_at = now(), expires_at = now() + interval '5 seconds';
end; $$;
grant execute on function public.upsert_live_draft(uuid, text) to authenticated;

create or replace function public.clear_live_draft(conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id;
begin
  if me is null then return; end if;
  delete from public.live_drafts where live_drafts.conversation_id = conv and sender_id = me;
end; $$;
grant execute on function public.clear_live_draft(uuid) to authenticated;

alter table public.live_drafts enable row level security;
drop policy if exists live_drafts_select_member on public.live_drafts;
create policy live_drafts_select_member on public.live_drafts for select to authenticated
  using (public.is_live_draft_eligible(conversation_id, auth.uid()));
drop policy if exists live_drafts_insert_own on public.live_drafts;
create policy live_drafts_insert_own on public.live_drafts for insert to authenticated
  with check (sender_id = auth.uid() and public.is_live_draft_eligible(conversation_id, auth.uid()));
drop policy if exists live_drafts_update_own on public.live_drafts;
create policy live_drafts_update_own on public.live_drafts for update to authenticated
  using (sender_id = auth.uid() and public.is_live_draft_eligible(conversation_id, auth.uid()))
  with check (sender_id = auth.uid());
drop policy if exists live_drafts_delete_own on public.live_drafts;
create policy live_drafts_delete_own on public.live_drafts for delete to authenticated
  using (sender_id = auth.uid());

do $$ begin alter publication supabase_realtime add table public.live_drafts;
exception when duplicate_object then null; end $$;
alter table public.live_drafts replica identity full;

-- PIN RPC'leri (013/014 — jsonb dönüş + satır doğrulama; void→jsonb için DROP)
drop function if exists public.set_conversation_pin(uuid, text);
drop function if exists public.lock_conversation_now(uuid);

create or replace function public.set_conversation_pin(conversation_id uuid, pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; p text := pin; salt text; row_exists boolean;
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_conversation_member(conv, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  if p is null or p !~ '^[0-9]{4}$' then raise exception 'PIN tam olarak 4 rakam olmalıdır'; end if;
  salt := extensions.gen_salt('bf');
  insert into public.conversation_locks (user_id, conversation_id, pin_hash, pin_salt, failed_attempts, locked_until, unlocked_until)
  values (me, conv, extensions.crypt(p, salt), salt, 0, null, now() + interval '10 minutes')
  on conflict (user_id, conversation_id) do update
    set pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt,
        failed_attempts = 0, locked_until = null, unlocked_until = now() + interval '10 minutes', updated_at = now();
  select exists (select 1 from public.conversation_locks l where l.user_id = me and l.conversation_id = conv and l.pin_hash is not null) into row_exists;
  if not row_exists then raise exception 'PIN kaydedilemedi (conversation_locks satırı oluşmadı)'; end if;
  return jsonb_build_object('success', true, 'has_pin', true, 'requires_pin', false);
end; $$;

create or replace function public.lock_conversation_now(conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; updated int;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  update public.conversation_locks set unlocked_until = null, updated_at = now()
   where user_id = me and conversation_id = conv and pin_hash is not null;
  get diagnostics updated = row_count;
  if updated = 0 then raise exception 'Önce PIN oluşturun'; end if;
  return jsonb_build_object('success', true, 'requires_pin', true);
end; $$;

create or replace function public.get_conversation_lock_status(conversation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; r public.conversation_locks%rowtype;
  has_pin boolean; locked boolean; unlocked boolean; req_pin boolean;
begin
  if me is null then return jsonb_build_object('has_pin', false, 'locked', false, 'unlocked', true, 'requires_pin', false); end if;
  select * into r from public.conversation_locks where user_id = me and conversation_id = conv;
  has_pin := found and r.pin_hash is not null;
  locked  := has_pin and r.locked_until is not null and r.locked_until > now();
  unlocked := has_pin and r.unlocked_until is not null and r.unlocked_until > now();
  req_pin := has_pin and not unlocked;
  return jsonb_build_object('has_pin', has_pin, 'locked', locked,
    'locked_until', case when has_pin then r.locked_until else null end,
    'unlocked', unlocked, 'unlocked_until', case when has_pin then r.unlocked_until else null end,
    'failed_attempts', coalesce(r.failed_attempts, 0), 'remaining_attempts', greatest(0, 5 - coalesce(r.failed_attempts, 0)),
    'requires_pin', req_pin);
end; $$;

-- ============================================================
-- 015/016 — ambiguous conversation_id düzeltmesi (p_* parametreler + alias)
-- chat_lock_ok / is_live_draft_eligible DROP EDİLMEZ (RLS bağımlı)
create extension if not exists pgcrypto with schema extensions;

drop function if exists public.get_conversation_lock_status(uuid);
drop function if exists public.set_conversation_pin(uuid, text);
drop function if exists public.verify_conversation_pin(uuid, text);
drop function if exists public.lock_conversation_now(uuid);
drop function if exists public.remove_conversation_pin(uuid, text);
drop function if exists public.force_remove_conversation_lock(uuid);
drop function if exists public.get_live_typing_status(uuid);
drop function if exists public.set_live_typing_enabled(uuid, boolean);
drop function if exists public.upsert_live_draft(uuid, text);
drop function if exists public.clear_live_draft(uuid);
drop function if exists public.cleanup_expired_live_drafts();

create or replace function public.chat_lock_ok(conv uuid, uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (
    select 1 from public.conversation_locks cl
    where cl.user_id = uid and cl.conversation_id = conv
      and cl.pin_hash is not null and (cl.unlocked_until is null or cl.unlocked_until <= now())
  );
$$;
grant execute on function public.chat_lock_ok(uuid, uuid) to authenticated;

create or replace function public.get_conversation_lock_status(p_conversation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid(); r public.conversation_locks%rowtype; has_pin boolean; locked boolean; unlocked boolean; req_pin boolean;
begin
  if me is null then return jsonb_build_object('has_pin', false, 'locked', false, 'unlocked', true, 'requires_pin', false); end if;
  select cl.* into r from public.conversation_locks cl where cl.user_id = me and cl.conversation_id = p_conversation_id;
  has_pin := found and r.pin_hash is not null;
  locked := has_pin and r.locked_until is not null and r.locked_until > now();
  unlocked := has_pin and r.unlocked_until is not null and r.unlocked_until > now();
  req_pin := has_pin and not unlocked;
  return jsonb_build_object('has_pin', has_pin, 'locked', locked,
    'locked_until', case when has_pin then r.locked_until else null end,
    'unlocked', unlocked, 'unlocked_until', case when has_pin then r.unlocked_until else null end,
    'failed_attempts', coalesce(r.failed_attempts, 0), 'remaining_attempts', greatest(0, 5 - coalesce(r.failed_attempts, 0)),
    'requires_pin', req_pin);
end; $$;
grant execute on function public.get_conversation_lock_status(uuid) to authenticated;

create or replace function public.set_conversation_pin(p_conversation_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); salt text; row_exists boolean;
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_conversation_member(p_conversation_id, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'PIN tam olarak 4 rakam olmalıdır'; end if;
  salt := extensions.gen_salt('bf');
  insert into public.conversation_locks as cl (user_id, conversation_id, pin_hash, pin_salt, failed_attempts, locked_until, unlocked_until)
  values (me, p_conversation_id, extensions.crypt(p_pin, salt), salt, 0, null, now() + interval '10 minutes')
  on conflict (user_id, conversation_id) do update
    set pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt, failed_attempts = 0, locked_until = null,
        unlocked_until = now() + interval '10 minutes', updated_at = now();
  select exists (select 1 from public.conversation_locks cl where cl.user_id = me and cl.conversation_id = p_conversation_id and cl.pin_hash is not null) into row_exists;
  if not row_exists then raise exception 'PIN kaydedilemedi (conversation_locks satırı oluşmadı)'; end if;
  return jsonb_build_object('success', true, 'has_pin', true, 'requires_pin', false);
end; $$;
grant execute on function public.set_conversation_pin(uuid, text) to authenticated;

create or replace function public.verify_conversation_pin(p_conversation_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); r public.conversation_locks%rowtype; ok boolean; new_failed int; new_locked timestamptz;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select cl.* into r from public.conversation_locks cl where cl.user_id = me and cl.conversation_id = p_conversation_id for update;
  if not found or r.pin_hash is null then return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null); end if;
  if r.locked_until is not null and r.locked_until > now() then return jsonb_build_object('success', false, 'remaining_attempts', 0, 'locked_until', r.locked_until); end if;
  ok := (p_pin is not null and p_pin ~ '^[0-9]{4}$' and extensions.crypt(p_pin, r.pin_hash) = r.pin_hash);
  if ok then
    update public.conversation_locks cl set failed_attempts = 0, locked_until = null, unlocked_until = now() + interval '10 minutes', updated_at = now()
     where cl.user_id = me and cl.conversation_id = p_conversation_id;
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  else
    new_failed := r.failed_attempts + 1;
    new_locked := case when new_failed >= 5 then now() + interval '15 minutes' else null end;
    update public.conversation_locks cl set failed_attempts = case when new_failed >= 5 then 0 else new_failed end, locked_until = new_locked, updated_at = now()
     where cl.user_id = me and cl.conversation_id = p_conversation_id;
    return jsonb_build_object('success', false, 'remaining_attempts', greatest(0, 5 - new_failed), 'locked_until', new_locked);
  end if;
end; $$;
grant execute on function public.verify_conversation_pin(uuid, text) to authenticated;

create or replace function public.lock_conversation_now(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); updated int;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  update public.conversation_locks cl set unlocked_until = null, updated_at = now()
   where cl.user_id = me and cl.conversation_id = p_conversation_id and cl.pin_hash is not null;
  get diagnostics updated = row_count;
  if updated = 0 then raise exception 'Önce PIN oluşturun'; end if;
  return jsonb_build_object('success', true, 'requires_pin', true);
end; $$;
grant execute on function public.lock_conversation_now(uuid) to authenticated;

create or replace function public.remove_conversation_pin(p_conversation_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); r public.conversation_locks%rowtype;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select cl.* into r from public.conversation_locks cl where cl.user_id = me and cl.conversation_id = p_conversation_id for update;
  if not found or r.pin_hash is null then return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null); end if;
  if r.locked_until is not null and r.locked_until > now() then return jsonb_build_object('success', false, 'remaining_attempts', 0, 'locked_until', r.locked_until); end if;
  if p_pin is not null and p_pin ~ '^[0-9]{4}$' and extensions.crypt(p_pin, r.pin_hash) = r.pin_hash then
    delete from public.conversation_locks cl where cl.user_id = me and cl.conversation_id = p_conversation_id;
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  else
    update public.conversation_locks cl set failed_attempts = least(r.failed_attempts + 1, 5),
      locked_until = case when r.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else cl.locked_until end, updated_at = now()
     where cl.user_id = me and cl.conversation_id = p_conversation_id;
    return jsonb_build_object('success', false, 'remaining_attempts', greatest(0, 5 - (r.failed_attempts + 1)), 'locked_until', null);
  end if;
end; $$;
grant execute on function public.remove_conversation_pin(uuid, text) to authenticated;

create or replace function public.force_remove_conversation_lock(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Yetkisiz istek'; end if;
  if not public.is_conversation_member(p_conversation_id, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  delete from public.conversation_locks cl where cl.user_id = me and cl.conversation_id = p_conversation_id;
end; $$;
grant execute on function public.force_remove_conversation_lock(uuid) to authenticated;

create or replace function public.set_live_typing_enabled(p_conversation_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); grp boolean; cnt int;
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_conversation_member(p_conversation_id, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  select (coalesce(c.type, 'direct') = 'group' or c.is_group) into grp from public.conversations c where c.id = p_conversation_id;
  select count(*)::int into cnt from public.conversation_members cm where cm.conversation_id = p_conversation_id;
  if coalesce(grp, false) or cnt <> 2 then raise exception 'Canlı yazım yalnızca birebir sohbetlerde kullanılabilir'; end if;
  update public.conversation_members cm set live_typing_enabled = coalesce(p_enabled, false)
   where cm.conversation_id = p_conversation_id and cm.user_id = me;
end; $$;
grant execute on function public.set_live_typing_enabled(uuid, boolean) to authenticated;

create or replace function public.get_live_typing_status(p_conversation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid(); other_id uuid; grp boolean; cnt int; me_en boolean; other_en boolean; eligible boolean;
begin
  if me is null or not public.is_conversation_member(p_conversation_id, me) then
    return jsonb_build_object('eligible', false, 'me_enabled', false, 'other_enabled', false, 'active', false);
  end if;
  select (coalesce(c.type, 'direct') = 'group' or c.is_group) into grp from public.conversations c where c.id = p_conversation_id;
  select count(*)::int into cnt from public.conversation_members cm where cm.conversation_id = p_conversation_id;
  select cm.user_id into other_id from public.conversation_members cm where cm.conversation_id = p_conversation_id and cm.user_id <> me limit 1;
  select cm.live_typing_enabled into me_en from public.conversation_members cm where cm.conversation_id = p_conversation_id and cm.user_id = me;
  select cm.live_typing_enabled into other_en from public.conversation_members cm where cm.conversation_id = p_conversation_id and cm.user_id = other_id;
  eligible := (not coalesce(grp, false)) and cnt = 2 and other_id is not null and public.is_approved_user(me) and public.is_approved_user(other_id) and not public.is_blocked_pair(me, other_id);
  return jsonb_build_object('eligible', eligible, 'me_enabled', coalesce(me_en, false), 'other_enabled', coalesce(other_en, false), 'active', eligible and coalesce(me_en, false) and coalesce(other_en, false));
end; $$;
grant execute on function public.get_live_typing_status(uuid) to authenticated;

create or replace function public.is_live_draft_eligible(conv uuid, uid uuid default auth.uid())
returns boolean language plpgsql security definer stable set search_path = public as $$
declare other_id uuid; grp boolean; cnt int; me_en boolean; other_en boolean;
begin
  if uid is null or not public.is_approved_user(uid) then return false; end if;
  if not public.is_conversation_member(conv, uid) then return false; end if;
  select (coalesce(c.type, 'direct') = 'group' or c.is_group) into grp from public.conversations c where c.id = conv;
  select count(*)::int into cnt from public.conversation_members cm where cm.conversation_id = conv;
  if coalesce(grp, false) or cnt <> 2 then return false; end if;
  select cm.user_id into other_id from public.conversation_members cm where cm.conversation_id = conv and cm.user_id <> uid limit 1;
  if other_id is null or not public.is_approved_user(other_id) then return false; end if;
  if public.is_blocked_pair(uid, other_id) then return false; end if;
  select cm.live_typing_enabled into me_en from public.conversation_members cm where cm.conversation_id = conv and cm.user_id = uid;
  select cm.live_typing_enabled into other_en from public.conversation_members cm where cm.conversation_id = conv and cm.user_id = other_id;
  return coalesce(me_en, false) and coalesce(other_en, false);
end; $$;
grant execute on function public.is_live_draft_eligible(uuid, uuid) to authenticated;

create or replace function public.cleanup_expired_live_drafts()
returns void language sql security definer set search_path = public as $$
  delete from public.live_drafts ld where ld.expires_at < now();
$$;
grant execute on function public.cleanup_expired_live_drafts() to authenticated;

create or replace function public.upsert_live_draft(p_conversation_id uuid, p_draft_text text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); clean text := nullif(btrim(coalesce(p_draft_text, '')), '');
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_live_draft_eligible(p_conversation_id, me) then raise exception 'Canlı yazım bu sohbette aktif değil (iki taraf da açmalı)'; end if;
  perform public.cleanup_expired_live_drafts();
  if clean is null then delete from public.live_drafts ld where ld.conversation_id = p_conversation_id and ld.sender_id = me; return; end if;
  if char_length(clean) > 2000 then clean := left(clean, 2000); end if;
  insert into public.live_drafts as ld (conversation_id, sender_id, text, updated_at, expires_at)
  values (p_conversation_id, me, clean, now(), now() + interval '5 seconds')
  on conflict (conversation_id, sender_id) do update set text = excluded.text, updated_at = now(), expires_at = now() + interval '5 seconds';
end; $$;
grant execute on function public.upsert_live_draft(uuid, text) to authenticated;

create or replace function public.clear_live_draft(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  delete from public.live_drafts ld where ld.conversation_id = p_conversation_id and ld.sender_id = me;
end; $$;
grant execute on function public.clear_live_draft(uuid) to authenticated;

drop policy if exists live_drafts_select_member on public.live_drafts;
create policy live_drafts_select_member on public.live_drafts for select to authenticated
  using (public.is_live_draft_eligible(conversation_id, auth.uid()));
drop policy if exists live_drafts_insert_own on public.live_drafts;
create policy live_drafts_insert_own on public.live_drafts for insert to authenticated
  with check (sender_id = auth.uid() and public.is_live_draft_eligible(conversation_id, auth.uid()));
drop policy if exists live_drafts_update_own on public.live_drafts;
create policy live_drafts_update_own on public.live_drafts for update to authenticated
  using (sender_id = auth.uid() and public.is_live_draft_eligible(conversation_id, auth.uid())) with check (sender_id = auth.uid());
drop policy if exists live_drafts_delete_own on public.live_drafts;
create policy live_drafts_delete_own on public.live_drafts for delete to authenticated using (sender_id = auth.uid());

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid()) and public.chat_lock_ok(conversation_id, auth.uid()));
drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid()) and public.chat_lock_ok(conversation_id, auth.uid()));
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages for update to authenticated
  using (sender_id = auth.uid() and public.is_approved_user(auth.uid()) and public.chat_lock_ok(conversation_id, auth.uid())) with check (sender_id = auth.uid());
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete to authenticated
  using (sender_id = auth.uid() and public.is_approved_user(auth.uid()) and public.chat_lock_ok(conversation_id, auth.uid()));

