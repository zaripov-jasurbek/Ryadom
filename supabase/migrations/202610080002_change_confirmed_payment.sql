-- A guest may change the amount they sent after the creator confirmed it; the confirmation then comes off
-- (✓✓ back to ✓) and the creator confirms the new amount again. Before, the guard refused the change.

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
  -- The participant sets their own amount; that keeps the confirmation as it was or clears it, never grants it.
  if new.participant_id = actor and new.status <> 'paid'
    and ((new.confirmed_by is not distinct from old.confirmed_by and new.confirmed_at is not distinct from old.confirmed_at)
      or (new.confirmed_by is null and new.confirmed_at is null)) then
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
