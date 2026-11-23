-- ============================================================
-- Asil → admin (mevcut Nexa admin sistemi)
--
-- Kullanır:
--   public.admin_set_role(target uuid, new_role text)   -- 004_security_admin.sql
--   public.admin_approve_user(target_user_id uuid)      -- 007 onay sistemi
--   public.is_admin(uid uuid)                           -- doğrulama
--
-- Yeni kolon / yeni admin sistemi YOK.
--
-- NOT (ilk admin):
--   admin_set_role çağıranın zaten admin olmasını ister (auth.uid()).
--   Projede hiç admin yoksa, protect trigger kısa süre kapatılıp
--   yalnızca bootstrap için role='admin' yazılır; ardından JWT claim
--   Asil’e set edilip resmi admin_set_role + admin_approve_user çağrılır.
-- ============================================================

do $$
declare
  asil_id    uuid;
  asil_email text;
  asil_name  text;
  admins     int;
begin
  select u.id, u.email::text,
         coalesce(p.username, u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1))
    into asil_id, asil_email, asil_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.email ilike '%asil%'
     or coalesce(p.username, '') ilike '%asil%'
     or coalesce(p.display_name, '') ilike '%asil%'
     or coalesce(u.raw_user_meta_data ->> 'username', '') ilike '%asil%'
     or coalesce(u.raw_user_meta_data ->> 'display_name', '') ilike '%asil%'
  order by u.created_at asc
  limit 1;

  if asil_id is null then
    raise exception 'Asil kullanıcısı auth.users / profiles içinde bulunamadı (email/username/display_name).';
  end if;

  if not exists (select 1 from public.profiles where id = asil_id) then
    raise exception 'Asil için profiles satırı yok (id=%). Önce giriş/kayıt ile profil oluşmalı.', asil_id;
  end if;

  raise notice 'Asil bulundu: id=% email=% name=%', asil_id, asil_email, asil_name;

  select public.active_admin_count() into admins;

  if admins = 0 then
    -- İlk admin bootstrap (README ile aynı gerekçe): protect trigger role yazımını geri alır.
    alter table public.profiles disable trigger trg_profiles_protect;
    update public.profiles
       set role = 'admin'
     where id = asil_id;
    alter table public.profiles enable trigger trg_profiles_protect;
    raise notice 'İlk admin bootstrap: role=admin yazıldı (admin_set_role önkoşulu).';
  end if;

  -- SQL Editor oturumunda auth.uid() için claim (Asil olarak çağır)
  perform set_config('request.jwt.claim.sub', asil_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', asil_id::text, 'role', 'authenticated')::text,
    true
  );

  if not public.is_admin(asil_id) then
    raise exception 'Bootstrap sonrası is_admin(%) hâlâ false — role yazılamadı.', asil_id;
  end if;

  -- Resmi RPC’ler (004 + 007)
  perform public.admin_set_role(asil_id, 'admin');
  perform public.admin_approve_user(asil_id);

  raise notice 'admin_set_role(admin) + admin_approve_user tamam.';
end $$;

-- Doğrulama
select
  u.email,
  p.username,
  p.role,
  p.approval_status,
  public.is_admin(p.id) as is_admin_rpc
from public.profiles p
join auth.users u on u.id = p.id
where u.email ilike '%asil%'
   or coalesce(p.username, '') ilike '%asil%'
   or coalesce(p.display_name, '') ilike '%asil%'
limit 5;
