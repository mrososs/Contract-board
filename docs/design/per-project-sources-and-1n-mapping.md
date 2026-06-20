# Design — Per-project sources + N:N task mapping

**Status:** Draft for review · **Branch:** `design/per-project-sources` · **Author:** design pass, 2026-06-20

This document designs three related changes to ContractBoard's sync layer:

1. **Per-project sources** — each Azure project carries its **own** OpenAPI spec URL and Figma
   file; the workers poll and match per project, not from one global pair of secrets.
2. **N:N task mapping** — a task can require **multiple** OpenAPI endpoints **and** multiple
   Figma screens; Contract/Design Ready means *all of them* are present.
3. **Admin Settings panel** — a dedicated admin-only UI to configure each project's sources,
   completely separate from the *Pull Sprint* dialog.

It is a design only — no code is changed here. See [`../../HANDOFF-GUIDE.md`](../../HANDOFF-GUIDE.md)
for how the sync flow works today and [`../../ISSUES.md`](../../ISSUES.md) for the broader backlog.

---

## 1. Goals / non-goals

**Goals**
- Configure OpenAPI spec URL + Figma file **per Azure project**, in the UI, by an admin.
- A task can map to **many** endpoints and **many** frames; the ready gates aggregate over all.
- Workers poll **every configured, active project** each run and match that project's tasks
  against that project's sources only.
- Keep the security posture: **the browser never queries tables directly**, secrets never reach
  the client, and per-project tokens are stored in **Supabase Vault**, not plain columns.

**Non-goals (this pass)**
- Pixel-level Figma diffing (still file-`version` based, per §9.7 of the planning doc).
- Auto-discovering which endpoints/frames belong to a task without *some* signal (UC tag or a
  manual mapping). We improve the manual path; the convention stays the zero-config default.
- Changing the Azure macro-status flow (Start/Stop/Done) — unaffected.

---

## 2. Current state (what we're changing)

| Area | Today | Limitation |
| --- | --- | --- |
| Sources | `OPENAPI_SPEC_URL`, `FIGMA_TOKEN`, `FIGMA_FILE_KEY` are **global Supabase secrets** | One spec + one Figma file for the *whole app*; can't serve two projects |
| Active sprint | `pullSprint` sets `is_active=false` on **all other** sprints → exactly **one** active sprint app-wide | The board shows one project at a time; workers only ever see one project's tasks |
| Mapping | `task_mapping.task_id` is the **PRIMARY KEY** → strict **1:1** task↔operation and task↔frame | A task needing 3 endpoints + 2 screens cannot be modeled |
| Ready gate | First mapped op appears → `contract_ready`; first ready frame → `design_ready` | "Ready" can't mean "all N parts are in" |
| Config UI | None — secrets set via CLI | Admin can't self-serve; no per-project anything |

Relevant code: `supabase/functions/openapi-worker/index.ts`, `figma-worker/index.ts`,
`azure-proxy/index.ts` (`pullSprint`, `getBoard`, `getActivity`), `libs/data-access/board-store.ts`.

---

## 3. Target model (overview)

```
Org (dev.azure.com/iSaned)
 └─ Project "Visits Management System"
     ├─ project_source: openapi_spec_url, figma_file_key, (vault) figma_token, openapi_auth
     ├─ active sprint  → tasks
     │                     ├─ task_endpoint[]  (UC-12 → createBooking, refundBooking, ...)
     │                     └─ task_screen[]    (UC-12 → frame A, frame B, ...)
 └─ Project "Saned System - Version 03"
     ├─ project_source: (its own spec + figma file)
     └─ active sprint  → tasks → endpoints[] / screens[]

Contract Ready(task) = every required task_endpoint is present in the project's latest spec
Design  Ready(task) = every required task_screen is READY_FOR_DEV in the project's Figma file
```

Two structural shifts:
- **Active sprint becomes per-project** (one active sprint *per project*, not one app-wide).
- **Sources and snapshots become per-project**, keyed by `(org_url, project)`.

---

## 4. Data model changes

### 4.1 New: `project_source` (per-project config)

```sql
create table project_source (
  id              uuid primary key default gen_random_uuid(),
  org_url         text not null,
  project         text not null,
  openapi_spec_url text,                       -- public or behind auth (see 4.5)
  openapi_auth_ref text,                        -- vault secret name for a bearer/header, nullable
  figma_file_key  text,
  figma_token_ref text,                         -- vault secret name for the Figma PAT, nullable
  poll_enabled    boolean not null default true,
  poll_interval_s integer not null default 300,
  updated_by      uuid references app_user(id),
  updated_at      timestamptz not null default now(),
  unique (org_url, project)
);
alter table project_source enable row level security;   -- no anon/authenticated policies; service-role only
```

- Keyed by `(org_url, project)` — the same identity `sprint` already uses.
- **No secret values in columns** — only *references* (`*_ref`) to Supabase Vault entries (§4.5).
- RLS on with no client policies, consistent with the "browser never reads tables" rule.

### 4.2 Active sprint becomes per-project

Today `pullSprint` does:
```ts
await db.from('sprint').update({ is_active: false }).neq('iteration_path', iterationPath);
```
That deactivates sprints in **all** projects. Change it to scope by project:
```ts
await db.from('sprint').update({ is_active: false })
  .eq('org_url', orgUrl).eq('project', project)        // only this project's other sprints
  .neq('iteration_path', iterationPath);
```
Result: each project can have its own active sprint simultaneously. `getBoard` then returns
**all** active sprints (one per project) and the board groups/filters by project (§7).

> Migration note: existing data has one active sprint (`Visits Management System`). After the
> change, re-pulling `Saned System - Version 03` would leave **both** active — intended.

### 4.3 `task_mapping` → N:N (`task_endpoint` + `task_screen`)

Drop the 1:1 `task_mapping` table; replace with two purpose tables (clearer than one row with
both an operation and a node). **Recommended:**

```sql
create table task_endpoint (
  id            uuid primary key default gen_random_uuid(),
  task_id       bigint not null references task(id) on delete cascade,
  operation_id  text   not null,               -- e.g. createUC12Booking
  endpoint      text,                            -- "POST /uc-12/bookings", filled on detect
  is_required   boolean not null default true,   -- counts toward the ready gate
  is_manual     boolean not null default false,  -- true → workers won't auto-remove it
  present       boolean not null default false,  -- last seen in the spec?
  last_diff     jsonb,                            -- last DtoDiff when it changed
  updated_at    timestamptz not null default now(),
  unique (task_id, operation_id)
);

create table task_screen (
  id            uuid primary key default gen_random_uuid(),
  task_id       bigint not null references task(id) on delete cascade,
  node_id       text   not null,
  frame_name    text,
  is_required   boolean not null default true,
  is_manual     boolean not null default false,
  status        text   not null default 'unknown',  -- wip | ready | changed | unknown
  fingerprint   text,                                -- figma file version at last observation
  updated_at    timestamptz not null default now(),
  unique (task_id, node_id)
);
```

- `unique(task_id, operation_id)` / `(task_id, node_id)` replaces the old single-row PK — many
  rows per task now.
- `is_manual` carries the planning-doc "manual override (B2)" forward per-row: an admin-pinned
  mapping the worker must not auto-delete.
- `present` / `status` let the gate compute "X of Y ready" without re-reading snapshots.

> **Alternative considered:** one unified `task_link(kind, ref, …)` table with a `kind in
> ('endpoint','screen')` discriminator. Rejected: endpoints and screens carry different
> attributes (`endpoint`/`last_diff` vs `node_id`/`fingerprint`), so two tables stay cleaner and
> avoid nullable sprawl. Open to revisiting.

### 4.4 Snapshots stay per-project

`spec_snapshot` is already keyed by `sprint_id`; since the active sprint is now per-project this
is naturally per-project. `design_snapshot` is keyed by `task_id` (unchanged). No structural
change needed — just ensure the worker writes one `spec_snapshot` per project per run.

### 4.5 Secret handling (Supabase Vault) — important

Storing a Figma PAT or an OpenAPI bearer in a plain text column would break the "no stored
secret" posture. Use **Supabase Vault**:
- Admin enters the token in the Settings UI → `azure-proxy` writes it to Vault under a name like
  `figma_token::<org>::<project>` and stores only that **name** in `project_source.figma_token_ref`.
- Workers read the secret by name from Vault at run time (service-role).
- The token value is **never** returned to the client; the UI shows only "configured / not
  configured" + a "replace" action.

OpenAPI specs that are public (most swagger endpoints) need no token — `openapi_auth_ref` is null.

---

## 5. Worker changes

### 5.1 `openapi-worker`

```
for each project_source where poll_enabled:
  spec = fetch(openapi_spec_url, auth from vault if openapi_auth_ref)   # skip/stale on failure
  ops  = flattenSpec(spec)                                              # unchanged
  activeSprint = active sprint for (org_url, project)
  tasks = tasks in that sprint
  # 1) auto-convention (zero-config): every op whose UC matches a task →
  #    upsert task_endpoint(is_manual=false). Multiple ops sharing UC-12 → multiple rows. (1:N!)
  # 2) for each task_endpoint of each task:
  #       present = operation_id in ops
  #       if newly present:  set present=true, endpoint=..., (maybe) activity 'endpoint_ready'
  #       if present and DTO changed vs snapshot: last_diff=diff, activity 'contract_changed'
  #       if was present and now missing (non-manual): mark not present (or prune)
  # 3) recompute task.backend_state from the aggregate (see §6)
  write spec_snapshot for this project
```

Key point: the **UC convention already supports 1:N** — if the backend tags three operations
`UC-12` (in `operationId`/tag/path), all three become `task_endpoint` rows for the UC-12 task.
Manual mapping (§7) is only for when the convention can't express it.

### 5.2 `figma-worker`

- `collectFrames` currently keeps the **first** node per UC. Change to collect **all** UC-named
  nodes → one `task_screen` per frame (1:N).
- Per project: read `figma_file_key` + token from Vault; poll that file only.
- A frame flips `status`; the task's `design_state` is recomputed from the aggregate (§6).

### 5.3 Scheduling

One pg_cron entry per worker that **loops all enabled projects** internally (preferred — single
schedule, simpler), or the cron passes a `project` arg and we schedule per project. Recommend the
internal loop so adding a project needs no new cron.

---

## 6. Ready-gate logic (aggregate over N)

Replace the "first one wins" flips with an aggregate computed after each run:

```
required_eps = task_endpoint where is_required
contract_ready = required_eps non-empty AND all present
contract_partial = some present but not all          → show "k/n endpoints"
contract_changed = any present endpoint has a fresh last_diff after it was ready

required_frames = task_screen where is_required
design_ready = required_frames non-empty AND all status='ready'
design_changed = any required frame status='changed'
```

- `backend_state`: `be_wip` → `contract_ready` only when **all** required endpoints present;
  otherwise stays `be_wip` but the board shows a "2/3 endpoints" sub-label.
- `deriveConv()` in `libs/data-access/tokens.ts` keeps deciding convergence from
  `design_state`/`backend_state`; only the *inputs* now come from the aggregate.
- Activity rows gain granularity: `endpoint_ready` (one of N) vs `contract_ready` (all N). The
  feed can say "Booking endpoint ready (2/3)".

---

## 7. Backend API (`azure-proxy`) — new ops

All service-role, admin-gated where noted (admin check already exists via `ADMIN_EMAILS`):

| Op | Who | Purpose |
| --- | --- | --- |
| `listProjectSources` | admin | list configured sources (token shown as configured/not, never the value) |
| `setProjectSource` | admin | upsert spec URL / figma file key + poll settings; writes tokens to Vault |
| `clearProjectSecret` | admin | remove a Vault token reference |
| `testOpenApiSource` | admin | fetch the spec once, return op count / error (connection test) |
| `testFigmaSource` | admin | fetch the file once, return frame count / error |
| `listTaskLinks` | member | endpoints + screens for a task (for the drawer editor) |
| `setTaskEndpoint` / `setTaskScreen` | member/admin | add/edit a manual mapping (`is_manual=true`) |
| `deleteTaskLink` | member/admin | remove a manual mapping |

`getBoard` changes to return **all** active sprints (one per project) plus, per task, its
endpoint/screen aggregate counts. `getActivity` already reads the active sprint — extend to all
active sprints.

---

## 8. Frontend changes

> Implementation will go through the `/angular-developer` skill and follow the repo conventions:
> standalone components, `ChangeDetectionStrategy.OnPush`, signal `input()`s, state in
> `BoardStore`/a new store, `cb-` selector prefix, color+label (never color alone).

### 8.1 Admin Settings panel (new, admin-only) — separate from Pull

- New nav entry **Settings** (gated `isAdmin()`), opening a screen (state-driven via
  `BoardStore.nav()`, consistent with the no-child-routes rule).
- Lists projects (from `listProjects` / known sprints). For each: OpenAPI spec URL field, Figma
  file key field, "token configured ✓ / set token" actions, poll on/off + interval, and
  **Test connection** buttons hitting `testOpenApiSource` / `testFigmaSource`.
- Saves via `setProjectSource`. Never displays secret values.

### 8.2 Per-task mapping editor (task drawer)

- In `task-detail`, an "Endpoints & Screens" section listing `task_endpoint` / `task_screen`
  rows with present/ready badges, plus add/remove (manual) controls (`setTaskEndpoint`, etc.).
- Read-only for the PM/admin lens on task *state* (consistent with current rules), but admin may
  edit mappings.

### 8.3 Multi-project board

- Because multiple sprints can now be active, the board needs a **project switcher** (or grouped
  lanes by project). Minimal first version: a project dropdown in the app shell that filters the
  decorated tasks by `project`; `BoardStore` gains a `selectedProject` signal feeding the
  existing computeds.

### 8.4 Store

- `BoardStore` (or a new `SourcesStore`) holds `projectSources`, `selectedProject`, and the
  per-task link aggregates; components stay thin and read signals.

---

## 9. Migration & rollout order

1. **Migration `0007_per_project_sources`:** create `project_source`; create `task_endpoint` +
   `task_screen`; backfill from existing `task_mapping` (one row each where set); keep
   `task_mapping` temporarily as a view or drop after workers cut over; RLS on all.
2. **Per-project active sprint:** change `pullSprint`'s deactivation scope (§4.2). Backwards
   compatible — current single active sprint keeps working.
3. **Workers:** update `openapi-worker` + `figma-worker` to loop `project_source` and use
   `task_endpoint`/`task_screen` + the aggregate gate. Behind `poll_enabled` so a project with no
   source configured is simply skipped (today's safe no-op behavior preserved).
4. **`azure-proxy` ops** (§7) + Vault wiring.
5. **Frontend:** Settings panel → per-task editor → multi-project board (can ship incrementally).
6. **Deprecate** the global `OPENAPI_SPEC_URL` / `FIGMA_FILE_KEY` secrets once every active
   project has a `project_source` row (keep `FIGMA_TOKEN` only if you want one shared token).

Each step is independently shippable; the workers stay safe no-ops for unconfigured projects.

---

## 10. Open questions / decisions for review

1. **One shared Figma token or per-project?** Per-project in Vault is most flexible; if every
   project lives in one Figma org, a single shared token + per-project file key is simpler. The
   schema supports both (`figma_token_ref` nullable → fall back to a shared `FIGMA_TOKEN`).
2. **`is_required` semantics.** Should an endpoint default to required (counts toward the gate)
   or optional until an admin marks it required? Draft assumes required-by-default for
   convention-matched ops.
3. **Auto-prune.** When a non-manual endpoint disappears from the spec, do we delete the
   `task_endpoint` row or keep it as "was present, now missing" (a regression signal)? Draft
   keeps it and flags it.
4. **Multi-project board UX.** Switcher vs. grouped lanes vs. an "all projects" overview. Draft
   recommends a switcher first.
5. **Partial-ready state.** Add an explicit `backend_state` value (e.g. `be_partial`) or keep
   `be_wip` + a sub-label? Draft keeps the enum and uses a sub-label to avoid an enum migration.

---

## 11. Test cases (additions)

- **TC-N1** Two operations tagged `UC-12` → two `task_endpoint` rows; task flips Contract Ready
  only when **both** are present; "1/2" shown in between.
- **TC-N2** Two projects each with their own spec → worker matches each project's tasks against
  *its own* spec only; no cross-project leakage.
- **TC-N3** Project B has no `project_source` → worker skips it, no errors (safe no-op).
- **TC-N4** Manual endpoint mapping (`is_manual=true`) survives a worker run that doesn't see it
  in the convention scan.
- **TC-N5** Figma file with two `UC-12` frames → both become `task_screen`; Design Ready needs
  both `ready`.
- **TC-N6** Secret stored in Vault is never returned by `listProjectSources` (only configured
  flag).
- **TC-N7** Re-pulling project B leaves project A's sprint active too (per-project active sprint).
```
