-- ============================================================
-- 002_messaging.sql — Konuşma/mesaj genişletme, reaksiyon, yazıyor,
-- okundu bilgisi, güvenli RPC'ler. Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- conversations genişletme
-- ------------------------------------------------------------
alter table public.conversations add column if not exists type            text;
alter table public.conversations add column if not exists avatar_url      text;
alter table public.conversations add column if not exists last_message_at timestamptz;
alter table public.conversations add column if not exists updated_at      timestamptz not null default now();

-- is_group -> type senkronu (mevcut satırlar için backfill)
update public.conversations
   set type = case when is_group then 'group' else 'direct' end
 where type is null;

alter table public.conversations alter column type set default 'direct';

do $$ begin
  alter table public.conversations
    add constraint conversations_type_chk check (type in ('direct', 'group'));
exception when duplicate_object then null; end $$;

update public.conversations c
   set last_message_at = coalesce(
        (select max(m.created_at) from public.messages m where m.conversation_id = c.id),
        c.created_at)
 where last_message_at is null;

-- ------------------------------------------------------------
-- conversation_members genişletme
-- ------------------------------------------------------------
alter table public.conversation_members add column if not exists member_role          text not null default 'member';
alter table public.conversation_members add column if not exists muted_until          timestamptz;
alter table public.conversation_members add column if not exists archived_at          timestamptz;
alter table public.conversation_members add column if not exists last_read_message_id uuid;
alter table public.conversation_members add column if not exists last_read_at         timestamptz;

do $$ begin
  alter table public.conversation_members
    add constraint conversation_members_role_chk check (member_role in ('member', 'admin', 'owner'));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- messages genişletme
-- ------------------------------------------------------------
alter table public.messages add column if not exists reply_to_id  uuid references public.messages (id) on delete set null;
alter table public.messages add column if not exists message_type text not null default 'text';
alter table public.messages add column if not exists metadata     jsonb not null default '{}'::jsonb;
alter table public.messages add column if not exists edited_at    timestamptz;
alter table public.messages add column if not exists updated_at   timestamptz;

do $$ begin
  alter table public.messages
    add constraint messages_type_chk check (message_type in ('text', 'image', 'video', 'audio', 'file', 'system'));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- message_reactions
-- ------------------------------------------------------------
create table if not exists public.message_reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

-- reaksiyonun hangi konuşmaya ait olduğunu RLS için kolay bulmak üzere yardımcı fonksiyon
create or replace function public.message_conversation_id(msg uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select conversation_id from public.messages where id = msg;
$$;

-- ------------------------------------------------------------
-- typing_indicators
-- ------------------------------------------------------------
create table if not exists public.typing_indicators (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  updated_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ------------------------------------------------------------
-- Indexler (performans)
-- ------------------------------------------------------------
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index if not exists messages_reply_to_idx             on public.messages (reply_to_id);
create index if not exists conversation_members_user_conv_idx on public.conversation_members (user_id, conversation_id);
create index if not exists conversations_last_message_idx    on public.conversations (last_message_at desc);
create index if not exists message_reactions_message_idx     on public.message_reactions (message_id);

-- ------------------------------------------------------------
-- Mesaj eklenince konuşmanın last_message_at alanını güncelle
-- (SECURITY DEFINER → conversations update RLS'i bypass eder)
-- ------------------------------------------------------------
create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_on_message_insert on public.messages;
create trigger trg_on_message_insert after insert on public.messages
  for each row execute function public.on_message_insert();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.message_reactions enable row level security;
alter table public.typing_indicators enable row level security;

-- message_reactions: yalnızca üye olunan konuşmanın reaksiyonları
drop policy if exists reactions_select_member on public.message_reactions;
create policy reactions_select_member on public.message_reactions
  for select to authenticated
  using (public.is_conversation_member(public.message_conversation_id(message_id), auth.uid()));

drop policy if exists reactions_insert_member on public.message_reactions;
create policy reactions_insert_member on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_conversation_member(public.message_conversation_id(message_id), auth.uid())
  );

drop policy if exists reactions_delete_own on public.message_reactions;
create policy reactions_delete_own on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- typing_indicators: yalnızca üye olunan konuşma
drop policy if exists typing_select_member on public.typing_indicators;
create policy typing_select_member on public.typing_indicators
  for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists typing_upsert_self on public.typing_indicators;
create policy typing_upsert_self on public.typing_indicators
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
  );

drop policy if exists typing_update_self on public.typing_indicators;
create policy typing_update_self on public.typing_indicators
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists typing_delete_self on public.typing_indicators;
create policy typing_delete_self on public.typing_indicators
  for delete to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- RPC: doğrudan konuşma bul/oluştur (güvenli, tekilleştirilmiş)
-- Kendisiyle sohbet engellenir. 003'te engelleme kontrolü eklenir.
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
  if other_id = me then
    raise exception 'Kendinizle sohbet açamazsınız';
  end if;
  if not exists (select 1 from public.profiles where id = other_id) then
    raise exception 'Kullanıcı bulunamadı';
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
-- RPC: okundu işaretle
-- ------------------------------------------------------------
create or replace function public.mark_conversation_read(conv uuid, msg uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(conv, auth.uid()) then
    raise exception 'Bu konuşmanın üyesi değilsiniz';
  end if;
  update public.conversation_members
     set last_read_at = now(),
         last_read_message_id = coalesce(msg, last_read_message_id)
   where conversation_id = conv and user_id = auth.uid();
end;
$$;

-- ------------------------------------------------------------
-- RPC: sustur / arşivle (üye kendi ayarını değiştirir)
-- ------------------------------------------------------------
create or replace function public.set_conversation_muted(conv uuid, until timestamptz default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(conv, auth.uid()) then
    raise exception 'Bu konuşmanın üyesi değilsiniz';
  end if;
  update public.conversation_members set muted_until = until
   where conversation_id = conv and user_id = auth.uid();
end;
$$;

create or replace function public.set_conversation_archived(conv uuid, archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(conv, auth.uid()) then
    raise exception 'Bu konuşmanın üyesi değilsiniz';
  end if;
  update public.conversation_members
     set archived_at = case when archived then now() else null end
   where conversation_id = conv and user_id = auth.uid();
end;
$$;

-- ------------------------------------------------------------
-- RPC: okunmamış mesaj sayıları (auth.uid() için)
-- ------------------------------------------------------------
create or replace function public.get_unread_counts()
returns table (conversation_id uuid, unread integer)
language sql
security definer
stable
set search_path = public
as $$
  select m.conversation_id, count(msg.*)::int as unread
  from public.conversation_members m
  join public.messages msg on msg.conversation_id = m.conversation_id
  where m.user_id = auth.uid()
    and msg.sender_id <> auth.uid()
    and msg.deleted_at is null
    and (m.last_read_at is null or msg.created_at > m.last_read_at)
  group by m.conversation_id;
$$;

grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid, uuid)       to authenticated;
grant execute on function public.set_conversation_muted(uuid, timestamptz) to authenticated;
grant execute on function public.set_conversation_archived(uuid, boolean)  to authenticated;
grant execute on function public.get_unread_counts()                       to authenticated;
grant execute on function public.message_conversation_id(uuid)             to authenticated;
