# ContractBoard

A live board that sits on top of **Figma + Azure DevOps + the backend's OpenAPI spec** and
auto-detects three handoff signals, so Design, Frontend and Backend always see what the other
tracks have finished — without anyone updating a status by hand.

1. **Design Ready** — detected from Figma Dev Mode "Ready for development".
2. **Contract Ready** — detected when an endpoint/DTO appears in the OpenAPI spec.
3. **Macro-status** — read from / written to Azure DevOps.

> **The signature idea:** three tracks (Design → Frontend → Backend) run in parallel and
> converge at the Frontend, which needs *both* a ready design and a ready contract before it can
> integrate. Each work item shows its three lane states at a glance, and "what's blocking what"
> is always obvious.

**Status:** live on Supabase + Azure DevOps (org **iSaned**). Azure work-item sync, auth, the
board, per-track claims with Azure write-back, Insights, and an installable desktop PWA are all
working. The Figma / OpenAPI auto-detection workers are the next milestone.

---

## How it works

```
Browser (Angular PWA, anon key)
        │  supabase.functions.invoke('azure-proxy', { op, payload })
        ▼
Supabase Edge Function  azure-proxy   ──Basic :PAT──►  Azure DevOps REST
        │  (PAT forwarded per request, never stored)
        ▼
Postgres (RLS)  ◄── service-role ──  sprint · task · app_user · activity · presence
```

- **Auth is identity-from-PAT.** You paste your Azure org URL + a Personal Access Token; the
  Edge Function asks Azure *who* the token belongs to. No passwords. The token is kept only on
  your device (so the installed app reopens signed-in) and cleared on sign-out.
- **Admin-driven sync.** An admin picks a Project + Sprint and pulls the sprint's story-level
  work items into Postgres; everyone then sees the same board. Members never pull.
- **Roles are a lens, not access.** Designer / Frontend / Backend / Lead-PM — picked once on
  first sign-in. FE/BE members **Start / Stop / Done** the stories they're working on, which
  reflects back to Azure under their own identity. Admin/PM is read-only oversight.

## Tech stack

| Layer        | Choice                                                          |
| ------------ | --------------------------------------------------------------- |
| Frontend     | Angular 21 — standalone components, **signals**, OnPush         |
| Monorepo     | Nx (integrated: `apps/` + `libs/`)                              |
| Backend      | **Supabase** — Postgres + RLS + Edge Functions (Deno)           |
| Integration  | Azure DevOps REST (live, via the Edge proxy)                    |
| Installable  | **PWA** — service worker + standalone manifest                  |
| Styling      | Global SCSS theme (CSS custom props) + scoped component styles  |

## Quick start

```bash
npm install

# Dev (note: the service worker / Install only work in a production build)
npx nx serve board                 # → http://localhost:4200

# Lint / type-check (build is the canonical compile check)
npx nx lint board
npx nx build board

# Installable PWA: build, then serve the prod output over http(s)
npx nx build board
npx nx serve-static board          # → http://localhost:4200  (click Install in the address bar)
```

**Log in:** Organization URL `dev.azure.com/iSaned` + an Azure **PAT** with Work Items
(read/write) and Project & Team (read) scopes. The admin then picks a Project + Sprint and hits
**Pull sprint**.

## Repo structure

```
apps/
  board/                 # the Angular PWA — routing, providers, global theme, manifest, icons
libs/
  data-access/           # domain models + signal stores (BoardStore, AuthStore) + SupabaseService
  ui/                    # presentational atoms (status pill, brand mark)
  feature-auth/          # login (PAT) + first-run role select
  feature-board/         # app shell, board views, My Work, Insights, task drawer, overlays
  azure/                 # typed Azure contract (logic now lives in the Edge Function)
  openapi-sync/          # OpenAPI poll + DTO diff — detect/diff real, poll = stub (next)
  figma-sync/            # Figma Dev-Mode poll + diff — detect real, poll = stub (next)
supabase/
  migrations/            # schema + RLS (0001), role (0003), start-work (0004)
  functions/azure-proxy/ # LIVE Azure DevOps proxy
  functions/{openapi,figma}-worker/  # stubs (next)
```

## Documentation

- [`supabase/README.md`](./supabase/README.md) — the database schema + Edge Functions.
- Architecture (`CLAUDE.md`), roadmap (`ROADMAP.md`) and the full product spec
  (`ContractBoard-Planning.md`) are maintained as working docs in the workspace (kept local,
  not committed).
