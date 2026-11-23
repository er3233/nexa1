-- ============================================================
-- Nexa Chat — YENİ/BOŞ Supabase projesi uygulama sırası
--
-- Bu dosya YALNIZCA sıra ve doğrulama rehberidir.
-- Mevcut migrations/ ve schema.sql SİLİNMEZ / DEĞİŞTİRİLMEZ.
--
-- UYGULA (SQL Editor'de, sırayla):
--   1) supabase/schema.sql
--   2) supabase/migrations/019_disappearing_messages.sql
--   3) supabase/migrations/021_push_subscriptions.sql (Web Push için)
--
-- NOTLAR:
-- - migrations/001..020 tek başına BOŞ projede ÇALIŞMAZ:
--   temel tablolar (profiles, conversations, …) yalnızca schema.sql'dedir.
-- - schema.sql = 001..018 birleşik + 020 (@ arama) içerir.
-- - 019 (kaybolan mesajlar) schema.sql'de YOKTUR → ayrıca gerekir.
-- - 021 (push abonelikleri) schema.sql'de YOKTUR → Web Push için ayrıca gerekir.
-- - Mevcut veritabanında schema.sql veya bu sırayı körü körüne çalıştırmayın;
--   önce uygulanmış şema ve migration'ları karşılaştırıp yedek alın.
-- - 001..018'i schema.sql SONRASI tekrar çalıştırmayın (gereksiz).
-- - Hardcoded project URL / service_role / eski UUID YOKTUR.
-- ============================================================

-- Uygulama sonrası doğrulama (SQL Editor):
select tablename from pg_tables where schemaname = 'public' order by 1;

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1;

select id, name, public from storage.buckets order by 1;

select tablename from pg_publication_tables
where pubname = 'supabase_realtime' order by 1;
-- Sesli arama için zorunlu: call_sessions, call_signals
-- Yoksa migrations/009_calls.sql sonundaki publication satırlarını yeniden çalıştırın.

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'messages' and column_name = 'expires_at';

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'conversations'
  and column_name = 'disappearing_seconds';
