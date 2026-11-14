-- Whether the signed-in Account is linked: it has signed in with Apple,
-- Google or email. Anonymous Accounts are not linked. For policies and functions of
-- features that require a linked account, such as connecting an assistant
-- or receiving Nudges.
create function public.user_is_linked()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false;
$$;

revoke execute on function public.user_is_linked from public, anon;
grant execute on function public.user_is_linked to authenticated;

-- Deletes the signed-in Account. Every table holding a user's data (Cards,
-- Reviews, and later settings) references auth.users with on delete cascade,
-- so this removes all of it. New user tables must do the same.
create function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleting uuid := auth.uid();
begin
  if deleting is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = deleting;
end;
$$;

revoke execute on function public.delete_account from public, anon;
grant execute on function public.delete_account to authenticated;
