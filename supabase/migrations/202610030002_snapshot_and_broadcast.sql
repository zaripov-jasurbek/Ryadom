-- 1. get_check returns the whole check in one round trip instead of seven PostgREST queries.
-- 2. Changes are broadcast once per transaction on the check's private channel (check:<public_id>).
--    Before this, clients subscribed to Postgres Changes on seven tables; DELETE events cannot be
--    filtered, so every removed share woke up every connected client of every check.
-- 3. Indexes for the check_id lookups that RLS, RPCs and the snapshot run on every request.

create index if not exists items_check_idx on public.items(check_id, created_at);
create index if not exists payments_check_idx on public.payments(check_id);
create index if not exists comments_check_idx on public.comments(check_id, created_at);
create index if not exists item_shares_participant_idx on public.item_shares(participant_id);

create or replace function public.get_check(p_public_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.checks; me uuid;
begin
  select * into c from public.checks where public_id = p_public_id;
  if found then me := public.current_participant(c.id); end if;
  -- Same answer for a missing check and one the caller is not a member of.
  if me is null then raise exception 'Check not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', c.id,
    'public_id', c.public_id,
    'title', c.title,
    'service_percent', c.service_percent,
    'created_at', c.created_at,
    'me', me,
    'is_owner', coalesce(me = c.owner_participant_id, false),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'paid', coalesce(pay.amount_paid, 0), 'proof_url', pay.proof_url, 'status', coalesce(pay.status, 'unpaid')) order by p.sort_order, p.id)
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
revoke all on function public.get_check(text) from public, anon;
grant execute on function public.get_check(text) to authenticated;

-- One "changed" broadcast per check per transaction; Realtime delivers it only after commit.
-- `by` lets the acting device skip the echo of a change it already reloaded.
create or replace function public.broadcast_check_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid; topic_id text; marker text;
begin
  if tg_table_name = 'checks' then
    target := coalesce(new.id, old.id);
    topic_id := coalesce(new.public_id, old.public_id);
  else
    if tg_table_name = 'item_shares' then
      select i.check_id into target from public.item_units u join public.items i on i.id = u.item_id where u.id = coalesce(new.item_unit_id, old.item_unit_id);
    else
      target := coalesce(new.check_id, old.check_id);
    end if;
    -- Rows deleted together with their check are covered by the check's own broadcast.
    select public_id into topic_id from public.checks where id = target;
  end if;
  if topic_id is null then return null; end if;
  marker := 'bill_split.sent_' || replace(target::text, '-', '');
  if current_setting(marker, true) = '1' then return null; end if;
  perform set_config(marker, '1', true);
  perform realtime.send(jsonb_build_object('table', tg_table_name, 'by', auth.uid()), 'changed', 'check:' || topic_id, true);
  return null;
end $$;
revoke all on function public.broadcast_check_change() from public, anon, authenticated;

-- item_units only change together with their item, so the items trigger covers them.
create trigger broadcast_checks after update or delete on public.checks for each row execute function public.broadcast_check_change();
create trigger broadcast_participants after insert or update or delete on public.participants for each row execute function public.broadcast_check_change();
create trigger broadcast_items after insert or update or delete on public.items for each row execute function public.broadcast_check_change();
create trigger broadcast_item_shares after insert or update or delete on public.item_shares for each row execute function public.broadcast_check_change();
create trigger broadcast_payments after insert or update or delete on public.payments for each row execute function public.broadcast_check_change();
create trigger broadcast_comments after insert or update or delete on public.comments for each row execute function public.broadcast_check_change();

do $$
declare t text;
begin
  foreach t in array array['checks', 'participants', 'items', 'item_units', 'item_shares', 'payments', 'comments'] loop
    begin execute format('alter publication supabase_realtime drop table public.%I', t);
    exception when undefined_object or undefined_table then null; end;
  end loop;
end $$;
