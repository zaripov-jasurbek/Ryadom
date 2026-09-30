-- The check creator can delete the check at any time, not only after every payment is confirmed.
create or replace function public.delete_check(p_check_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  delete from public.checks where id=p_check_id;
  if not found then raise exception 'Check not found'; end if;
end $$;

-- Internal: turn a unit back into an equal split among everyone who still holds a non-zero share.
create or replace function public.resplit_unit_equally(p_item_unit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare unit_price bigint; consumers integer; base_amount bigint; remainder bigint;
begin
  select i.unit_price into unit_price from public.items i join public.item_units u on u.item_id=i.id where u.id=p_item_unit;
  if not found then return; end if;
  delete from public.item_shares where item_unit_id=p_item_unit and mode='custom' and amount=0;
  select count(*) into consumers from public.item_shares where item_unit_id=p_item_unit;
  if consumers=0 then return; end if;
  base_amount := unit_price / consumers; remainder := unit_price % consumers;
  with ordered as (select s.participant_id, row_number() over(order by p.sort_order,p.id) as rn from public.item_shares s join public.participants p on p.id=s.participant_id where s.item_unit_id=p_item_unit)
  update public.item_shares s set amount=base_amount+case when ordered.rn<=remainder then 1 else 0 end, mode='equal', updated_at=now()
  from ordered where s.item_unit_id=p_item_unit and s.participant_id=ordered.participant_id;
end $$;

-- The check creator removes a guest. Their shares, payment and comments cascade;
-- a custom split no longer adds up without them, so each unit they shared is re-split equally.
create or replace function public.remove_participant(p_check_id uuid, p_participant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.participants; affected uuid[]; unit_id uuid;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  select * into target from public.participants where id=p_participant_id and check_id=p_check_id for update;
  if not found then raise exception 'Participant not found'; end if;
  if target.user_id = (select auth.uid()) then raise exception 'The check creator cannot be removed'; end if;

  select array_agg(item_unit_id) into affected from public.item_shares where participant_id=p_participant_id;
  delete from public.participants where id=p_participant_id;
  foreach unit_id in array coalesce(affected, '{}') loop perform public.resplit_unit_equally(unit_id); end loop;
end $$;

-- The check creator undoes a custom split: the unit goes back to an equal split that guests can re-mark.
create or replace function public.reset_unit_custom_shares(p_item_unit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare item_row public.items;
begin
  select i.* into item_row from public.items i join public.item_units u on u.item_id=i.id where u.id=p_item_unit;
  if not found or not public.is_check_owner(item_row.check_id) then raise exception 'Owner access required'; end if;
  perform public.resplit_unit_equally(p_item_unit);
end $$;

-- A participant deletes only their own comment.
create or replace function public.delete_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.comments c using public.participants p
  where c.id=p_comment_id and p.id=c.participant_id and p.check_id=c.check_id and p.user_id=(select auth.uid());
  if not found then raise exception 'Only the author can delete this comment'; end if;
end $$;

revoke all on function public.resplit_unit_equally(uuid) from public, anon, authenticated;
revoke all on function public.remove_participant(uuid, uuid) from public, anon;
revoke all on function public.reset_unit_custom_shares(uuid) from public, anon;
revoke all on function public.delete_comment(uuid) from public, anon;
grant execute on function public.remove_participant(uuid, uuid) to authenticated;
grant execute on function public.reset_unit_custom_shares(uuid) to authenticated;
grant execute on function public.delete_comment(uuid) to authenticated;
