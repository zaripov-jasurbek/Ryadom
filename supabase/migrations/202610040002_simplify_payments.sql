-- The creator pays the whole bill; everyone else reports how much they have given the creator, in cash or by transfer.
-- No transfer receipt link anymore: the full amount goes to the creator for confirmation, less is a partial payment.
-- The creator no longer records payments on someone's behalf: they confirm what the participant reported, or undo that.

drop function public.submit_payment(uuid, bigint, text);
create function public.submit_payment(p_check_id uuid, p_amount bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.current_participant(p_check_id); due bigint;
begin
  if actor is null then raise exception 'Participant access required'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Invalid payment data'; end if;
  select d.due into due from public.participant_due_totals(p_check_id) d where d.participant_id = actor;
  update public.payments set amount_paid = p_amount,
    status = case
      when p_amount > 0 and p_amount >= coalesce(due, 0) then 'proof_submitted'::public.payment_status
      when p_amount > 0 then 'partially_paid'::public.payment_status
      else 'unpaid'::public.payment_status end,
    submitted_at = now(), updated_at = now(), confirmed_by = null, confirmed_at = null
  where check_id = p_check_id and participant_id = actor;
end $$;
revoke all on function public.submit_payment(uuid, bigint) from public, anon;
grant execute on function public.submit_payment(uuid, bigint) to authenticated;

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
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'paid', coalesce(pay.amount_paid, 0), 'status', coalesce(pay.status, 'unpaid')) order by p.sort_order, p.id)
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

-- Only the participant says how much they paid; the creator confirms it or takes the confirmation back.
drop function public.mark_payment(uuid, uuid, boolean);
create function public.unconfirm_payment(p_check_id uuid, p_participant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  update public.payments set status = 'proof_submitted', confirmed_by = null, confirmed_at = null, updated_at = now()
  where check_id = p_check_id and participant_id = p_participant_id and status = 'paid';
  if not found then raise exception 'Payment is not confirmed'; end if;
end $$;
revoke all on function public.unconfirm_payment(uuid, uuid) from public, anon;
grant execute on function public.unconfirm_payment(uuid, uuid) to authenticated;

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
    -- The amount always comes from the participant; the creator only confirms it or takes that back.
    if new.amount_paid is distinct from old.amount_paid or new.submitted_at is distinct from old.submitted_at then
      raise exception 'Owner may only confirm or undo a full payment';
    end if;
    if old.status = 'proof_submitted' and new.status = 'paid' and new.confirmed_at is not null and new.confirmed_by is not distinct from actor
      and new.amount_paid >= coalesce((select due from public.participant_due_totals(new.check_id) where participant_id = new.participant_id), 0) then
      return new;
    end if;
    if old.status = 'paid' and new.status = 'proof_submitted' and new.confirmed_at is null and new.confirmed_by is null then
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
    submitted_at = null, confirmed_by = null, confirmed_at = null, updated_at = now()
  from public.participant_due_totals(target) d
  where p.check_id = target and d.participant_id = p.participant_id
    and p.status in ('paid', 'proof_submitted') and p.amount_paid < d.due;
  return null;
end $$;

alter table public.payments drop column proof_url;
