-- ============================================================
-- 004_security_admin.sql — Admin altyapısı, denetim kayıtları,
-- moderasyon RPC'leri. Idempotent.
--
-- GÜVENLİK: Admin durumu yalnızca veritabanından/service_role ile
-- atanır. Frontend'den admin_set_role çağrısı ancak çağıran zaten
-- admin ise çalışır (is_admin kontrolü). Bu yüzden kullanıcı kendini
-- admin yapamaz.
-- ============================================================

-- ------------------------------------------------------------
-- admin_audit_logs
-- ------------------------------------------------------------
create table if not exists public.admin_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references auth.users (id) on delete set null,
  action      text not null,
  target_type text,
  target_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);

alter table public.admin_audit_logs enable row level security;

-- Yalnızca adminler denetim kayıtlarını görür. INSERT politikası YOK →
-- kayıtlar yalnızca SECURITY DEFINER fonksiyonlar aracılığıyla yazılır.
drop policy if exists audit_select_admin on public.admin_audit_logs;
create policy audit_select_admin on public.admin_audit_logs
  for select to authenticated using (public.is_admin(auth.uid()));

-- İç yardımcı: denetim kaydı yaz
create or replace function public.log_admin_action(p_action text, p_target_type text, p_target_id uuid, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
end;
$$;

-- ------------------------------------------------------------
-- RPC: kullanıcı yasakla / yasağı kaldır
-- ------------------------------------------------------------
create or replace function public.admin_ban_user(target uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Yetki yok (admin gerekli)';
  end if;
  if target = auth.uid() then
    raise exception 'Kendinizi yasaklayamazsınız';
  end if;
  update public.profiles
     set banned_at = now(), ban_reason = reason
   where id = target;
  perform public.log_admin_action('ban_user', 'profile', target, jsonb_build_object('reason', reason));
end;
$$;

create or replace function public.admin_unban_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Yetki yok (admin gerekli)';
  end if;
  update public.profiles set banned_at = null, ban_reason = null where id = target;
  perform public.log_admin_action('unban_user', 'profile', target, '{}'::jsonb);
end;
$$;

-- ------------------------------------------------------------
-- RPC: rol ata
-- ------------------------------------------------------------
create or replace function public.admin_set_role(target uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Yetki yok (admin gerekli)';
  end if;
  if new_role not in ('user', 'moderator', 'admin') then
    raise exception 'Geçersiz rol';
  end if;
  update public.profiles set role = new_role where id = target;
  perform public.log_admin_action('set_role', 'profile', target, jsonb_build_object('role', new_role));
end;
$$;

-- ------------------------------------------------------------
-- RPC: mesajı moderasyonla sil (soft delete)
-- ------------------------------------------------------------
create or replace function public.admin_soft_delete_message(msg uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_moderator(auth.uid()) then
    raise exception 'Yetki yok (moderatör gerekli)';
  end if;
  update public.messages set deleted_at = now(), updated_at = now() where id = msg;
  perform public.log_admin_action('soft_delete_message', 'message', msg, '{}'::jsonb);
end;
$$;

-- ------------------------------------------------------------
-- RPC: şikâyet incele/güncelle
-- ------------------------------------------------------------
create or replace function public.admin_review_report(report_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_moderator(auth.uid()) then
    raise exception 'Yetki yok (moderatör gerekli)';
  end if;
  if new_status not in ('open', 'reviewing', 'resolved', 'dismissed') then
    raise exception 'Geçersiz durum';
  end if;
  update public.reports
     set status = new_status,
         resolved_by = case when new_status in ('resolved', 'dismissed') then auth.uid() else null end,
         resolved_at = case when new_status in ('resolved', 'dismissed') then now() else null end
   where id = report_id;
  perform public.log_admin_action('review_report', 'report', report_id, jsonb_build_object('status', new_status));
end;
$$;

-- ------------------------------------------------------------
-- RPC: admin listeleri
-- ------------------------------------------------------------
create or replace function public.admin_list_users(search text default null, lim integer default 50, off integer default 0)
returns setof public.profiles
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_moderator(auth.uid()) then
    raise exception 'Yetki yok (moderatör gerekli)';
  end if;
  return query
    select * from public.profiles p
    where search is null
       or p.username ilike '%' || search || '%'
       or p.display_name ilike '%' || search || '%'
    order by p.created_at desc
    limit greatest(1, least(lim, 200)) offset greatest(0, off);
end;
$$;

create or replace function public.admin_list_reports(status_filter text default null, lim integer default 50, off integer default 0)
returns setof public.reports
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_moderator(auth.uid()) then
    raise exception 'Yetki yok (moderatör gerekli)';
  end if;
  return query
    select * from public.reports r
    where status_filter is null or r.status = status_filter
    order by r.created_at desc
    limit greatest(1, least(lim, 200)) offset greatest(0, off);
end;
$$;

grant execute on function public.admin_ban_user(uuid, text)            to authenticated;
grant execute on function public.admin_unban_user(uuid)                to authenticated;
grant execute on function public.admin_set_role(uuid, text)            to authenticated;
grant execute on function public.admin_soft_delete_message(uuid)       to authenticated;
grant execute on function public.admin_review_report(uuid, text)       to authenticated;
grant execute on function public.admin_list_users(text, integer, integer)   to authenticated;
grant execute on function public.admin_list_reports(text, integer, integer) to authenticated;
-- log_admin_action bilerek grant EDİLMEZ (yalnızca diğer definer fonksiyonlar çağırır).
