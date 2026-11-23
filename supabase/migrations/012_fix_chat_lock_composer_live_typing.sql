-- ============================================================
-- 012_fix_chat_lock_composer_live_typing.sql
--   (A) pgcrypto düzeltmesi: Supabase'te pgcrypto `extensions` şemasındadır.
--       gen_salt/crypt çağrıları şema-nitelikli (extensions.) yapılır ve
--       search_path'e extensions eklenir → "function gen_salt(unknown) does
--       not exist" hatası giderilir.
--   (C) Canlı Yazım: private Realtime Broadcast yetkilendirmesi. Kanal topic'i
--       `live-draft:<conversation_id>` olarak standartlaştırılır; realtime.messages
--       RLS politikaları üye kontrolü ile (yeniden) kurulur.
--
-- Idempotent. DROP TABLE/TRUNCATE YOK. Mevcut extension TAŞINMAZ.
-- SECURITY DEFINER + güvenli search_path korunur. Hash/salt frontend'e dönmez.
-- 5 deneme / 15 dk sistemi korunur.
-- ============================================================

-- Supabase'te zaten `extensions` şemasında kuruludur; yoksa oraya kurulur (taşımaz).
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- (A) PIN RPC'leri — extensions.gen_salt / extensions.crypt
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- (C) Canlı Yazım — private broadcast yetkilendirmesi (topic: live-draft:<uuid>)
-- Eski 011 politikaları (live-typing) kaldırılır; live-draft için üye kontrollü
-- SELECT (alma) ve INSERT (gönderme) politikaları kurulur.
-- Hata olursa YUTULMAZ; NOTICE ile SQL çıktısında görünür (README'de de belirtildi).
-- ------------------------------------------------------------
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
  raise notice '[012] Canlı yazım private broadcast politikaları kuruldu (live-draft).';
exception when others then
  raise warning '[012] Realtime Authorization politikaları UYGULANAMADI: %. Canlı yazım private kanalı çalışmayabilir; Supabase Realtime Authorization / realtime.messages RLS iznini kontrol edin.', sqlerrm;
end $$;
