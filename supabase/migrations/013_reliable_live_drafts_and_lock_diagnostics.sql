-- ============================================================
-- 013_reliable_live_drafts_and_lock_diagnostics.sql
--
-- (1) Canlı yazım: private Broadcast yerine geçici live_drafts tablosu
--     + Postgres Realtime (typing_indicators ile aynı güvenilir yol).
-- (2) Sohbet kilidi: PIN RPC'leri jsonb döndürür, extensions.crypt doğrulanır,
--     hata ayıklama için get_conversation_lock_status güçlendirilir.
--
-- Idempotent. DROP TABLE / TRUNCATE YOK.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- (1) live_drafts — geçici taslak (kalıcı mesaj DEĞİL, max ~5 sn)
-- ------------------------------------------------------------
create table if not exists public.live_drafts (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  text            text not null,
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '5 seconds'),
  primary key (conversation_id, sender_id)
);

create index if not exists live_drafts_conv_idx on public.live_drafts (conversation_id, expires_at);

-- İki taraf da live_typing_enabled=true ve birebir onaylı sohbet mi?
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

-- Taslak yaz/güncelle; boş metin → satır sil.
create or replace function public.upsert_live_draft(p_conversation_id uuid, p_draft_text text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); clean text := nullif(btrim(coalesce(p_draft_text, '')), '');
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_live_draft_eligible(p_conversation_id, me) then raise exception 'Canlı yazım bu sohbette aktif değil (iki taraf da açmalı)'; end if;
  perform public.cleanup_expired_live_drafts();
  if clean is null then
    delete from public.live_drafts ld where ld.conversation_id = p_conversation_id and ld.sender_id = me;
    return;
  end if;
  if char_length(clean) > 2000 then clean := left(clean, 2000); end if;
  insert into public.live_drafts as ld (conversation_id, sender_id, text, updated_at, expires_at)
  values (p_conversation_id, me, clean, now(), now() + interval '5 seconds')
  on conflict (conversation_id, sender_id) do update
    set text = excluded.text, updated_at = now(), expires_at = now() + interval '5 seconds';
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

do $$ begin
  alter publication supabase_realtime add table public.live_drafts;
exception when duplicate_object then null; end $$;
alter table public.live_drafts replica identity full;

-- ------------------------------------------------------------
-- (2) Sohbet kilidi — PIN RPC'leri jsonb (parametreler p_* — belirsizlik yok)
-- void→jsonb dönüş tipi CREATE OR REPLACE ile değişmez; önce DROP.
-- CASCADE YOK. conversation_locks verisi silinmez.
-- Mevcut DB'de 013 hata verdiyse 014; ambiguous hata varsa 015 çalıştırın.
-- ------------------------------------------------------------
drop function if exists public.set_conversation_pin(uuid, text);
drop function if exists public.lock_conversation_now(uuid);

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
    set pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt,
        failed_attempts = 0, locked_until = null, unlocked_until = now() + interval '10 minutes', updated_at = now();
  select exists (
    select 1 from public.conversation_locks cl
    where cl.user_id = me and cl.conversation_id = p_conversation_id and cl.pin_hash is not null
  ) into row_exists;
  if not row_exists then raise exception 'PIN kaydedilemedi (conversation_locks satırı oluşmadı)'; end if;
  return jsonb_build_object('success', true, 'has_pin', true, 'requires_pin', false);
end; $$;

create or replace function public.lock_conversation_now(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); updated int;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  update public.conversation_locks cl
     set unlocked_until = null, updated_at = now()
   where cl.user_id = me and cl.conversation_id = p_conversation_id and cl.pin_hash is not null;
  get diagnostics updated = row_count;
  if updated = 0 then raise exception 'Önce PIN oluşturun'; end if;
  return jsonb_build_object('success', true, 'requires_pin', true);
end; $$;

create or replace function public.get_conversation_lock_status(p_conversation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid(); r public.conversation_locks%rowtype;
  has_pin boolean; locked boolean; unlocked boolean; req_pin boolean;
begin
  if me is null then
    return jsonb_build_object('has_pin', false, 'locked', false, 'unlocked', true, 'requires_pin', false);
  end if;
  select cl.* into r from public.conversation_locks cl
   where cl.user_id = me and cl.conversation_id = p_conversation_id;
  has_pin := found and r.pin_hash is not null;
  locked  := has_pin and r.locked_until is not null and r.locked_until > now();
  unlocked := has_pin and r.unlocked_until is not null and r.unlocked_until > now();
  req_pin := has_pin and not unlocked;
  return jsonb_build_object(
    'has_pin', has_pin, 'locked', locked,
    'locked_until', case when has_pin then r.locked_until else null end,
    'unlocked', unlocked,
    'unlocked_until', case when has_pin then r.unlocked_until else null end,
    'failed_attempts', coalesce(r.failed_attempts, 0),
    'remaining_attempts', greatest(0, 5 - coalesce(r.failed_attempts, 0)),
    'requires_pin', req_pin
  );
end; $$;

grant execute on function public.set_conversation_pin(uuid, text) to authenticated;
grant execute on function public.lock_conversation_now(uuid) to authenticated;
grant execute on function public.get_conversation_lock_status(uuid) to authenticated;
