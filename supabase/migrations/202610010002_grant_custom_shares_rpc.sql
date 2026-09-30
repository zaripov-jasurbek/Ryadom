-- The initial migration revokes public execution from this RPC but omitted
-- the authenticated grant. Owners need it to save custom item allocations.
grant execute on function public.set_unit_custom_shares(uuid, jsonb) to authenticated;
