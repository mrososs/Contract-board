# ContractBoard — Issues & Fix List

A trackable list of everything worth fixing or finishing, found from a full read of the codebase
(data-access, UI/feature layer, integration layer, Supabase backend). Tick items off as we solve
them. See [`ROADMAP.md`](./ROADMAP.md) for the high-level plan and [`CLAUDE.md`](./CLAUDE.md) for
architecture.

_Last updated: 2026-06-20._

**Severity:** 🔴 blocking / core · 🟠 important · 🟡 quality / maintainability · 🟢 nice-to-have

> **Progress (2026-06-20):** Worked the suggested order. Done this pass — **B1, B2, B3, B4,
> A1, A2, A3, A5, A7, A8**. Edge Functions `openapi-worker` + `figma-worker` are deployed
> (v1) and `azure-proxy` redeployed (v6, adds `getActivity` + `ADMIN_EMAILS`); migrations
> `0005` (sync) + `0006` (realtime broadcast) applied. `npx nx build board` ✅,
> `npx nx vite:test data-access` ✅ (19 tests), lint ✅ (warnings only).
>
> **To go fully live, set these Supabase secrets + schedule the workers** (no code change
> needed): `OPENAPI_SPEC_URL`, `FIGMA_TOKEN`, `FIGMA_FILE_KEY`, `ADMIN_EMAILS`. Then add a
> pg_cron schedule hitting the two workers (see B1). Until then the workers no-op safely and
> the admin still resolves via the fallback in `azure-proxy`.
> **Note:** the live sprint's stories have no `UC-N` in their titles, so UC auto-mapping (B2)
> binds nothing yet — give stories `UC-N` titles or add a manual mapping for the workers to flip.

---

## Part A — Problems to fix (quality · security · a11y · tests)

### A1. Hard-coded admin email 🟠 — ✅ done
- [x] **Where:** `supabase/functions/azure-proxy/index.ts` (now `ADMIN_EMAILS`)
- **Resolved:** reads `ADMIN_EMAILS` (comma-separated) from env; falls back to the original
  owner so a deploy can't lock the admin out before the secret is set. Set the `ADMIN_EMAILS`
  secret, after which the fallback literal can be removed. Deployed (azure-proxy v6).
- **Problem:** The admin identity is baked into source (`'mohamed.osama@obeikan.com.sa'`). Anyone
  reading the repo learns who the admin is, and changing/adding an admin needs a code edit + redeploy.
- **Fix:** Read from an env var: `const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? '';` (set the
  secret via the Supabase dashboard / MCP). Document it in [`supabase/README.md`](./supabase/README.md).

### A2. Accessibility — clickable `<div>`s + no keyboard support 🟠 — ✅ done
- [x] **Resolved:** every clickable card/row now has `role="button"`, `tabindex="0"`,
  `aria-label`, and `(keydown.enter)`/`(keydown.space)` → a shared `activate()` helper
  (preventDefault + open) in `my-work`, `board-view`, `insights`.
- **Where:** clickable `<div>` cards (no `role`, no keyboard handler, just `cursor: pointer`):
  - `libs/feature-board/src/lib/board-view/board-view.html:83` (lanes card), `:112` (matrix row), `:138` (convergence card)
  - `libs/feature-board/src/lib/my-work/my-work.html:24` (task card)
  - `libs/feature-board/src/lib/insights/insights.html:90` (blocked task)
- **Problem:** Confirmed **0** occurrences of `role="button"`, `keydown`, or `tabindex` across the
  feature-board templates — these cards can't be reached or activated by keyboard / screen readers.
- **Fix:** Make each a `<button type="button">` (or add `role="button"` + `tabindex="0"` +
  `(keydown.enter)`/`(keydown.space)`).

### A3. Overlays don't close on Esc and don't trap focus 🟠 — ✅ done
- [x] **Resolved:** added a dependency-free `FocusTrap` directive
  (`libs/feature-board/src/lib/focus-trap.directive.ts`) — moves focus in on open, wraps
  Tab/Shift+Tab, restores focus on close/destroy — applied to `task-detail`, `generate-types`,
  and the new `activity-feed`, plus `@HostListener('document:keydown.escape')` on each and
  `[attr.inert]` on the persistent panels so they leave the tab order while hidden.
- **Where:** `task-detail` and `generate-types` overlays — scrims at
  `task-detail.html:6` and `generate-types.html:5` close on click only.
- **Problem:** No `Escape` handler and no focus trap; Tab can move behind the modal. Expected UX
  for a drawer/modal is Esc-to-close + trapped focus.
- **Fix:** Add `@HostListener('keydown.escape')` to `TaskDetail` and `GenerateTypes`; consider
  `@angular/cdk` Overlay/A11yModule for a real focus trap.

### A4. Three libs are imported nowhere 🟡
- [ ] **Where:** `libs/azure` (73 lines), `libs/openapi-sync` (62), `libs/figma-sync` (41) — no
  imports anywhere in the app.
- **Problem:** They hold real, correct logic (`detectContractReady` + `diffOperation`; `isReady` +
  `detectChanged`) but nothing calls it, so it reads as dead code. Their `poll*()` functions return
  mocked/empty data.
- **Fix:** Wire them into the sync workers (see **B1**) — that's their intended home. Until then,
  keep them but make the "contract-only / not wired yet" status obvious in each file header.

### A5. `board-store.ts` is large (676 lines) 🟡 — ✅ done
- [x] **Resolved:** extracted `buildMyGroups` + the per-role card factories + `MyWorkCard` /
  `MyWorkGroup` into a pure, testable `libs/data-access/src/lib/my-work-groups.ts`
  (store passes identity + CTA factories as `MyWorkDeps`). Store is now orchestration only.
- **Where:** `libs/data-access/src/lib/board-store.ts`
- **Problem:** One file holds raw signals, ~10 computeds, data ops, and the long `buildMyGroups`
  role builders — harder to navigate/test.
- **Fix:** Extract `buildMyGroups` + the per-role card factories into a pure helper module
  (e.g. `my-work-groups.ts`) the store imports. Keep the store as orchestration only.

### A6. PAT persisted in `localStorage` 🟡
- [ ] **Where:** `libs/data-access/src/lib/auth-store.ts:8-10` (Session.pat), `:91` (persist)
- **Problem:** The Azure PAT is stored in the browser so the PWA reopens signed-in. It's a scoped,
  revocable token (not a password), but a stored token is more exposed than an in-memory one.
- **Fix (optional, security mode):** Offer a "don't persist the PAT" option — keep identity
  (uniqueName/displayName/role) persisted, drop the token, and re-prompt for it on the first write.

### A7. Unsafe DOM casts 🟡 — ✅ done
- [x] **Resolved:** added a `BeforeInstallPromptEvent` interface (no more `as unknown as`),
  guarded the captured event with `'prompt' in e`, and replaced the `change`-handler casts with
  `e.target instanceof HTMLSelectElement` guards.
- **Where:** `libs/feature-board/src/lib/app-shell/app-shell.ts:48`
  (`e as unknown as { prompt }`), `:74` and `:77` (`e.target as HTMLSelectElement`), `:42`
  (`navigator as { standalone? }`).
- **Problem:** Casts assume a shape without a guard; a wrong target type would fail at runtime.
- **Fix:** Add `instanceof` guards for the `change` handlers; define a small
  `BeforeInstallPromptEvent` interface instead of `as unknown as`.

### A8. No tests on the board app 🟡 — ✅ first specs landed
- [x] **Resolved:** the Vitest infra already existed (per-lib `vite.config.mts`,
  `tsconfig.spec.json`, `@nx/vitest:test` defaults) — the target is `nx vite:test <project>`.
  Added the first specs: `tokens.spec.ts` (deriveConv gate, initials, pill/conv) and
  `my-work-groups.spec.ts` (frontend/pm grouping) — **19 tests passing**.
  Follow-up: extract `rowToTask` to a pure helper and cover it too.
- **Where:** there is no `test` target for `apps/board`; libs ship a `test-setup.ts` but no specs.
- **Problem:** Zero automated coverage — refactors (e.g. **A5**) are risky.
- **Fix:** Add a `test` target (Jest/Vitest) and start with pure logic: `deriveConv()` (tokens.ts),
  `buildMyGroups()`, and `rowToTask()` — they're deterministic and high-value.

### A9. Heavy inline styles in templates 🟢
- [ ] **Where:** `board-view.html`, `insights.html`, `task-detail.html`, `my-work.html`,
  `app-shell.html` (many inline `style="…"`).
- **Problem:** Repeated layout/typography inline makes templates noisy and inconsistent.
- **Fix:** Promote repeated patterns to component SCSS or global `.cb-*` utilities; keep inline only
  for genuinely dynamic `[style.x]` values.

### A10. Permissive CORS on the Edge Function 🟢
- [ ] **Where:** `supabase/functions/azure-proxy/index.ts:30` (`Access-Control-Allow-Origin: '*'`)
- **Problem:** Any origin can invoke the proxy (it still needs the anon key + a valid PAT, so impact
  is limited, but it's broader than needed).
- **Fix:** Restrict to the known app origin(s) via an allow-list, or an `APP_ORIGIN` env var.

---

## Part B — Missing features to build (close the product promise)

### B1. Auto-detection loop — the signature feature 🔴 — ✅ implemented & deployed
- [x] **Resolved:** both workers are real and deployed (v1).
  - **OpenAPI worker:** fetches `OPENAPI_SPEC_URL` → flattens operations (deref'd request +
    2xx DTOs) → diffs vs the last `spec_snapshot` → flips a UC-mapped task to
    `backend_state = 'contract_ready'` + names the endpoint on first appearance, or inserts a
    `contract_changed` activity with the field diff. On an unreachable/malformed spec it marks
    the last snapshot `is_stale` and changes no task state (TC-18/19). The diff logic mirrors
    `libs/openapi-sync` (ported to Deno — edge functions can't import the Angular service).
  - **Figma worker:** GETs the file tree → reads node `devStatus` → upserts `design_snapshot`
    → flips `design_state` to `design_ready` (READY_FOR_DEV) / `design_changed` (file `version`
    moved after handoff) + inserts activity. Mirrors `libs/figma-sync`.
  - **Remaining (needs you):** set `OPENAPI_SPEC_URL` / `FIGMA_TOKEN` / `FIGMA_FILE_KEY`
    secrets and add a pg_cron schedule hitting both endpoints. Until then they no-op safely.
- **Where:** `supabase/functions/openapi-worker/index.ts`, `supabase/functions/figma-worker/index.ts`.
- **Problem:** Both workers just return `{ ok: true }`. As a result tasks can **never** reach
  `contract_ready` or `design_ready` — only the Azure macro-status is live, so the Design/Backend
  auto-detection (the core idea) doesn't work.
- **Fix:**
  - **OpenAPI worker:** fetch `OPENAPI_SPEC_URL` → flatten operations → upsert `spec_snapshot` →
    diff vs previous (reuse `OpenApiSyncService.detectContractReady` / `diffOperation` in
    `libs/openapi-sync`) → set `task.backend_state = 'contract_ready'` / flag changes → insert `activity`.
  - **Figma worker:** GET file nodes + Dev-Mode status → upsert `design_snapshot` → detect
    ready/changed (reuse `FigmaSyncService.isReady` / `detectChanged` in `libs/figma-sync`) →
    set `task.design_state` → insert `activity`.
  - Schedule both (Supabase cron) once implemented.

### B2. Task ↔ endpoint / frame mapping 🟠 — ✅ auto-map done (manual UI deferred)
- [x] **Resolved (auto):** both workers map by UC convention — the `UC-N` parsed from the
  operationId / tag / path (OpenAPI) or the frame name (Figma) is matched against `task.uc`,
  and the resolved binding is persisted to `task_mapping` (non-manual). Indexes added in
  migration `0005`. **Deferred:** the manual one-time mapping UI fallback (TC-04/05/21) — still
  worth adding for stories whose titles/frames don't carry a UC.
- **Problem:** No mapping yet between a task and its OpenAPI operation / Figma frame, so the
  workers above won't know which task to flip. `pullSprint` currently sets a `'— pending'` endpoint.
- **Fix:** Auto-map by UC convention (UC number in `operationId`/tag and in the frame/page name),
  persisting to the existing `task_mapping` table, with a manual one-time mapping UI as fallback
  (planning doc TC-04 / TC-05 / TC-21).

### B3. Realtime board updates 🟠 — ✅ done
- [x] **Resolved:** the browser holds only the anon key (no Supabase Auth session), so a direct
  `postgres_changes` subscription would read nothing under the `authenticated`-only RLS — and
  opening `anon` SELECT would grant full table reads. Instead, migration `0006` broadcasts each
  `task` / `activity` change from the DB to a public `board` channel (triggers calling
  `realtime.send`), exposing only the changed row, not table-read access. `BoardStore` subscribes
  to that channel and patches `rawTasks` / prepends `activity` in place (no full refetch).

### B4. Notifications / activity feed 🟠 — ✅ done
- [x] **Resolved:** new `getActivity` op on `azure-proxy` (service-role read of recent events for
  the active sprint) + a `cb-activity-feed` slide-over (bell button in the top bar with an unread
  badge, Esc/focus-trapped) fed by `BoardStore.activity()`; live rows arrive via the B3 broadcast.

### B5. Two-track close gate 🟠
- [ ] **Problem:** Azure isn't closed only-when-both-done; the FE/BE done flow doesn't enforce the
  convergence gate (planning doc TC-14).
- **Fix:** In the proxy `doneWork` path, transition the Azure item to Completed only when both
  `fe_done` and `be_done` are set.

### B6. Lift the 200-story pull cap 🟡
- [ ] **Where:** `pullSprint` in `supabase/functions/azure-proxy/index.ts` (workitemsbatch is 200/call).
- **Fix:** Paginate the batched details fetch so sprints with >200 stories load fully.

### B7. Real "Generate Types" 🟡
- [ ] **Problem:** The Generate-Types modal is a mocked preview, not a real run.
- **Fix:** Wire it to an actual `ng-openapi-gen` run against the current DTOs (planning doc TC-12).

### B8. Completed-Work write-back UI 🟡
- [ ] **Problem:** The proxy `addCompletedWork` op exists (additive, never clobbers estimates) but
  there's no UI to log hours.
- **Fix:** Add a "log work" control on the task drawer that calls `addCompletedWork`.

### B9. Admin team panel 🟡
- [ ] **Problem:** Roles are self-picked on first run; no admin view to assign/override them.
- **Fix:** Add an admin-only panel listing members (`listMembers`) with a role setter (`setRole`).

---

## Suggested order
1. **B1** (+ **B2**) — makes the product actually do its signature job.
2. **B3 / B4** — live + notifications, so the auto-detection is felt immediately.
3. **A1 / A2 / A3** — quick security + a11y wins.
4. **A5 / A8** — split the store and add the first tests.
5. Everything else as capacity allows.
