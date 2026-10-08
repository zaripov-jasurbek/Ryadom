-- A guest who joins without a name gets three random letters picked by the server, so they never repeat
-- within a check, and the first letter (the avatar) differs from everyone else's while letters are left.

create or replace function public.unique_guest_name(p_check_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  letters constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  free text;
  candidate text;
  tries integer := 0;
begin
  select string_agg(l, '') into free
  from regexp_split_to_table(letters, '') l
  where not exists (select 1 from public.participants p where p.check_id = p_check_id and upper(left(p.name, 1)) = l);
  free := coalesce(nullif(free, ''), letters);
  loop
    candidate := substr(free, 1 + floor(random() * length(free))::integer, 1)
      || chr(65 + floor(random() * 26)::integer) || chr(65 + floor(random() * 26)::integer);
    exit when tries >= 100 or not exists (select 1 from public.participants p where p.check_id = p_check_id and upper(p.name) = candidate);
    tries := tries + 1;
  end loop;
  return candidate;
end $$;
revoke all on function public.unique_guest_name(uuid) from public, anon, authenticated;

create or replace function public.join_check(p_public_id text, p_name text, p_session_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person_id uuid; v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  -- An empty name asks the server for unique random letters.
  if length(v_name) > 48 or length(p_session_token) < 24 then raise exception 'Invalid participant session'; end if;
  perform public.touch_account();
  select * into c from public.checks where public_id = p_public_id and status = 'active' and created_at >= now() - public.check_lifetime() for update;
  if not found then raise exception 'Check not found'; end if;
  person_id := public.current_participant(c.id);
  if person_id is null then
    -- The same browser comes back with its saved token after losing its session.
    select id into person_id from public.participants
    where check_id = c.id and session_token_hash = extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256');
    if person_id is null then
      if (select count(*) from public.participants where check_id = c.id) >= 50 then raise exception 'Participant limit reached'; end if;
      if v_name = '' then v_name := public.unique_guest_name(c.id); end if;
      insert into public.participants(check_id, name, session_token_hash, sort_order)
      values (c.id, v_name, extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256'),
        coalesce((select max(sort_order) + 1 from public.participants where check_id = c.id), 1))
      returning id into person_id;
      insert into public.participant_devices(participant_id, check_id, user_id) values (person_id, c.id, auth.uid());
      insert into public.payments(check_id, participant_id) values (c.id, person_id);
    else
      insert into public.participant_devices(participant_id, check_id, user_id) values (person_id, c.id, auth.uid());
    end if;
  end if;
  return jsonb_build_object('id', c.id, 'public_id', c.public_id, 'participant_id', person_id);
end $$;
