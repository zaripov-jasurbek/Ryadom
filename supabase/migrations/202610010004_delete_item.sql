create or replace function public.delete_item(p_check_id uuid, p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  delete from public.items where id=p_item_id and check_id=p_check_id;
  if not found then raise exception 'Item not found'; end if;
end $$;

revoke all on function public.delete_item(uuid, uuid) from public, anon;
grant execute on function public.delete_item(uuid, uuid) to authenticated;
