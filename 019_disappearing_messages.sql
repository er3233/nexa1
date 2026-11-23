-- ============================================================
-- 019_disappearing_messages.sql
--
-- Kaybolan mesajlar (disappearing messages) — sohbet başına tek ayar
-- (herhangi bir üye değiştirebilir, WhatsApp grup ayarına benzer).
--
-- GÜVENLİK / KURALLAR:
-- - Idempotent. DROP TABLE / TRUNCATE / CASCADE YOK.
-- - Mevcut mesajlar/konuşmalar/kullanıcılar etkilenmez (yeni kolonlar nullable).
-- - Süresi dolan mesaj RLS SELECT düzeyinde ANINDA gizlenir (temizlenmeden önce
--   bile) — gönderen dahil kimse göremez. messages_select_member politikasının
--   AYNI koşulları (chat_lock_ok / is_conversation_member / is_approved_user)
--   korunur, yalnızca expires_at koşulu eklenir.
-- - Bu bir uçtan uca (E2E) şifreleme garantisi DEĞİLDİR: süre dolana kadar
--   mesaj sunucuda normal şekilde (düz metin) saklanır.
-- ============================================================

-- ------------------------------------------------------------
-- Şema
-- ------------------------------------------------------------
alter table public.messages
  add column if not exists expires_at timestamptz;

alter table public.conversations
  add column if not exists disappearing_seconds integer;

do $$ begin
  alter table public.conversations
    add constraint conversations_disappearing_seconds_chk
    check (disappearing_seconds is null or disappearing_seconds in (3600, 86400, 604800));
exception when duplicate_object then null; end $$;

create index if not exists messages_expires_at_idx
  on public.messages (conversation_id, expires_at) where expires_at is not null;

-- ------------------------------------------------------------
-- Trigger: yeni mesaj eklenirken, konuşmada kaybolan mesaj süresi
-- açıksa expires_at otomatik atanır.
-- ------------------------------------------------------------
create or replace function public.set_message_expiry()
returns trigger language plpgsql security definer set search_path = public as $$
declare secs integer;
begin
  select disappearing_seconds into secs from public.conversations where id = NEW.conversation_id;
  if secs is not null and secs > 0 then
    NEW.expires_at := now() + (secs || ' seconds')::interval;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_messages_set_expiry on public.messages;
create trigger trg_messages_set_expiry before insert on public.messages
  for each row execute function public.set_message_expiry();

-- ------------------------------------------------------------
-- RPC: kaybolan mesaj süresini ayarla (üyelik kontrolü yapar).
-- ------------------------------------------------------------
create or replace function public.set_disappearing_messages(p_conversation_id uuid, p_seconds integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız bu işlem için uygun değil'; end if;
  if not public.is_conversation_member(p_conversation_id, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  if p_seconds is not null and p_seconds not in (3600, 86400, 604800) then
    raise exception 'Geçersiz süre';
  end if;
  update public.conversations set disappearing_seconds = p_seconds, updated_at = now() where id = p_conversation_id;
  return jsonb_build_object('success', true, 'disappearing_seconds', p_seconds);
end; $$;
grant execute on function public.set_disappearing_messages(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- RPC: süresi geçmiş mesajları gerçekten sil (veri hijyeni — RLS zaten
-- görünürlüğü bundan bağımsız olarak anında kesiyor). Fırsatçı temizlik
-- deseni: frontend, kaybolan mesaj açık bir sohbete girildiğinde çağırır
-- (migration 013'teki cleanup_expired_live_drafts ile aynı yaklaşım).
-- ------------------------------------------------------------
create or replace function public.cleanup_expired_messages(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not public.is_conversation_member(p_conversation_id, me) then return; end if;
  delete from public.messages
   where conversation_id = p_conversation_id
     and expires_at is not null
     and expires_at < now();
end; $$;
grant execute on function public.cleanup_expired_messages(uuid) to authenticated;

-- ------------------------------------------------------------
-- RLS: messages_select_member — mevcut koşullar AYNEN korunur,
-- yalnızca "süresi dolmamış" koşulu eklenir. DROP POLICY + CREATE
-- (aynı isim, aynı davranış + ek koşul; veri/tablo silinmez).
-- ------------------------------------------------------------
drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select to authenticated
  using (
    public.is_approved_user(auth.uid())
    and public.is_conversation_member(conversation_id, auth.uid())
    and public.chat_lock_ok(conversation_id, auth.uid())
    and (expires_at is null or expires_at > now())
  );

-- ------------------------------------------------------------
-- Doğrulama (yalnızca bilgi amaçlı NOTICE — veri/şema değiştirmez)
-- ------------------------------------------------------------
do $$
declare fn_count int;
begin
  select count(*) into fn_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('set_message_expiry', 'set_disappearing_messages', 'cleanup_expired_messages');
  raise notice '[019] Kaybolan mesajlar onarımı tamamlandı. Beklenen 3 fonksiyondan % tanesi mevcut.', fn_count;
end $$;
