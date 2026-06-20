# Role playbooks — the full ContractBoard cycle

ContractBoard runs three tracks in parallel — **Design → Frontend → Backend** — that
converge at the Frontend, which needs **both** a ready design and a ready contract before it
can integrate. These playbooks say exactly what each role does, in order, to take a sprint
from **pull** to **frontend done**.

| Step | Role | Playbook |
| --- | --- | --- |
| 1 | PM / Lead (or Admin) | [01-pm-lead.md](./01-pm-lead.md) — pull the sprint + configure sources |
| 2a | Designer | [02-designer.md](./02-designer.md) — hand off Figma screens |
| 2b | Backend | [03-backend.md](./03-backend.md) — ship the API contract |
| 3 | Frontend | [04-frontend.md](./04-frontend.md) — generate types + integrate |

---

## The one rule that makes everything link: `UC-<n>`

A task only auto-links across the three tracks when the **same UC number** appears in all of:

- the **Azure work-item title** — e.g. `UC-12 Booking refund` (read into `task.uc` at pull time);
- the **OpenAPI operation** — in its `operationId`, a tag, or the path (e.g. `createUC12Booking`);
- the **Figma frame name** — e.g. `UC-12 · Booking` (for auto-sync; not needed for manual links).

Accepted forms (case-insensitive): `UC-12`, `UC 12`, `UC_12`, `UC12`.
**No `UC-n` in the title → the task can't auto-link; map it by hand in the task drawer.**

---

## State legend (the pills you'll see)

**Design:** To Do → Designing → **Design Ready** → Design Changed
**Backend:** Building → **Contract Ready** → BE Done
**Frontend:** Blocked → Scaffold → Integrating → **FE Done** (Changed if the contract moves under it)

**Convergence** (what a task is blocked on), shown on the card/drawer:

| Pill | Meaning |
| --- | --- |
| Waiting on design | contract ready, design not ready |
| Waiting on backend | design ready, contract not ready |
| Can scaffold | design ready, FE building UI ahead of the contract |
| **Ready to integrate** | design **and** contract both ready |
| Needs attention | something changed after handoff |

---

## Lenses & permissions (a *lens* is picked once, it is not an access level)

- **Admin** — flagged by email; sees the sprint **Pull** controls (with the PM lens) and the
  **Settings** panel; read-only on task actions.
- **PM / Lead** (`pm` lens) — pulls sprints and configures **project sources** (Settings).
- **Designer** — manual Figma-link handoff + Finish (Ready for dev).
- **Frontend / Backend** — Start / Stop / Done their track; FE also generates types.

> The sync workers (auto OpenAPI/Figma detection) are optional. Everything below also works
> **manually** (paste links, map endpoints), which is the recommended path until the workers are
> scheduled and `FIGMA_TOKEN` is set.
