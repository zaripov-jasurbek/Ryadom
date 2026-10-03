-- 1. A participant may use several devices (anonymous auth users). Before this, opening the owner
--    link on a phone moved the creator's only identity there and locked the laptop out of the check.
-- 2. Every change to a unit's shares locks the unit row first, so concurrent "это моё" taps cannot
--    leave shares that no longer add up to the unit price.
-- 3. Guests cannot toggle into a unit the owner split by hand.
-- 4. add_item records the creator from the session instead of a client-supplied participant id.

create table public.participant_devices (
  participant_id uuid not null,
  check_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (participant_id, user_id),
  unique (check_id, user_id),
  foreign key (participant_id, check_id) references public.participants(id, check_id) on delete cascade
);
alter table public.participant_devices enable row level security;
-- No policies or grants: only the SECURITY DEFINER functions below read or write devices.

alter table public.checks add column owner_participant_id uuid references public.participants(id) on delete set null;

insert into public.participant_devices(participant_id, check_id, user_id)
select id, check_id, user_id from public.participants where user_id is not null
on conflict do nothing;
update public.checks c set owner_participant_id = p.id
from public.participants p where p.check_id = c.id and p.sort_order = 0;

create or replace function public.current_participant(target_check uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select participant_id from public.participant_devices where check_id = target_check and user_id = (select auth.uid());
$$;

create or replace function public.is_check_member(target_check uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.participant_devices where check_id = target_check and user_id = (select auth.uid()));
$$;

create or replace function public.is_check_owner(target_check uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.checks c join public.participant_devices d on d.participant_id = c.owner_participant_id
    where c.id = target_check and d.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_own_participant(target_participant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.participant_devices where participant_id = target_participant and user_id = (select auth.uid()));
$$;

create or replace function public.create_check(p_title text, p_service_percent numeric, p_owner_name text, p_owner_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person public.participants;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  if length(p_owner_token) < 32 then raise exception 'Invalid owner token'; end if;
  if length(trim(p_title)) not between 1 and 80 or length(trim(p_owner_name)) not between 1 and 48 then raise exception 'Invalid title or participant name'; end if;
  insert into public.checks(title, service_percent, owner_uid, owner_token_hash)
  values (trim(p_title), p_service_percent, auth.uid(), extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256')) returning * into c;
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
  select * into c from public.checks where public_id = p_public_id and status = 'active' for update;
  if not found then raise exception 'Check not found'; end if;
  person_id := public.current_participant(c.id);
  if person_id is null then
    select id into person_id from public.participants
    where check_id = c.id and session_token_hash = extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256');
    if person_id is null then
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

-- The owner link adds this device to the creator; devices that already hold it keep access.
create or replace function public.claim_check_owner(p_public_id text, p_owner_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.checks;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  select * into c from public.checks
  where public_id = p_public_id and owner_token_hash = extensions.digest(convert_to(p_owner_token, 'UTF8'), 'sha256');
  if not found or c.owner_participant_id is null then raise exception 'Invalid owner link'; end if;
  -- A device that joined as a guest earlier becomes the creator's device.
  delete from public.participant_devices where check_id = c.id and user_id = auth.uid() and participant_id <> c.owner_participant_id;
  insert into public.participant_devices(participant_id, check_id, user_id) values (c.owner_participant_id, c.id, auth.uid())
  on conflict do nothing;
  return c.id;
end $$;

drop function public.add_item(uuid, text, integer, bigint, uuid);
create function public.add_item(p_check_id uuid, p_name text, p_quantity integer, p_unit_price bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item_uuid uuid;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if p_quantity not between 1 and 999 or p_unit_price <= 0 or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid item'; end if;
  insert into public.items(check_id, name, quantity, unit_price, created_by)
  values (p_check_id, trim(p_name), p_quantity, p_unit_price, public.current_participant(p_check_id)) returning id into item_uuid;
  insert into public.item_units(item_id, unit_index) select item_uuid, n from generate_series(1, p_quantity) n;
  return item_uuid;
end $$;
revoke all on function public.add_item(uuid, text, integer, bigint) from public, anon;
grant execute on function public.add_item(uuid, text, integer, bigint) to authenticated;

-- Internal: equal amounts for everyone holding a share of the unit; the first participants absorb the remainder.
create or replace function public.split_unit_equally(p_item_unit uuid, p_unit_price bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare consumers integer;
begin
  select count(*) into consumers from public.item_shares where item_unit_id = p_item_unit;
  if consumers = 0 then return; end if;
  with ordered as (
    select s.participant_id, row_number() over (order by p.sort_order, p.id) as rn
    from public.item_shares s join public.participants p on p.id = s.participant_id where s.item_unit_id = p_item_unit
  )
  update public.item_shares s set amount = p_unit_price / consumers + case when ordered.rn <= p_unit_price % consumers then 1 else 0 end,
    mode = 'equal', updated_at = now()
  from ordered where s.item_unit_id = p_item_unit and s.participant_id = ordered.participant_id;
end $$;
revoke all on function public.split_unit_equally(uuid, bigint) from public, anon, authenticated;

create or replace function public.toggle_unit_share(p_item_unit uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare parent_item public.items; actor uuid;
begin
  select i.* into parent_item from public.item_units u join public.items i on i.id = u.item_id where u.id = p_item_unit for update of u;
  if not found then raise exception 'Item unit unavailable'; end if;
  actor := public.current_participant(parent_item.check_id);
  if actor is null then raise exception 'Join the check first'; end if;
  if exists(select 1 from public.item_shares where item_unit_id = p_item_unit and mode = 'custom') then raise exception 'This unit has a custom split'; end if;
  if p_enabled then
    insert into public.item_shares(item_unit_id, participant_id, amount, mode) values (p_item_unit, actor, 0, 'equal') on conflict (item_unit_id, participant_id) do nothing;
  else
    delete from public.item_shares where item_unit_id = p_item_unit and participant_id = actor;
  end if;
  perform public.split_unit_equally(p_item_unit, parent_item.unit_price);
end $$;

create or replace function public.set_unit_custom_shares(p_item_unit uuid, p_allocations jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item_row public.items; total bigint;
begin
  select i.* into item_row from public.item_units u join public.items i on i.id = u.item_id where u.id = p_item_unit for update of u;
  if not found or not public.is_check_owner(item_row.check_id) then raise exception 'Owner access required'; end if;
  if jsonb_typeof(p_allocations) <> 'object' then raise exception 'Invalid allocations'; end if;
  if exists(
    select 1 from jsonb_each_text(p_allocations) e
    where e.value !~ '^[0-9]+$'
      or not exists(select 1 from public.participants p where p.id::text = e.key and p.check_id = item_row.check_id)
  ) then raise exception 'Invalid participant allocation'; end if;
  select coalesce(sum(e.value::bigint), 0) into total from jsonb_each_text(p_allocations) e;
  if total <> item_row.unit_price then raise exception 'Shares must equal the item unit price'; end if;
  delete from public.item_shares where item_unit_id = p_item_unit;
  insert into public.item_shares(item_unit_id, participant_id, amount, mode)
  select p_item_unit, e.key::uuid, e.value::bigint, 'custom' from jsonb_each_text(p_allocations) e where e.value::bigint > 0;
end $$;

create or replace function public.resplit_unit_equally(p_item_unit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare unit_price bigint;
begin
  select i.unit_price into unit_price from public.item_units u join public.items i on i.id = u.item_id where u.id = p_item_unit for update of u;
  if not found then return; end if;
  delete from public.item_shares where item_unit_id = p_item_unit and mode = 'custom' and amount = 0;
  perform public.split_unit_equally(p_item_unit, unit_price);
end $$;

create or replace function public.remove_participant(p_check_id uuid, p_participant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare affected uuid[]; unit_id uuid;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if p_participant_id = (select owner_participant_id from public.checks where id = p_check_id) then raise exception 'The check creator cannot be removed'; end if;
  perform 1 from public.participants where id = p_participant_id and check_id = p_check_id for update;
  if not found then raise exception 'Participant not found'; end if;
  select array_agg(item_unit_id order by item_unit_id) into affected from public.item_shares where participant_id = p_participant_id;
  delete from public.participants where id = p_participant_id;
  foreach unit_id in array coalesce(affected, '{}') loop perform public.resplit_unit_equally(unit_id); end loop;
end $$;

create or replace function public.submit_payment(p_check_id uuid, p_amount bigint, p_proof_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.current_participant(p_check_id);
begin
  if actor is null then raise exception 'Participant access required'; end if;
  if p_amount < 0 or (p_proof_url is not null and (length(p_proof_url) > 2048 or p_proof_url !~* '^https?://')) then raise exception 'Invalid payment data'; end if;
  update public.payments set amount_paid = p_amount, proof_url = p_proof_url,
    status = case when p_proof_url is not null then 'proof_submitted'::public.payment_status when p_amount > 0 then 'partially_paid'::public.payment_status else 'unpaid'::public.payment_status end,
    submitted_at = now(), updated_at = now(), confirmed_by = null, confirmed_at = null
  where check_id = p_check_id and participant_id = actor;
end $$;

create or replace function public.confirm_payment(p_check_id uuid, p_participant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  update public.payments set status = 'paid', confirmed_by = public.current_participant(p_check_id), confirmed_at = now(), updated_at = now()
  where check_id = p_check_id and participant_id = p_participant_id and status = 'proof_submitted';
  if not found then raise exception 'No submitted proof to confirm'; end if;
end $$;

create or replace function public.add_comment(p_check_id uuid, p_item_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.current_participant(p_check_id); comment_uuid uuid;
begin
  if actor is null then raise exception 'Participant access required'; end if;
  if length(trim(p_body)) not between 1 and 1000 then raise exception 'Invalid comment'; end if;
  if p_item_id is not null and not exists(select 1 from public.items where id = p_item_id and check_id = p_check_id) then raise exception 'Item not found'; end if;
  insert into public.comments(check_id, item_id, participant_id, body) values (p_check_id, p_item_id, actor, trim(p_body)) returning id into comment_uuid;
  return comment_uuid;
end $$;

create or replace function public.delete_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.comments c where c.id = p_comment_id and c.participant_id = public.current_participant(c.check_id);
  if not found then raise exception 'Only the author can delete this comment'; end if;
end $$;

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
  if new.participant_id = actor and new.status <> 'paid' and new.confirmed_by is not distinct from old.confirmed_by and new.confirmed_at is not distinct from old.confirmed_at then
    if new.status = 'proof_submitted' and new.proof_url is null then raise exception 'Payment proof URL is required'; end if;
    return new;
  end if;
  if public.is_check_owner(new.check_id) then
    if new.status <> 'paid' or old.status <> 'proof_submitted'
      or new.amount_paid < coalesce((select due from public.participant_due_totals(new.check_id) where participant_id = new.participant_id), 0)
      or new.amount_paid is distinct from old.amount_paid or new.proof_url is distinct from old.proof_url or new.submitted_at is distinct from old.submitted_at
      or new.confirmed_at is null or new.confirmed_by is distinct from actor then
      raise exception 'Owner may only confirm a submitted proof';
    end if;
    return new;
  end if;
  raise exception 'Participants may only submit their own payment';
end $$;

-- Identity now lives in participant_devices.
alter table public.participants drop column user_id;

revoke all on function public.current_participant(uuid) from public, anon;
grant execute on function public.current_participant(uuid) to authenticated;
