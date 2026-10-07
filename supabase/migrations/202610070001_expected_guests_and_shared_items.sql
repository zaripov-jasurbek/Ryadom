-- Feedback from the table: people arrive at different times, so "split among everyone" must mean everyone who is coming.
-- 1. checks.expected_guests: how many people the creator expects, asked when the check is created.
-- 2. items.shared_all: "split among everyone" is now a lasting rule, not a one-off copy of who was there.
--    A guest who joins later is added to such items automatically; until everyone has come, each unit is split
--    into max(expected guests, people present) parts, so the people already here pay their final share and the
--    absent guests' parts wait for them. Marking or custom-splitting a unit by hand turns the rule off.
-- 3. participant_due_totals breaks service-fee ties on exact integer remainders, like splitInteger on the client.

alter table public.checks add column expected_guests smallint check (expected_guests between 1 and 50);
alter table public.items add column shared_all boolean not null default false;

-- Internal: equal amounts for everyone holding a share of the unit; the first participants absorb the remainder.
-- On a shared_all item the unit is cut for the guests still expected too; their parts stay unassigned until they join.
create or replace function public.split_unit_equally(p_item_unit uuid, p_unit_price bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare consumers integer; slots integer;
begin
  select count(*) into consumers from public.item_shares where item_unit_id = p_item_unit;
  if consumers = 0 then return; end if;
  select case when i.shared_all then greatest(consumers, coalesce(c.expected_guests, 0)) else consumers end into slots
  from public.item_units u join public.items i on i.id = u.item_id join public.checks c on c.id = i.check_id
  where u.id = p_item_unit;
  slots := coalesce(slots, consumers);
  with ordered as (
    select s.participant_id, row_number() over (order by p.sort_order, p.id) as rn
    from public.item_shares s join public.participants p on p.id = s.participant_id where s.item_unit_id = p_item_unit
  )
  update public.item_shares s set amount = p_unit_price / slots + case when ordered.rn <= p_unit_price % slots then 1 else 0 end,
    mode = 'equal', updated_at = now()
  from ordered where s.item_unit_id = p_item_unit and s.participant_id = ordered.participant_id;
end $$;
revoke all on function public.split_unit_equally(uuid, bigint) from public, anon, authenticated;

-- Internal: every unit of the item goes to everyone currently in the check.
create or replace function public.share_item_with_everyone(p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare item_row public.items; unit_id uuid;
begin
  select * into item_row from public.items where id = p_item_id;
  if not found then return; end if;
  for unit_id in select id from public.item_units where item_id = p_item_id order by unit_index loop
    delete from public.item_shares where item_unit_id = unit_id;
    insert into public.item_shares(item_unit_id, participant_id, amount, mode)
    select unit_id, p.id, 0, 'equal' from public.participants p where p.check_id = item_row.check_id;
    perform public.split_unit_equally(unit_id, item_row.unit_price);
  end loop;
end $$;
revoke all on function public.share_item_with_everyone(uuid) from public, anon, authenticated;

-- Internal: re-splits every shared_all item of a check, after someone joins or the expected number changes.
create or replace function public.reshare_shared_items(p_check_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare item_id uuid;
begin
  for item_id in select id from public.items where check_id = p_check_id and shared_all order by created_at, id loop
    perform public.share_item_with_everyone(item_id);
  end loop;
end $$;
revoke all on function public.reshare_shared_items(uuid) from public, anon, authenticated;

create or replace function public.include_new_participant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.reshare_shared_items(new.check_id);
  return null;
end $$;
revoke all on function public.include_new_participant() from public, anon, authenticated;
create trigger include_new_participant after insert on public.participants for each row execute function public.include_new_participant();

-- Internal: a hand-made change ends "split among everyone"; the other servings are re-split among the people on them,
-- otherwise the parts kept for guests still on the way would stay unassigned for good.
-- Only the transaction that turns the rule off re-splits: a concurrent one waits on the item row and finds it already off.
create or replace function public.end_shared_all(p_item_id uuid, p_except_unit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare price bigint; unit_id uuid;
begin
  update public.items set shared_all = false where id = p_item_id and shared_all returning unit_price into price;
  if not found then return; end if;
  for unit_id in select id from public.item_units where item_id = p_item_id and id <> p_except_unit order by unit_index loop
    perform public.split_unit_equally(unit_id, price);
  end loop;
end $$;
revoke all on function public.end_shared_all(uuid, uuid) from public, anon, authenticated;

-- "Split among everyone" now also covers people who join later.
create or replace function public.share_item_equally(p_check_id uuid, p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  -- Check row first, then units: the same order as join_check and update_item.
  perform 1 from public.checks where id = p_check_id for update;
  perform 1 from public.item_units u join public.items i on i.id = u.item_id where u.item_id = p_item_id and i.check_id = p_check_id order by u.unit_index for update of u;
  update public.items set shared_all = true where id = p_item_id and check_id = p_check_id;
  if not found then raise exception 'Item not found'; end if;
  perform public.share_item_with_everyone(p_item_id);
end $$;
revoke all on function public.share_item_equally(uuid, uuid) from public, anon;
grant execute on function public.share_item_equally(uuid, uuid) to authenticated;

-- A hand-made mark on a unit ends "split among everyone" for that item.
create or replace function public.toggle_unit_share(p_item_unit uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare parent_item public.items; parent_id uuid; actor uuid;
begin
  select item_id into parent_id from public.item_units where id = p_item_unit for update;
  if not found then raise exception 'Item unit unavailable'; end if;
  select * into parent_item from public.items where id = parent_id;
  actor := public.current_participant(parent_item.check_id);
  if actor is null then raise exception 'Join the check first'; end if;
  if exists(select 1 from public.item_shares where item_unit_id = p_item_unit and mode = 'custom') then raise exception 'This unit has a custom split'; end if;
  perform public.end_shared_all(parent_id, p_item_unit);
  if p_enabled then
    insert into public.item_shares(item_unit_id, participant_id, amount, mode) values (p_item_unit, actor, 0, 'equal') on conflict (item_unit_id, participant_id) do nothing;
  else
    delete from public.item_shares where item_unit_id = p_item_unit and participant_id = actor;
  end if;
  perform public.split_unit_equally(p_item_unit, parent_item.unit_price);
end $$;

create or replace function public.set_unit_custom_shares(p_item_unit uuid, p_allocations jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item_row public.items; parent_id uuid; total bigint;
begin
  select item_id into parent_id from public.item_units where id = p_item_unit for update;
  if found then select * into item_row from public.items where id = parent_id; end if;
  if item_row.id is null or not public.is_check_owner(item_row.check_id) then raise exception 'Owner access required'; end if;
  if jsonb_typeof(p_allocations) <> 'object' then raise exception 'Invalid allocations'; end if;
  if exists(
    select 1 from jsonb_each_text(p_allocations) e
    where e.value !~ '^[0-9]+$'
      or not exists(select 1 from public.participants p where p.id::text = e.key and p.check_id = item_row.check_id)
  ) then raise exception 'Invalid participant allocation'; end if;
  select coalesce(sum(e.value::bigint), 0) into total from jsonb_each_text(p_allocations) e;
  if total <> item_row.unit_price then raise exception 'Shares must equal the item unit price'; end if;
  perform public.end_shared_all(parent_id, p_item_unit);
  delete from public.item_shares where item_unit_id = p_item_unit;
  insert into public.item_shares(item_unit_id, participant_id, amount, mode)
  select p_item_unit, e.key::uuid, e.value::bigint, 'custom' from jsonb_each_text(p_allocations) e where e.value::bigint > 0;
end $$;

-- New servings of a shared_all item are shared by everyone too.
create or replace function public.update_item(p_check_id uuid, p_item_id uuid, p_name text, p_quantity integer, p_unit_price bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare old_item public.items; unit_id uuid;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if p_quantity not between 1 and 999 or p_unit_price not between 1 and 100000000 or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid item'; end if;
  perform 1 from public.checks where id = p_check_id for update;
  -- Units first, in the same order as toggle_unit_share, so a concurrent tap waits for the new price.
  perform 1 from public.item_units where item_id = p_item_id order by unit_index for update;
  select * into old_item from public.items where id = p_item_id and check_id = p_check_id for update;
  if not found then raise exception 'Item not found'; end if;
  if p_quantity > old_item.quantity
    and (select coalesce(sum(quantity), 0) from public.items where check_id = p_check_id) - old_item.quantity + p_quantity > 1000 then
    raise exception 'Portion limit reached';
  end if;
  update public.items set name = trim(p_name), quantity = p_quantity, unit_price = p_unit_price where id = p_item_id;
  if p_quantity > old_item.quantity then
    insert into public.item_units(item_id, unit_index) select p_item_id, n from generate_series(old_item.quantity + 1, p_quantity) n;
  elsif p_quantity < old_item.quantity then
    delete from public.item_units where item_id = p_item_id and unit_index > p_quantity;
  end if;
  if old_item.shared_all then
    perform public.share_item_with_everyone(p_item_id);
  elsif p_unit_price <> old_item.unit_price then
    for unit_id in select id from public.item_units where item_id = p_item_id order by unit_index loop
      perform public.resplit_unit_equally(unit_id);
    end loop;
  end if;
end $$;

drop function public.create_check(text, numeric, text, text, text);
create function public.create_check(p_title text, p_service_percent numeric, p_owner_name text, p_owner_token text, p_payment_details text default null, p_expected_guests integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person public.participants;
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
  perform public.touch_account();
  perform public.purge_expired();
  insert into public.checks(title, service_percent, owner_token_hash, payment_details, expected_guests)
  values (trim(p_title), p_service_percent, extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256'), nullif(trim(p_payment_details), ''), p_expected_guests) returning * into c;
  insert into public.participants(check_id, name, session_token_hash, sort_order)
  values (c.id, trim(p_owner_name), extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256'), 0) returning * into person;
  insert into public.participant_devices(participant_id, check_id, user_id) values (person.id, c.id, auth.uid());
  update public.checks set owner_participant_id = person.id where id = c.id;
  insert into public.payments(check_id, participant_id) values (c.id, person.id);
  return jsonb_build_object('id', c.id, 'public_id', c.public_id, 'participant_id', person.id);
end $$;
revoke all on function public.create_check(text, numeric, text, text, text, integer) from public, anon;
grant execute on function public.create_check(text, numeric, text, text, text, integer) to authenticated;

-- p_expected_guests: null keeps the number, 0 clears it.
drop function public.update_check(uuid, text, numeric, text);
create function public.update_check(p_check_id uuid, p_title text, p_service_percent numeric, p_payment_details text default null, p_expected_guests integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare old_expected smallint;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 80 or p_service_percent is null or p_service_percent not between 0 and 100
    or length(trim(p_payment_details)) > 100 or p_expected_guests not between 0 and 50 then
    raise exception 'Invalid check details';
  end if;
  select expected_guests into old_expected from public.checks where id = p_check_id for update;
  update public.checks set title = trim(p_title), service_percent = p_service_percent, payment_details = nullif(trim(p_payment_details), ''),
    expected_guests = case when p_expected_guests is null then expected_guests else nullif(p_expected_guests, 0) end, updated_at = now()
  where id = p_check_id;
  if p_expected_guests is not null and nullif(p_expected_guests, 0) is distinct from old_expected then
    perform public.reshare_shared_items(p_check_id);
  end if;
end $$;
revoke all on function public.update_check(uuid, text, numeric, text, integer) from public, anon;
grant execute on function public.update_check(uuid, text, numeric, text, integer) to authenticated;

create or replace function public.get_check(p_public_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.checks; me uuid;
begin
  select * into c from public.checks where public_id = p_public_id and created_at >= now() - public.check_lifetime();
  if found then me := public.current_participant(c.id); end if;
  -- Same answer for a missing or expired check and one the caller is not a member of.
  if me is null then raise exception 'Check not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', c.id,
    'public_id', c.public_id,
    'title', c.title,
    'service_percent', c.service_percent,
    'payment_details', c.payment_details,
    'expected_guests', c.expected_guests,
    'created_at', c.created_at,
    'me', me,
    'owner_id', c.owner_participant_id,
    'is_owner', coalesce(me = c.owner_participant_id, false),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'paid', coalesce(pay.amount_paid, 0), 'status', coalesce(pay.status, 'unpaid')) order by p.sort_order, p.id)
      from public.participants p left join public.payments pay on pay.participant_id = p.id
      where p.check_id = c.id
    ), '[]'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity, 'unit_price', i.unit_price, 'shared_all', i.shared_all, 'units', (
        select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'shares', (
          select coalesce(jsonb_agg(jsonb_build_object('participant_id', s.participant_id, 'amount', s.amount, 'mode', s.mode) order by p.sort_order, p.id), '[]')
          from public.item_shares s join public.participants p on p.id = s.participant_id where s.item_unit_id = u.id
        )) order by u.unit_index), '[]')
        from public.item_units u where u.item_id = i.id
      )) order by i.created_at, i.id)
      from public.items i where i.check_id = c.id
    ), '[]'),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'item_id', m.item_id, 'participant_id', m.participant_id, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
      from public.comments m where m.check_id = c.id
    ), '[]')
  );
end $$;

-- Exact remainders: numeric division rounds, so two different fractions could compare equal (or the reverse)
-- and the leftover sum went to another person than on the client.
create or replace function public.participant_due_totals(target_check uuid)
returns table(participant_id uuid, due bigint)
language sql stable security definer set search_path = '' as $$
  with subtotals as (
    select p.id as participant_id, p.sort_order, c.service_percent,
      coalesce(sum(s.amount), 0)::bigint as subtotal
    from public.participants p
    cross join public.checks c
    left join public.item_shares s on s.participant_id = p.id
    left join public.item_units u on u.id = s.item_unit_id
    left join public.items i on i.id = u.item_id and i.check_id = p.check_id
    where p.check_id = target_check and c.id = target_check
    group by p.id, p.sort_order, c.service_percent
  ), amounts as (
    select s.*,
      round(sum(s.subtotal) over () * s.service_percent / 100)::numeric as service_total,
      sum(s.subtotal) over ()::numeric as total_subtotal
    from subtotals s
  ), portions as (
    select a.*,
      case when total_subtotal = 0 then 0 else div(service_total * subtotal, total_subtotal) end as service_base,
      case when total_subtotal = 0 then 0 else mod(service_total * subtotal, total_subtotal) end as fraction
    from amounts a
  ), ranked as (
    select p.*, service_total - sum(service_base) over () as remainder,
      row_number() over (order by fraction desc, sort_order, participant_id) as rank
    from portions p
  )
  select participant_id, (subtotal + service_base + case when rank <= remainder then 1 else 0 end)::bigint
  from ranked;
$$;
