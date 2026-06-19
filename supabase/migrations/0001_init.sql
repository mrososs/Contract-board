-- ============================================================================
-- ContractBoard — initial schema
--
-- Two sources of truth, cleanly split (planning doc §1):
--   · Azure owns the MACRO-status (Active / Resolved / Closed) + Completed Work.
--   · Supabase owns the MICRO-workflow (design/fe/be states, presence), keyed by
--     the Azure work item id. We never invent a parallel status system.
--
-- Identity is derived from a PAT (no passwords). Tokens are stored encrypted and
-- are readable only by their owner. RLS is on for every table.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums — mirror libs/data-access/src/lib/models.ts so the app and DB agree.
-- ---------------------------------------------------------------------------
create type member_role     as enum ('designer', 'frontend', 'backend', 'pm');
create type design_state    as enum ('todo', 'design_wip', 'design_ready', 'design_changed');
create type frontend_state  as enum ('fe_blocked', 'fe_scaffold', 'fe_integration', 'fe_changed', 'fe_done');
create type backend_state   as enum ('be_wip', 'contract_ready', 'be_done');
create type event_kind      as enum (
  'design_ready', 'design_changed',
  'contract_ready', 'contract_changed',
  'fe_done', 'be_done', 'closed'
);

-- ---------------------------------------------------------------------------
-- People — identity resolved from the Azure PAT (planning doc §5).
-- ---------------------------------------------------------------------------
create table app_user (
  id                uuid primary key default gen_random_uuid(),
  auth_uid          uuid unique,                 -- supabase auth user, if linked
  azure_unique_name text unique not null,        -- resolved from connectionData
  display_name      text not null,
  is_admin          boolean not null default false,
  created_at        timestamptz not null default now()
);

-- A member's own PAT, encrypted. Only the owner may read it (TC-02, §5).
create table member_token (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_user(id) on delete cascade,
  org_url     text not null,
  pat_cipher  bytea not null,                    -- encrypt app-side / via vault
  scope       text not null default 'vso.work_write',
  created_at  timestamptz not null default now(),
  unique (user_id, org_url)
);

-- ---------------------------------------------------------------------------
-- Admin-set active project + sprint; the admin token pulls the whole board.
-- ---------------------------------------------------------------------------
create table sprint (
  id             uuid primary key default gen_random_uuid(),
  org_url        text not null,
  project        text not null,
  iteration_path text not null,
  is_active      boolean not null default true,
  set_by         uuid references app_user(id),
  created_at     timestamptz not null default now(),
  unique (org_url, project, iteration_path)
);

-- ---------------------------------------------------------------------------
-- Tasks — the Azure work item mirror + our micro-state (the "checkpoints").
-- PK is the Azure work item id so everything keys off Azure.
-- ---------------------------------------------------------------------------
create table task (
  id              bigint primary key,            -- Azure System.Id
  sprint_id       uuid not null references sprint(id) on delete cascade,
  uc              text,                           -- UC number parsed from title/tag
  title           text not null,
  macro_state     text,                           -- Azure: Active / Resolved / Closed
  assigned_to     text,                           -- Azure System.AssignedTo
  designer        text,
  fe_dev          text,
  be_dev          text,
  endpoint        text,
  design_state    design_state   not null default 'todo',
  frontend_state  frontend_state not null default 'fe_blocked',
  backend_state   backend_state  not null default 'be_wip',
  updated_at      timestamptz not null default now()
);
create index task_sprint_idx on task(sprint_id);

-- Convention-based mapping: UC number in a Figma frame / OpenAPI operationId
-- (TC-04/05/21). Fallback is a one-time manual mapping per task.
create table task_mapping (
  task_id              bigint primary key references task(id) on delete cascade,
  figma_node_id        text,
  figma_frame_name     text,
  openapi_operation_id text,
  is_manual            boolean not null default false,
  created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sync worker snapshots (planning doc §1: "spec & design snapshots").
-- ---------------------------------------------------------------------------
create table spec_snapshot (
  id          uuid primary key default gen_random_uuid(),
  sprint_id   uuid not null references sprint(id) on delete cascade,
  fetched_at  timestamptz not null default now(),
  operations  jsonb not null default '{}',        -- operationId -> flattened DTO fields
  is_stale    boolean not null default false       -- set on unreachable spec (TC-18)
);
create index spec_snapshot_sprint_idx on spec_snapshot(sprint_id, fetched_at desc);

create table design_snapshot (
  id            uuid primary key default gen_random_uuid(),
  task_id       bigint not null references task(id) on delete cascade,
  node_id       text not null,
  status        text not null,                     -- wip | ready | changed | unknown
  last_modified timestamptz,
  fetched_at    timestamptz not null default now()
);
create index design_snapshot_task_idx on design_snapshot(task_id, fetched_at desc);

-- Detected state transitions / diffs (drives the Realtime notifications feed).
create table activity (
  id         uuid primary key default gen_random_uuid(),
  task_id    bigint references task(id) on delete cascade,
  kind       event_kind not null,
  actor      text,
  message    text not null,
  payload    jsonb,                                -- e.g. the DTO diff
  created_at timestamptz not null default now()
);
create index activity_created_idx on activity(created_at desc);

-- ---------------------------------------------------------------------------
-- Presence — private per-user rows (TC-02: User A cannot read User B's rows).
-- ---------------------------------------------------------------------------
create table presence (
  user_id    uuid not null references app_user(id) on delete cascade,
  task_id    bigint not null references task(id) on delete cascade,
  status     text not null,                        -- viewing | editing | away
  updated_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table app_user      enable row level security;
alter table member_token  enable row level security;
alter table sprint        enable row level security;
alter table task          enable row level security;
alter table task_mapping  enable row level security;
alter table spec_snapshot enable row level security;
alter table design_snapshot enable row level security;
alter table activity      enable row level security;
alter table presence      enable row level security;

-- The whole team sees the board (that's the point — everyone sees every lane).
-- Read access for any authenticated session:
create policy board_read_tasks    on task          for select to authenticated using (true);
create policy board_read_mappings on task_mapping  for select to authenticated using (true);
create policy board_read_sprint   on sprint        for select to authenticated using (true);
create policy board_read_spec     on spec_snapshot for select to authenticated using (true);
create policy board_read_design   on design_snapshot for select to authenticated using (true);
create policy board_read_activity on activity      for select to authenticated using (true);
create policy board_read_users    on app_user      for select to authenticated using (true);

-- A member may only read / write their OWN token and presence rows.
create policy own_token   on member_token for all to authenticated
  using (user_id = (select id from app_user where auth_uid = auth.uid()))
  with check (user_id = (select id from app_user where auth_uid = auth.uid()));

create policy own_presence on presence for all to authenticated
  using (user_id = (select id from app_user where auth_uid = auth.uid()))
  with check (user_id = (select id from app_user where auth_uid = auth.uid()));

-- Writes to the shared board come through the service-role Edge Functions
-- (azure-proxy / workers), which bypass RLS — so no broad write policy here.
