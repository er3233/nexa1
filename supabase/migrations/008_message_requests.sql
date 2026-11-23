-- ============================================================
-- 008_message_requests.sql — Mesajlaşma isteği sistemi.
--
-- KURALLAR / GÜVENLİK:
-- - Idempotent. DROP TABLE / TRUNCATE YOK.
-- - Tüm yazma işlemleri yalnızca SECURITY DEFINER RPC'lerle yapılır
--   (tabloya doğrudan INSERT/UPDATE/DELETE politikası YOKTUR) → kullanıcı
--   status/conversation_id alanlarını değiştirerek sistemi aşamaz.
-- - Yalnızca onaylı+aktif+yasaksız kullanıcılar istek gönderip alabilir.
-- - Engellenen çiftler arasında istek oluşmaz.
-- - Aynı gönderici→alıcı için birden fazla pending olamaz (partial unique index).
-- - Kabul, mevcut güvenli get_or_create_direct_conversation ile tek konuşma açar.
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

-- Aynı gönderici→alıcı için tek bir pending istek.
create unique index if not exists message_requests_unique_pending
  on public.message_requests (sender_id, receiver_id) where status = 'pending';
create index if not exists message_requests_receiver_status_idx on public.message_requests (receiver_id, status, created_at desc);
create index if not exists message_requests_sender_status_idx   on public.message_requests (sender_id, status, created_at desc);

drop trigger if exists trg_message_requests_updated_at on public.message_requests;
create trigger trg_message_requests_updated_at before update on public.message_requests
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- RLS: yalnızca SELECT (kendi gönderdiği/aldığı). Yazma yok → RPC zorunlu.
-- ------------------------------------------------------------
alter table public.message_requests enable row level security;

drop policy if exists message_requests_select_own on public.message_requests;
create policy message_requests_select_own on public.message_requests
  for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

-- ------------------------------------------------------------
-- Yardımcı: iki kullanıcı arasındaki mevcut direct conversation'ı bul (oluşturmaz)
-- ------------------------------------------------------------
create or replace function public.find_direct_conversation(a uuid, b uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select c.id
  from public.conversations c
  where coalesce(c.type, 'direct') = 'direct'
    and exists (select 1 from public.conversation_members m1 where m1.conversation_id = c.id and m1.user_id = a)
    and exists (select 1 from public.conversation_members m2 where m2.conversation_id = c.id and m2.user_id = b)
    and (select count(*) from public.conversation_members m3 where m3.conversation_id = c.id) = 2
  limit 1;
$$;
grant execute on function public.find_direct_conversation(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- RPC: istek gönder
-- Dönüş: jsonb { type: 'existing_conversation'|'already_pending'|'request_sent',
--                conversation_id uuid, request_id uuid }
-- ------------------------------------------------------------
create or replace function public.send_message_request(receiver_user_id uuid, preview text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  conv uuid;
  existing uuid;
  new_id uuid;
  clean_preview text := nullif(btrim(coalesce(preview, '')), '');
begin
  if me is null or not public.is_approved_user(me) then
    raise exception 'Hesabınız bu işlem için uygun değil';
  end if;
  if receiver_user_id = me then
    raise exception 'Kendinize istek gönderemezsiniz';
  end if;
  if not exists (select 1 from public.profiles where id = receiver_user_id) then
    raise exception 'Kullanıcı bulunamadı';
  end if;
  if not public.is_approved_user(receiver_user_id) then
    raise exception 'Bu kullanıcıya istek gönderilemez';
  end if;
  if public.is_blocked_pair(me, receiver_user_id) then
    raise exception 'Bu kullanıcıyla iletişim kurulamaz';
  end if;
  if clean_preview is not null and char_length(clean_preview) > 300 then
    clean_preview := left(clean_preview, 300);
  end if;

  -- Zaten sohbet varsa istek gerekmez.
  conv := public.find_direct_conversation(me, receiver_user_id);
  if conv is not null then
    return jsonb_build_object('type', 'existing_conversation', 'conversation_id', conv, 'request_id', null);
  end if;

  -- Zaten bekleyen istek varsa tekrar oluşturma.
  select id into existing from public.message_requests
   where sender_id = me and receiver_id = receiver_user_id and status = 'pending' limit 1;
  if existing is not null then
    return jsonb_build_object('type', 'already_pending', 'conversation_id', null, 'request_id', existing);
  end if;

  -- Reddedilen istek için makul cooldown (1 saat).
  if exists (
    select 1 from public.message_requests
    where sender_id = me and receiver_id = receiver_user_id and status = 'rejected'
      and responded_at is not null and responded_at > now() - interval '1 hour'
  ) then
    raise exception 'Bu kullanıcıya kısa süre önce istek gönderdiniz. Lütfen sonra tekrar deneyin.';
  end if;

  insert into public.message_requests (sender_id, receiver_id, status, message_preview)
  values (me, receiver_user_id, 'pending', clean_preview)
  returning id into new_id;

  return jsonb_build_object('type', 'request_sent', 'conversation_id', null, 'request_id', new_id);
end;
$$;

-- ------------------------------------------------------------
-- RPC: gelen istekler (alıcı = me, pending)
-- ------------------------------------------------------------
create or replace function public.list_incoming_message_requests()
returns table (
  id uuid, sender_id uuid, username text, display_name text, avatar_url text,
  message_preview text, created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  return query
    select r.id, r.sender_id, p.username, p.display_name, p.avatar_url, r.message_preview, r.created_at
    from public.message_requests r
    join public.profiles p on p.id = r.sender_id
    where r.receiver_id = me and r.status = 'pending'
      and not public.is_blocked_pair(me, r.sender_id)
    order by r.created_at desc;
end;
$$;

-- ------------------------------------------------------------
-- RPC: giden istekler (gönderen = me)
-- ------------------------------------------------------------
create or replace function public.list_outgoing_message_requests()
returns table (
  id uuid, receiver_id uuid, username text, display_name text, avatar_url text,
  status text, message_preview text, created_at timestamptz, responded_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  return query
    select r.id, r.receiver_id, p.username, p.display_name, p.avatar_url,
           r.status, r.message_preview, r.created_at, r.responded_at
    from public.message_requests r
    join public.profiles p on p.id = r.receiver_id
    where r.sender_id = me
    order by r.created_at desc
    limit 50;
end;
$$;

-- ------------------------------------------------------------
-- RPC: kabul et → tek direct conversation oluştur/bul, atomik
-- ------------------------------------------------------------
create or replace function public.accept_message_request(request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  r    public.message_requests%rowtype;
  conv uuid;
begin
  if me is null or not public.is_approved_user(me) then
    raise exception 'Hesabınız bu işlem için uygun değil';
  end if;
  select * into r from public.message_requests where id = request_id for update;
  if not found then raise exception 'İstek bulunamadı'; end if;
  if r.receiver_id <> me then raise exception 'Bu isteği kabul edemezsiniz'; end if;
  if r.status <> 'pending' then raise exception 'İstek zaten yanıtlanmış'; end if;
  if public.is_blocked_pair(me, r.sender_id) then raise exception 'Bu kullanıcıyla iletişim kurulamaz'; end if;

  -- Güvenli, tekilleştirilmiş konuşma (auth.uid()=me alıcı; other=sender).
  conv := public.get_or_create_direct_conversation(r.sender_id);

  update public.message_requests
     set status = 'accepted', conversation_id = conv, responded_at = now()
   where id = request_id;

  return conv;
end;
$$;

-- ------------------------------------------------------------
-- RPC: reddet (alıcı) / iptal et (gönderen)
-- ------------------------------------------------------------
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
end;
$$;

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
end;
$$;

-- ------------------------------------------------------------
-- RPC: bekleyen gelen istek sayısı
-- ------------------------------------------------------------
create or replace function public.get_message_request_count()
returns integer language sql security definer stable set search_path = public as $$
  select count(*)::int from public.message_requests
  where receiver_id = auth.uid() and status = 'pending';
$$;

grant execute on function public.send_message_request(uuid, text)      to authenticated;
grant execute on function public.list_incoming_message_requests()      to authenticated;
grant execute on function public.list_outgoing_message_requests()      to authenticated;
grant execute on function public.accept_message_request(uuid)          to authenticated;
grant execute on function public.reject_message_request(uuid)          to authenticated;
grant execute on function public.cancel_message_request(uuid)          to authenticated;
grant execute on function public.get_message_request_count()           to authenticated;

-- ------------------------------------------------------------
-- Realtime: yeni/güncellenen istekler anlık gelsin.
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.message_requests;
exception when duplicate_object then null; end $$;
alter table public.message_requests replica identity full;
