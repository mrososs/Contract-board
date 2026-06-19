# Supabase — ContractBoard backend

Postgres (schema + RLS) · Realtime · Edge Functions (the Azure / OpenAPI / Figma
proxies and workers). This directory is the source of truth for the database;
the Angular app reads it through `@supabase/supabase-js`.

```
supabase/
  config.toml              # local project + function settings
  migrations/
    0001_init.sql          # schema + RLS (tasks, mappings, snapshots, presence, tokens)
    0003_user_role.sql     # per-user board lens (app_user.role)
  functions/
    azure-proxy/           # Azure DevOps REST proxy — LIVE (identity, sprint pull, write-back)
    openapi-worker/        # poll spec → diff DTOs → Contract Ready/Changed (stub)
    figma-worker/          # poll Dev Mode → Design Ready/Changed (stub)
```

**Live project.** This backend is deployed to the `ContractBoard` Supabase project
(`agynsfjrhpabioiwjdpq`, region `eu-central-1`). The Angular app points at it via
`SUPABASE_CONFIG` in `apps/board/src/app/app.config.ts` (URL + public anon key). The
`azure-proxy` function holds no stored secret — the admin pastes their PAT at login and it
is forwarded per-request; the function uses the auto-injected service-role key for DB writes.
There is no demo seed: the board is populated by the admin pulling a real Azure sprint.

## Create the database

**Option A — via the Supabase MCP (preferred here).** It's registered in
`.mcp.json`. Restart Claude Code, run `/mcp`, authenticate `supabase`, then ask
Claude to create a project and apply `supabase/migrations/*`.

**Option B — Supabase CLI.**

```bash
supabase link --project-ref <your-ref>   # or `supabase start` for local
supabase db push                         # applies migrations/*
supabase functions deploy azure-proxy openapi-worker figma-worker
supabase secrets set AZURE_ADMIN_PAT=... FIGMA_TOKEN=... OPENAPI_SPEC_URL=...
```

## Wiring the app

Point the client at your project (anon key + URL), then replace the stub bodies
in `libs/azure`, `libs/openapi-sync`, `libs/figma-sync` with calls to the Edge
Functions above. The DB schema deliberately mirrors the app's domain model
(`libs/data-access/src/lib/models.ts`) so swapping demo data for live data is local.
