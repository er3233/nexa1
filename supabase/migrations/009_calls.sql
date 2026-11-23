-- ============================================================
-- 009_calls.sql — Birebir WebRTC sesli/görüntülü arama altyapısı.
--
-- GÜVENLİK / KURALLAR:
-- - Idempotent. DROP TABLE / TRUNCATE YOK.
-- - call_sessions: yazma yalnızca SECURITY DEFINER RPC'lerle (status güvenli değişir).
-- - call_signals: yalnızca çağrının katılımcıları kendi sinyallerini ekleyip
--   ilgili çağrının tüm sinyallerini okuyabilir (RLS). Üçüncü kişi göremez.
-- - Yalnızca onaylı+aktif+yasaksız kullanıcılar, aynı direct conversation üyesiyse,
--   engelli değilse arama başlatabilir.
-- - Aynı anda birden fazla aktif çağrı engellenir; süresiz ringing 45 sn'de missed olur.
-- - Önkoşul: 007 (is_approved_user, is_blocked_pair) ve 008 (find_direct_conversation).
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

-- ------------------------------------------------------------
-- Yardımcı: kullanıcı çağrının katılımcısı mı?
-- ------------------------------------------------------------
create or replace function public.is_call_participant(cid uuid, uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.call_sessions c
    where c.id = cid and (c.caller_id = uid or c.receiver_id = uid)
  );
$$;
grant execute on function public.is_call_participant(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.call_sessions enable row level security;
drop policy if exists call_sessions_select_participant on public.call_sessions;
create policy call_sessions_select_participant on public.call_sessions
  for select to authenticated
  using (caller_id = auth.uid() or receiver_id = auth.uid());

alter table public.call_signals enable row level security;
drop policy if exists call_signals_select_participant on public.call_signals;
create policy call_signals_select_participant on public.call_signals
  for select to authenticated
  using (public.is_call_participant(call_id, auth.uid()));

-- Sinyal ekleme düşük gecikme için doğrudan (RLS ile katılımcı + onaylı doğrulanır).
drop policy if exists call_signals_insert_participant on public.call_signals;
create policy call_signals_insert_participant on public.call_signals
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_approved_user(auth.uid())
    and public.is_call_participant(call_id, auth.uid())
  );

-- ------------------------------------------------------------
-- Temizlik: süresi geçen ringing çağrıları missed'a al.
-- ------------------------------------------------------------
create or replace function public.expire_stale_calls()
returns void language sql security definer set search_path = public as $$
  -- Cevapsız ringing
  update public.call_sessions
     set status = 'missed', ended_at = now()
   where status = 'ringing'
     and started_at < now() - interval '45 seconds';

  -- Sayfa kapanınca end_call kaçmış accepted (WebRTC keepalive yok)
  update public.call_sessions
     set status = 'ended', ended_at = coalesce(ended_at, now())
   where status = 'accepted'
     and coalesce(answered_at, started_at) < now() - interval '15 minutes';
$$;
grant execute on function public.expire_stale_calls() to authenticated;

-- ------------------------------------------------------------
-- RPC: aramayı başlat
-- ------------------------------------------------------------
create or replace function public.start_call(receiver_user_id uuid, conversation_id uuid, call_type text default 'audio')
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); new_id uuid; ct text := lower(coalesce(call_type,'audio'));
begin
  if me is null or not public.is_approved_user(me) then raise exception 'Hesabınız arama için uygun değil'; end if;
  if receiver_user_id = me then raise exception 'Kendinizi arayamazsınız'; end if;
  if ct not in ('audio','video') then ct := 'audio'; end if;
  if not public.is_approved_user(receiver_user_id) then raise exception 'Bu kullanıcı aranamaz'; end if;
  if public.is_blocked_pair(me, receiver_user_id) then raise exception 'Bu kullanıcıyla iletişim kurulamaz'; end if;
  -- Yalnızca mevcut direct conversation üyeleri birbirini arayabilir.
  if conversation_id is null or public.find_direct_conversation(me, receiver_user_id) is distinct from conversation_id then
    raise exception 'Geçerli bir birebir sohbet gerekiyor';
  end if;

  perform public.expire_stale_calls();

  -- UI idle iken kendi stuck ringing/accepted satırlarını kapat (sayfa yenileme / crash).
  update public.call_sessions
     set status = case when status = 'ringing' then 'missed' else 'ended' end,
         ended_at = now()
   where status in ('ringing', 'accepted')
     and (caller_id = me or receiver_id = me)
     and started_at < now() - interval '45 seconds';

  -- Aynı anda birden fazla aktif çağrı engellenir.
  if exists (
    select 1 from public.call_sessions
    where status in ('ringing','accepted') and (caller_id = me or receiver_id = me or caller_id = receiver_user_id or receiver_id = receiver_user_id)
  ) then
    raise exception 'Zaten aktif bir çağrı var';
  end if;

  insert into public.call_sessions (caller_id, receiver_id, conversation_id, call_type, status)
  values (me, receiver_user_id, conversation_id, ct, 'ringing')
  returning id into new_id;
  return new_id;
end; $$;

-- ------------------------------------------------------------
-- RPC: durum değişiklikleri
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.call_sessions;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.call_signals;
exception when duplicate_object then null; end $$;
alter table public.call_sessions replica identity full;
alter table public.call_signals replica identity full;
