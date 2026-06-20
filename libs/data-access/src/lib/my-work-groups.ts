import { DecoratedTask, Pill, Role } from './models';
import { initials, pill, TRACK } from './tokens';

/** One card in the role-focused "My Work" view. */
export interface MyWorkCard {
  uc: string;
  title: string;
  sub: string;
  statusPill: Pill;
  who: string;
  whoName: string;
  whoColor: string;
  ctaLabel: string;
  cta: (e?: Event) => void;
  /** Optional secondary action (e.g. "Stop" alongside "Mark done"). */
  cta2Label?: string;
  cta2?: (e?: Event) => void;
  open: (e?: Event) => void;
}

export interface MyWorkGroup {
  label: string;
  fg: string;
  count: number;
  items: MyWorkCard[];
}

/**
 * The store hands the builder its identity + CTA factories so this module stays
 * pure (no store/Angular imports) and unit-testable in isolation (A5/A8).
 */
export interface MyWorkDeps {
  /** The signed-in member's display name (for "you started this"). */
  me: string;
  toastCta: (msg: string) => (e?: Event) => void;
  openCta: (uc: string) => (e?: Event) => void;
  startCta: (azureId?: number) => (e?: Event) => void;
  stopCta: (azureId?: number) => (e?: Event) => void;
  doneCta: (azureId?: number) => (e?: Event) => void;
  /** Designer dashboard: set the design micro-state by hand (Start/Finish/Stop). */
  designCta: (azureId: number | undefined, state: string) => (e?: Event) => void;
}

/**
 * Build the per-role "My Work" groups from the decorated tasks. Pure function —
 * the same task set + role + identity always yields the same groups. Ported out
 * of BoardStore so the store reads as orchestration and this logic can be tested
 * directly.
 */
export function buildMyGroups(role: Role, tasks: DecoratedTask[], deps: MyWorkDeps): MyWorkGroup[] {
  const G = TRACK.frontend,
    T = TRACK.design,
    S = TRACK.backend,
    R = TRACK.alert,
    M = TRACK.slate;

  const card = (
    t: DecoratedTask,
    o: {
      sub: string;
      pill: Pill;
      who: string;
      color: string;
      ctaLabel: string;
      cta: (e?: Event) => void;
      cta2Label?: string;
      cta2?: (e?: Event) => void;
    },
  ): MyWorkCard => ({
    uc: t.uc,
    title: t.title,
    sub: o.sub,
    statusPill: o.pill,
    who: initials(o.who),
    whoName: o.who,
    whoColor: o.color,
    ctaLabel: o.ctaLabel,
    cta: o.cta,
    cta2Label: o.cta2Label,
    cta2: o.cta2,
    open: t.open,
  });
  const grp = (label: string, fg: string, items: MyWorkCard[]): MyWorkGroup => ({
    label,
    fg,
    items,
    count: items.length,
  });

  if (role === 'designer') {
    // Manual handoff: the designer opens a UC to paste Figma links, then
    // Start / Finish (Ready for dev) / Stop straight from the card.
    const mk = (t: DecoratedTask) => {
      const base = { pill: pill(t.d), who: t.designer, color: T };
      if (t.d === 'todo') {
        return card(t, { ...base, sub: 'Not started — open to add Figma links',
          ctaLabel: 'Start in Figma', cta: deps.designCta(t.azureId, 'design_wip') });
      }
      if (t.d === 'design_wip') {
        return card(t, { ...base, sub: 'In Figma · add links, then finish',
          ctaLabel: 'Finish · Ready for dev', cta: deps.designCta(t.azureId, 'design_ready'),
          cta2Label: 'Stop', cta2: deps.designCta(t.azureId, 'todo') });
      }
      if (t.d === 'design_ready') {
        return card(t, { ...base, sub: 'Handed off · FE/BE notified',
          ctaLabel: 'Open links', cta: deps.openCta(t.uc),
          cta2Label: 'Reopen', cta2: deps.designCta(t.azureId, 'design_wip') });
      }
      return card(t, { ...base, sub: 'Edited after handoff · FE alerted',
        ctaLabel: 'Re-mark Ready', cta: deps.designCta(t.azureId, 'design_ready') });
    };
    return [
      grp('Designing now', G, tasks.filter((t) => t.d === 'design_wip').map(mk)),
      grp('Up next', M, tasks.filter((t) => t.d === 'todo').map(mk)),
      grp('Ready for development', T, tasks.filter((t) => t.d === 'design_ready').map(mk)),
      grp('Changed after handoff', R, tasks.filter((t) => t.d === 'design_changed').map(mk)),
    ].filter((g) => g.count);
  }

  if (role === 'frontend' || role === 'backend') {
    const me = deps.me;
    const startedBy = (t: DecoratedTask) => (role === 'frontend' ? t.feStartedBy : t.beStartedBy);
    const trackPill = (t: DecoratedTask) => (role === 'frontend' ? t.fp : t.bp);
    const isDone = (t: DecoratedTask) => (role === 'frontend' ? t.f === 'fe_done' : t.b === 'be_done');
    const trackColor = role === 'frontend' ? G : S;
    const working = (t: DecoratedTask) =>
      card(t, {
        sub: 'You started this story',
        pill: trackPill(t),
        who: me,
        color: trackColor,
        ctaLabel: 'Mark done',
        cta: deps.doneCta(t.azureId),
        cta2Label: 'Stop',
        cta2: deps.stopCta(t.azureId),
      });
    const available = (t: DecoratedTask) =>
      card(t, {
        sub: 'Tap Start to claim this story',
        pill: trackPill(t),
        who: role === 'frontend' ? t.feDev : t.beDev,
        color: trackColor,
        ctaLabel: 'Start',
        cta: deps.startCta(t.azureId),
      });
    const done = (t: DecoratedTask) =>
      card(t, {
        sub: 'Done by you',
        pill: trackPill(t),
        who: me,
        color: S,
        ctaLabel: 'Open',
        cta: deps.openCta(t.uc),
      });
    const taken = (t: DecoratedTask) =>
      card(t, {
        sub: 'Started by ' + startedBy(t),
        pill: trackPill(t),
        who: startedBy(t) || '—',
        color: M,
        ctaLabel: 'Open',
        cta: deps.openCta(t.uc),
      });
    return [
      grp('Working on', trackColor, tasks.filter((t) => startedBy(t) === me && !isDone(t)).map(working)),
      grp('Available to start', T, tasks.filter((t) => !startedBy(t) && !isDone(t) && !t.closed).map(available)),
      grp('Done', S, tasks.filter((t) => startedBy(t) === me && isDone(t)).map(done)),
      grp('Taken by the team', M, tasks.filter((t) => startedBy(t) && startedBy(t) !== me && !isDone(t)).map(taken)),
    ].filter((g) => g.count);
  }

  if (role === 'pm') {
    // Read-only oversight: who's working on what, and what's finished.
    const doneish = (t: DecoratedTask) => t.closed || (t.f === 'fe_done' && t.b === 'be_done');
    const started = (t: DecoratedTask) => !!(t.feStartedBy || t.beStartedBy);
    const owners = (t: DecoratedTask) => 'FE: ' + (t.feStartedBy || '—') + ' · BE: ' + (t.beStartedBy || '—');
    const doneSub = (t: DecoratedTask) =>
      [t.f === 'fe_done' ? 'FE done' : '', t.b === 'be_done' ? 'BE done' : '', t.closed ? 'Closed in Azure' : '']
        .filter(Boolean)
        .join(' · ') || 'Done';
    const mk = (sub: (t: DecoratedTask) => string, color: string) => (t: DecoratedTask) =>
      card(t, {
        sub: sub(t),
        pill: t.cv,
        who: t.feStartedBy || t.beStartedBy || t.feDev,
        color,
        ctaLabel: 'Open',
        cta: deps.openCta(t.uc),
      });
    return [
      grp('In progress', G, tasks.filter((t) => started(t) && !doneish(t)).map(mk(owners, G))),
      grp('Done', S, tasks.filter((t) => doneish(t)).map(mk(doneSub, S))),
      grp('Not started yet', M, tasks.filter((t) => !started(t) && !doneish(t)).map(mk(() => 'No one has started this yet', M))),
    ].filter((g) => g.count);
  }

  return [];
}
