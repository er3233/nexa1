-- ============================================================
-- 018_repair_live_typing_and_chat_lock.sql
--
-- Amaç: 011→017 arasındaki onarım zincirini (pgcrypto şema hatası,
-- void→jsonb dönüş tipi değişimi, "ambiguous column" ve "cannot change
-- name of input parameter" hataları) TEK, idempotent bir dosyada
-- toparlamak. Bu dosya, DB şu an 011-017 arasındaki HANGİ noktada
-- kalmış olursa olsun güvenle çalıştırılabilir ve sonucu her zaman
-- 017'nin doğru/nihai haline yakınsar.
--
-- KURALLAR (bozulmasın diye):
-- - chat_lock_ok(conv, uid) ve is_live_draft_eligible(conv, uid):
--   messages / live_drafts RLS politikaları bunlara bağımlı olduğu için
--   DROP EDİLMEZ, yalnızca CREATE OR REPLACE ile güncellenir. Parametre
--   adları (conv, uid) AYNEN korunur — 016'nın çarptığı hata buydu.
-- - Diğer tüm RPC'ler policy bağımlılığı taşımadığından DROP FUNCTION
--   IF EXISTS + CREATE ile p_* parametre standardına (013-015'in
--   getirdiği "ambiguous column" düzeltmesi) kesin olarak sabitlenir.
-- - DROP TABLE / TRUNCATE / CASCADE / DROP POLICY YOK.
--   conversation_locks ve live_drafts içindeki veri SİLİNMEZ.
-- - Mevcut kullanıcılar, konuşmalar, mesajlar bu migration'dan etkilenmez.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- chat_lock_ok — DROP YOK (messages RLS bağımlı). İmza AYNEN: conv, uid.
-- ------------------------------------------------------------
create or replace function public.chat_lock_ok(conv uuid, uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (
    select 1 from public.conversation_locks cl
    where cl.user_id = uid
      and cl.conversation_id = conv
      and cl.pin_hash is not null
      and (cl.unlocked_until is null or cl.unlocked_until <= now())
  );
$$;
grant execute on function public.chat_lock_ok(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- is_live_draft_eligible — DROP YOK (live_drafts RLS bağımlı). İmza AYNEN: conv, uid.
-- ------------------------------------------------------------
create or replace function public.is_live_draft_eligible(conv uuid, uid uuid default auth.uid())
returns boolean language plpgsql security definer stable set search_path = public as $$
declare
  other_id uuid;
  grp boolean;
  cnt int;
  me_en boolean;
  other_en boolean;
begin
  if uid is null or not public.is_approved_user(uid) then return false; end if;
  if not public.is_conversation_member(conv, uid) then return false; end if;
  select (coalesce(c.type, 'direct') = 'group' or c.is_group) into grp
  from public.conversations c where c.id = conv;
  select count(*)::int into cnt from public.conversation_members cm where cm.conversation_id = conv;
  if coalesce(grp, false) or cnt <> 2 then return false; end if;
  select cm.user_id into other_id
  from public.conversation_members cm
  where cm.conversation_id = conv and cm.user_id <> uid
  limit 1;
  if other_id is null or not public.is_approved_user(other_id) then return false; end if;
  if public.is_blocked_pair(uid, other_id) then return false; end if;
  select cm.live_typing_enabled into me_en
  from public.conversation_members cm
  where cm.conversation_id = conv and cm.user_id = uid;
  select cm.live_typing_enabled into other_en
  from public.conversation_members cm
  where cm.conversation_id = conv and cm.user_id = other_id;
  return coalesce(me_en, false) and coalesce(other_en, false);
end; $$;
grant execute on function public.is_live_draft_eligible(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- Sohbet kilidi RPC'leri — policy bağımlılığı yok → DROP + CREATE (p_* parametreler)
-- ------------------------------------------------------------
drop function if exists public.get_conversation_lock_status(uuid);
create function public.get_conversation_lock_status(p_conversation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  me uuid := auth.uid();
  r public.conversation_locks%rowtype;
  has_pin boolean;
  locked boolean;
  unlocked boolean;
  req_pin boolean;
begin
  if me is null then
    return jsonb_build_object('has_pin', false, 'locked', false, 'unlocked', true, 'requires_pin', false);
  end if;
  select cl.* into r
  from public.conversation_locks cl
  where cl.user_id = me and cl.conversation_id = p_conversation_id;
  has_pin := found and r.pin_hash is not null;
  locked  := has_pin and r.locked_until is not null and r.locked_until > now();
  unlocked := has_pin and r.unlocked_until is not null and r.unlocked_until > now();
  req_pin := has_pin and not unlocked;
  return jsonb_build_object(
    'has_pin', has_pin,
    'locked', locked,
    'locked_until', case when has_pin then r.locked_until else null end,
    'unlocked', unlocked,
    'unlocked_until', case when has_pin then r.unlocked_until else null end,
    'failed_attempts', coalesce(r.failed_attempts, 0),
    'remaining_attempts', greatest(0, 5 - coalesce(r.failed_attempts, 0)),
    'requires_pin', req_pin
  );
end; $$;
grant execute on function public.get_conversation_lock_status(uuid) to authenticated;

drop function if exists public.set_conversation_pin(uuid, text);
create function public.set_conversation_pin(p_conversation_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid();
  salt text;
  row_exists boolean;
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_conversation_member(p_conversation_id, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'PIN tam olarak 4 rakam olmalıdır'; end if;
  salt := extensions.gen_salt('bf');
  insert into public.conversation_locks as cl (user_id, conversation_id, pin_hash, pin_salt, failed_attempts, locked_until, unlocked_until)
  values (me, p_conversation_id, extensions.crypt(p_pin, salt), salt, 0, null, now() + interval '10 minutes')
  on conflict (user_id, conversation_id) do update
    set pin_hash = excluded.pin_hash,
        pin_salt = excluded.pin_salt,
        failed_attempts = 0,
        locked_until = null,
        unlocked_until = now() + interval '10 minutes',
        updated_at = now();
  select exists (
    select 1 from public.conversation_locks cl
    where cl.user_id = me and cl.conversation_id = p_conversation_id and cl.pin_hash is not null
  ) into row_exists;
  if not row_exists then raise exception 'PIN kaydedilemedi (conversation_locks satırı oluşmadı)'; end if;
  return jsonb_build_object('success', true, 'has_pin', true, 'requires_pin', false);
end; $$;
grant execute on function public.set_conversation_pin(uuid, text) to authenticated;

drop function if exists public.lock_conversation_now(uuid);
create function public.lock_conversation_now(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  updated int;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  update public.conversation_locks cl
     set unlocked_until = null, updated_at = now()
   where cl.user_id = me and cl.conversation_id = p_conversation_id and cl.pin_hash is not null;
  get diagnostics updated = row_count;
  if updated = 0 then raise exception 'Önce PIN oluşturun'; end if;
  return jsonb_build_object('success', true, 'requires_pin', true);
end; $$;
grant execute on function public.lock_conversation_now(uuid) to authenticated;

drop function if exists public.verify_conversation_pin(uuid, text);
create function public.verify_conversation_pin(p_conversation_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid();
  r public.conversation_locks%rowtype;
  ok boolean;
  new_failed int;
  new_locked timestamptz;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select cl.* into r
  from public.conversation_locks cl
  where cl.user_id = me and cl.conversation_id = p_conversation_id
  for update;
  if not found or r.pin_hash is null then
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('success', false, 'remaining_attempts', 0, 'locked_until', r.locked_until);
  end if;
  ok := (p_pin is not null and p_pin ~ '^[0-9]{4}$' and extensions.crypt(p_pin, r.pin_hash) = r.pin_hash);
  if ok then
    update public.conversation_locks cl
       set failed_attempts = 0, locked_until = null, unlocked_until = now() + interval '10 minutes', updated_at = now()
     where cl.user_id = me and cl.conversation_id = p_conversation_id;
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  else
    new_failed := r.failed_attempts + 1;
    new_locked := case when new_failed >= 5 then now() + interval '15 minutes' else null end;
    update public.conversation_locks cl
       set failed_attempts = case when new_failed >= 5 then 0 else new_failed end,
           locked_until = new_locked,
           updated_at = now()
     where cl.user_id = me and cl.conversation_id = p_conversation_id;
    return jsonb_build_object('success', false, 'remaining_attempts', greatest(0, 5 - new_failed), 'locked_until', new_locked);
  end if;
end; $$;
grant execute on function public.verify_conversation_pin(uuid, text) to authenticated;

drop function if exists public.remove_conversation_pin(uuid, text);
create function public.remove_conversation_pin(p_conversation_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid();
  r public.conversation_locks%rowtype;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select cl.* into r
  from public.conversation_locks cl
  where cl.user_id = me and cl.conversation_id = p_conversation_id
  for update;
  if not found or r.pin_hash is null then
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('success', false, 'remaining_attempts', 0, 'locked_until', r.locked_until);
  end if;
  if p_pin is not null and p_pin ~ '^[0-9]{4}$' and extensions.crypt(p_pin, r.pin_hash) = r.pin_hash then
    delete from public.conversation_locks cl
     where cl.user_id = me and cl.conversation_id = p_conversation_id;
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  else
    update public.conversation_locks cl
       set failed_attempts = least(r.failed_attempts + 1, 5),
           locked_until = case when r.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else cl.locked_until end,
           updated_at = now()
     where cl.user_id = me and cl.conversation_id = p_conversation_id;
    return jsonb_build_object('success', false, 'remaining_attempts', greatest(0, 5 - (r.failed_attempts + 1)), 'locked_until', null);
  end if;
end; $$;
grant execute on function public.remove_conversation_pin(uuid, text) to authenticated;

drop function if exists public.force_remove_conversation_lock(uuid);
create function public.force_remove_conversation_lock(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Yetkisiz istek'; end if;
  if not public.is_conversation_member(p_conversation_id, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  delete from public.conversation_locks cl
   where cl.user_id = me and cl.conversation_id = p_conversation_id;
end; $$;
grant execute on function public.force_remove_conversation_lock(uuid) to authenticated;

-- ------------------------------------------------------------
-- Canlı yazım — üyelik bayrağı + durum RPC'leri (policy bağımlılığı yok)
-- ------------------------------------------------------------
drop function if exists public.set_live_typing_enabled(uuid, boolean);
create function public.set_live_typing_enabled(p_conversation_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  grp boolean;
  cnt int;
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_conversation_member(p_conversation_id, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  select (coalesce(c.type, 'direct') = 'group' or c.is_group) into grp
  from public.conversations c where c.id = p_conversation_id;
  select count(*)::int into cnt from public.conversation_members cm where cm.conversation_id = p_conversation_id;
  if coalesce(grp, false) or cnt <> 2 then
    raise exception 'Canlı yazım yalnızca birebir sohbetlerde kullanılabilir';
  end if;
  update public.conversation_members cm
     set live_typing_enabled = coalesce(p_enabled, false)
   where cm.conversation_id = p_conversation_id and cm.user_id = me;
end; $$;
grant execute on function public.set_live_typing_enabled(uuid, boolean) to authenticated;

drop function if exists public.get_live_typing_status(uuid);
create function public.get_live_typing_status(p_conversation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  me uuid := auth.uid();
  other_id uuid;
  grp boolean;
  cnt int;
  me_en boolean;
  other_en boolean;
  eligible boolean;
begin
  if me is null or not public.is_conversation_member(p_conversation_id, me) then
    return jsonb_build_object('eligible', false, 'me_enabled', false, 'other_enabled', false, 'active', false);
  end if;
  select (coalesce(c.type, 'direct') = 'group' or c.is_group) into grp
  from public.conversations c where c.id = p_conversation_id;
  select count(*)::int into cnt from public.conversation_members cm where cm.conversation_id = p_conversation_id;
  select cm.user_id into other_id
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id and cm.user_id <> me
  limit 1;
  select cm.live_typing_enabled into me_en
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id and cm.user_id = me;
  select cm.live_typing_enabled into other_en
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id and cm.user_id = other_id;
  eligible := (not coalesce(grp, false)) and cnt = 2 and other_id is not null
              and public.is_approved_user(me) and public.is_approved_user(other_id)
              and not public.is_blocked_pair(me, other_id);
  return jsonb_build_object(
    'eligible', eligible,
    'me_enabled', coalesce(me_en, false),
    'other_enabled', coalesce(other_en, false),
    'active', eligible and coalesce(me_en, false) and coalesce(other_en, false)
  );
end; $$;
grant execute on function public.get_live_typing_status(uuid) to authenticated;

drop function if exists public.cleanup_expired_live_drafts();
create function public.cleanup_expired_live_drafts()
returns void language sql security definer set search_path = public as $$
  delete from public.live_drafts ld where ld.expires_at < now();
$$;
grant execute on function public.cleanup_expired_live_drafts() to authenticated;

drop function if exists public.upsert_live_draft(uuid, text);
create function public.upsert_live_draft(p_conversation_id uuid, p_draft_text text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  clean text := nullif(btrim(coalesce(p_draft_text, '')), '');
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_live_draft_eligible(p_conversation_id, me) then
    raise exception 'Canlı yazım bu sohbette aktif değil (iki taraf da açmalı)';
  end if;
  perform public.cleanup_expired_live_drafts();
  if clean is null then
    delete from public.live_drafts ld
     where ld.conversation_id = p_conversation_id and ld.sender_id = me;
    return;
  end if;
  if char_length(clean) > 2000 then clean := left(clean, 2000); end if;
  insert into public.live_drafts as ld (conversation_id, sender_id, text, updated_at, expires_at)
  values (p_conversation_id, me, clean, now(), now() + interval '5 seconds')
  on conflict (conversation_id, sender_id) do update
    set text = excluded.text, updated_at = now(), expires_at = now() + interval '5 seconds';
end; $$;
grant execute on function public.upsert_live_draft(uuid, text) to authenticated;

drop function if exists public.clear_live_draft(uuid);
create function public.clear_live_draft(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  delete from public.live_drafts ld
   where ld.conversation_id = p_conversation_id and ld.sender_id = me;
end; $$;
grant execute on function public.clear_live_draft(uuid) to authenticated;

-- ------------------------------------------------------------
-- live_drafts realtime publication — idempotent (zaten ekliyse hata vermez)
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.live_drafts;
exception when duplicate_object then null;
end $$;
alter table public.live_drafts replica identity full;

-- messages / live_drafts RLS politikalarına DOKUNULMAZ (DROP POLICY yok).

-- ------------------------------------------------------------
-- Doğrulama (yalnızca bilgi amaçlı NOTICE — veri/şema değiştirmez)
-- ------------------------------------------------------------
do $$
declare
  fn_count int;
begin
  select count(*) into fn_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'chat_lock_ok', 'is_live_draft_eligible', 'get_conversation_lock_status',
      'set_conversation_pin', 'lock_conversation_now', 'verify_conversation_pin',
      'remove_conversation_pin', 'force_remove_conversation_lock',
      'set_live_typing_enabled', 'get_live_typing_status',
      'cleanup_expired_live_drafts', 'upsert_live_draft', 'clear_live_draft'
    );
  raise notice '[018] Onarım tamamlandı. Beklenen 13 fonksiyondan % tanesi public şemada mevcut.', fn_count;
end $$;
