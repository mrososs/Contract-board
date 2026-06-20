-- Realtime board updates (B3) — broadcast, not postgres_changes.
--
-- The browser holds only the public anon key and has no Supabase Auth session,
-- so it cannot pass the `authenticated` RLS policies that gate direct table
-- reads. Rather than open anon SELECT on the board tables (a full-table read
-- grant), we broadcast each change from the database to a public 'board'
-- channel. Subscribers receive only the row that changed — no table read access.
--
-- Reads of history still go through the service-role Edge Function (getActivity /
-- getBoard), keeping the "browser never queries tables directly" posture intact.

create or replace function public.broadcast_task_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(to_jsonb(new), 'task', 'board', false);
  return new;
end;
$$;

drop trigger if exists task_broadcast on public.task;
create trigger task_broadcast
  after insert or update on public.task
  for each row execute function public.broadcast_task_change();

create or replace function public.broadcast_activity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(to_jsonb(new), 'activity', 'board', false);
  return new;
end;
$$;

drop trigger if exists activity_broadcast on public.activity;
create trigger activity_broadcast
  after insert on public.activity
  for each row execute function public.broadcast_activity_change();
