-- A request id was remembered per account and call only, not per check. The client never reuses an id for another
-- check, but if it did, add_item or add_items on check B would answer with the item ids made on check A.
-- add_item and add_items now remember the id together with the check ('add_item:<check id>'), so the same id on
-- another check is refused as 'Invalid request id' instead of answered from the wrong check.
-- Ids remembered before this migration carry the bare call name; a repeat of one of them still gets its first result,
-- so a request whose answer was lost while this migration ran is not refused. Those rows go away within a day.
-- Signatures do not change, so the published site works before and after this migration.

create or replace function public.request_replay(p_request_id uuid, p_fn text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare stored public.request_results;
begin
  if p_request_id is null then return null; end if;
  insert into public.request_results(user_id, request_id, fn) values (auth.uid(), p_request_id, p_fn) on conflict do nothing;
  if found then return null; end if;
  select * into stored from public.request_results where user_id = auth.uid() and request_id = p_request_id;
  -- split_part: a row from before scoping ('add_item') matches its scoped call ('add_item:<check id>').
  if (stored.fn is distinct from p_fn and stored.fn is distinct from split_part(p_fn, ':', 1)) or stored.result is null then
    raise exception 'Invalid request id';
  end if;
  return stored.result;
end $$;
revoke all on function public.request_replay(uuid, text) from public, anon, authenticated;

create or replace function public.add_item(p_check_id uuid, p_name text, p_quantity integer, p_unit_price bigint, p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item_uuid uuid; replay jsonb;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  replay := public.request_replay(p_request_id, 'add_item:' || p_check_id::text);
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

create or replace function public.add_items(p_check_id uuid, p_items jsonb, p_request_id uuid default null)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare entry jsonb; ids uuid[] := '{}'; replay jsonb;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  replay := public.request_replay(p_request_id, 'add_items:' || p_check_id::text);
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
