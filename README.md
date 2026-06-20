# ContractBoard

**A live board that connects Figma, Azure DevOps, and your backend's OpenAPI spec — and
automatically tells Design, Frontend, and Backend what the *other* tracks have finished, so nobody
has to ask, chase, or update a status by hand.**

A feature passes through three groups — Design draws the screens, Backend builds the API, Frontend
wires them together — and the *handoffs* between them are where time leaks: the endless "is it ready
yet?", stale tickets, starting too early, and silent breakage when a design or API changes after
handoff. ContractBoard removes that handoff tax by **detecting** each handoff signal at its source
instead of asking a human to relay it:

1. **Design Ready** — detected from Figma Dev Mode *"Ready for development."*
2. **Contract Ready** — detected when an endpoint/DTO appears in the OpenAPI spec.
3. **Macro-status** — read from / written back to Azure DevOps.

> **The signature idea:** three tracks (Design → Frontend → Backend) run in parallel and converge at
> the Frontend, which needs *both* a ready design and a ready contract before it can integrate. Each
> work item shows its three lane states at a glance, so **"what's blocking what" is always obvious.**

**Status:** live on Supabase + Azure DevOps (org **iSaned**). Azure work-item sync, identity-from-PAT
auth, the board, per-track claims with Azure write-back, Insights, and an installable desktop PWA are
all working. The **Figma** auto-detection worker is **live and scheduled** (every 5 min). The
**OpenAPI** worker is deployed but **not yet scheduled** — until it is, the contract track is driven
manually (paste links / map endpoints in the task drawer), which works end-to-end today.

---

## What you can do with it

- **See every task across all three tracks live** — Design / Frontend / Backend state per work item,
  with "what's blocked on what" called out (*waiting on design*, *waiting on backend*, *can scaffold*,
  *ready to integrate*).
- **Hand off without messaging anyone** — a designer marking a Figma frame ready, or a backend
  endpoint going live, flips the task automatically and notifies the Frontend.
- **Claim and move your own work** — Frontend/Backend members Start / Stop / Done their stories, which
  writes back to Azure *under their own identity*.
- **Generate typed API clients in one click** — `ng-openapi-gen` wrapper produces TS interfaces +
  Angular services from the current spec.
- **Get early warning on changes** — a design edit or a DTO change *after* handoff is flagged, so
  breakage is caught early, not in QA.
- **Raise a blocker when the contract is wrong** — if Frontend finds a *Contract Ready* endpoint is
  insufficient (e.g. missing DTO fields), they raise a blocker with a note. The task's Backend track
  drops back to **Building** for rework, the Frontend track shows **Blocked**, and the note stays as a
  banner + activity event until the backend fixes it — no separate bug ticket or Slack thread.
- **Install it like a desktop app** — a PWA that opens in its own window and reopens signed-in.

### Before / after

> **Before** — *FE:* "Is the endpoint ready?" → *BE:* "Let me check…" · *PM:* "Why is UC-12 stuck?"
> → opens Azure, opens Figma, messages two people, waits.
>
> **After** — *UC-12* shows Design **Ready** · Backend **Contract Ready** · Frontend **Ready to
> integrate** the moment it's true. The question is answered before it's asked.

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
        ▲
        │  scheduled workers poll + diff and flip task state
        └──  figma-worker (Figma Dev Mode)  ·  openapi-worker (/swagger.json)
```

- **Auth is identity-from-PAT.** You paste your Azure org URL + a Personal Access Token; the Edge
  Function asks Azure *who* the token belongs to. No passwords. The token is kept only on your device
  (so the installed app reopens signed-in) and cleared on sign-out.
- **Admin-driven sync.** An admin picks a Project + Sprint and pulls the sprint's story-level work
  items into Postgres; everyone then sees the same board. Members never pull.
- **Roles are a lens, not access.** Designer / Frontend / Backend / Lead-PM — picked once on first
  sign-in. FE/BE members **Start / Stop / Done** the stories they're working on, which reflects back
  to Azure under their own identity. Admin/PM is read-only oversight.
- **Handoffs are detected, not typed in.** The Figma worker flips tasks to *Design Ready*; the OpenAPI
  worker flips them to *Contract Ready* — so the board can't go stale.

## Tech stack

| Layer        | Choice                                                          |
| ------------ | --------------------------------------------------------------- |
| Frontend     | Angular 21 — standalone components, **signals**, OnPush         |
| Monorepo     | Nx (integrated: `apps/` + `libs/`)                              |
| Backend      | **Supabase** — Postgres + RLS + Edge Functions (Deno)           |
| Integration  | Azure DevOps REST (live) · Figma REST · OpenAPI spec (via Edge) |
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

**Log in:** Organization URL `dev.azure.com/iSaned` + an Azure **PAT** with Work Items (read/write)
and Project & Team (read) scopes. The admin then picks a Project + Sprint and hits **Pull sprint**.

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
  openapi-sync/          # OpenAPI poll + DTO diff — detect/diff real, poll = stub
  figma-sync/            # Figma Dev-Mode poll + diff — detect real, poll = stub
supabase/
  migrations/            # schema + RLS
  functions/azure-proxy/ # LIVE Azure DevOps proxy
  functions/{openapi,figma}-worker/  # poll + diff workers (figma scheduled; openapi pending)
```

## Documentation

- [`supabase/README.md`](./supabase/README.md) — the database schema + Edge Functions.
- [`HANDOFF-GUIDE.md`](./HANDOFF-GUIDE.md) — operational handoff guide.
- The deeper working docs are kept **local-only** (not committed): the project overview & business
  case (`docs/overview.md`), the per-role playbooks (`docs/roles/`) and design notes (`docs/design/`),
  plus the architecture (`CLAUDE.md`), roadmap (`ROADMAP.md`), and full product spec
  (`ContractBoard-Planning.md`).
