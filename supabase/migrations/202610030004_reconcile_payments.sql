-- Before: any change to items or shares reopened every confirmed or submitted payment in the check,
-- even for people whose total did not change. Now payments are checked once, when the transaction
-- commits, and only those that no longer cover the participant's total are reopened.

drop trigger if exists invalidate_payments_from_items on public.items;
drop trigger if exists invalidate_payments_from_shares on public.item_shares;
drop function if exists public.invalidate_check_payments();

create or replace function public.reconcile_check_payments()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; marker text;
begin
  if tg_table_name = 'items' then
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
revoke all on function public.reconcile_check_payments() from public, anon, authenticated;

-- Deferred, so the check runs on the final amounts rather than halfway through a re-split.
create constraint trigger reconcile_payments_from_items after insert or update or delete on public.items
  deferrable initially deferred for each row execute function public.reconcile_check_payments();
create constraint trigger reconcile_payments_from_shares after insert or update or delete on public.item_shares
  deferrable initially deferred for each row execute function public.reconcile_check_payments();
