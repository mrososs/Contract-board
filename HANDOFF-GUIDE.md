# Handoff Guide — how Backend and Designer feed the board

> **TL;DR — there is no "upload" button.** ContractBoard never asks the backend to
> upload a schema or the designer to push a file. Both tracks keep working in their
> own tools; ContractBoard *polls* and *detects* the handoff. The only thing you do
> on purpose is **tag the work with its use-case number (`UC-<n>`)** so the board can
> link an API operation / a Figma frame back to the right task.

This explains the two signals that frustrate people the most — **Contract Ready**
(Backend → Frontend) and **Design Ready** (Designer → Frontend) — and exactly what each
person has to do for them to fire.

---

## 0. The glue: the `UC-<n>` tag

Three independent systems get linked by one token that appears in all of them:

| Where | Example | Who sets it |
| --- | --- | --- |
| Azure work-item **title** | `UC-12 Booking refund` | PM / whoever creates the story |
| Figma **frame name** | `UC-12 · Booking` | Designer |
| OpenAPI **operation** (`operationId`, a tag, or the path) | `createUC12Booking` | Backend |

When the admin pulls a sprint, `azure-proxy` extracts the UC from the title into
`task.uc` (`parseUc()`, `supabase/functions/azure-proxy/index.ts`). The two sync
workers match on that same token. **No `UC-<n>` anywhere in the operation/frame name →
the board cannot auto-link it, and the signal never fires.**

The regex is forgiving: `UC-12`, `UC 12`, `UC_12`, `uc12` all parse to `UC-12`.

---

## 1. Backend → Frontend: "Contract Ready"

### What the backend actually does

Nothing new. You build the endpoint + DTO the way you always do. The board reads the
**OpenAPI spec your framework already generates**:

| Stack | Spec URL it already serves |
| --- | --- |
| ASP.NET (Swashbuckle/NSwag) | `/swagger/v1/swagger.json` |
| Spring Boot (springdoc) | `/v3/api-docs` |
| NestJS (`@nestjs/swagger`) | `/api-json` |
| FastAPI | `/openapi.json` |

The **only deliberate step** is to make the operation carry its UC number, in any one of:

```jsonc
// 1) operationId  (cleanest)
"operationId": "createUC12Booking"

// 2) a tag
"tags": ["UC-12"]

// 3) the path
"/uc-12/bookings": { "post": { ... } }
```

That's the whole "upload." You expose the spec URL (already on by default in most
frameworks) and name one thing with the UC. **You do not log into ContractBoard to
publish a schema.**

### What the board does automatically

`supabase/functions/openapi-worker/index.ts` runs on a schedule and:

1. Fetches the spec from the `OPENAPI_SPEC_URL` secret.
2. Flattens every operation into a `field → type` map (request + 2xx response DTOs),
   resolving `$ref`s.
3. Matches each operation to a task by UC (`operationId` → tags → path).
4. **First time** a mapped operation appears and the task is `be_wip`:
   - flips `task.backend_state` → `contract_ready`
   - fills `task.endpoint` (e.g. `POST /uc-12/bookings`)
   - writes a `contract_ready` row to `activity` → the FE owner sees it live (Realtime).
5. **DTO changed later** (a field added/removed/retyped): writes a `contract_changed`
   activity. It **notifies, never downgrades** — the FE decides what to do.
6. On an unreachable/malformed spec: keeps the last good snapshot, marks it stale, and
   touches no task state (so a backend deploy blip can't wipe the board).

### What the frontend sees / does

- The task shows a **Contract Ready** pill, and the `endpoint` becomes visible.
- The FE opens the **Generate TypeScript** modal (the `</>` action on a task) — this runs
  `ng-openapi-gen` against the same spec to emit typed interfaces + an Angular service.
- The FE can now integrate (assuming Design Ready is also true — see §3).

---

## 2. Designer → Frontend: "Design Ready"

### What the designer actually does

Two things, both inside Figma:

1. Name the frame/section with its UC, e.g. `UC-12 · Booking`.
2. In **Dev Mode**, mark it **"Ready for development"** (this sets the node's
   `devStatus` to `READY_FOR_DEV`).

That's it. No export, no handoff link to paste into ContractBoard.

### What the board does automatically

`supabase/functions/figma-worker/index.ts` polls the linked file and:

1. Walks the document, collecting the first `UC-<n>`-named node per UC.
2. Marks `READY_FOR_DEV` / `COMPLETED` frames as ready.
3. First time a mapped frame is ready → flips `task.design_state` → `design_ready` +
   `design_ready` activity.
4. If the frame is edited **after** it was handed off (the Figma file `version` changes)
   → `design_changed` activity. v1 uses the file version as the change basis, not a
   pixel diff.

---

## 3. Convergence — why both signals matter

The signature rule of ContractBoard: the Frontend track sits downstream of **both** the
Designer and the Backend and needs **both** ready before it can integrate.

```
Designer  ─ Design Ready ─┐
                          ├─→  Frontend can integrate
Backend   ─ Contract Ready┘
```

`deriveConv()` in `libs/data-access/.../tokens.ts` computes the convergence state from the
three track states, so a task can read as "waiting on design", "waiting on contract", or
"ready to build" — that's what the board's convergence column is showing you.

---

## 4. Turning the tracks on (one-time ops)

The Edge Functions are written and real — but the backend/design tracks only light up once
they're deployed, given secrets, and scheduled. Until then every task's design/contract
micro-state sits at its default and only the Azure macro-status is live.

### 4.1 Confirm the support tables exist

The workers write to `spec_snapshot`, `design_snapshot`, `task_mapping`, and `activity`.
These come from the migrations (`0005_sync_mapping.sql` adds the indexes + the design
fingerprint column). Apply migrations via the Supabase MCP (`apply_migration`).

### 4.2 Deploy the functions

```bash
supabase functions deploy openapi-worker
supabase functions deploy figma-worker
```

### 4.3 Set the secrets

```bash
# Backend track
supabase secrets set OPENAPI_SPEC_URL="https://your-api/swagger/v1/swagger.json"

# Designer track
supabase secrets set FIGMA_TOKEN="figd_..."          # a Figma personal access token
supabase secrets set FIGMA_FILE_KEY="abc123"          # the key in figma.com/file/<KEY>/...
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — don't set them.
If a secret is missing, the worker no-ops cleanly (`skipped: ...`) instead of erroring.

### 4.4 Schedule the polls

Either pg_cron inside Postgres, or any external cron hitting the function URL on a POST.
External example:

```bash
# every 5 minutes
*/5 * * * *  curl -fsS -X POST https://<project>.supabase.co/functions/v1/openapi-worker \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
*/5 * * * *  curl -fsS -X POST https://<project>.supabase.co/functions/v1/figma-worker \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

### 4.5 Smoke-test

```bash
curl -X POST https://<project>.supabase.co/functions/v1/openapi-worker \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
# → {"ok":true,"operations":N,"events":[{"kind":"contract_ready","message":"UC-12 POST /uc-12/bookings",...}]}
```

A `contract_ready` / `design_ready` event in the response means the board just flipped
that task — refresh the app and the pill + activity should be there.

---

## 5. Quick troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Worker returns `skipped: "...not set"` | Secret missing (§4.3). |
| Worker returns `skipped: "no active sprint"` | Admin hasn't pulled a sprint yet. |
| `ok:true` but no event fired | The operation/frame has no `UC-<n>`, or the UC doesn't match any pulled task's title. |
| Backend track never flips | Spec URL not reachable from Supabase, or the UC isn't in `operationId`/tag/path. |
| Contract was ready, now shows "changed" | A DTO field was added/removed/retyped after handoff — expected; FE re-generates types. |
| Design flips back to "changed" | The Figma file was edited after the frame was marked ready. |

---

## 6. Where to look in the code

| Concern | File |
| --- | --- |
| Contract detection + DTO diff | `supabase/functions/openapi-worker/index.ts` |
| Design status detection | `supabase/functions/figma-worker/index.ts` |
| UC extraction from Azure titles | `supabase/functions/azure-proxy/index.ts` (`parseUc`) |
| Convergence gate | `libs/data-access/src/lib/tokens.ts` (`deriveConv`) |
| FE type-gen preview | `libs/feature-board/src/lib/generate-types/` |
| In-browser sync contract (mirror; `pollSpec` is a stub) | `libs/openapi-sync/`, `libs/figma-sync/` |
