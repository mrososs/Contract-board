-- Live endpoint smoke-test gate before "Contract Ready".
--
-- The openapi-worker used to flip a task to Contract Ready the moment every
-- required endpoint was DECLARED in the spec. That only proves the contract was
-- written, not that it actually RUNS — a route can be in the spec yet return 500
-- / 404 on the deploy, so the board would announce a contract that's broken.
--
-- We now probe each required endpoint against the live API (safe probe: real GET
-- for parameter-free GETs, OPTIONS / no-body reachability for everything else)
-- before flipping. These columns record the last probe per endpoint so the drawer
-- can show which endpoint is failing and with what status.
alter table task_endpoint add column if not exists last_status     integer;
alter table task_endpoint add column if not exists last_checked_at timestamptz;
alter table task_endpoint add column if not exists health          text not null default 'unchecked';
  -- health: 'ok' | 'failed' | 'unchecked'

-- Activity-feed event for a failed contract check, so it renders with its own
-- label and never gets mistaken for a healthy Contract Ready. ADD VALUE is
-- idempotent via IF NOT EXISTS (same pattern as 0009).
alter type event_kind add value if not exists 'contract_check_failed';
