-- SplitBill initial schema. Apply with `supabase db push` or the Supabase SQL editor.
create extension if not exists pgcrypto with schema extensions;

create type public.payment_status as enum ('unpaid', 'partially_paid', 'proof_submitted', 'paid');
create type public.share_mode as enum ('equal', 'by_quantity', 'custom');

create table public.checks (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default encode(gen_random_bytes(9), 'hex'),
  title text not null check (length(title) between 1 and 80),
  currency text not null default 'UZS' check (currency = 'UZS'),
  service_percent numeric(5,2) not null default 0 check (service_percent between 0 and 100),
  owner_uid uuid not null references auth.users(id),
  owner_token_hash bytea not null,
  status text not null default 'active' check (status in ('active','settled','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.checks(id) on delete cascade,
  user_id uuid references auth.users(id),
  name text not null check (length(name) between 1 and 48),
  session_token_hash bytea not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (check_id, user_id),
  unique (id, check_id)
);
create index participants_check_idx on public.participants(check_id);
create unique index participants_name_per_check on public.participants(check_id,lower(name));

create table public.items (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.checks(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  quantity integer not null check (quantity between 1 and 999),
  unit_price bigint not null check (unit_price > 0),
  created_by uuid references public.participants(id) on delete set null,
  created_at timestamptz not null default now()
);

-- A physical serving is independently assignable, so identical line items can be shared differently.
create table public.item_units (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  unit_index integer not null check (unit_index > 0),
  unique (item_id, unit_index)
);

-- Amounts are whole UZS. Shares for each unit must add up to its item's unit_price.
create table public.item_shares (
  id uuid primary key default gen_random_uuid(),
  item_unit_id uuid not null references public.item_units(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  amount bigint not null check (amount >= 0),
  mode public.share_mode not null default 'equal',
  updated_at timestamptz not null default now(),
  unique (item_unit_id, participant_id)
);
create index item_units_item_idx on public.item_units(item_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.checks(id) on delete cascade,
  participant_id uuid not null,
  amount_paid bigint not null default 0 check (amount_paid >= 0),
  proof_url text check (proof_url is null or length(proof_url) <= 2048),
  status public.payment_status not null default 'unpaid',
  confirmed_by uuid references public.participants(id),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(participant_id),
  foreign key(participant_id,check_id) references public.participants(id,check_id) on delete cascade
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.checks(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  participant_id uuid not null,
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key(participant_id,check_id) references public.participants(id,check_id) on delete cascade
);

create table public.check_events (
  id bigint generated always as identity primary key,
  check_id uuid not null references public.checks(id) on delete cascade,
  actor_id uuid references public.participants(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Access helpers rely on a Supabase anonymous-auth account (auth.uid()). No service key is used by clients.
create or replace function public.is_check_member(target_check uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.checks c where c.id = target_check and c.owner_uid = (select auth.uid()))
    or exists(select 1 from public.participants p where p.check_id = target_check and p.user_id = (select auth.uid()));
$$;
create or replace function public.is_check_owner(target_check uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.checks c where c.id = target_check and c.owner_uid = (select auth.uid()));
$$;
create or replace function public.is_own_participant(target_participant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.participants p where p.id = target_participant and p.user_id = (select auth.uid()));
$$;

alter table public.checks enable row level security;
alter table public.participants enable row level security;
alter table public.items enable row level security;
alter table public.item_units enable row level security;
alter table public.item_shares enable row level security;
alter table public.payments enable row level security;
alter table public.comments enable row level security;
alter table public.check_events enable row level security;

create policy "members read checks" on public.checks for select to authenticated using (public.is_check_member(id));
create policy "owner inserts checks" on public.checks for insert to authenticated with check (owner_uid = (select auth.uid()));
-- Check metadata changes are intentionally unavailable to participants and the current UI.
create policy "members read participants" on public.participants for select to authenticated using (public.is_check_member(check_id));
create policy "members read items" on public.items for select to authenticated using (public.is_check_member(check_id));
create policy "members read units" on public.item_units for select to authenticated using (exists(select 1 from public.items i where i.id = item_id and public.is_check_member(i.check_id)));
create policy "members read shares" on public.item_shares for select to authenticated using (exists(select 1 from public.item_units u join public.items i on i.id=u.item_id where u.id=item_unit_id and public.is_check_member(i.check_id)));
create policy "members read payments" on public.payments for select to authenticated using (public.is_check_member(check_id));
create policy "members read comments" on public.comments for select to authenticated using (public.is_check_member(check_id));
create policy "members read events" on public.check_events for select to authenticated using (public.is_check_member(check_id));
create policy "participant comments" on public.comments for insert to authenticated with check (public.is_own_participant(participant_id) and public.is_check_member(check_id));

-- A participant can only update their own payment record; creators have read-only access here.
create policy "participants submit own payment" on public.payments for insert to authenticated with check (public.is_own_participant(participant_id) and public.is_check_member(check_id));
create policy "participants update own payment" on public.payments for update to authenticated using (public.is_own_participant(participant_id)) with check (public.is_own_participant(participant_id));
create policy "owner confirms payments" on public.payments for update to authenticated using (public.is_check_owner(check_id)) with check (public.is_check_owner(check_id));

-- Deliberately no direct write policies for items, participants, item_units or shares: write access is added via validated RPCs.
-- Private presence topics use the same membership check. The Realtime channel name is check:<public_id>.
create policy "members join their check channel" on realtime.messages for select to authenticated using (
  exists(select 1 from public.checks c where c.public_id = split_part(realtime.topic(), ':', 2) and public.is_check_member(c.id))
);
create policy "members broadcast in their check channel" on realtime.messages for insert to authenticated with check (
  exists(select 1 from public.checks c where c.public_id = split_part(realtime.topic(), ':', 2) and public.is_check_member(c.id))
);

grant execute on function public.is_check_member(uuid) to authenticated;
grant execute on function public.is_check_owner(uuid) to authenticated;
grant execute on function public.is_own_participant(uuid) to authenticated;
-- Capability-checked mutation functions. Client writes go through these SECURITY DEFINER entry points.
create or replace function public.create_check(p_title text, p_service_percent numeric, p_owner_name text, p_owner_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person public.participants;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  if length(p_owner_token)<32 then raise exception 'Invalid owner token'; end if;
  if length(trim(p_title)) not between 1 and 80 or length(trim(p_owner_name)) not between 1 and 48 then raise exception 'Invalid title or participant name'; end if;
  insert into public.checks(title,service_percent,owner_uid,owner_token_hash)
  values(trim(p_title),p_service_percent,auth.uid(),extensions.digest(convert_to(p_owner_token,'UTF8'),'sha256')) returning * into c;
  insert into public.participants(check_id,user_id,name,session_token_hash,sort_order)
  values(c.id,auth.uid(),trim(p_owner_name),extensions.digest(convert_to(p_owner_token,'UTF8'),'sha256'),0) returning * into person;
  insert into public.payments(check_id,participant_id) values(c.id,person.id);
  return jsonb_build_object('id',c.id,'public_id',c.public_id,'participant_id',person.id);
end $$;

create or replace function public.join_check(p_public_id text, p_name text, p_session_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checks; person public.participants;
begin
  if auth.uid() is null then raise exception 'Anonymous session required'; end if;
  if length(trim(p_name)) not between 1 and 48 or length(p_session_token) < 24 then raise exception 'Invalid participant session'; end if;
  select * into c from public.checks where public_id=p_public_id and status='active';
  if not found then raise exception 'Check not found'; end if;
  select * into person from public.participants where check_id=c.id and user_id=auth.uid();
  if not found then
    select * into person from public.participants where check_id=c.id and user_id is null and session_token_hash=extensions.digest(convert_to(p_session_token,'UTF8'),'sha256') for update;
    if found then
      update public.participants set user_id=auth.uid() where id=person.id returning * into person;
    else
      if exists(select 1 from public.participants where check_id=c.id and lower(name)=lower(trim(p_name))) then raise exception 'That name is reserved. Use the personal invitation link.'; end if;
      insert into public.participants(check_id,user_id,name,session_token_hash,sort_order)
      values(c.id,auth.uid(),trim(p_name),extensions.digest(convert_to(p_session_token,'UTF8'),'sha256'),coalesce((select max(sort_order)+1 from public.participants where check_id=c.id),1)) returning * into person;
      insert into public.payments(check_id,participant_id) values(c.id,person.id);
    end if;
  end if;
  return jsonb_build_object('id',c.id,'public_id',c.public_id,'participant_id',person.id);
end $$;

create or replace function public.claim_check_owner(p_public_id text, p_owner_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare check_uuid uuid;
begin
  select id into check_uuid from public.checks where public_id=p_public_id and owner_token_hash=extensions.digest(convert_to(p_owner_token,'UTF8'),'sha256');
  if check_uuid is null then raise exception 'Invalid owner link'; end if;
  update public.participants set user_id=auth.uid() where check_id=check_uuid and user_id=(select owner_uid from public.checks where id=check_uuid) and sort_order=0;
  update public.checks set owner_uid=auth.uid(), updated_at=now() where id=check_uuid;
  return check_uuid;
end $$;

create or replace function public.add_participant(p_check_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare new_id uuid; next_order integer; invite_secret text;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if length(trim(p_name)) not between 1 and 48 then raise exception 'Invalid participant name'; end if;
  if exists(select 1 from public.participants where check_id=p_check_id and lower(name)=lower(trim(p_name))) then raise exception 'Name already in this check'; end if;
  select coalesce(max(sort_order)+1,1) into next_order from public.participants where check_id=p_check_id;
  invite_secret := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.participants(check_id,name,session_token_hash,sort_order) values(p_check_id,trim(p_name),extensions.digest(convert_to(invite_secret,'UTF8'),'sha256'),next_order) returning id into new_id;
  insert into public.payments(check_id,participant_id) values(p_check_id,new_id);
  return jsonb_build_object('id',new_id,'session_token',invite_secret);
end $$;

create or replace function public.add_item(p_check_id uuid, p_name text, p_quantity integer, p_unit_price bigint, p_creator_participant uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item_uuid uuid; n integer;
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if p_quantity not between 1 and 999 or p_unit_price <= 0 or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid item'; end if;
  insert into public.items(check_id,name,quantity,unit_price,created_by) values(p_check_id,trim(p_name),p_quantity,p_unit_price,p_creator_participant) returning id into item_uuid;
  for n in 1..p_quantity loop insert into public.item_units(item_id,unit_index) values(item_uuid,n); end loop;
  return item_uuid;
end $$;

create or replace function public.toggle_unit_share(p_item_unit uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare actor public.participants; parent_item public.items; unit_price bigint; consumers uuid[]; unit_count integer; base_amount bigint; remainder bigint;
begin
  select i.* into parent_item from public.items i join public.item_units u on u.item_id=i.id where u.id=p_item_unit;
  if not found or not public.is_check_member(parent_item.check_id) then raise exception 'Item unit unavailable'; end if;
  select * into actor from public.participants where user_id=auth.uid() and check_id=parent_item.check_id;
  if not found then raise exception 'Join the check first'; end if;
  unit_price := parent_item.unit_price;
  if p_enabled then
    insert into public.item_shares(item_unit_id,participant_id,amount,mode) values(p_item_unit,actor.id,0,'equal') on conflict(item_unit_id,participant_id) do nothing;
  else
    delete from public.item_shares where item_unit_id=p_item_unit and participant_id=actor.id;
  end if;
  select array_agg(s.participant_id order by p.sort_order,p.id), count(*) into consumers,unit_count
  from public.item_shares s join public.participants p on p.id=s.participant_id where s.item_unit_id=p_item_unit;
  if coalesce(unit_count,0)=0 then return; end if;
  base_amount := unit_price / unit_count; remainder := unit_price % unit_count;
  with ordered as (select s.participant_id, row_number() over(order by p.sort_order,p.id) as rn from public.item_shares s join public.participants p on p.id=s.participant_id where s.item_unit_id=p_item_unit)
  update public.item_shares s set amount=base_amount+case when ordered.rn<=remainder then 1 else 0 end,updated_at=now()
  from ordered where s.item_unit_id=p_item_unit and s.participant_id=ordered.participant_id;
end $$;

create or replace function public.set_unit_custom_shares(p_item_unit uuid, p_allocations jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item_row public.items; total bigint;
begin
  select i.* into item_row from public.items i join public.item_units u on u.item_id=i.id where u.id=p_item_unit;
  if not found or not public.is_check_owner(item_row.check_id) then raise exception 'Owner access required'; end if;
  if jsonb_typeof(p_allocations) <> 'object' then raise exception 'Invalid allocations'; end if;
  if exists(
    select 1 from jsonb_each_text(p_allocations) e
    where e.value !~ '^[0-9]+$'
      or not exists(select 1 from public.participants p where p.id=e.key::uuid and p.check_id=item_row.check_id)
  ) then raise exception 'Invalid participant allocation'; end if;
  select coalesce(sum(e.value::bigint),0) into total from jsonb_each_text(p_allocations) e;
  if total <> item_row.unit_price then raise exception 'Shares must equal the item unit price'; end if;
  delete from public.item_shares where item_unit_id=p_item_unit;
  insert into public.item_shares(item_unit_id,participant_id,amount,mode)
  select p_item_unit,e.key::uuid,e.value::bigint,'custom' from jsonb_each_text(p_allocations) e;
end $$;

create or replace function public.submit_payment(p_check_id uuid, p_amount bigint, p_proof_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid;
begin
  select id into actor_id from public.participants where check_id=p_check_id and user_id=auth.uid();
  if actor_id is null then raise exception 'Participant access required'; end if;
  if p_amount < 0 or (p_proof_url is not null and (length(p_proof_url)>2048 or p_proof_url !~ '^https?://')) then raise exception 'Invalid payment data'; end if;
  update public.payments set amount_paid=p_amount,proof_url=p_proof_url,
    status=case when p_proof_url is not null then 'proof_submitted'::public.payment_status when p_amount>0 then 'partially_paid'::public.payment_status else 'unpaid'::public.payment_status end,
    submitted_at=now(),updated_at=now(),confirmed_by=null,confirmed_at=null
  where check_id=p_check_id and participant_id=actor_id;
end $$;

create or replace function public.confirm_payment(p_check_id uuid, p_participant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  update public.payments set status='paid',confirmed_by=(select id from public.participants where check_id=p_check_id and user_id=auth.uid()),confirmed_at=now(),updated_at=now()
  where check_id=p_check_id and participant_id=p_participant_id and status='proof_submitted';
  if not found then raise exception 'No submitted proof to confirm'; end if;
end $$;

create or replace function public.add_comment(p_check_id uuid, p_item_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; comment_uuid uuid;
begin
  select id into actor_id from public.participants where check_id=p_check_id and user_id=auth.uid();
  if actor_id is null then raise exception 'Participant access required'; end if;
  if length(trim(p_body)) not between 1 and 1000 then raise exception 'Invalid comment'; end if;
  if p_item_id is not null and not exists(select 1 from public.items where id=p_item_id and check_id=p_check_id) then raise exception 'Item not found'; end if;
  insert into public.comments(check_id,item_id,participant_id,body) values(p_check_id,p_item_id,actor_id,trim(p_body)) returning id into comment_uuid;
  return comment_uuid;
end $$;

create or replace function public.delete_check(p_check_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if exists(select 1 from public.payments where check_id=p_check_id and status <> 'paid') then raise exception 'All payments must be confirmed first'; end if;
  delete from public.checks where id=p_check_id;
end $$;



create or replace function public.archive_check(p_check_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_check_owner(p_check_id) then raise exception 'Owner access required'; end if;
  if exists(select 1 from public.payments where check_id=p_check_id and status <> 'paid') then raise exception 'All payments must be confirmed first'; end if;
  update public.checks set status='archived',updated_at=now() where id=p_check_id;
end $$;

grant execute on function public.create_check(text,numeric,text,text) to authenticated;
grant execute on function public.join_check(text,text,text) to authenticated;
grant execute on function public.claim_check_owner(text,text) to authenticated;
grant execute on function public.add_participant(uuid,text) to authenticated;
grant execute on function public.add_item(uuid,text,integer,bigint,uuid) to authenticated;
grant execute on function public.toggle_unit_share(uuid,boolean) to authenticated;
grant execute on function public.submit_payment(uuid,bigint,text) to authenticated;
grant execute on function public.confirm_payment(uuid,uuid) to authenticated;
grant execute on function public.add_comment(uuid,uuid,text) to authenticated;
grant execute on function public.archive_check(uuid) to authenticated;
grant execute on function public.delete_check(uuid) to authenticated;
create or replace function public.invalidate_check_payments()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_check uuid;
begin
  if tg_table_name='items' then
    target_check := coalesce(new.check_id,old.check_id);
  else
    select i.check_id into target_check
    from public.item_units u join public.items i on i.id=u.item_id
    where u.id=coalesce(new.item_unit_id,old.item_unit_id);
  end if;
  if target_check is not null then
    update public.payments set
      status=case when amount_paid>0 then 'partially_paid'::public.payment_status else 'unpaid'::public.payment_status end,
      proof_url=null,submitted_at=null,confirmed_by=null,confirmed_at=null,updated_at=now()
    where check_id=target_check and (status in ('paid','proof_submitted') or proof_url is not null or confirmed_at is not null);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

-- Match the client calculation when the owner confirms a submitted payment.
create or replace function public.participant_due_totals(target_check uuid)
returns table(participant_id uuid, due bigint)
language sql stable security definer set search_path = '' as $$
  with subtotals as (
    select p.id as participant_id, p.sort_order, c.service_percent,
      coalesce(sum(s.amount), 0)::bigint as subtotal
    from public.participants p
    cross join public.checks c
    left join public.item_shares s on s.participant_id = p.id
    left join public.item_units u on u.id = s.item_unit_id
    left join public.items i on i.id = u.item_id and i.check_id = p.check_id
    where p.check_id = target_check and c.id = target_check
    group by p.id, p.sort_order, c.service_percent
  ), amounts as (
    select s.*,
      round(sum(s.subtotal) over () * s.service_percent / 100)::bigint as service_total,
      sum(s.subtotal) over () as total_subtotal
    from subtotals s
  ), portions as (
    select a.*,
      case when total_subtotal = 0 then 0 else floor(service_total::numeric * subtotal / total_subtotal)::bigint end as service_base,
      case when total_subtotal = 0 then 0 else (service_total::numeric * subtotal / total_subtotal) - floor(service_total::numeric * subtotal / total_subtotal) end as fraction
    from amounts a
  ), ranked as (
    select p.*, service_total - sum(service_base) over () as remainder,
      row_number() over (order by fraction desc, sort_order, participant_id) as rank
    from portions p
  )
  select participant_id, subtotal + service_base + case when rank <= remainder then 1 else 0 end
  from ranked;
$$;

create or replace function public.guard_payment_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; participant_uid uuid;
begin
  select owner_uid into owner_id from public.checks where id=new.check_id;
  select user_id into participant_uid from public.participants where id=new.participant_id and check_id=new.check_id;
  if tg_op='INSERT' then
    if not (participant_uid=auth.uid() or (participant_uid is null and owner_id=auth.uid() and new.status='unpaid' and new.amount_paid=0 and new.proof_url is null)) or new.status='paid' or new.confirmed_at is not null or new.confirmed_by is not null then raise exception 'Only the participant can submit an unconfirmed payment'; end if;
    return new;
  end if;
  if new.check_id is distinct from old.check_id or new.participant_id is distinct from old.participant_id then raise exception 'Payment identity cannot change'; end if;
  if pg_trigger_depth()>1 then
    if new.amount_paid is distinct from old.amount_paid or new.status='paid' then raise exception 'Invalid internal payment reset'; end if;
    return new;
  end if;
  if participant_uid=auth.uid() and new.status<>'paid' and new.confirmed_by is not distinct from old.confirmed_by and new.confirmed_at is not distinct from old.confirmed_at then
    if new.status='proof_submitted' and new.proof_url is null then raise exception 'Payment proof URL is required'; end if;
    return new;
  end if;
  if auth.uid()=owner_id then
    if new.status <> 'paid' or old.status <> 'proof_submitted' or new.amount_paid < coalesce((select due from public.participant_due_totals(new.check_id) where participant_id=new.participant_id),0) or new.amount_paid is distinct from old.amount_paid or new.proof_url is distinct from old.proof_url or new.submitted_at is distinct from old.submitted_at or new.confirmed_at is null or new.confirmed_by is distinct from (select id from public.participants where check_id=new.check_id and user_id=auth.uid()) then raise exception 'Owner may only confirm a submitted proof'; end if;
    return new;
  end if;
  raise exception 'Participants may only submit their own payment';
end $$;

create trigger guard_payments before insert or update on public.payments for each row execute function public.guard_payment_changes();
create trigger invalidate_payments_from_items after insert or update or delete on public.items for each row execute function public.invalidate_check_payments();
create trigger invalidate_payments_from_shares after insert or update or delete on public.item_shares for each row execute function public.invalidate_check_payments();

-- Enable Supabase Postgres Changes for the bill tables after they exist.
do $$
declare t regclass;
begin
  foreach t in array array[
    'public.checks'::regclass,
    'public.participants'::regclass,
    'public.items'::regclass,
    'public.item_units'::regclass,
    'public.item_shares'::regclass,
    'public.payments'::regclass,
    'public.comments'::regclass
  ] loop
    begin execute format('alter publication supabase_realtime add table %s', t); exception when duplicate_object then null; end;
  end loop;
end $$;

revoke all on function public.participant_due_totals(uuid) from public, anon, authenticated;
revoke all on function public.create_check(text,numeric,text,text) from public, anon;
revoke all on function public.join_check(text,text,text) from public, anon;
revoke all on function public.claim_check_owner(text,text) from public, anon;
revoke all on function public.add_participant(uuid,text) from public, anon;
revoke all on function public.add_item(uuid,text,integer,bigint,uuid) from public, anon;
revoke all on function public.toggle_unit_share(uuid,boolean) from public, anon;
revoke all on function public.set_unit_custom_shares(uuid,jsonb) from public, anon;
revoke all on function public.submit_payment(uuid,bigint,text) from public, anon;
revoke all on function public.confirm_payment(uuid,uuid) from public, anon;
revoke all on function public.add_comment(uuid,uuid,text) from public, anon;
revoke all on function public.archive_check(uuid) from public, anon;
revoke all on function public.delete_check(uuid) from public, anon;
-- Table grants expose member reads; RLS policies still scope every row.
grant usage on schema public to authenticated;
grant select on public.checks,public.participants,public.items,public.item_units,public.item_shares,public.payments,public.comments,public.check_events to authenticated;
grant insert on public.comments,public.payments to authenticated;
grant update on public.payments to authenticated;

