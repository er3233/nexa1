-- Yalnızca bu yeni proje kurulumu içindir. SECURITY DEFINER uygulama
-- fonksiyonlarında PostgreSQL'in varsayılan PUBLIC çalıştırma yetkisini kaldırır.
-- Uzantıların sahip olduğu fonksiyonlar kapsam dışıdır.
begin;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.signature);
  end loop;
end $$;
-- RLS üyelik politikaları tarafından doğrudan çağrılan yardımcı.
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;
commit;
