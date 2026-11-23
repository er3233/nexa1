-- Mesaj düzenleme yetkisi, mesajı başka bir sohbete veya kullanıcıya
-- taşımak için kullanılamaz. Normal içerik düzenleme ve soft delete korunur.
begin;
create function public.protect_message_identity()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.sender_id is distinct from old.sender_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Mesaj kimliği ve sohbeti değiştirilemez';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_message_identity() from public, anon, authenticated;
create trigger messages_identity_immutable before update on public.messages
  for each row execute function public.protect_message_identity();
commit;
