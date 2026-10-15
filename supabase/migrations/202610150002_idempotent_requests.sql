-- A request whose answer is lost on the way (a weak mobile network) looks failed to the client, and the person taps
-- again. For calls that create something that made a second check, item or a whole second scanned receipt.
-- create_check, add_item and add_items now take p_request_id: the client sends the same id when it repeats the same
-- action, and the server answers a repeat with the result of the first call instead of doing it again.
-- Without p_request_id they work as before, so the published site keeps working.

create table if not exists public.request_results (
  user_id uuid not null,
  request_id uuid not null,
  fn text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.request_results enable row level security;
revoke all on public.request_results from public, anon, authenticated;
create index if not exists request_results_created_idx on public.request_results(created_at);

-- Null: a new request, go ahead (its row is taken now, so a parallel repeat waits for this transaction).
-- Otherwise the result the first call returned. A failed call rolls back with its row, so its repeat runs again.
create or replace function public.request_replay(p_request_id uuid, p_fn text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare stored public.request_results;
begin
  if p_request_id is null then return null; end if;
  insert into public.request_results(user_id, request_id, fn) values (auth.uid(), p_request_id, p_fn) on conflict do nothing;
  if found then return null; end if;
  select * into stored from public.request_results where user_id = auth.uid() and request_id = p_request_id;
  if stored.fn is distinct from p_fn or stored.result is null then raise exception 'Invalid request id'; end if;
  return stored.result;
end $$;
revoke all on function public.request_replay(uuid, text) from public, anon, authenticated;

create or replace function public.request_done(p_request_id uuid, p_result jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.request_results set result = p_result where user_id = auth.uid() and request_id = p_request_id;
$$;
revoke all on function public.request_done(uuid, jsonb) from public, anon, authenticated;

drop function if exists public.create_check(text, numeric, text, text, text, integer);
create or replace function public.create_check(p_title text, p_service_percent numeric, p_owner_name text, p_owner_token text, p_payment_details text default null, p_expected_guests integer default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person public.participants; ip_hash bytea := public.client_ip_hash(); replay jsonb; created jsonb;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  -- A repeat returns the check made the first time; it is not counted against the limits again.
  replay := public.request_replay(p_request_id, 'create_check');
  if replay is not null then return replay; end if;
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
  created := jsonb_build_object('id', c.id, 'public_id', c.public_id, 'participant_id', person.id);
  perform public.request_done(p_request_id, created);
  return created;
end $$;
revoke all on function public.create_check(text, numeric, text, text, text, integer, uuid) from public, anon;
grant execute on function public.create_check(text, numeric, text, text, text, integer, uuid) to authenticated;

drop function if exists public.add_item(uuid, text, integer, bigint);
create or replace function public.add_item(p_check_id uuid, p_name text, p_quantity integer, p_unit_price bigint, p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item_uuid uuid; replay jsonb;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  replay := public.request_replay(p_request_id, 'add_item');
  if replay is not null then return (replay #>> '{}')::uuid; end if;
  if p_quantity not between 1 and 999 or p_unit_price not between 1 and 100000000 or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid item'; end if;
  -- The check row serializes concurrent additions, so the limits hold.
  perform 1 from public.checks where id = p_check_id for update;
  if (select count(*) from public.items where check_id = p_check_id) >= 100 then raise exception 'Item limit reached'; end if;
  if (select coalesce(sum(quantity), 0) from public.items where check_id = p_check_id) + p_quantity > 1000 then raise exception 'Portion limit reached'; end if;
  insert into public.items(check_id, name, quantity, unit_price, created_by)
  values (p_check_id, trim(p_name), p_quantity, p_unit_price, public.current_participant(p_check_id)) returning id into item_uuid;
  insert into public.item_units(item_id, unit_index) select item_uuid, n from generate_series(1, p_quantity) n;
  perform public.request_done(p_request_id, to_jsonb(item_uuid));
  return item_uuid;
end $$;
revoke all on function public.add_item(uuid, text, integer, bigint, uuid) from public, anon;
grant execute on function public.add_item(uuid, text, integer, bigint, uuid) to authenticated;

-- All rows or none, as before; a repeat of the whole receipt returns the items the first call added.
drop function if exists public.add_items(uuid, jsonb);
create or replace function public.add_items(p_check_id uuid, p_items jsonb, p_request_id uuid default null)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare entry jsonb; ids uuid[] := '{}'; replay jsonb;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  replay := public.request_replay(p_request_id, 'add_items');
  if replay is not null then return array(select value::uuid from jsonb_array_elements_text(replay)); end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Invalid item'; end if;
  for entry in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(entry->'name') is distinct from 'string' or jsonb_typeof(entry->'quantity') is distinct from 'number' or jsonb_typeof(entry->'unit_price') is distinct from 'number' then
      raise exception 'Invalid item';
    end if;
    ids := ids || public.add_item(p_check_id, entry->>'name', (entry->>'quantity')::integer, (entry->>'unit_price')::bigint);
  end loop;
  perform public.request_done(p_request_id, to_jsonb(ids));
  return ids;
end $$;
revoke all on function public.add_items(uuid, jsonb, uuid) from public, anon;
grant execute on function public.add_items(uuid, jsonb, uuid) to authenticated;

-- A repeat comes within seconds or minutes; a day is plenty, and the scheduled cleanup removes older ids.
create or replace function public.purge_request_results()
returns void language sql security definer set search_path = '' as $$
  delete from public.request_results where created_at < now() - interval '1 day';
$$;
revoke all on function public.purge_request_results() from public, anon, authenticated;
select cron.schedule('ryadom-purge-request-results', '17 * * * *', 'select public.purge_request_results()');
