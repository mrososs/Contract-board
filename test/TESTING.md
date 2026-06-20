# Testing ContractBoard end-to-end (mock sources)

This branch (`test/mock-sources`) carries a **mock backend swagger** so you can watch the
Contract-Ready / Design-Ready flow fire on real infrastructure without a real backend or design.

> **The one rule that makes it all work:** the `UC-<n>` tag must appear in **all three** places
> for a task to auto-link — the **Azure work-item title**, the **OpenAPI operation**, and the
> **Figma frame name**. Same number, e.g. `UC-3`, in each.

---

## 1. The UC tag — what must contain it

| Side | Where the `UC-n` goes | Example |
| --- | --- | --- |
| **Azure task** (pulled) | the work-item **Title** | `UC-3 Booking refund` |
| **OpenAPI** | `operationId`, a `tag`, or the path | `createUC3Booking` / tag `UC-3` / `/uc-3/bookings` |
| **Figma** | the **frame/section name** | `UC-3 · Booking` |

Accepted forms (case-insensitive, regex `\bUC[-_\s]?(\d+)\b`): `UC-3`, `UC 3`, `UC_3`, `UC3`.

**If a pulled task's title has no `UC-n`, `task.uc` is null and nothing auto-links** — you'd have
to map it by hand in the task drawer (Endpoints/Screens editor). So: **put `UC-n` in the title.**

---

## 2. The mock backend spec

[`mock-vms-openapi.json`](./mock-vms-openapi.json) — a public OpenAPI 3.0 spec with these UCs:

| UC | Operation(s) | Notes |
| --- | --- | --- |
| **UC-1** | `createUC1Login` — `POST /uc-1/auth/login` | single endpoint |
| **UC-2** | `getUC2Profile` — `GET /uc-2/profile` | single endpoint |
| **UC-3** | `createUC3Booking` + `refundUC3Booking` — `POST /uc-3/bookings`, `POST /uc-3/bookings/refund` | **two endpoints → N:N**: the UC-3 task goes Contract Ready only when **both** are present |

Once this branch is pushed, the worker can poll it at this **raw URL**:

```
https://raw.githubusercontent.com/mrososs/Contract-board/test/mock-sources/test/mock-vms-openapi.json
```

> Raw GitHub caches for a few minutes, so edits to the spec take ~5 min to show as
> "Contract Changed". Fine for testing.

---

## 3. Set it up (admin or PM/lead)

1. **Pick a test project + sprint in Azure** whose stories you can rename, and **put `UC-1`,
   `UC-2`, `UC-3` in three story titles** (e.g. `UC-1 Login`, `UC-2 Profile`, `UC-3 Booking`).
2. Sign in, go to **Settings → Configure a project**:
   - **Project:** your test project.
   - **OpenAPI spec URL:** the raw URL above → click **Test spec** (should say `✓ 4 operations found`).
   - **Figma file key:** the key from your file URL `figma.com/design/<KEY>/...` → **Test Figma**
     (works once `FIGMA_TOKEN` is set — see §5).
   - **Save sources.**
3. **Pull that sprint** (the Pull controls, admin+pm). The three `UC-*` stories arrive with
   `task.uc` set.
4. **Run the worker** (or wait for the schedule):
   ```bash
   curl -X POST https://agynsfjrhpabioiwjdpq.supabase.co/functions/v1/openapi-worker \
     -H "Authorization: Bearer <SUPABASE_ANON_KEY>"
   ```
   Expected: UC-1 and UC-2 flip to **Contract Ready**; UC-3 shows **1/2 endpoints** until both
   are present (they both are in the mock, so it goes Contract Ready too). Each flip writes an
   activity row and the board updates live.

---

## 4. Your Figma file (design track)

1. In your new Figma file, name the frames/sections with the UC, e.g. `UC-1 · Login`,
   `UC-3 · Booking`. Mark them **"Ready for development"** in Dev Mode.
2. Put the **file key** (`figma.com/design/<KEY>/...`) in Settings.
3. Run the figma worker:
   ```bash
   curl -X POST https://agynsfjrhpabioiwjdpq.supabase.co/functions/v1/figma-worker \
     -H "Authorization: Bearer <SUPABASE_ANON_KEY>"
   ```
   A UC task flips to **Design Ready** only when **all** its required frames are ready.

---

## 5. Prerequisite secret

The design track needs the shared Figma token set once (the OpenAPI mock is public, no token):

```bash
supabase secrets set FIGMA_TOKEN=figd_your_personal_access_token
```

Until then **Test Figma** and the figma worker report `FIGMA_TOKEN secret is not set` (expected).

---

## 6. What "working well" looks like

- `openapi-worker` response: `{ ok: true, projects: [{ project, operations: 4, events: [...] }] }`
  with `contract_ready` / `endpoint_ready` events.
- On the board, the UC-tagged tasks show the **Contract Ready** pill + the endpoint
  (`POST /uc-3/bookings` or `2/2 endpoints`), and the activity feed lists the events.
- Edit a DTO in the mock spec (e.g. add a field to `Booking`), push, re-run → a
  **Contract Changed** activity with the field-level diff.
