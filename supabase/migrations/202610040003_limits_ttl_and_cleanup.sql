-- 1. Clients change data only through RPCs. The first schema still let members write payments and
--    comments directly through PostgREST (e.g. mark their own payment "proof_submitted" for 1 UZS).
-- 2. checks.owner_uid is unused since participant_devices, and its foreign key blocked deleting anonymous users.
-- 3. Limits: 50 participants and 50 comments per check, at most 100 000 000 UZS per unit.
--    Bigger prices are typos, and their totals no longer fit the client's exact integer math.
-- 4. A check lives 3 days (checkLifetimeDays in src/lib/limits.ts): an expired check is hidden right away
--    and deleted when someone creates a new check, together with everything in it (participants, items,
--    shares, payments, comments, devices: all of them cascade from the check).
-- 5. An anonymous account lives 10 days after its last use; every app session renews it (touch_account).
--    Deleting the account removes its devices; the participants stay in their checks under the same names.

drop policy if exists "participant comments" on public.comments;
drop policy if exists "participants submit own payment" on public.payments;
drop policy if exists "participants update own payment" on public.payments;
drop policy if exists "owner confirms payments" on public.payments;
drop policy if exists "owner inserts checks" on public.checks;
revoke insert on public.comments, public.payments from authenticated;
revoke update on public.payments from authenticated;

alter table public.checks drop column owner_uid;

alter table public.items add constraint items_unit_price_max check (unit_price <= 100000000) not valid;

create index if not exists checks_created_idx on public.checks(created_at);

create or replace function public.check_lifetime()
returns interval language sql immutable set search_path = '' as $$ select interval '3 days' $$;

create or replace function public.account_lifetime()
returns interval language sql immutable set search_path = '' as $$ select interval '10 days' $$;

-- When each anonymous account was last used. No grants: only the functions below touch it.
create table public.account_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.account_activity enable row level security;
-- Accounts that exist before this migration start their 10 days now instead of being deleted at once.
insert into public.account_activity(user_id) select id from auth.users where is_anonymous on conflict do nothing;

-- The client calls this when it uses the session; at most one write per account per hour.
create or replace function public.touch_account()
returns void language sql security definer set search_path = '' as $$
  insert into public.account_activity(user_id) select auth.uid() where auth.uid() is not null
  on conflict (user_id) do update set seen_at = now() where public.account_activity.seen_at < now() - interval '1 hour';
$$;
revoke all on function public.touch_account() from public, anon;
grant execute on function public.touch_account() to authenticated;

-- Internal: removes expired checks and unused anonymous accounts in small batches, so no single request pays for a backlog.
-- An account unused for 10 days has no live check: a check lives 3 days, and opening one renews the account.
create or replace function public.purge_expired()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.checks where id in (
    select id from public.checks where created_at < now() - public.check_lifetime() order by created_at limit 20
  );
  begin
    delete from auth.users where id in (
      select u.id from auth.users u left join public.account_activity a on a.user_id = u.id
      where u.is_anonymous and u.id is distinct from auth.uid() and coalesce(a.seen_at, u.created_at) < now() - public.account_lifetime()
      order by coalesce(a.seen_at, u.created_at) limit 20
    );
  exception when insufficient_privilege then
    -- Creating a check must not fail because the platform refused the cleanup.
    raise warning 'Unused anonymous accounts were not deleted: %', sqlerrm;
  end;
end $$;
revoke all on function public.purge_expired() from public, anon, authenticated;

create or replace function public.create_check(p_title text, p_service_percent numeric, p_owner_name text, p_owner_token text, p_payment_details text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person public.participants;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  if length(p_owner_token) < 32 then raise exception 'Invalid owner token'; end if;
  if length(trim(p_title)) not between 1 and 80 or length(trim(p_owner_name)) not between 1 and 48 then raise exception 'Invalid title or participant name'; end if;
  if length(trim(p_payment_details)) > 100 then raise exception 'Invalid check details'; end if;
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

create or replace function public.join_check(p_public_id text, p_name text, p_session_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person_id uuid;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  if length(trim(p_name)) not between 1 and 48 or length(p_session_token) < 24 then raise exception 'Invalid participant session'; end if;
  perform public.touch_account();
  select * into c from public.checks where public_id = p_public_id and status = 'active' and created_at >= now() - public.check_lifetime() for update;
  if not found then raise exception 'Check not found'; end if;
  person_id := public.current_participant(c.id);
  if person_id is null then
    -- The same browser comes back with its saved token after losing its session.
    select id into person_id from public.participants
    where check_id = c.id and session_token_hash = extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256');
    if person_id is null then
      if (select count(*) from public.participants where check_id = c.id) >= 50 then raise exception 'Participant limit reached'; end if;
      insert into public.participants(check_id, name, session_token_hash, sort_order)
      values (c.id, trim(p_name), extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256'),
        coalesce((select max(sort_order) + 1 from public.participants where check_id = c.id), 1))
      returning id into person_id;
      insert into public.participant_devices(participant_id, check_id, user_id) values (person_id, c.id, auth.uid());
      insert into public.payments(check_id, participant_id) values (c.id, person_id);
    else
      insert into public.participant_devices(participant_id, check_id, user_id) values (person_id, c.id, auth.uid());
    end if;
  end if;
  return jsonb_build_object('id', c.id, 'public_id', c.public_id, 'participant_id', person_id);
end $$;

create or replace function public.claim_check_owner(p_public_id text, p_owner_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.checks;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  select * into c from public.checks
  where public_id = p_public_id and owner_token_hash = extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256')
    and created_at >= now() - public.check_lifetime();
  if not found or c.owner_participant_id is null then raise exception 'Invalid owner link'; end if;
  -- A device that joined as a guest earlier becomes the creator's device.
  delete from public.participant_devices where check_id = c.id and user_id = auth.uid() and participant_id <> c.owner_participant_id;
  insert into public.participant_devices(participant_id, check_id, user_id) values (c.owner_participant_id, c.id, auth.uid())
  on conflict do nothing;
  return c.id;
end $$;

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
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity, 'unit_price', i.unit_price, 'units', (
        select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'shares', (
          select coalesce(jsonb_agg(jsonb_build_object('participant_id', s.participant_id, 'amount', s.amount, 'mode', s.mode) order by p.sort_order, p.id), '[]')
          from public.item_shares s join public.participants p on p.id = s.participant_id where s.item_unit_id = u.id
        )) order by u.unit_index), '[]')
        from public.item_units u where u.item_id = i.id
      )) order by i.created_at, i.id)
      from public.items i where i.check_id = c.id
    ), '[]'),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'item_id', m.item_id, 'participant_id', m.participant_id, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
      from public.comments m where m.check_id = c.id
    ), '[]')
  );
end $$;

create or replace function public.add_item(p_check_id uuid, p_name text, p_quantity integer, p_unit_price bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item_uuid uuid;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if p_quantity not between 1 and 999 or p_unit_price not between 1 and 100000000 or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid item'; end if;
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
  -- Units first, in the same order as toggle_unit_share, so a concurrent tap waits for the new price.
  perform 1 from public.item_units where item_id = p_item_id order by unit_index for update;
  select * into old_item from public.items where id = p_item_id and check_id = p_check_id for update;
  if not found then raise exception 'Item not found'; end if;
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

create or replace function public.add_comment(p_check_id uuid, p_item_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.current_participant(p_check_id); comment_uuid uuid;
begin
  if actor is null then raise exception 'Participant access required'; end if;
  if length(trim(p_body)) not between 1 and 1000 then raise exception 'Invalid comment'; end if;
  if p_item_id is not null and not exists(select 1 from public.items where id = p_item_id and check_id = p_check_id) then raise exception 'Item not found'; end if;
  -- The check row serializes concurrent comments, so the limit holds.
  perform 1 from public.checks where id = p_check_id for update;
  if (select count(*) from public.comments where check_id = p_check_id) >= 50 then raise exception 'Comment limit reached'; end if;
  insert into public.comments(check_id, item_id, participant_id, body) values (p_check_id, p_item_id, actor, trim(p_body)) returning id into comment_uuid;
  return comment_uuid;
end $$;
