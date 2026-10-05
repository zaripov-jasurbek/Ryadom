-- 1. Limits against filling the database: 100 items and 1000 portions per check,
--    20 new checks per anonymous account a day. Existing checks above a limit keep working; they only stop growing.
-- 2. Clients read only through get_check and check_preview. Direct table reads through PostgREST let any member
--    select columns the app never shows, such as checks.owner_token_hash and participants.session_token_hash.
-- 3. Members may only track presence on the check's channel. Broadcasts come from the database (realtime.send);
--    before this, any member could post "changed" to the channel and make every open client reload the check.

-- 1. Limits
create index if not exists participant_devices_user_idx on public.participant_devices(user_id);

create or replace function public.create_check(p_title text, p_service_percent numeric, p_owner_name text, p_owner_token text, p_payment_details text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person public.participants;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  if length(p_owner_token) < 32 then raise exception 'Invalid owner token'; end if;
  if length(trim(p_title)) not between 1 and 80 or length(trim(p_owner_name)) not between 1 and 48 then raise exception 'Invalid title or participant name'; end if;
  if length(trim(p_payment_details)) > 100 then raise exception 'Invalid check details'; end if;
  -- One account creates checks one at a time, so parallel requests cannot pass the limit together.
  perform pg_advisory_xact_lock(hashtext('create_check:' || auth.uid()::text));
  if (select count(*) from public.checks owned join public.participant_devices d on d.participant_id = owned.owner_participant_id
      where d.user_id = auth.uid() and owned.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Check limit reached';
  end if;
  perform public.touch_account();
  perform public.purge_expired();
  insert into public.checks(title, service_percent, owner_token_hash, payment_details)
  values (trim(p_title), p_service_percent, extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256'), nullif(trim(p_payment_details), '')) returning * into c;
  insert into public.participants(check_id, name, session_token_hash, sort_order)
  values (c.id, trim(p_owner_name), extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256'), 0) returning * into person;
  insert into public.participant_devices(participant_id, check_id, user_id) values (person.id, c.id, auth.uid());
  update public.checks set owner_participant_id = person.id where id = c.id;
  insert into public.payments(check_id, participant_id) values (c.id, person.id);
  return jsonb_build_object('id', c.id, 'public_id', c.public_id, 'participant_id', person.id);
end $$;

create or replace function public.add_item(p_check_id uuid, p_name text, p_quantity integer, p_unit_price bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item_uuid uuid;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if p_quantity not between 1 and 999 or p_unit_price not between 1 and 100000000 or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid item'; end if;
  -- The check row serializes concurrent additions, so the limits hold.
  perform 1 from public.checks where id = p_check_id for update;
  if (select count(*) from public.items where check_id = p_check_id) >= 100 then raise exception 'Item limit reached'; end if;
  if (select coalesce(sum(quantity), 0) from public.items where check_id = p_check_id) + p_quantity > 1000 then raise exception 'Portion limit reached'; end if;
  insert into public.items(check_id, name, quantity, unit_price, created_by)
  values (p_check_id, trim(p_name), p_quantity, p_unit_price, public.current_participant(p_check_id)) returning id into item_uuid;
  insert into public.item_units(item_id, unit_index) select item_uuid, n from generate_series(1, p_quantity) n;
  return item_uuid;
end $$;

create or replace function public.update_item(p_check_id uuid, p_item_id uuid, p_name text, p_quantity integer, p_unit_price bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare old_item public.items; unit_id uuid;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if p_quantity not between 1 and 999 or p_unit_price not between 1 and 100000000 or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid item'; end if;
  perform 1 from public.checks where id = p_check_id for update;
  -- Units first, in the same order as toggle_unit_share, so a concurrent tap waits for the new price.
  perform 1 from public.item_units where item_id = p_item_id order by unit_index for update;
  select * into old_item from public.items where id = p_item_id and check_id = p_check_id for update;
  if not found then raise exception 'Item not found'; end if;
  if p_quantity > old_item.quantity
    and (select coalesce(sum(quantity), 0) from public.items where check_id = p_check_id) - old_item.quantity + p_quantity > 1000 then
    raise exception 'Portion limit reached';
  end if;
  update public.items set name = trim(p_name), quantity = p_quantity, unit_price = p_unit_price where id = p_item_id;
  if p_quantity > old_item.quantity then
    insert into public.item_units(item_id, unit_index) select p_item_id, n from generate_series(old_item.quantity + 1, p_quantity) n;
  elsif p_quantity < old_item.quantity then
    delete from public.item_units where item_id = p_item_id and unit_index > p_quantity;
  end if;
  if p_unit_price <> old_item.unit_price then
    for unit_id in select id from public.item_units where item_id = p_item_id order by unit_index loop
      perform public.resplit_unit_equally(unit_id);
    end loop;
  end if;
end $$;

-- 2. No direct table access; SECURITY DEFINER functions read and write as the table owner.
drop policy if exists "members read checks" on public.checks;
drop policy if exists "members read participants" on public.participants;
drop policy if exists "members read items" on public.items;
drop policy if exists "members read units" on public.item_units;
drop policy if exists "members read shares" on public.item_shares;
drop policy if exists "members read payments" on public.payments;
drop policy if exists "members read comments" on public.comments;
revoke all on all tables in schema public from anon, authenticated;
-- Tables added by later migrations start closed too; whatever a client needs is granted explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- 3. Presence only. The channel policies ran as the client and read public.checks directly,
--    so after the revoke above they go through a SECURITY DEFINER check instead.
create or replace function public.is_check_topic_member(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.checks c join public.participant_devices d on d.check_id = c.id
    where c.public_id = split_part(p_topic, ':', 2) and d.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_check_topic_member(text) from public, anon;
grant execute on function public.is_check_topic_member(text) to authenticated;

drop policy if exists "members join their check channel" on realtime.messages;
drop policy if exists "members broadcast in their check channel" on realtime.messages;
create policy "members join their check channel" on realtime.messages for select to authenticated using (
  public.is_check_topic_member(realtime.topic())
);
create policy "members track presence in their check channel" on realtime.messages for insert to authenticated with check (
  realtime.messages.extension = 'presence' and public.is_check_topic_member(realtime.topic())
);
