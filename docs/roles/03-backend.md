# Backend — ship the API contract for each UC

Your job: build the endpoints + DTOs for a UC and make sure they appear in the OpenAPI spec the
PM configured. When they do, the board flips that UC's Backend track to **Contract Ready** and
notifies the Frontend. **You don't upload anything to ContractBoard** — it reads your spec.

---

## Step 1 — Tag your operations with the UC

For the board to attach an endpoint to a UC, put the UC number in the operation's **`operationId`,
a tag, or the path**:

```jsonc
"operationId": "createUC12Booking"        // cleanest
"tags": ["UC-12"]                           // or a tag
"/uc-12/bookings": { "post": { … } }        // or the path
```

A UC with several endpoints? Tag them all with the same UC — they all attach, and the task is
Contract Ready only when **all required** endpoints are present (the card shows `2/3 endpoints`
while partial).

## Step 2 — Make the spec reachable

Your framework already serves an OpenAPI doc (Swagger/Springdoc/NSwag/Scalar). The PM sets that
URL in **Settings → OpenAPI spec URL**. Just make sure the staging spec is reachable and current.

## Step 3 — Detection (automatic, or manual)

- **Automatic:** the `openapi-worker` polls the spec on a schedule. The first time your UC's
  endpoints appear it flips the task to **Contract Ready**, records the endpoint
  (`POST /uc-12/bookings`), and writes an activity event. If you later change a DTO, it records a
  **Contract Changed** event (with the field-level diff) — it notifies, never downgrades.
- **Manual fallback:** an Admin/PM can open the task drawer → **Endpoints** and add the
  `operationId`s by hand (handy before the worker is scheduled).

## Step 4 — Claim & finish your track (optional, in-app)

If you work the board directly: **My work** → **Start** a story (claims it on the Backend track) →
**Mark done** when your part ships (Backend → **BE Done**). In Azure the story shows **In Progress**
until the **Frontend track is also done** — the work item only closes to **Done/Completed when both
FE and BE are done** (one Azure story spans both). **Stop** returns it to the pool.

## What the Frontend sees
On the task: the **Contract Ready** pill, the **endpoint(s)**, and (once design is also ready)
**Ready to integrate**. They then run `ng-openapi-gen` against your spec to get typed services —
so keep DTO names and shapes stable once a UC is Contract Ready; if you must change them, expect a
**Contract Changed** flag and a quick FE re-generate.
