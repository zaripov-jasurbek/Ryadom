-- Guests join under three random letters and may give their name later; the creator renames themselves the same way.
-- Only one's own name: nobody renames someone else.

create or replace function public.rename_participant(p_check_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.current_participant(p_check_id);
begin
  if actor is null then raise exception 'Participant access required'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 48 then raise exception 'Invalid participant name'; end if;
  update public.participants set name = trim(p_name) where id = actor;
end $$;
revoke all on function public.rename_participant(uuid, text) from public, anon;
grant execute on function public.rename_participant(uuid, text) to authenticated;
