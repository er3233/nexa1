-- ============================================================
-- 006_realtime.sql — Realtime yayını ve replica identity. Idempotent.
-- ============================================================

-- Yayına eklenecek tablolar (çift eklemeyi güvenle yok say).
do $$
declare
  t text;
  tables text[] := array['messages', 'message_reactions', 'typing_indicators', 'conversation_members'];
begin
  foreach t in array tables loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;  -- zaten yayında
      when undefined_object then null;  -- publication yok
    end;
  end loop;
end $$;

-- UPDATE/DELETE olaylarında eski kaydın gelmesi için replica identity full.
alter table public.messages            replica identity full;
alter table public.message_reactions   replica identity full;
alter table public.typing_indicators   replica identity full;
alter table public.conversation_members replica identity full;
