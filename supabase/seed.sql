-- ============================================================
-- seed.sql — Nexa Chat
--
-- Bu dosya BİLİNÇLİ olarak sahte/demo veri İÇERMEZ.
-- Profiller gerçek kayıt (auth) sırasında trigger ile oluşur.
--
-- Aşağıdaki komutlar YORUM satırıdır. Yalnızca ihtiyaç halinde,
-- ilgili UUID'yi kendiniz yazarak elle çalıştırın.
-- ============================================================

-- İlk admini atamak için (UUID'yi Authentication > Users'tan alın):
--   update public.profiles set role = 'admin'
--    where id = '00000000-0000-0000-0000-000000000000';

-- Bir kullanıcıyı moderatör yapmak için:
--   update public.profiles set role = 'moderator'
--    where id = '00000000-0000-0000-0000-000000000000';

-- Eksik ayar kayıtlarını doldurmak (normalde trigger halleder):
--   insert into public.user_settings (user_id)
--   select p.id from public.profiles p
--   left join public.user_settings s on s.user_id = p.id
--   where s.user_id is null
--   on conflict (user_id) do nothing;
