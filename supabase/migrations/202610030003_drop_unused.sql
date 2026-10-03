-- Nothing writes check_events and no client calls archive_check.
drop function if exists public.archive_check(uuid);
drop table if exists public.check_events;
