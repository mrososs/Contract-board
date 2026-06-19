# ContractBoard

A live board that sits on top of **Figma + Azure DevOps + the backend's OpenAPI spec** and
auto-detects three handoff signals so Design, Frontend and Backend always see what the other
tracks have finished:

1. **Design Ready** — detected from Figma Dev Mode "Ready for development".
2. **Contract Ready** — detected when an endpoint/DTO appears in the OpenAPI spec.
3. **Macro-status** — read from / written to Azure DevOps.

The signature idea: three tracks (Design → Frontend → Backend) run in parallel and converge at
the Frontend, which needs *both* a ready design and a ready contract before it can integrate.
See `ContractBoard-Planning.md` for the full product spec, state machine, and test cases.

> Status: **live on Supabase + Azure DevOps (org `iSaned`)**. Login is identity-from-PAT
> (org URL + token) resolved through the deployed `azure-proxy` Edge Function; the admin
> (`mohamed.osama`) picks a Project/Sprint and pulls real work items into Postgres. Supabase
> project `ContractBoard` (`agynsfjrhpabioiwjdpq`); client config in `app.config.ts`. The
> **OpenAPI / Figma** sync workers (`libs/openapi-sync`, `libs/figma-sync` + the `*-worker`
> functions) are still stubs, so the Design/Contract track micro-states sit at defaults until
> wired — only the Azure macro-status is live today.

## Tech stack

| Layer            | Choice                                              |
| ---------------- | --------------------------------------------------- |
| Frontend         | Angular 21 — standalone components, **signals**     |
| Monorepo         | Nx (integrated, `apps/` + `libs/`)                  |
| Styling          | Global SCSS theme + scoped component styles         |
| Installable      | PWA (`@angular/service-worker`, web manifest)       |
| Backend (target) | Supabase — Postgres + Auth + RLS + Realtime + Edge  |
| Type generation  | `ng-openapi-gen` (wrapped) — preview UI implemented |

## Commands

Run everything through Nx (it caches and respects project graph). Use `npx nx …`:

```bash
npx nx serve board            # dev server  → http://localhost:4200
npx nx build board            # production build (emits service worker)
npx nx test board             # unit tests (Vitest)
npx nx lint board             # ESLint
npx nx run-many -t lint test  # all projects
npx nx graph                  # project dependency graph
```

The service worker is only active in production builds (`isDevMode()` gate in `app.config.ts`).
To smoke-test PWA/install: `npx nx build board` then serve `dist/apps/board/browser` over HTTP.

## Workspace structure

```
apps/
  board/                 # the Angular PWA — routing, providers, global theme, manifest
libs/
  data-access/           # MODELS + signal STORES + demo data (the brain)
  ui/                    # pure presentational atoms (status pill, brand mark)
  feature-auth/          # Login screen (identity-from-token, no passwords)
  feature-board/         # app shell + board screens + overlays (the app)
  azure/                 # Azure DevOps client (via Supabase Edge proxy) — stub
  openapi-sync/          # OpenAPI poll + DTO diff worker — stub
  figma-sync/            # Figma Dev-Mode status poll + diff worker — stub
```

TypeScript path aliases (`tsconfig.base.json`) — always import across libs via these, never deep paths:

- `@contract-board/data-access`
- `@contract-board/ui`
- `@contract-board/feature-auth`
- `@contract-board/feature-board`
- `@contract-board/azure` · `@contract-board/openapi-sync` · `@contract-board/figma-sync`

## Architecture & conventions

- **State lives in signal stores in `data-access`**, not in components:
  - `BoardStore` — single source of truth for the board: raw UI state as `signal()` (role, nav,
    layout, override, selected task, modal, toast) and everything else as `computed()`
    (decorated tasks, per-role My-Work groups, lanes, convergence groups, insights metrics,
    selected-task detail). All the prototype's `buildTasks` / `buildMyGroups` logic ported here.
  - `AuthStore` — identity from a PAT (the role picker stands in for token resolution). **Never
    store a password.** `signIn(role)` seeds the board; `signOut()` resets it.
- **Components are thin**: `inject(BoardStore)`, read signals in the template. All are
  `standalone`, `ChangeDetectionStrategy.OnPush`, signal `input()`s. Selector prefix `cb-`.
- **The board is state-driven, not route-driven** (matches the prototype). Only two real routes
  exist — `/login` and `/app` (guarded by `authGuard`). Inside `/app`, the `AppShell` switches
  screens on `BoardStore.nav()`; the task drawer / modal / toast are overlays driven by store
  signals. Don't add child routes for My-Work/Board/Insights unless deep-linking is required.
- **Styling**: design tokens are CSS custom properties on `:root` in `apps/board/src/styles.scss`
  (palette `--cb-*`, fonts `--xp-serif`/`--xp-sans`, motion `--xp-ease`). Templates use inline
  `style="…"` for one-off static layout and bound `[style.x]` for dynamic values; repeated/hover
  and stateful styles live in component SCSS or the global `.cb-hover-*` helpers. State is always
  communicated by **color + label**, never color alone (accessibility).
- **Status pills**: render via `<cb-status-pill>` with resolved `label/fg/bg` tokens from
  `pill()` / `conv()` in `data-access/tokens.ts`. Track accent colors: Design `#3BA7B3` (cyan),
  Frontend `#CBA86E` (gold), Backend `#7FB07F` (green), alert/changed `#D9885F` (orange).

## Domain model (libs/data-access)

- `Role` = designer | frontend | backend | pm — a *lens*, not an access level.
- A `Task` carries three independent track states + a derived `conv` (convergence) state that
  answers "what's this blocked on?": `DesignState`, `FrontendState`, `BackendState`, `ConvKey`.
- `DecoratedTask` = `Task` + resolved pill tokens + `open()` handler (built in `BoardStore.tasks`).
- Live tasks: `BoardStore.rawTasks` is filled from the `azure-proxy` `getBoard`/`pullSprint`
  ops (the Postgres mirror of an Azure sprint). `conv` is computed by `deriveConv()` in
  `tokens.ts` (the planning-doc gate), since live rows don't carry a precomputed convergence.
  Identity (name/initials) comes from the resolved session, not `roleInfo()` — role is the lens.

## Integration layer

- **Azure — LIVE.** All Azure traffic goes through the deployed `azure-proxy` Edge Function
  (`supabase/functions/azure-proxy`), invoked from the app via `SupabaseService`
  (`@contract-board/data-access`). Ops: `resolveIdentity`, `setRole`, `listProjects`,
  `listIterations`, `pullSprint` (WIQL → batch → upsert), `getBoard`, `startWork`, `setState`,
  `addCompletedWork` (additive — never clobbers PM estimates). The PAT is forwarded
  per-request (never stored); DB writes use the auto-injected service-role key. The typed
  `AzureClient` (`libs/azure`) now only documents the contract for the worker layer.
  - `pullSprint` pulls **story-level items only** — WIQL `IN GROUP 'Microsoft.RequirementCategory'`
    (User Story / Product Backlog Item / Requirement; iSaned = Scrum → PBIs), capped at 200 ids.
  - `startWork` lets a FE/BE member **claim** a story (per-track `*_started_by`); their My Work
    splits into Working-on / Available-to-start / Taken-by-team. Supabase-only for now.

The remaining workers describe real contracts but return mocked data:
- `OpenApiSyncService` (`libs/openapi-sync`) — `detectContractReady()` + field-level `diffOperation()`
  are real; `pollSpec()` is a stub. This is what flips a task to Contract Ready.
- `FigmaSyncService` (`libs/figma-sync`) — `isReady()` + `detectChanged()` are real; `pollDesignStatus()`
  is a stub. Flips a task to Design Ready / Design Changed.

## Gotchas

- The `anyComponentStyle` budget in `apps/board/project.json` is raised to 24 kB (error) because
  the dark theme is style-heavy. Keep large surfaces in the global theme, not per component.
- Inline SVG icons in templates are written as literal markup (not `[innerHTML]`) to avoid the
  Angular sanitizer stripping attributes.
- `npx nx build board` runs the full Angular type-check — use it as the canonical "does it compile".

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
