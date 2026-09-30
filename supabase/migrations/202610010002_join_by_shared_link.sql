-- Guests join through the check's shared link and enter their own name.
-- Duplicate names are allowed so the link never requires an owner-created invite.
drop index if exists public.participants_name_per_check;
drop function if exists public.add_participant(uuid, text);

create or replace function public.join_check(p_public_id text, p_name text, p_session_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person public.participants;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  if length(trim(p_name)) not between 1 and 48 or length(p_session_token) < 24 then raise exception 'Invalid participant session'; end if;
  select * into c from public.checks where public_id=p_public_id and status='active';
  if not found then raise exception 'Check not found'; end if;
  select * into person from public.participants where check_id=c.id and user_id=auth.uid();
  if not found then
    select * into person from public.participants where check_id=c.id and user_id is null and session_token_hash=extensions.digest(convert_to(p_session_token,'UTF8'),'sha256') for update;
    if found then
      update public.participants set user_id=auth.uid() where id=person.id returning * into person;
    else
      insert into public.participants(check_id,user_id,name,session_token_hash,sort_order)
      values(c.id,auth.uid(),trim(p_name),extensions.digest(convert_to(p_session_token,'UTF8'),'sha256'),coalesce((select max(sort_order)+1 from public.participants where check_id=c.id),1)) returning * into person;
      insert into public.payments(check_id,participant_id) values(c.id,person.id);
    end if;
  end if;
  return jsonb_build_object('id',c.id,'public_id',c.public_id,'participant_id',person.id);
end $$;
