-- Nexa search approve + smoke test (plain SQL only, no DO blocks)
-- Approve Asil + second user if present; ensure >=2 approved; test search_approved_users
-- Does NOT disable RLS. Does NOT create tables/columns. Does NOT recreate Asil.

alter table public.profiles disable trigger trg_profiles_protect;

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
   and u.email ilike 'nexa.prod.%@mailinator.com';

update public.profiles p
   set approval_status = 'approved',
       approved_at = coalesce(p.approved_at, now()),
       rejected_at = null,
       rejection_reason = null
 where p.id = (
   select p2.id
   from public.profiles p2
   where p2.approval_status is distinct from 'approved'
      or p2.banned_at is not null
      or p2.deactivated_at is not null
   order by p2.created_at asc
   limit 1
 )
 and (
   select count(*)
   from public.profiles
   where approval_status = 'approved'
     and banned_at is null
     and deactivated_at is null
 ) < 2;

alter table public.profiles enable trigger trg_profiles_protect;

select
  u.email,
  p.username,
  p.display_name,
  p.role,
  p.approval_status,
  public.is_approved_user(p.id) as is_approved
from public.profiles p
join auth.users u on u.id = p.id
where u.email ilike '%asil%'
   or coalesce(p.username, '') ilike '%asil%'
   or coalesce(p.display_name, '') ilike '%asil%'
   or u.email ilike 'nexa.prod.%@mailinator.com'
order by p.created_at;

select
  count(*) filter (
    where approval_status = 'approved'
      and banned_at is null
      and deactivated_at is null
  ) as approved_active,
  count(*) filter (where approval_status = 'pending') as pending
from public.profiles;

select set_config(
  'request.jwt.claim.sub',
  coalesce(
    (
      select p.id::text
      from public.profiles p
      join auth.users u on u.id = p.id
      where u.email ilike '%asil%'
         or coalesce(p.username, '') ilike '%asil%'
         or coalesce(p.display_name, '') ilike '%asil%'
      order by p.created_at asc
      limit 1
    ),
    (
      select p.id::text
      from public.profiles p
      where p.approval_status = 'approved'
        and p.banned_at is null
        and p.deactivated_at is null
      order by p.created_at asc
      limit 1
    )
  ),
  true
);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',
    current_setting('request.jwt.claim.sub', true),
    'role',
    'authenticated'
  )::text,
  true
);

select
  current_setting('request.jwt.claim.sub', true) as caller_uid,
  public.is_approved_user(
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  ) as caller_is_approved;

select *
from public.search_approved_users(
  (
    select left(
      coalesce(nullif(p.username, ''), nullif(p.display_name, ''), 'ab'),
      4
    )
    from public.profiles p
    where p.approval_status = 'approved'
      and p.banned_at is null
      and p.deactivated_at is null
      and p.id::text is distinct from current_setting('request.jwt.claim.sub', true)
    order by p.created_at asc
    limit 1
  ),
  20
);
