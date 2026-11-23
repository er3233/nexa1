-- ============================================================
-- 010_admin_notifications.sql — Uygulama içi bildirimler.
--
-- Amaç: Yeni kullanıcı kayıt olup approval_status='pending' olunca TÜM aktif
-- adminlere gerçek zamanlı "Yeni hesap başvurusu" bildirimi düşsün.
--
-- GÜVENLİK / KURALLAR:
-- - Idempotent. DROP TABLE / TRUNCATE YOK.
-- - Bildirimler yalnızca SECURITY DEFINER trigger/RPC ile OLUŞTURULUR
--   (tabloda INSERT politikası yok) → kullanıcı sahte bildirim yaratamaz.
-- - Kullanıcı YALNIZCA kendi bildirimlerini görür/güncelleyebilir (RLS).
-- - Normal kullanıcı admin başvuru bildirimlerini göremez (recipient_id eşleşmez).
-- - Aynı başvuru için aynı admine ikinci bildirim oluşmaz (partial unique index).
-- - RLS recursion yok (trigger definer, düz select).
-- - Önkoşul: 007 (approval_status, is_admin).
-- ============================================================

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  type         text not null,
  title        text not null,
  body         text,
  entity_id    uuid,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_recipient_idx on public.notifications (recipient_id, is_read, created_at desc);
-- Tek başvuru için aynı adminde tekrar bildirim oluşmasın.
-- Tam (partial olmayan) unique: entity_id NULL satırlar birbirinden farklı sayılır,
-- bu yüzden entity_id'siz genel bildirimler kısıtlanmaz; ON CONFLICT çıkarımı güvenli.
create unique index if not exists notifications_dedupe_idx
  on public.notifications (recipient_id, type, entity_id);

-- ------------------------------------------------------------
-- RLS: yalnızca kendi bildirimleri (görüntüle + güncelle). Ekleme = definer.
-- ------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- ------------------------------------------------------------
-- Yeni pending profil → tüm aktif adminlere bildirim.
-- ------------------------------------------------------------
create or replace function public.notify_admins_new_application()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, type, title, body, entity_id)
  select a.id, new.id, 'account_application', 'Yeni hesap başvurusu',
         coalesce(nullif(new.display_name, ''), new.username, 'Bir kullanıcı') || ' onay bekliyor',
         new.id
  from public.profiles a
  where a.role = 'admin' and a.banned_at is null and a.deactivated_at is null
  on conflict (recipient_id, type, entity_id) do nothing;
  return new;
end; $$;

drop trigger if exists trg_notify_admins_new_application on public.profiles;
create trigger trg_notify_admins_new_application
  after insert on public.profiles
  for each row when (new.approval_status = 'pending')
  execute function public.notify_admins_new_application();

-- ------------------------------------------------------------
-- Onay/Red sonrası ilgili başvuru bildirimleri okunmuş sayılsın.
-- (Mevcut fonksiyonlara bildirim kapama satırı eklenir.)
-- ------------------------------------------------------------
create or replace function public.admin_approve_user(target_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  update public.profiles set approval_status = 'approved', approved_at = now(), approved_by = auth.uid(),
    rejected_at = null, rejection_reason = null where id = target_user_id;
  update public.notifications set is_read = true
    where type = 'account_application' and entity_id = target_user_id and is_read = false;
  perform public.log_admin_action('approve_user', 'profile', target_user_id, '{}'::jsonb);
end; $$;

create or replace function public.admin_reject_user(target_user_id uuid, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Yetki yok (admin gerekli)'; end if;
  if target_user_id = auth.uid() then raise exception 'Kendi hesabınızı reddedemezsiniz'; end if;
  update public.profiles set approval_status = 'rejected', rejected_at = now(), rejection_reason = reason,
    approved_at = null, approved_by = null where id = target_user_id;
  update public.notifications set is_read = true
    where type = 'account_application' and entity_id = target_user_id and is_read = false;
  perform public.log_admin_action('reject_user', 'profile', target_user_id, jsonb_build_object('reason', reason));
end; $$;

-- ------------------------------------------------------------
-- Backfill: mevcut pending başvurular için eksik admin bildirimleri.
-- ------------------------------------------------------------
insert into public.notifications (recipient_id, actor_id, type, title, body, entity_id)
select a.id, p.id, 'account_application', 'Yeni hesap başvurusu',
       coalesce(nullif(p.display_name, ''), p.username, 'Bir kullanıcı') || ' onay bekliyor', p.id
from public.profiles p
cross join public.profiles a
where p.approval_status = 'pending'
  and a.role = 'admin' and a.banned_at is null and a.deactivated_at is null
on conflict (recipient_id, type, entity_id) do nothing;

-- ------------------------------------------------------------
-- Realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
alter table public.notifications replica identity full;
