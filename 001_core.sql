-- ============================================================
-- 001_core.sql — Profiller, roller, kullanıcı ayarları
-- Idempotent. Mevcut profiles tablosunu güvenle genişletir.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- profiles genişletme
-- ------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url   text;
alter table public.profiles add column if not exists role         text not null default 'user';
alter table public.profiles add column if not exists status       text;
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists is_online    boolean not null default false;
alter table public.profiles add column if not exists banned_at    timestamptz;
alter table public.profiles add column if not exists ban_reason   text;
alter table public.profiles add column if not exists created_at   timestamptz not null default now();
alter table public.profiles add column if not exists updated_at   timestamptz not null default now();

do $$ begin
  alter table public.profiles
    add constraint profiles_role_chk check (role in ('user', 'moderator', 'admin'));
exception when duplicate_object then null; end $$;

create unique index if not exists profiles_username_key on public.profiles (username);

-- ------------------------------------------------------------
-- user_settings
-- ------------------------------------------------------------
create table if not exists public.user_settings (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  theme                   text not null default 'dark',
  language                text not null default 'tr',
  notifications_enabled   boolean not null default true,
  read_receipts_enabled   boolean not null default true,
  last_seen_visibility    text not null default 'contacts',
  profile_photo_visibility text not null default 'everyone',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

do $$ begin
  alter table public.user_settings
    add constraint user_settings_last_seen_vis_chk
    check (last_seen_visibility in ('everyone', 'contacts', 'nobody'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.user_settings
    add constraint user_settings_photo_vis_chk
    check (profile_photo_visibility in ('everyone', 'contacts', 'nobody'));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- Yardımcı fonksiyonlar (SECURITY DEFINER → RLS recursion yok)
-- ------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin');
$$;

create or replace function public.is_moderator(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.role in ('admin', 'moderator'));
$$;

-- ------------------------------------------------------------
-- updated_at otomatik güncelleme
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- username normalize (lower + trim)
-- ------------------------------------------------------------
create or replace function public.normalize_profile()
returns trigger
language plpgsql
as $$
begin
  if new.username is not null then
    new.username := nullif(lower(trim(new.username)), '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_normalize on public.profiles;
create trigger trg_profiles_normalize before insert or update on public.profiles
  for each row execute function public.normalize_profile();

-- ------------------------------------------------------------
-- Ayrıcalıklı alan koruması:
-- role / banned_at / ban_reason yalnızca admin tarafından değişebilir.
-- Normal kullanıcı kendi profilini güncellese bile bu alanlar korunur.
-- ------------------------------------------------------------
create or replace function public.protect_profile_privileged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    new.role       := old.role;
    new.banned_at  := old.banned_at;
    new.ban_reason := old.ban_reason;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_privileged();

-- ------------------------------------------------------------
-- Yeni kullanıcı → profil + ayar kaydı (çakışmasız username)
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_name text;
  uname     text;
begin
  base_name := coalesce(
    nullif(lower(trim(new.raw_user_meta_data ->> 'username')), ''),
    split_part(new.email, '@', 1)
  );
  uname := base_name;
  if exists (select 1 from public.profiles where username = uname) then
    uname := base_name || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    uname,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), base_name)
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.user_settings enable row level security;

-- profiles: giriş yapmış herkes okur (kişi listesi / isimler için).
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- Kendi profilini güncelleyebilir; role/banned alanları trigger ile korunur.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Adminler her profili güncelleyebilir (ban/rol için).
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- user_settings: yalnızca sahibi.
drop policy if exists user_settings_select_self on public.user_settings;
create policy user_settings_select_self on public.user_settings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_settings_insert_self on public.user_settings;
create policy user_settings_insert_self on public.user_settings
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_settings_update_self on public.user_settings;
create policy user_settings_update_self on public.user_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Var olan kullanıcılar için eksik ayar kaydını doldur.
insert into public.user_settings (user_id)
select p.id from public.profiles p
left join public.user_settings s on s.user_id = p.id
where s.user_id is null
on conflict (user_id) do nothing;

grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_moderator(uuid) to authenticated;
