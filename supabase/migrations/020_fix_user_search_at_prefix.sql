-- ============================================================
-- 020_fix_user_search_at_prefix.sql
--
-- Kullanıcı aramada "@ali" gibi sorgular username "ali" ile eşleşmiyordu.
-- Baştaki @ temizlenir; parametre adı search_text korunur (DROP yok).
-- CASCADE / DROP POLICY / DROP TABLE / TRUNCATE YOK.
-- ============================================================

create or replace function public.search_approved_users(search_text text, result_limit int default 20)
returns table (id uuid, username text, display_name text, avatar_url text, status text)
language plpgsql security definer stable set search_path = public as $$
declare
  me  uuid := auth.uid();
  q   text := trim(both from coalesce(search_text, ''));
  lim int  := least(greatest(coalesce(result_limit, 20), 1), 20);
begin
  if left(q, 1) = '@' then
    q := trim(both from substring(q from 2));
  end if;
  if me is null or not public.is_approved_user(me) then return; end if;
  if char_length(q) < 2 then return; end if;
  return query
    select p.id, p.username, p.display_name, p.avatar_url, p.status
    from public.profiles p
    where p.id <> me
      and p.approval_status = 'approved'
      and p.banned_at is null
      and p.deactivated_at is null
      and not public.is_blocked_pair(me, p.id)
      and (
        p.username ilike '%' || q || '%'
        or p.display_name ilike '%' || q || '%'
      )
    order by
      (lower(p.username) = lower(q)) desc,
      (p.username ilike q || '%') desc,
      p.username asc
    limit lim;
end; $$;

grant execute on function public.search_approved_users(text, int) to authenticated;
