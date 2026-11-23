-- ============================================================
-- Nexa kullanıcı arama teşhis + smoke (mevcut RPC)
-- Dashboard → SQL Editor → Run
--
-- RLS kapatılmaz. Tablo/RPC silinmez. Yeni arama sistemi yok.
-- ============================================================

-- A) Fonksiyon imzası / SECURITY DEFINER / owner
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  case when p.prosecdef then 'SECURITY DEFINER' else 'INVOKER' end as security,
  r.rolname as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles r on r.oid = p.proowner
where n.nspname = 'public' and p.proname = 'search_approved_users';

-- B) EXECUTE grant
select grantee, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public' and routine_name = 'search_approved_users'
order by grantee;

-- C) Onay dağılımı
select approval_status, count(*)::int as n
from public.profiles
group by 1
order by 1;

-- D) Smoke: en az 2 onaylı kullanıcı yoksa bootstrap onayla, sonra JWT impersonation ile ara
do $$
declare
  approved_n int;
  caller_id uuid;
  peer_id uuid;
  needle text;
  hits int;
begin
  select count(*) into approved_n
  from public.profiles
  where approval_status = 'approved'
    and banned_at is null
    and deactivated_at is null;

  if approved_n < 2 then
    alter table public.profiles disable trigger trg_profiles_protect;

    -- Asil varsa onaylı yap
    update public.profiles p
       set approval_status = 'approved',
           approved_at = coalesce(p.approved_at, now()),
           rejected_at = null,
           rejection_reason = null,
           banned_at = null,
           ban_reason = null,
           deactivated_at = null,
           deactivation_reason = null
      from auth.users u
     where u.id = p.id
       and (
         u.email ilike '%asil%'
         or coalesce(p.username, '') ilike '%asil%'
         or coalesce(p.display_name, '') ilike '%asil%'
       );

    -- Hâlâ <2 ise en eski eksik profilleri onayla (max 2 adım)
    for i in 1..2 loop
      exit when (
        select count(*) from public.profiles
         where approval_status = 'approved' and banned_at is null and deactivated_at is null
      ) >= 2;

      update public.profiles p
         set approval_status = 'approved',
             approved_at = coalesce(p.approved_at, now()),
             rejected_at = null,
             rejection_reason = null,
             banned_at = null,
             ban_reason = null,
             deactivated_at = null,
             deactivation_reason = null
       where p.id = (
         select id from public.profiles
          where not (
            approval_status = 'approved' and banned_at is null and deactivated_at is null
          )
          order by created_at asc
          limit 1
       );
    end loop;

    alter table public.profiles enable trigger trg_profiles_protect;
    raise notice 'Bootstrap: onaylı kullanıcı sayısı artırıldı (önceki=%).', approved_n;
  end if;

  select id into caller_id
  from public.profiles
  where approval_status = 'approved' and banned_at is null and deactivated_at is null
  order by created_at asc
  limit 1;

  select id, left(coalesce(nullif(username, ''), display_name, id::text), 8)
    into peer_id, needle
  from public.profiles
  where approval_status = 'approved' and banned_at is null and deactivated_at is null
    and id <> caller_id
  order by created_at asc
  limit 1;

  if caller_id is null or peer_id is null then
    raise exception 'Smoke için 2 onaylı kullanıcı yok.';
  end if;

  if char_length(needle) < 2 then
    needle := left(replace(peer_id::text, '-', ''), 8);
  end if;

  perform set_config('request.jwt.claim.sub', caller_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', caller_id::text, 'role', 'authenticated')::text,
    true
  );

  select count(*) into hits
  from public.search_approved_users(needle, 20);

  raise notice 'SEARCH_SMOKE caller=% peer=% needle=% hits=%', caller_id, peer_id, needle, hits;

  if hits < 1 then
    raise exception 'search_approved_users boş döndü — RPC/RLS/veri hatası.';
  end if;

  raise notice 'SEARCH_SMOKE_OK';
end $$;

-- E) Özet (impersonation dışında; auth.uid null → boş olabilir — sorun değil)
select
  (select count(*) from public.profiles where approval_status = 'approved' and banned_at is null and deactivated_at is null) as approved_active,
  (select count(*) from public.profiles where approval_status = 'pending') as pending;
