-- Ek koruma: engellenen iki kullanıcı mevcut birebir sohbete yeni mesaj
-- gönderemesin. Mevcut mesajlar ve permissive politikalar korunur.
-- Önkoşul: schema.sql ve 019 uygulanmış; is_approved_user,
-- is_conversation_member ve is_blocked_pair fonksiyonları mevcut.
-- Yeni kurulum için henüz PostgreSQL üzerinde doğrulanmamıştır.
begin;

create or replace function public.can_send_unblocked_direct(p_conversation_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.is_approved_user(auth.uid())
    and public.is_conversation_member(p_conversation_id, auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = p_conversation_id
        and (
          coalesce(c.is_group, false) or c.type = 'group'
          or not exists (
            select 1 from public.conversation_members m
            where m.conversation_id = c.id and m.user_id <> auth.uid()
              and public.is_blocked_pair(auth.uid(), m.user_id)
          )
        )
    );
$$;

revoke all on function public.can_send_unblocked_direct(uuid) from public, anon;
grant execute on function public.can_send_unblocked_direct(uuid) to authenticated;

create policy messages_blocked_direct_insert on public.messages
  as restrictive for insert to authenticated
  with check (public.can_send_unblocked_direct(conversation_id));

commit;
