# PM / Lead (and Admin) — pull the sprint + configure sources

**You start the cycle.** You pull the sprint from Azure and tell each project where its OpenAPI
spec and Figma file live, so the board can light up the Design and Contract signals.

> Lenses: both **pulling a sprint** and **configuring sources** are open to the **PM/lead lens
> (`pm`) or an Admin** — the Pull controls and the Settings tab show for either.

---

## Step 1 — Make sure the work items are UC-tagged

Before pulling, ensure the Azure stories you want linked have their **UC number in the title**
(e.g. `UC-12 Booking refund`). This is what lets Design/Contract attach to the task. Stories
without a `UC-n` still appear on the board but won't auto-link (they can be mapped by hand later).

## Step 2 — Pull the sprint

1. Sign in (Org URL + your Azure PAT).
2. Top bar → pick **Project** → pick **Sprint** → **Pull sprint**.
3. The board fills with that sprint's stories (story-level work items). Each carries its `uc`
   (parsed from the title), starting at Design = To Do, Backend = Building, Frontend = Blocked.

Each project keeps **its own** active sprint, so you can pull several projects; use the
**project switcher** in the top bar to move between them.

## Step 3 — Configure that project's sources (Settings)

Open **Settings** (admin/PM only) → **Configure a project**:

1. **Project** — choose the one you pulled.
2. **OpenAPI spec URL** — the backend's spec (e.g. `https://…/swagger/v1/swagger.json`,
   `/v3/api-docs`, `/openapi.json`, or a Scalar `…/specification.json`). Click **Test spec** →
   it should report `✓ N operations found`.
3. **Figma file key** — the `KEY` from `figma.com/design/<KEY>/…`. Click **Test Figma**
   (needs the shared `FIGMA_TOKEN` secret set; otherwise it says so — that's fine, the designer
   can still hand off links manually).
4. **Polling enabled** on → **Save sources**. The project appears under **Configured projects**.

> The spec URL + file key are **not secrets** and are stored per project. The Figma access
> **token** is a single shared server secret (`FIGMA_TOKEN`), set once in the Supabase dashboard.

## Step 4 — Hand off to the tracks

Tell the **Designer** and **Backend** their UCs are on the board. From here:
- the **Designer** marks each UC's design ready ([02-designer.md](./02-designer.md));
- the **Backend** ships the contract ([03-backend.md](./03-backend.md));
- the **Frontend** integrates once both are ready ([04-frontend.md](./04-frontend.md)).

## What you can watch
- **Insights** — Design Ready / Contracts Ready / FE Done percentages, blockers, who's on each side.
- **Activity feed** (bell) — every detected event (design ready, contract ready, DTO changed, done).
- The board **Convergence** view groups tasks by what they're blocked on.

> Admins are **read-only on task actions** (no Start/Done) — you track progress; the assigned
> dev moves the work.
