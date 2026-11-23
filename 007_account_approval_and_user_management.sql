-- ============================================================
-- 007_account_approval_and_user_management.sql
-- Admin onaylı kayıt + güvenli kullanıcı yönetimi + kullanıcı arama.
--
-- GÜVENLİK / KURALLAR:
-- - Idempotent (tekrar çalıştırılabilir). DROP TABLE / TRUNCATE YOK.
-- - Mevcut hesaplar migration sırasında 'approved' yapılır (kilitlenmez).
-- - Yeni hesaplar varsayılan 'pending'.
-- - Ayrıcalıklı alanlar (approval/ban/deactivate) yalnızca admin RPC'leri ile
--   değişir; normal kullanıcı trigger ile engellenir.
-- - Tüm admin işlemleri backend'de is_admin ile doğrulanır ve audit'e yazılır.
-- - E-posta yalnızca doğrulanmış admin RPC sonucunda döner.
-- - Kalıcı auth kullanıcı silme burada YAPILMAZ (Edge Function ile).
-- ============================================================

-- ------------------------------------------------------------
-- 1) profiles: onay / devre dışı alanları (varsayılansız ekle → mevcut satırlar NULL)
-- ------------------------------------------------------------
alter table public.profiles add column if not exists approval_status     text;
alter table public.profiles add column if not exists approved_at         timestamptz;
alter table public.profiles add column if not exists approved_by         uuid references public.profiles (id) on delete set null;
alter table public.profiles add column if not exists rejected_at         timestamptz;
alter table public.profiles add column if not exists rejection_reason    text;
alter table public.profiles add column if not exists deactivated_at      timestamptz;
alter table public.profiles add column if not exists deactivated_by      uuid references public.profiles (id) on delete set null;
alter table public.profiles add column if not exists deactivation_reason text;

-- Mevcut TÜM hesapları approved yap (yalnızca henüz atanmamış / NULL olanlar).
-- Bu, mevcut adminleri ve kullanıcıları kilitlemez. Yeni kullanıcılar 'pending'
-- olacağından (aşağıdaki default), bu update onları yanlışlıkla onaylamaz.
update public.profiles
   set approval_status = 'approved',
       approved_at = coalesce(approved_at, now())
 where approval_status is null;

-- Bundan sonra oluşacak yeni hesaplar için varsayılan 'pending'.
alter table public.profiles alter column approval_status set default 'pending';
alter table public.profiles alter column approval_status set not null;

do $$ begin
  alter table public.profiles
    add constraint profiles_approval_status_chk
    check (approval_status in ('pending', 'approved', 'rejected'));
exception when duplicate_object then null; end $$;

-- Arama / filtre performansı için index.
create index if not exists profiles_approval_status_idx on public.profiles (approval_status);
create index if not exists profiles_deactivated_idx on public.profiles (deactivated_at);

-- Büyük/küçük harf duyarsız arama için trigram index (varsa pg_trgm).
do $$ begin
  create extension if not exists pg_trgm;
  create index if not exists profiles_username_trgm_idx     on public.profiles using gin (username gin_trgm_ops);
  create index if not exists profiles_display_name_trgm_idx on public.profiles using gin (display_name gin_trgm_ops);
exception when others then
  raise notice 'pg_trgm kurulamadı; arama btree/seq scan ile çalışacak (%).', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 2) handle_new_user: yeni profil açıkça 'pending' oluşturulsun
--    (default zaten pending; yine de açık yazarak niyeti netleştiriyoruz)
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

  insert into public.profiles (id, username, display_name, approval_status)
  values (
    new.id,
    uname,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), base_name),
    'pending'
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3) Ayrıcalıklı alan koruması: yeni onay/devre dışı alanları da koru.
--    Normal kullanıcı kendi profilini güncellese bile bu alanlar değişmez.
-- ------------------------------------------------------------
create or replace function public.protect_profile_privileged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    new.role                := old.role;
    new.banned_at           := old.banned_at;
    new.ban_reason          := old.ban_reason;
    new.approval_status     := old.approval_status;
    new.approved_at         := old.approved_at;
    new.approved_by         := old.approved_by;
    new.rejected_at         := old.rejected_at;
    new.rejection_reason    := old.rejection_reason;
    new.deactivated_at      := old.deactivated_at;
    new.deactivated_by      := old.deactivated_by;
    new.deactivation_reason := old.deactivation_reason;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 4) is_approved_user: onaylı + yasaksız + devre dışı değil
--    (SECURITY DEFINER → RLS recursion yok)
-- ------------------------------------------------------------
create or replace function public.is_approved_user(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid
      and p.approval_status = 'approved'
      and p.banned_at is null
      and p.deactivated_at is null
  );
$$;

grant execute on function public.is_approved_user(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) RLS: onaylı olmayan kullanıcı sohbet/mesaj/arama/oluşturma yapamaz.
--    Kendi profil satırını (durumunu) her zaman görebilir.
-- ------------------------------------------------------------

-- profiles SELECT: kendi satırı her zaman; başkalarını yalnızca onaylı kullanıcı görür.
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_approved_user(auth.uid()));

-- conversations SELECT: yalnızca onaylı üye/oluşturan.
drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member on public.conversations
  for select to authenticated
  using (
    public.is_approved_user(auth.uid())
    and (created_by = auth.uid() or public.is_conversation_member(id, auth.uid()))
  );

-- conversations INSERT: yalnızca onaylı kullanıcı oluşturur.
drop policy if exists conversations_insert_creator on public.conversations;
create policy conversations_insert_creator on public.conversations
  for insert to authenticated
  with check (created_by = auth.uid() and public.is_approved_user(auth.uid()));

-- conversation_members SELECT/INSERT: onaylı kullanıcı.
drop policy if exists members_select_member on public.conversation_members;
create policy members_select_member on public.conversation_members
  for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists members_insert on public.conversation_members;
create policy members_insert on public.conversation_members
  for insert to authenticated
  with check (
    public.is_approved_user(auth.uid())
    and (user_id = auth.uid() or public.is_conversation_member(conversation_id, auth.uid()))
  );

-- messages SELECT/INSERT/UPDATE/DELETE: onaylı kullanıcı.
drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_approved_user(auth.uid())
    and public.is_conversation_member(conversation_id, auth.uid())
  );

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update to authenticated
  using (sender_id = auth.uid() and public.is_approved_user(auth.uid()))
  with check (sender_id = auth.uid());

drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
  for delete to authenticated
  using (sender_id = auth.uid() and public.is_approved_user(auth.uid()));

-- message_reactions SELECT/INSERT: onaylı kullanıcı.
drop policy if exists reactions_select_member on public.message_reactions;
create policy reactions_select_member on public.message_reactions
  for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(public.message_conversation_id(message_id), auth.uid()));

drop policy if exists reactions_insert_member on public.message_reactions;
create policy reactions_insert_member on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_approved_user(auth.uid())
    and public.is_conversation_member(public.message_conversation_id(message_id), auth.uid())
  );

-- typing_indicators SELECT/INSERT/UPDATE: onaylı kullanıcı.
drop policy if exists typing_select_member on public.typing_indicators;
create policy typing_select_member on public.typing_indicators
  for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists typing_upsert_self on public.typing_indicators;
create policy typing_upsert_self on public.typing_indicators
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_approved_user(auth.uid())
    and public.is_conversation_member(conversation_id, auth.uid())
  );

drop policy if exists typing_update_self on public.typing_indicators;
create policy typing_update_self on public.typing_indicators
  for update to authenticated
  using (user_id = auth.uid() and public.is_approved_user(auth.uid()))
  with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 6) get_or_create_direct_conversation: iki taraf da onaylı olmalı.
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
  if not public.is_approved_user(me) then
    raise exception 'Hesabınız onaylı değil';
  end if;
  if other_id = me then
    raise exception 'Kendinizle sohbet açamazsınız';
  end if;
  if not exists (select 1 from public.profiles where id = other_id) then
    raise exception 'Kullanıcı bulunamadı';
  end if;
  if not public.is_approved_user(other_id) then
    raise exception 'Bu kullanıcı ile sohbet başlatılamaz';
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

-- ------------------------------------------------------------
-- 7) search_approved_users: güvenli kullanıcı arama.
--    Yalnızca id/username/display_name/avatar_url/status döner (e-posta YOK).
-- ------------------------------------------------------------
create or replace function public.search_approved_users(search_text text, result_limit int default 20)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  status text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  q    text := trim(coalesce(search_text, ''));
  lim  int  := least(greatest(coalesce(result_limit, 20), 1), 20);
begin
  if me is null or not public.is_approved_user(me) then
    return; -- onaylı olmayan kullanıcı arama yapamaz
  end if;
  if length(q) < 2 then
    return; -- en az 2 karakter
  end if;

  return query
    select p.id, p.username, p.display_name, p.avatar_url, p.status
    from public.profiles p
    where p.id <> me
      and p.approval_status = 'approved'
      and p.banned_at is null
      and p.deactivated_at is null
      and not public.is_blocked_pair(me, p.id)
      and (p.username ilike '%' || q || '%' or p.display_name ilike '%' || q || '%')
    order by
      (lower(p.username) = lower(q)) desc,
      (p.username ilike q || '%') desc,
      p.username asc
    limit lim;
end;
$$;

grant execute on function public.search_approved_users(text, int) to authenticated;

-- ============================================================
-- 8) ADMIN RPC'leri — Hesap başvuruları
--    Hepsi is_admin ile doğrulanır ve audit'e yazar.
-- ============================================================

-- Bekleyen başvuruları listele (e-posta yalnızca admin RPC sonucunda döner).
create or replace function public.admin_list_pending_users()
returns table (
  id uuid,
  username text,
  display_name text,
  email text,
  created_at timestamptz,
  approval_status text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Yetki yok (admin gerekli)';
  end if;
  return query
    select p.id, p.username, p.display_name, u.email::text, p.created_at, p.approval_status
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.approval_status = 'pending'
    order by p.created_at asc;
end;
$$;

-- Onayla: pending/rejected → approved.
create or replace function public.admin_approve_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Yetki yok (admin gerekli)';
  end if;
  update public.profiles
     set approval_status = 'approved',
         approved_at = now(),
         approved_by = auth.uid(),
         rejected_at = null,
         rejection_reason = null
   where id = target_user_id;
  perform public.log_admin_action('approve_user', 'profile', target_user_id, '{}'::jsonb);
end;
$$;

-- Reddet: sebep zorunlu değil ama önerilir. Admin kendini reddedemez.
create or replace function public.admin_reject_user(target_user_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Yetki yok (admin gerekli)';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Kendi hesabınızı reddedemezsiniz';
  end if;
  update public.profiles
     set approval_status = 'rejected',
         rejected_at = now(),
         rejection_reason = reason,
         approved_at = null,
         approved_by = null
   where id = target_user_id;
  perform public.log_admin_action('reject_user', 'profile', target_user_id, jsonb_build_object('reason', reason));
end;
$$;

-- ============================================================
-- 9) ADMIN RPC'leri — Kullanıcı yönetimi
-- ============================================================

-- Aktif admin sayısı (yasaksız + devre dışı değil).
create or replace function public.active_admin_count()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int
  from public.profiles
  where role = 'admin' and banned_at is null and deactivated_at is null;
$$;

-- Eski 3-argümanlı admin_list_users'ı kaldır (fonksiyon silme veri kaybı değildir).
drop function if exists public.admin_list_users(text, integer, integer);

-- Yeni: arama + durum filtresi + sayfalama + e-posta.
create or replace function public.admin_list_users(
  search_text  text default null,
  status_filter text default null,
  page_size    int  default 25,
  page_offset  int  default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  email text,
  avatar_url text,
  role text,
  approval_status text,
  banned_at timestamptz,
  ban_reason text,
  deactivated_at timestamptz,
  deactivation_reason text,
  rejection_reason text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  q   text := nullif(trim(coalesce(search_text, '')), '');
  lim int  := least(greatest(coalesce(page_size, 25), 1), 100);
  off int  := greatest(coalesce(page_offset, 0), 0);
  sf  text := nullif(trim(coalesce(status_filter, '')), '');
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Yetki yok (admin gerekli)';
  end if;
  return query
    select
      p.id, p.username, p.display_name, u.email::text, p.avatar_url, p.role,
      p.approval_status, p.banned_at, p.ban_reason, p.deactivated_at,
      p.deactivation_reason, p.rejection_reason, p.created_at,
      count(*) over()::bigint as total_count
    from public.profiles p
    join auth.users u on u.id = p.id
    where (q is null or p.username ilike '%' || q || '%' or p.display_name ilike '%' || q || '%' or u.email ilike '%' || q || '%')
      and (
        sf is null
        or (sf = 'pending'     and p.approval_status = 'pending')
        or (sf = 'approved'    and p.approval_status = 'approved' and p.banned_at is null and p.deactivated_at is null)
        or (sf = 'rejected'    and p.approval_status = 'rejected')
        or (sf = 'deactivated' and p.deactivated_at is not null)
        or (sf = 'banned'      and p.banned_at is not null)
      )
    order by p.created_at desc
    limit lim offset off;
end;
$$;

-- Devre dışı bırak: kendini ve son admini engelle.
create or replace function public.admin_deactivate_user(target_user_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Yetki yok (admin gerekli)';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Kendi hesabınızı devre dışı bırakamazsınız';
  end if;
  select role into target_role from public.profiles where id = target_user_id;
  if target_role = 'admin' and public.active_admin_count() <= 1 then
    raise exception 'Son aktif admini devre dışı bırakamazsınız';
  end if;
  update public.profiles
     set deactivated_at = now(),
         deactivated_by = auth.uid(),
         deactivation_reason = reason
   where id = target_user_id;
  perform public.log_admin_action('deactivate_user', 'profile', target_user_id, jsonb_build_object('reason', reason));
end;
$$;

-- Yeniden etkinleştir.
create or replace function public.admin_reactivate_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Yetki yok (admin gerekli)';
  end if;
  update public.profiles
     set deactivated_at = null,
         deactivated_by = null,
         deactivation_reason = null
   where id = target_user_id;
  perform public.log_admin_action('reactivate_user', 'profile', target_user_id, '{}'::jsonb);
end;
$$;

-- ban: son admin koruması ekle (mevcut admin_ban_user'ı güncelle).
create or replace function public.admin_ban_user(target uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Yetki yok (admin gerekli)';
  end if;
  if target = auth.uid() then
    raise exception 'Kendinizi yasaklayamazsınız';
  end if;
  select role into target_role from public.profiles where id = target;
  if target_role = 'admin' and public.active_admin_count() <= 1 then
    raise exception 'Son aktif admini yasaklayamazsınız';
  end if;
  update public.profiles
     set banned_at = now(), ban_reason = reason
   where id = target;
  perform public.log_admin_action('ban_user', 'profile', target, jsonb_build_object('reason', reason));
end;
$$;

grant execute on function public.admin_list_pending_users()                      to authenticated;
grant execute on function public.admin_approve_user(uuid)                        to authenticated;
grant execute on function public.admin_reject_user(uuid, text)                   to authenticated;
grant execute on function public.admin_list_users(text, text, int, int)          to authenticated;
grant execute on function public.admin_deactivate_user(uuid, text)               to authenticated;
grant execute on function public.admin_reactivate_user(uuid)                     to authenticated;
-- active_admin_count bilerek grant EDİLMEZ (yalnızca definer fonksiyonlar çağırır).

-- ============================================================
-- 10) Realtime: profiles değişimleri (onay/devre dışı) anlık yansısın.
-- ============================================================
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
alter table public.profiles replica identity full;
