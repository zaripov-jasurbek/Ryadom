-- 1. The limit of 20 new checks a day was per anonymous account, and a new anonymous account is one request away.
--    Checks now also count per client IP: at most public.daily_checks_per_ip() a day. Mobile networks put many people
--    behind one address, so the number is generous; it stops a script, not a busy restaurant. Only a hash of the address
--    is kept, and it goes away with the check. The address is CF-Connecting-IP, not the spoofable first X-Forwarded-For.
-- 2. purge_expired ran inside create_check, so whoever made a check waited for other people's old ones to be deleted.
--    It now runs on a schedule (pg_cron) in bigger batches, and create_check no longer calls it.
-- create_check keeps its signature, so the published site works before and after this migration.

-- 1. Limit per IP
alter table public.checks add column if not exists creator_ip_hash bytea;
create index if not exists checks_creator_ip_idx on public.checks(creator_ip_hash, created_at) where creator_ip_hash is not null;

create or replace function public.daily_checks_per_ip() returns integer language sql immutable as $$ select 100 $$;

-- The client address. The first entry of X-Forwarded-For is whatever the client sent in that header, so it cannot
-- be trusted: Cloudflare in front of Supabase puts the real address in CF-Connecting-IP and appends it to
-- X-Forwarded-For. So CF-Connecting-IP first, otherwise the last X-Forwarded-For entry, which the proxy wrote.
-- Null outside an API request (SQL editor, scheduled jobs, tests), and then only the per-account limit applies.
create or replace function public.client_ip_hash()
returns bytea language plpgsql stable set search_path = '' as $$
declare headers json; forwarded text[]; ip text;
begin
  headers := nullif(current_setting('request.headers', true), '')::json;
  forwarded := string_to_array(headers->>'x-forwarded-for', ',');
  ip := coalesce(nullif(trim(headers->>'cf-connecting-ip'), ''), nullif(trim(forwarded[cardinality(forwarded)]), ''));
  if ip is null then return null; end if;
  return extensions.digest(convert_to('ryadom:' || ip, 'UTF8'), 'sha256');
exception when others then
  -- Malformed headers must not block creating a check.
  return null;
end $$;
revoke all on function public.client_ip_hash() from public, anon, authenticated;

create or replace function public.create_check(p_title text, p_service_percent numeric, p_owner_name text, p_owner_token text, p_payment_details text default null, p_expected_guests integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person public.participants; ip_hash bytea := public.client_ip_hash();
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  if length(p_owner_token) < 32 then raise exception 'Invalid owner token'; end if;
  if length(trim(p_title)) not between 1 and 80 or length(trim(p_owner_name)) not between 1 and 48 then raise exception 'Invalid title or participant name'; end if;
  if length(trim(p_payment_details)) > 100 or p_expected_guests not between 1 and 50 then raise exception 'Invalid check details'; end if;
  -- One account creates checks one at a time, so parallel requests cannot pass the limit together.
  perform pg_advisory_xact_lock(hashtext('create_check:' || auth.uid()::text));
  if (select count(*) from public.checks owned join public.participant_devices d on d.participant_id = owned.owner_participant_id
      where d.user_id = auth.uid() and owned.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Check limit reached';
  end if;
  -- The same per address, so fresh anonymous accounts from one place do not get around it.
  if ip_hash is not null then
    perform pg_advisory_xact_lock(hashtext('create_check_ip:' || encode(ip_hash, 'hex')));
    if (select count(*) from public.checks where creator_ip_hash = ip_hash and created_at > now() - interval '1 day') >= public.daily_checks_per_ip() then
      raise exception 'Check limit reached';
    end if;
  end if;
  perform public.touch_account();
  insert into public.checks(title, service_percent, owner_token_hash, payment_details, expected_guests, creator_ip_hash)
  values (trim(p_title), p_service_percent, extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256'), nullif(trim(p_payment_details), ''), p_expected_guests, ip_hash) returning * into c;
  insert into public.participants(check_id, name, session_token_hash, sort_order)
  values (c.id, trim(p_owner_name), extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256'), 0) returning * into person;
  insert into public.participant_devices(participant_id, check_id, user_id) values (person.id, c.id, auth.uid());
  update public.checks set owner_participant_id = person.id where id = c.id;
  insert into public.payments(check_id, participant_id) values (c.id, person.id);
  return jsonb_build_object('id', c.id, 'public_id', c.public_id, 'participant_id', person.id);
end $$;
revoke all on function public.create_check(text, numeric, text, text, text, integer) from public, anon;
grant execute on function public.create_check(text, numeric, text, text, text, integer) to authenticated;

-- 2. Cleanup on a schedule. Nobody waits for it now, so a run takes more at once.
create or replace function public.purge_expired()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.checks where id in (
    select id from public.checks where created_at < now() - public.check_lifetime() order by created_at limit 500
  );
  begin
    delete from auth.users where id in (
      select u.id from auth.users u left join public.account_activity a on a.user_id = u.id
      where u.is_anonymous and u.id is distinct from auth.uid() and coalesce(a.seen_at, u.created_at) < now() - public.account_lifetime()
      order by coalesce(a.seen_at, u.created_at) limit 500
    );
  exception when insufficient_privilege then
    raise warning 'Unused anonymous accounts were not deleted: %', sqlerrm;
  end;
end $$;
revoke all on function public.purge_expired() from public, anon, authenticated;

-- Supabase ships pg_cron; the SQL tests stub its schema instead.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
end $$;
-- Scheduling by name replaces the job if it exists, so the migration can run again.
select cron.schedule('ryadom-purge-expired', '*/10 * * * *', 'select public.purge_expired()');
