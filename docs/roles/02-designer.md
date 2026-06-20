# Designer — hand off Figma screens for each UC

Your job: for each UC, attach the Figma screen link(s) and mark the design **Ready for
development**. That flips the task's Design track to **Design Ready** and notifies Frontend &
Backend — and the links you paste are shown to them.

> This is the **manual handoff** (no Figma token needed). If the Figma auto-sync is enabled
> later, naming frames `UC-12 · …` and marking them "Ready for development" in Dev Mode does the
> same thing automatically.

---

## Your dashboard

Sign in → **My work** ("My design queue"). Your UCs are grouped:
**Up next** (To Do) · **Designing now** (WIP) · **Ready for development** · **Changed after handoff**.

Card buttons:
- **Start in Figma** — moves a To Do UC to *Designing* (you've picked it up).
- **Finish · Ready for dev** — marks it **Design Ready** (the handoff). 
- **Stop / Reopen** — send it back to To Do / Designing.

## Step-by-step for one UC

1. In **My work**, click the UC card to open its drawer (or **Start in Figma** first).
2. In the **Design** card:
   - paste a **Figma screen URL** (copy it from Figma — `figma.com/design/<KEY>/…?node-id=…`)
     into the field and click **Add**. Repeat for every screen this UC needs.
   - each link shows as a clickable row; remove one with the **×**.
3. When the screens are done, click **Finish · Ready for dev**.
   - Design track → **Design Ready**; an activity event fires so FE/BE are notified.
   - If you need to rework it, open the task and click **Reopen**.

## What FE/BE see
In the same Design card (read-only for them), they see your **Figma links** as clickable items
and the **Design Ready** pill. Once the contract is also ready, the task reads **Ready to
integrate**.

## If a design changes after handoff
Open the UC and either add the new link / re-mark Ready, or (auto-sync only) the worker flags it
as **Design Changed** so the Frontend reviews before continuing.

## Tip
You don't need a UC in the *Azure title* to paste links by hand — but matching the UC across
title + Figma + contract is what makes the three tracks line up on one card. Keep them consistent.
