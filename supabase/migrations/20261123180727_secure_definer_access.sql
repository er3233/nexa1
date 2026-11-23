-- Yalnızca denetimde belirlenen üç dahili yardımcı fonksiyonun doğrudan
-- API çağrısını kapatır. Veri silmez; SECURITY DEFINER üst fonksiyonları
-- aynı sahip tarafından çağırdığında yardımcıları kullanmaya devam eder.
-- Uygulamadan önce sahiplikleri ve diğer bağımlılıkları doğrulayın.
begin;
revoke execute on function public.log_admin_action(text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.find_direct_conversation(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cleanup_expired_live_drafts() from public, anon, authenticated;
commit;
