-- Every client asks a new guest for a name since 2.5.0, so random letters for an empty name are gone:
-- join_check now always wants a name of at least two characters that nobody else at the table has.
-- p_unique_name stays only because the published 2.5.0 site still sends it; it changes nothing now
-- and can be dropped once that version is no longer served.
-- A browser coming back with its saved token is matched before any of this, so its name is not checked again.
-- Names are trimmed after their spaces are folded: trimming first left a leading tab or line break as a space,
-- and " ali" passed as a different name from "Ali".

create or replace function public.name_key(p_name text)
returns text language sql immutable set search_path = '' as $$
  select lower(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')))
$$;
revoke all on function public.name_key(text) from public, anon, authenticated;

create or replace function public.join_check(p_public_id text, p_name text, p_session_token text, p_unique_name boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person_id uuid; v_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  if length(v_name) > 48 or length(p_session_token) < 24 then raise exception 'Invalid participant session'; end if;
  perform public.touch_account();
  -- The row lock makes joins one at a time, so the name and the guest limit cannot be passed by two at once.
  select * into c from public.checks where public_id = p_public_id and status = 'active' and created_at >= now() - public.check_lifetime() for update;
  if not found then raise exception 'Check not found'; end if;
  person_id := public.current_participant(c.id);
  if person_id is null then
    -- The same browser comes back with its saved token after losing its session.
    select id into person_id from public.participants
    where check_id = c.id and session_token_hash = extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256');
    if person_id is null then
      if (select count(*) from public.participants where check_id = c.id) >= 50 then raise exception 'Participant limit reached'; end if;
      if c.expected_guests is not null and (select count(*) from public.participants where check_id = c.id) >= c.expected_guests then
        raise exception 'Guest limit reached';
      end if;
      if length(v_name) < 2 then raise exception 'Invalid participant name'; end if;
      if exists(select 1 from public.participants where check_id = c.id and public.name_key(name) = public.name_key(v_name)) then
        raise exception 'Name taken';
      end if;
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
revoke all on function public.join_check(text, text, text, boolean) from public, anon;
grant execute on function public.join_check(text, text, text, boolean) to authenticated;

drop function if exists public.unique_guest_name(uuid);

create or replace function public.rename_participant(p_check_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.current_participant(p_check_id); v_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if actor is null then raise exception 'Participant access required'; end if;
  if length(v_name) not between 2 and 48 then raise exception 'Invalid participant name'; end if;
  -- The same lock as join_check, so a guest joining and someone renaming cannot take one name together.
  perform 1 from public.checks where id = p_check_id for update;
  if exists(select 1 from public.participants where check_id = p_check_id and id <> actor and public.name_key(name) = public.name_key(v_name)) then
    raise exception 'Name taken';
  end if;
  update public.participants set name = v_name where id = actor;
end $$;
revoke all on function public.rename_participant(uuid, text) from public, anon;
grant execute on function public.rename_participant(uuid, text) to authenticated;
