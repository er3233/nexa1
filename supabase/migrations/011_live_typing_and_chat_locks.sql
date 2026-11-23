-- ============================================================
-- 011_live_typing_and_chat_locks.sql
--   (1) Canlı Yazım — geçici, opt-in, birebir taslak paylaşımı
--   (2) Sohbet Kilidi — 4 haneli PIN (server-side hash, DEĞİL E2E)
--
-- GÜVENLİK / KURALLAR:
-- - Idempotent. DROP TABLE / TRUNCATE YOK.
-- - PIN asla düz metin saklanmaz/loglanmaz: pgcrypto crypt()+gen_salt('bf').
-- - PIN doğrulama YALNIZCA SECURITY DEFINER RPC ile; frontend hash/salt OKUYAMAZ
--   (kolon bazlı GRANT + RLS).
-- - Kilit durumu SERVER timestamp'i ile kontrol edilir; cihaz saatine güvenilmez.
-- - Kilitli sohbette messages SELECT/INSERT/UPDATE/DELETE RLS ile engellenir
--   (yalnızca ekranda gizlemek değil) → Realtime erişimi de kilide uyar.
-- - Canlı yazım taslağı messages/kalıcı tabloya YAZILMAZ (yalnızca Realtime Broadcast).
-- - Önkoşul: 007 (is_approved_user, is_blocked_pair) ve is_conversation_member.
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- (1) CANLI YAZIM — üyelik bazlı opt-in bayrağı
-- ============================================================
alter table public.conversation_members
  add column if not exists live_typing_enabled boolean not null default false;

-- Kendi tarafını aç/kapat (yalnızca birebir sohbet).
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
  update public.conversation_members
     set live_typing_enabled = coalesce(enabled, false)
   where conversation_members.conversation_id = conv and conversation_members.user_id = me;
end; $$;

-- İki tarafın durumunu ve etkinliği döndür.
create or replace function public.get_live_typing_status(conversation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  me uuid := auth.uid(); conv uuid := conversation_id; other uuid;
  grp boolean; cnt int; me_en boolean; other_en boolean; eligible boolean;
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
  return jsonb_build_object(
    'eligible', eligible,
    'me_enabled', coalesce(me_en, false),
    'other_enabled', coalesce(other_en, false),
    'active', eligible and coalesce(me_en,false) and coalesce(other_en,false)
  );
end; $$;

grant execute on function public.set_live_typing_enabled(uuid, boolean) to authenticated;
grant execute on function public.get_live_typing_status(uuid) to authenticated;

-- ============================================================
-- (2) SOHBET KİLİDİ — kullanıcı başına, sohbet başına 4 haneli PIN
-- ============================================================
create table if not exists public.conversation_locks (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  pin_hash        text,
  pin_salt        text,
  failed_attempts int not null default 0,
  locked_until    timestamptz,   -- 5 hatalı denemeden sonra bu ana kadar kilitli
  unlocked_until  timestamptz,   -- doğru PIN sonrası bu ana kadar açık (kayan pencere)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

drop trigger if exists trg_conversation_locks_updated_at on public.conversation_locks;
create trigger trg_conversation_locks_updated_at before update on public.conversation_locks
  for each row execute function public.set_updated_at();

alter table public.conversation_locks enable row level security;

-- Yalnızca kendi satırını görebilir.
drop policy if exists locks_select_own on public.conversation_locks;
create policy locks_select_own on public.conversation_locks for select to authenticated
  using (user_id = auth.uid());

-- Kolon bazlı güvenlik: hash/salt HİÇBİR ZAMAN doğrudan okunamaz.
-- Yazma yetkisi yok → tüm değişiklikler SECURITY DEFINER RPC ile.
revoke all on public.conversation_locks from authenticated;
revoke all on public.conversation_locks from anon;
grant select (user_id, conversation_id, failed_attempts, locked_until, unlocked_until, created_at, updated_at)
  on public.conversation_locks to authenticated;

-- Kilit "geçilebilir mi?": kilit yoksa / PIN yoksa / şu an açıksa true.
create or replace function public.chat_lock_ok(conv uuid, uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (
    select 1 from public.conversation_locks l
    where l.user_id = uid and l.conversation_id = conv
      and l.pin_hash is not null
      and (l.unlocked_until is null or l.unlocked_until <= now())
  );
$$;
grant execute on function public.chat_lock_ok(uuid, uuid) to authenticated;

-- PIN oluştur/değiştir (change için frontend önce verify çağırır).
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
        failed_attempts = 0, locked_until = null, unlocked_until = now() + interval '10 minutes',
        updated_at = now();
end; $$;

-- PIN doğrula → { success, remaining_attempts, locked_until }
create or replace function public.verify_conversation_pin(conversation_id uuid, pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid(); conv uuid := conversation_id; p text := pin;
  r public.conversation_locks%rowtype; ok boolean; new_failed int; new_locked timestamptz;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  select * into r from public.conversation_locks
   where user_id = me and conversation_id = conv for update;
  if not found or r.pin_hash is null then
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  end if;
  -- Sunucu saatiyle deneme kilidi kontrolü.
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('success', false, 'remaining_attempts', 0, 'locked_until', r.locked_until);
  end if;
  ok := (p is not null and p ~ '^[0-9]{4}$' and extensions.crypt(p, r.pin_hash) = r.pin_hash);
  if ok then
    update public.conversation_locks
       set failed_attempts = 0, locked_until = null, unlocked_until = now() + interval '10 minutes', updated_at = now()
     where user_id = me and conversation_id = conv;
    return jsonb_build_object('success', true, 'remaining_attempts', 5, 'locked_until', null);
  else
    new_failed := r.failed_attempts + 1;
    new_locked := case when new_failed >= 5 then now() + interval '15 minutes' else null end;
    update public.conversation_locks
       set failed_attempts = case when new_failed >= 5 then 0 else new_failed end,
           locked_until = new_locked, updated_at = now()
     where user_id = me and conversation_id = conv;
    return jsonb_build_object(
      'success', false,
      'remaining_attempts', greatest(0, 5 - new_failed),
      'locked_until', new_locked
    );
  end if;
end; $$;

-- Şimdi kilitle (açık pencereyi kapat).
create or replace function public.lock_conversation_now(conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id;
begin
  if me is null then raise exception 'Yetkisiz istek'; end if;
  update public.conversation_locks set unlocked_until = null, updated_at = now()
   where user_id = me and conversation_id = conv and pin_hash is not null;
end; $$;

-- PIN ile kilidi kaldır (doğru PIN gerekir).
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
           locked_until = case when r.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end,
           updated_at = now()
     where user_id = me and conversation_id = conv;
    return jsonb_build_object('success', false, 'remaining_attempts', greatest(0, 5 - (r.failed_attempts + 1)), 'locked_until', null);
  end if;
end; $$;

-- PIN unutulduysa: hesap parolası yeniden doğrulandıktan SONRA (frontend
-- signInWithPassword ile) çağrılır. Yalnızca kendi kilidini kaldırır.
create or replace function public.force_remove_conversation_lock(conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id;
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Yetkisiz istek'; end if;
  if not public.is_conversation_member(conv, me) then raise exception 'Bu sohbetin üyesi değilsiniz'; end if;
  delete from public.conversation_locks where user_id = me and conversation_id = conv;
end; $$;

-- Kilit durumu (güvenli alanlar).
create or replace function public.get_conversation_lock_status(conversation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid(); conv uuid := conversation_id; r public.conversation_locks%rowtype; has_pin boolean; locked boolean; unlocked boolean;
begin
  if me is null then return jsonb_build_object('has_pin', false, 'locked', false, 'unlocked', true); end if;
  select * into r from public.conversation_locks where user_id = me and conversation_id = conv;
  has_pin := found and r.pin_hash is not null;
  locked  := has_pin and r.locked_until is not null and r.locked_until > now();
  unlocked := has_pin and r.unlocked_until is not null and r.unlocked_until > now();
  return jsonb_build_object(
    'has_pin', has_pin,
    'locked', locked,
    'locked_until', case when has_pin then r.locked_until else null end,
    'unlocked', unlocked,
    'unlocked_until', case when has_pin then r.unlocked_until else null end,
    'failed_attempts', coalesce(r.failed_attempts, 0),
    'remaining_attempts', greatest(0, 5 - coalesce(r.failed_attempts, 0)),
    -- 'requires_pin': şu an PIN ekranı gösterilmeli mi?
    'requires_pin', has_pin and not (r.unlocked_until is not null and r.unlocked_until > now())
  );
end; $$;

-- Şu an kilitli olan (PIN gereken) sohbet id'leri — liste maskeleme için.
create or replace function public.get_locked_conversation_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select l.conversation_id from public.conversation_locks l
  where l.user_id = auth.uid() and l.pin_hash is not null
    and (l.unlocked_until is null or l.unlocked_until <= now());
$$;

grant execute on function public.set_conversation_pin(uuid, text)         to authenticated;
grant execute on function public.verify_conversation_pin(uuid, text)      to authenticated;
grant execute on function public.lock_conversation_now(uuid)              to authenticated;
grant execute on function public.remove_conversation_pin(uuid, text)      to authenticated;
grant execute on function public.force_remove_conversation_lock(uuid)     to authenticated;
grant execute on function public.get_conversation_lock_status(uuid)       to authenticated;
grant execute on function public.get_locked_conversation_ids()            to authenticated;

-- ============================================================
-- (3) MESSAGES RLS — kilit durumunu uygula (007 sürümüne chat_lock_ok eklenir)
-- ============================================================
drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages for select to authenticated
  using (public.is_approved_user(auth.uid()) and public.is_conversation_member(conversation_id, auth.uid())
         and public.chat_lock_ok(conversation_id, auth.uid()));
drop policy if exists messages_insert_member on public.messages;
create policy messages_insert_member on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_approved_user(auth.uid())
              and public.is_conversation_member(conversation_id, auth.uid())
              and public.chat_lock_ok(conversation_id, auth.uid()));
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages for update to authenticated
  using (sender_id = auth.uid() and public.is_approved_user(auth.uid())
         and public.chat_lock_ok(conversation_id, auth.uid()))
  with check (sender_id = auth.uid());
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete to authenticated
  using (sender_id = auth.uid() and public.is_approved_user(auth.uid())
         and public.chat_lock_ok(conversation_id, auth.uid()));

-- ============================================================
-- (4) OPSİYONEL — Realtime Authorization (private broadcast) politikaları.
-- Canlı yazım kanalı `live-typing:<conversation_id>` topic'ini kullanır.
-- Aşağıdaki blok, Supabase Realtime Authorization etkinse kanalı yalnızca
-- konuşma üyelerine açar. `realtime.messages` sürüme göre değişebildiğinden
-- güvenli şekilde sarmalanmıştır (hata olursa migration bozulmaz; bu durumda
-- istemci normal broadcast'e düşer ve özellik yalnızca çift onayla çalışır).
-- ============================================================
do $$
begin
  begin execute 'alter table realtime.messages enable row level security'; exception when others then null; end;
  execute 'drop policy if exists nx_live_typing_read on realtime.messages';
  execute 'drop policy if exists nx_live_typing_write on realtime.messages';
  execute 'drop policy if exists nx_live_draft_read on realtime.messages';
  execute 'drop policy if exists nx_live_draft_send on realtime.messages';
  execute $p$
    create policy nx_live_draft_read on realtime.messages for select to authenticated
    using (
      (select realtime.topic()) like 'live-draft:%'
      and public.is_conversation_member(nullif(split_part((select realtime.topic()), ':', 2), '')::uuid, auth.uid())
    )
  $p$;
  execute $p$
    create policy nx_live_draft_send on realtime.messages for insert to authenticated
    with check (
      (select realtime.topic()) like 'live-draft:%'
      and public.is_conversation_member(nullif(split_part((select realtime.topic()), ':', 2), '')::uuid, auth.uid())
      and public.is_approved_user(auth.uid())
    )
  $p$;
exception when others then
  raise warning 'Realtime Authorization politikaları uygulanamadı: %. Canlı yazım private kanalı çalışmayabilir.', sqlerrm;
end $$;
