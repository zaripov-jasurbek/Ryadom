-- Items keep the order they were added in. add_items inserts a whole receipt in one transaction, where now() is
-- the same for every row, so ordering by created_at left the rows in random id order.

alter table public.items add column if not exists position bigint generated always as identity;

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
      )) order by i.created_at, i.position)
      from public.items i where i.check_id = c.id
    ), '[]'),
    'comments', '[]'::jsonb
  );
end $$;
