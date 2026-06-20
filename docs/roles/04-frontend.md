# Frontend — generate types + integrate, to FE Done

Your job: claim a UC, wait until it's **Ready to integrate** (design **and** contract ready),
generate the typed services from the contract, build the screen, and mark it **FE Done**. You're
where the three tracks converge.

---

## Your dashboard

Sign in → **My work**. Your UCs are grouped: **Working on** · **Available to start** · **Done** ·
**Taken by the team**. Card buttons: **Start** (claim), **Mark done**, **Stop** (release).

## Step 1 — Claim the story

**Start** a UC you'll build. It's now yours on the Frontend track (Integrating). You can scaffold
the UI from the **Design Ready** screens even before the contract lands.

## Step 2 — Wait for "Ready to integrate"

Open the task drawer. You need both:
- **Design Ready** — the designer's **Figma links** are listed in the Design card (clickable).
- **Contract Ready** — the **endpoint(s)** are listed in the Backend card.

When both are in, the header pill reads **Ready to integrate**.

## Step 3 — Generate the typed services

In the drawer click **Generate types**. The modal shows the **exact command** for this project's
spec, with a **Copy** button, and lists the endpoints this UC covers:

```bash
npx ng-openapi-gen --input <project's OpenAPI spec URL> --output src/app/api
```

1. **Copy** it and run it in your frontend repo — it writes typed models + an Angular service
   into `src/app/api`. Commit those.
2. Back in the modal, click **Mark generated & set Integration →** — the task moves to
   **Integrating** (`fe_integration`).

> The modal is a helper around `ng-openapi-gen`; the browser can't push to your repo, so you run
> the copied command locally (auto-PR to the repo is a planned option).

## Step 4 — Build, then finish

Build the screen against the generated service + the Figma links. When it's shipped, **Mark done**
(My work card or the drawer) → Frontend track → **FE Done**. In Azure the story moves to **In
Progress** (not Done) — the work item only closes to **Done/Completed once both the Frontend and
Backend tracks are done**, since one Azure story spans both.

## If the contract is insufficient — raise a blocker

If you start integrating and the contract is wrong/incomplete (e.g. an endpoint is missing DTO
fields), open the task → **Raise blocker** → write *why* (e.g. "createUC3Booking is missing
amount + currency") → **Send blocker to backend**. This:
- marks your track **Blocked**,
- sends the **Backend track back to Building** (the story leaves Contract Ready and returns to the
  backend's queue), and
- posts your note to the **activity feed** + a **banner on the task**, so the backend sees exactly
  what to fix.

When the backend reworks the contract and it's Ready again, the blocker note clears and you resume.

## If something changes after you start
- **Contract Changed** — a DTO moved after you generated. Re-run the `ng-openapi-gen` command to
  refresh `src/app/api`, then continue.
- **Design Changed** — the designer edited a screen after handoff; review the updated Figma link
  before continuing.

## The whole cycle, one line
PM pulls + configures → Designer finishes design → Backend ships contract → **you** generate
types, integrate, and mark FE Done. ✔
