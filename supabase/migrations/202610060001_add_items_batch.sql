-- Adds the rows of a scanned receipt in one request and one transaction: all of them or, on any error, none.
-- Each row goes through add_item, so ownership, validation and the per-check limits stay in one place.
create or replace function public.add_items(p_check_id uuid, p_items jsonb)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare entry jsonb; ids uuid[] := '{}';
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Invalid item'; end if;
  for entry in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(entry->'name') is distinct from 'string' or jsonb_typeof(entry->'quantity') is distinct from 'number' or jsonb_typeof(entry->'unit_price') is distinct from 'number' then
      raise exception 'Invalid item';
    end if;
    ids := ids || public.add_item(p_check_id, entry->>'name', (entry->>'quantity')::integer, (entry->>'unit_price')::bigint);
  end loop;
  return ids;
end $$;

revoke all on function public.add_items(uuid, jsonb) from public, anon;
grant execute on function public.add_items(uuid, jsonb) to authenticated;
