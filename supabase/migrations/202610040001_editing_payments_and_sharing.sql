-- 1. The creator can edit an item (name, quantity, price) and the check itself (title, service %).
--    A new price re-splits every unit equally among the people who had it; a smaller quantity drops the last units.
-- 2. A payment proof link is optional: paying the full amount is enough to ask the creator for confirmation.
-- 3. Payments are reconciled when the service percent changes, the same way as for item changes.
-- 4. Toggling and custom splits read the unit price after locking the unit, so they never use a price
--    that update_item changed while they were waiting for the lock.
-- 5. The creator can leave a card or phone number for transfers; members see it in get_check.
-- 6. The creator can split an item equally among everyone at the table in one step.
-- 7. The creator can mark anyone as paid (cash, a transfer seen in the bank app) and undo it.

alter table public.checks add column payment_details text
  check (payment_details is null or length(payment_details) between 1 and 100);

drop function public.create_check(text, numeric, text, text);
create function public.create_check(p_title text, p_service_percent numeric, p_owner_name text, p_owner_token text, p_payment_details text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person public.participants;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  if length(p_owner_token) < 32 then raise exception 'Invalid owner token'; end if;
  if length(trim(p_title)) not between 1 and 80 or length(trim(p_owner_name)) not between 1 and 48 then raise exception 'Invalid title or participant name'; end if;
  if length(trim(p_payment_details)) > 100 then raise exception 'Invalid check details'; end if;
  insert into public.checks(title, service_percent, owner_uid, owner_token_hash, payment_details)
  values (trim(p_title), p_service_percent, auth.uid(), extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256'), nullif(trim(p_payment_details), '')) returning * into c;
  insert into public.participants(check_id, name, session_token_hash, sort_order)
  values (c.id, trim(p_owner_name), extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256'), 0) returning * into person;
  insert into public.participant_devices(participant_id, check_id, user_id) values (person.id, c.id, auth.uid());
  update public.checks set owner_participant_id = person.id where id = c.id;
  insert into public.payments(check_id, participant_id) values (c.id, person.id);
  return jsonb_build_object('id', c.id, 'public_id', c.public_id, 'participant_id', person.id);
end $$;
revoke all on function public.create_check(text, numeric, text, text, text) from public, anon;
grant execute on function public.create_check(text, numeric, text, text, text) to authenticated;

create or replace function public.get_check(p_public_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.checks; me uuid;
begin
  select * into c from public.checks where public_id = p_public_id;
  if found then me := public.current_participant(c.id); end if;
  -- Same answer for a missing check and one the caller is not a member of.
  if me is null then raise exception 'Check not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', c.id,
    'public_id', c.public_id,
    'title', c.title,
    'service_percent', c.service_percent,
    'payment_details', c.payment_details,
    'created_at', c.created_at,
    'me', me,
    'owner_id', c.owner_participant_id,
    'is_owner', coalesce(me = c.owner_participant_id, false),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'paid', coalesce(pay.amount_paid, 0), 'proof_url', pay.proof_url, 'status', coalesce(pay.status, 'unpaid')) order by p.sort_order, p.id)
      from public.participants p left join public.payments pay on pay.participant_id = p.id
      where p.check_id = c.id
    ), '[]'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity, 'unit_price', i.unit_price, 'units', (
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

create or replace function public.update_item(p_check_id uuid, p_item_id uuid, p_name text, p_quantity integer, p_unit_price bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare old_item public.items; unit_id uuid;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if p_quantity not between 1 and 999 or p_unit_price <= 0 or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid item'; end if;
  -- Units first, in the same order as toggle_unit_share, so a concurrent tap waits for the new price.
  perform 1 from public.item_units where item_id = p_item_id order by unit_index for update;
  select * into old_item from public.items where id = p_item_id and check_id = p_check_id for update;
  if not found then raise exception 'Item not found'; end if;
  update public.items set name = trim(p_name), quantity = p_quantity, unit_price = p_unit_price where id = p_item_id;
  if p_quantity > old_item.quantity then
    insert into public.item_units(item_id, unit_index) select p_item_id, n from generate_series(old_item.quantity + 1, p_quantity) n;
  elsif p_quantity < old_item.quantity then
    delete from public.item_units where item_id = p_item_id and unit_index > p_quantity;
  end if;
  if p_unit_price <> old_item.unit_price then
    for unit_id in select id from public.item_units where item_id = p_item_id order by unit_index loop
      perform public.resplit_unit_equally(unit_id);
    end loop;
  end if;
end $$;
revoke all on function public.update_item(uuid, uuid, text, integer, bigint) from public, anon;
grant execute on function public.update_item(uuid, uuid, text, integer, bigint) to authenticated;

-- Payment details are always sent; an empty value removes them.
create or replace function public.update_check(p_check_id uuid, p_title text, p_service_percent numeric, p_payment_details text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 80 or p_service_percent is null or p_service_percent not between 0 and 100
    or length(trim(p_payment_details)) > 100 then
    raise exception 'Invalid check details';
  end if;
  update public.checks set title = trim(p_title), service_percent = p_service_percent, payment_details = nullif(trim(p_payment_details), ''), updated_at = now()
  where id = p_check_id;
end $$;
revoke all on function public.update_check(uuid, text, numeric, text) from public, anon;
grant execute on function public.update_check(uuid, text, numeric, text) to authenticated;

-- Bread, tea, a hookah: every unit of the item goes to everyone currently in the check, equally.
-- Replaces earlier marks and custom splits on that item; people who join later are not added.
create or replace function public.share_item_equally(p_check_id uuid, p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare unit_id uuid; price bigint;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  perform 1 from public.item_units u join public.items i on i.id = u.item_id where u.item_id = p_item_id and i.check_id = p_check_id order by u.unit_index for update of u;
  select unit_price into price from public.items where id = p_item_id and check_id = p_check_id;
  if not found then raise exception 'Item not found'; end if;
  for unit_id in select id from public.item_units where item_id = p_item_id order by unit_index loop
    delete from public.item_shares where item_unit_id = unit_id;
    insert into public.item_shares(item_unit_id, participant_id, amount, mode)
    select unit_id, p.id, 0, 'equal' from public.participants p where p.check_id = p_check_id;
    perform public.split_unit_equally(unit_id, price);
  end loop;
end $$;
revoke all on function public.share_item_equally(uuid, uuid) from public, anon;
grant execute on function public.share_item_equally(uuid, uuid) to authenticated;

-- The creator records that someone paid their whole total, or takes that back.
create or replace function public.mark_payment(p_check_id uuid, p_participant_id uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare due bigint;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if p_paid then
    select d.due into due from public.participant_due_totals(p_check_id) d where d.participant_id = p_participant_id;
    if due is null then raise exception 'Participant not found'; end if;
    if due = 0 then raise exception 'Nothing to pay yet'; end if;
    update public.payments set amount_paid = due, status = 'paid', confirmed_by = public.current_participant(p_check_id), confirmed_at = now(), updated_at = now()
    where check_id = p_check_id and participant_id = p_participant_id;
  else
    update public.payments set amount_paid = 0, status = 'unpaid', proof_url = null, submitted_at = null, confirmed_by = null, confirmed_at = null, updated_at = now()
    where check_id = p_check_id and participant_id = p_participant_id and status = 'paid';
  end if;
end $$;
revoke all on function public.mark_payment(uuid, uuid, boolean) from public, anon;
grant execute on function public.mark_payment(uuid, uuid, boolean) to authenticated;

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
  delete from public.item_shares where item_unit_id = p_item_unit;
  insert into public.item_shares(item_unit_id, participant_id, amount, mode)
  select p_item_unit, e.key::uuid, e.value::bigint, 'custom' from jsonb_each_text(p_allocations) e where e.value::bigint > 0;
end $$;

-- Paying the whole total (or attaching a link) sends the payment to the creator for confirmation.
create or replace function public.submit_payment(p_check_id uuid, p_amount bigint, p_proof_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.current_participant(p_check_id); due bigint;
begin
  if actor is null then raise exception 'Participant access required'; end if;
  if p_amount < 0 or (p_proof_url is not null and (length(p_proof_url) > 2048 or p_proof_url !~* '^https?://')) then raise exception 'Invalid payment data'; end if;
  select d.due into due from public.participant_due_totals(p_check_id) d where d.participant_id = actor;
  update public.payments set amount_paid = p_amount, proof_url = p_proof_url,
    status = case
      when p_proof_url is not null or (p_amount > 0 and p_amount >= coalesce(due, 0)) then 'proof_submitted'::public.payment_status
      when p_amount > 0 then 'partially_paid'::public.payment_status
      else 'unpaid'::public.payment_status end,
    submitted_at = now(), updated_at = now(), confirmed_by = null, confirmed_at = null
  where check_id = p_check_id and participant_id = actor;
end $$;

create or replace function public.guard_payment_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.current_participant(new.check_id);
begin
  if tg_op = 'INSERT' then
    if new.participant_id is distinct from actor or new.status = 'paid' or new.confirmed_at is not null or new.confirmed_by is not null then
      raise exception 'Only the participant can submit an unconfirmed payment';
    end if;
    return new;
  end if;
  if new.check_id is distinct from old.check_id or new.participant_id is distinct from old.participant_id then raise exception 'Payment identity cannot change'; end if;
  if pg_trigger_depth() > 1 then
    if new.amount_paid is distinct from old.amount_paid or new.status = 'paid' then raise exception 'Invalid internal payment reset'; end if;
    return new;
  end if;
  if new.participant_id = actor and new.status <> 'paid' and new.confirmed_by is not distinct from old.confirmed_by and new.confirmed_at is not distinct from old.confirmed_at then
    return new;
  end if;
  if public.is_check_owner(new.check_id) then
    -- Confirm: the whole total, either as the participant submitted it or recorded by the creator.
    if new.status = 'paid' and new.confirmed_at is not null and new.confirmed_by is not distinct from actor
      and new.proof_url is not distinct from old.proof_url and new.submitted_at is not distinct from old.submitted_at
      and new.amount_paid >= coalesce((select due from public.participant_due_totals(new.check_id) where participant_id = new.participant_id), 0)
      and (new.amount_paid = old.amount_paid or new.amount_paid = (select due from public.participant_due_totals(new.check_id) where participant_id = new.participant_id)) then
      return new;
    end if;
    -- Undo a confirmation: the payment starts over.
    if old.status = 'paid' and new.status = 'unpaid' and new.amount_paid = 0 and new.proof_url is null and new.submitted_at is null
      and new.confirmed_at is null and new.confirmed_by is null then
      return new;
    end if;
    raise exception 'Owner may only confirm or undo a full payment';
  end if;
  raise exception 'Participants may only submit their own payment';
end $$;

create or replace function public.reconcile_check_payments()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; marker text;
begin
  if tg_table_name = 'checks' then
    target := new.id;
  elsif tg_table_name = 'items' then
    target := coalesce(new.check_id, old.check_id);
  else
    -- Shares deleted together with their item are covered by the item's own trigger.
    select i.check_id into target from public.item_units u join public.items i on i.id = u.item_id where u.id = coalesce(new.item_unit_id, old.item_unit_id);
  end if;
  if target is null then return null; end if;
  marker := 'bill_split.reconciled_' || replace(target::text, '-', '');
  if current_setting(marker, true) = '1' then return null; end if;
  perform set_config(marker, '1', true);
  update public.payments p set
    status = case when p.amount_paid > 0 then 'partially_paid'::public.payment_status else 'unpaid'::public.payment_status end,
    proof_url = null, submitted_at = null, confirmed_by = null, confirmed_at = null, updated_at = now()
  from public.participant_due_totals(target) d
  where p.check_id = target and d.participant_id = p.participant_id
    and p.status in ('paid', 'proof_submitted') and p.amount_paid < d.due;
  return null;
end $$;

create constraint trigger reconcile_payments_from_checks after update of service_percent on public.checks
  deferrable initially deferred for each row execute function public.reconcile_check_payments();
