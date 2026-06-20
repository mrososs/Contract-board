-- ============================================================================
-- ContractBoard — per-project sources + N:N task mapping
--
-- Three changes (see docs/design/per-project-sources-and-1n-mapping.md):
--   1. project_source — each Azure project carries its OWN OpenAPI spec URL and
--      Figma file; the workers poll/match per project, not from global secrets.
--      Secrets (Figma PAT, OpenAPI bearer) are stored in Supabase Vault; only the
--      Vault secret NAME lives in a column — never the value.
--   2. task_endpoint / task_screen — a task may require MANY endpoints and MANY
--      frames; the Contract/Design Ready gates aggregate over all required rows.
--      (Replaces the strict 1:1 task_mapping; that table is kept until the
--      workers cut over, then dropped in a later migration.)
--   3. Active sprint becomes per-project (enforced in azure-proxy.pullSprint, not
--      here) so projects coexist on the board.
--
-- Additive + backwards compatible: existing task_mapping rows are backfilled and
-- the old table is left in place, so the currently-deployed workers keep working
-- until the new ones are deployed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Granular activity kinds — a single endpoint/frame becoming ready (one of N),
-- distinct from the aggregate contract_ready / design_ready (all N ready).
-- ADD VALUE is idempotent via IF NOT EXISTS and is not used within this file.
-- ---------------------------------------------------------------------------
alter type event_kind add value if not exists 'endpoint_ready';
alter type event_kind add value if not exists 'screen_ready';

-- ---------------------------------------------------------------------------
-- 1) Per-project sources. Keyed by (org_url, project) — the same identity the
--    sprint table uses. RLS on with NO client policies: only the service-role
--    Edge Functions (azure-proxy / workers) read or write it.
-- ---------------------------------------------------------------------------
create table project_source (
  id               uuid primary key default gen_random_uuid(),
  org_url          text not null,
  project          text not null,
  openapi_spec_url text,                                  -- public, or behind auth (openapi_auth_ref)
  openapi_auth_ref text,                                  -- Vault secret NAME for a bearer/header (nullable)
  figma_file_key   text,
  figma_token_ref  text,                                  -- Vault secret NAME for the Figma PAT (nullable → shared FIGMA_TOKEN)
  poll_enabled     boolean not null default true,
  poll_interval_s  integer not null default 300,
  updated_by       uuid references app_user(id),
  updated_at       timestamptz not null default now(),
  unique (org_url, project)
);

-- ---------------------------------------------------------------------------
-- 2) N:N mapping. Many endpoints / many frames per task. `is_required` rows
--    count toward the ready gate; `is_manual` rows are admin-pinned and the
--    workers must not auto-remove them (planning doc "manual override", B2).
-- ---------------------------------------------------------------------------
create table task_endpoint (
  id           uuid primary key default gen_random_uuid(),
  task_id      bigint not null references task(id) on delete cascade,
  operation_id text   not null,                           -- e.g. createUC12Booking
  endpoint     text,                                       -- "POST /uc-12/bookings", filled on detect
  is_required  boolean not null default true,
  is_manual    boolean not null default false,
  present      boolean not null default false,             -- last seen in the spec?
  last_diff    jsonb,                                       -- last DtoDiff when it changed
  updated_at   timestamptz not null default now(),
  unique (task_id, operation_id)
);
create index task_endpoint_task_idx on task_endpoint(task_id);
create index task_endpoint_op_idx   on task_endpoint(operation_id);

create table task_screen (
  id          uuid primary key default gen_random_uuid(),
  task_id     bigint not null references task(id) on delete cascade,
  node_id     text   not null,
  frame_name  text,
  is_required boolean not null default true,
  is_manual   boolean not null default false,
  status      text   not null default 'unknown',          -- wip | ready | changed | unknown
  fingerprint text,                                         -- figma file version at last observation
  updated_at  timestamptz not null default now(),
  unique (task_id, node_id)
);
create index task_screen_task_idx on task_screen(task_id);
create index task_screen_node_idx on task_screen(node_id);

-- ---------------------------------------------------------------------------
-- 3) Backfill the new tables from the existing 1:1 task_mapping rows.
-- ---------------------------------------------------------------------------
insert into task_endpoint (task_id, operation_id, is_manual, present)
  select task_id, openapi_operation_id, is_manual, true
  from task_mapping
  where openapi_operation_id is not null
on conflict (task_id, operation_id) do nothing;

insert into task_screen (task_id, node_id, frame_name, is_manual, status)
  select task_id, figma_node_id, figma_frame_name, is_manual, 'unknown'
  from task_mapping
  where figma_node_id is not null
on conflict (task_id, node_id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table project_source enable row level security;     -- service-role only (holds secret refs)
alter table task_endpoint  enable row level security;
alter table task_screen    enable row level security;

-- The board's link rows are readable by any authenticated session, mirroring the
-- task_mapping read policy (writes still come through the service-role functions).
create policy board_read_endpoints on task_endpoint for select to authenticated using (true);
create policy board_read_screens   on task_screen   for select to authenticated using (true);

-- project_source gets NO read policy: secret references are service-role only.
