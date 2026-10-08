-- Payments are checkmarks now, no amounts to type: a guest marks ✓ "I paid" (or takes it off), the creator puts ✓✓.
-- The creator can confirm without the guest's ✓ (cash handed over, nobody pressed anything) and take ✓✓ off at any time;
-- once ✓✓ is on, only the creator can change it. There are no partial payments anymore.
-- amount_paid stays as an internal record of the share at the moment of the mark, so a later bigger share takes the mark off.

drop function public.submit_payment(uuid, bigint);

create function public.mark_paid(p_check_id uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.current_participant(p_check_id); due bigint; cur public.payment_status;
begin
  if actor is null then raise exception 'Participant access required'; end if;
  if p_paid is null then raise exception 'Invalid payment data'; end if;
  select status into cur from public.payments where check_id = p_check_id and participant_id = actor;
  if cur = 'paid' then raise exception 'Payment is already confirmed'; end if;
  select d.due into due from public.participant_due_totals(p_check_id) d where d.participant_id = actor;
  update public.payments set
    amount_paid = case when p_paid then coalesce(due, 0) else 0 end,
    status = case when p_paid then 'proof_submitted' else 'unpaid' end::public.payment_status,
    submitted_at = case when p_paid then now() end,
    updated_at = now()
  where check_id = p_check_id and participant_id = actor;
end $$;
revoke all on function public.mark_paid(uuid, boolean) from public, anon;
grant execute on function public.mark_paid(uuid, boolean) to authenticated;

-- The creator confirms whatever the state: after the guest's ✓ or without it.
create or replace function public.confirm_payment(p_check_id uuid, p_participant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare due bigint;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  select d.due into due from public.participant_due_totals(p_check_id) d where d.participant_id = p_participant_id;
  update public.payments set status = 'paid', amount_paid = greatest(amount_paid, coalesce(due, 0)),
    confirmed_by = public.current_participant(p_check_id), confirmed_at = now(), updated_at = now()
  where check_id = p_check_id and participant_id = p_participant_id and status <> 'paid';
  if not found then raise exception 'Nothing to confirm'; end if;
end $$;

-- Taking ✓✓ off goes back to the guest's ✓ if they had put it, otherwise to nothing.
create or replace function public.unconfirm_payment(p_check_id uuid, p_participant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  update public.payments set
    status = case when submitted_at is null then 'unpaid' else 'proof_submitted' end::public.payment_status,
    amount_paid = case when submitted_at is null then 0 else amount_paid end,
    confirmed_by = null, confirmed_at = null, updated_at = now()
  where check_id = p_check_id and participant_id = p_participant_id and status = 'paid';
  if not found then raise exception 'Payment is not confirmed'; end if;
end $$;

create or replace function public.guard_payment_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.current_participant(new.check_id); due bigint;
begin
  if tg_op = 'INSERT' then
    if new.participant_id is distinct from actor or new.status = 'paid' or new.confirmed_at is not null or new.confirmed_by is not null then
      raise exception 'Only the participant can submit an unconfirmed payment';
    end if;
    return new;
  end if;
  if new.check_id is distinct from old.check_id or new.participant_id is distinct from old.participant_id then raise exception 'Payment identity cannot change'; end if;
  -- A changed bill only takes marks off.
  if pg_trigger_depth() > 1 then
    if new.status = 'paid' or (new.amount_paid is distinct from old.amount_paid and new.amount_paid <> 0) then raise exception 'Invalid internal payment reset'; end if;
    return new;
  end if;
  -- The guest puts or takes off their own ✓ until the creator confirms it.
  if new.participant_id = actor and old.status <> 'paid' and new.status in ('unpaid', 'proof_submitted')
    and new.confirmed_by is null and new.confirmed_at is null then
    return new;
  end if;
  if public.is_check_owner(new.check_id) then
    if new.submitted_at is distinct from old.submitted_at then raise exception 'Owner may only confirm or undo a payment'; end if;
    select d.due into due from public.participant_due_totals(new.check_id) d where d.participant_id = new.participant_id;
    if old.status <> 'paid' and new.status = 'paid' and new.confirmed_at is not null and new.confirmed_by is not distinct from actor
      and new.amount_paid = greatest(old.amount_paid, coalesce(due, 0)) then
      return new;
    end if;
    if old.status = 'paid' and new.confirmed_at is null and new.confirmed_by is null
      and ((old.submitted_at is not null and new.status = 'proof_submitted' and new.amount_paid = old.amount_paid)
        or (old.submitted_at is null and new.status = 'unpaid' and new.amount_paid = 0)) then
      return new;
    end if;
    raise exception 'Owner may only confirm or undo a payment';
  end if;
  raise exception 'Participants may only submit their own payment';
end $$;

-- When someone's share grows past what it was at the mark, the mark comes off: no partial state to land in.
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
    status = 'unpaid', amount_paid = 0,
    submitted_at = null, confirmed_by = null, confirmed_at = null, updated_at = now()
  from public.participant_due_totals(target) d
  where p.check_id = target and d.participant_id = p.participant_id
    and p.status in ('paid', 'proof_submitted') and p.amount_paid < d.due;
  return null;
end $$;
