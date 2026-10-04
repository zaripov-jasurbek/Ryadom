-- What the invitation page shows before someone joins: the check's name, who is at the table and the total,
-- so a guest knows the link is the right one. The link alone already lets anyone join and see the whole check,
-- so this reveals nothing new. A missing or expired check returns null.
create or replace function public.check_preview(p_public_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title', c.title,
    'service_percent', c.service_percent,
    'participants', coalesce((select jsonb_agg(p.name order by p.sort_order, p.id) from public.participants p where p.check_id = c.id), '[]'),
    'items', (select count(*) from public.items i where i.check_id = c.id),
    'food_total', (select coalesce(sum(i.quantity * i.unit_price), 0) from public.items i where i.check_id = c.id)
  )
  from public.checks c
  where c.public_id = p_public_id and c.status = 'active' and c.created_at >= now() - public.check_lifetime();
$$;
revoke all on function public.check_preview(text) from public, anon;
grant execute on function public.check_preview(text) to authenticated;
