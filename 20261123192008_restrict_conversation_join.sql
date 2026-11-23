-- Onaylı bir kullanıcı, kimliğini bildiği herhangi bir sohbete kendisini
-- ekleyemez. Yeni sohbeti oluşturan kullanıcı ilk üyelik satırını ekleyebilir;
-- sonraki üyelik değişiklikleri mevcut üyelik politikasına da tabidir.
begin;
create policy members_restrict_insert_access on public.conversation_members
  as restrictive for insert to authenticated
  with check (
    public.is_conversation_member(conversation_id, (select auth.uid()))
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.created_by = (select auth.uid())
      )
    )
  );
commit;
