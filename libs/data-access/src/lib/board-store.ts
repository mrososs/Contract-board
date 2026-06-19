import { computed, inject, Injectable, signal } from '@angular/core';
import {
  BackendState,
  BoardLayout,
  BoardOverride,
  ConvKey,
  DecoratedTask,
  DesignState,
  FrontendState,
  Nav,
  Pill,
  Role,
  Task,
} from './models';
import { SupabaseService } from './supabase.service';
import { conv, deriveConv, initials, pill, roleInfo, TRACK } from './tokens';

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
export interface LaneItem {
  uc: string;
  title: string;
  pill: Pill;
  who: string;
  whoName: string;
  avBg: string;
  avFg: string;
  open: (e?: Event) => void;
}
export interface Lane {
  name: string;
  dot: string;
  sub: string;
  count: number;
  items: LaneItem[];
}
export interface FocusGroup {
  label: string;
  fg: string;
  count: number;
  items: DecoratedTask[];
}
export interface Blocker {
  uc: string;
  title: string;
  reason: string;
  fg: string;
  open: (e?: Event) => void;
}

/** The session shape the store needs — passed in by AuthStore (avoids a cycle). */
export interface BoardSession {
  orgUrl: string;
  pat: string;
  displayName: string;
  role: Role | null;
  isAdmin: boolean;
}

/** A task row as returned by the `azure-proxy` getBoard / pullSprint ops. */
interface TaskRow {
  id: number;
  uc: string | null;
  title: string;
  macro_state: string | null;
  assigned_to: string | null;
  designer: string | null;
  fe_dev: string | null;
  be_dev: string | null;
  endpoint: string | null;
  design_state: DesignState;
  frontend_state: FrontendState;
  backend_state: BackendState;
  fe_started_by: string | null;
  be_started_by: string | null;
}
interface BoardResult {
  sprint: { project: string; iteration_path: string } | null;
  tasks: TaskRow[];
}

/**
 * Single source of truth for the board screen: raw UI state as signals,
 * everything else derived. Tasks are loaded live from Supabase (the Azure
 * mirror) via the `azure-proxy` Edge Function — never demo data.
 */
@Injectable({ providedIn: 'root' })
export class BoardStore {
  private readonly supabase = inject(SupabaseService);

  // ---- raw state ----------------------------------------------------------
  readonly role = signal<Role>('pm');
  readonly identity = signal<{ name: string; ini: string }>({ name: '—', ini: '·' });
  readonly nav = signal<Nav>('mywork');
  readonly layout = signal<BoardLayout>('lanes');
  readonly override = signal<BoardOverride>(null);
  readonly selectedUc = signal<string | null>(null);
  readonly genOpen = signal(false);
  readonly toast = signal('');
  readonly isAdmin = signal(false);
  readonly rawTasks = signal<Task[]>([]);
  /** The team that has signed in (display_name + chosen role) — drives Insights. */
  readonly members = signal<{ display_name: string; role: Role; is_admin: boolean }[]>([]);

  // ---- admin: sprint setup ------------------------------------------------
  readonly sprintName = signal<string>('');
  readonly projects = signal<string[]>([]);
  readonly iterations = signal<{ name: string; path: string }[]>([]);
  readonly selectedProject = signal<string>('');
  readonly selectedIteration = signal<string>('');
  readonly busy = signal(false);

  /** Azure credentials for this session — kept in memory only, never persisted. */
  private creds: { orgUrl: string; pat: string } | null = null;
  private toastTimer?: ReturnType<typeof setTimeout>;

  // ---- derived: tasks -----------------------------------------------------
  readonly tasks = computed<DecoratedTask[]>(() =>
    this.rawTasks().map((t) => ({
      ...t,
      dp: pill(t.d),
      fp: pill(t.f),
      bp: pill(t.b),
      cv: conv(t.conv),
      dtoList: t.dtos ? t.dtos.split(' · ') : [],
      open: () => this.openTask(t.uc),
    })),
  );

  readonly roleInfo = computed(() => {
    const info = roleInfo(this.role());
    const id = this.identity();
    return { ...info, name: id.name, ini: id.ini };
  });

  /** Real signed-in members grouped by their chosen lens — for Insights. */
  readonly team = computed(() => {
    const of = (r: Role) =>
      this.members()
        .filter((m) => m.role === r)
        .map((m) => ({ ini: initials(m.display_name), name: m.display_name }));
    return { design: of('designer'), frontend: of('frontend'), backend: of('backend') };
  });

  readonly pageTitle = computed(() => {
    switch (this.nav()) {
      case 'mywork':
        return this.roleInfo().tab;
      case 'board':
        return this.sprintName() || 'Board';
      default:
        return 'Insights';
    }
  });

  // ---- derived: My Work (role-focused) ------------------------------------
  readonly myGroups = computed<MyWorkGroup[]>(() =>
    this.buildMyGroups(this.role(), this.tasks()),
  );

  // ---- derived: Board · Lanes ---------------------------------------------
  readonly lanes = computed<Lane[]>(() => {
    const tasks = this.tasks();
    const laneItem = (t: DecoratedTask, state: string, track: 'd' | 'f' | 'b'): LaneItem => {
      const col = track === 'd' ? TRACK.design : track === 'f' ? TRACK.frontend : TRACK.backend;
      const who = track === 'd' ? t.designer : track === 'f' ? t.feDev : t.beDev;
      return {
        uc: t.uc,
        title: t.title,
        pill: pill(state as never),
        who: initials(who),
        whoName: who,
        avBg: col + '2e',
        avFg: col,
        open: t.open,
      };
    };
    const ld = tasks
      .filter((t) => ['design_wip', 'design_ready', 'design_changed'].includes(t.d))
      .map((t) => laneItem(t, t.d, 'd'));
    const lf = tasks
      .filter((t) => ['fe_blocked', 'fe_scaffold', 'fe_integration', 'fe_changed'].includes(t.f))
      .map((t) => laneItem(t, t.f, 'f'));
    const lb = tasks
      .filter((t) => ['be_wip', 'contract_ready'].includes(t.b))
      .map((t) => laneItem(t, t.b, 'b'));
    return [
      { name: 'Design', dot: TRACK.design, sub: 'Figma → Ready for dev', items: ld, count: ld.length },
      { name: 'Frontend', dot: TRACK.frontend, sub: 'Needs design + contract', items: lf, count: lf.length },
      { name: 'Backend', dot: TRACK.backend, sub: 'OpenAPI → Contract ready', items: lb, count: lb.length },
    ];
  });

  // ---- derived: Board · Convergence ---------------------------------------
  readonly focusGroups = computed<FocusGroup[]>(() => {
    const groupOf = (cs: ConvKey[]) => this.tasks().filter((t) => cs.includes(t.conv));
    return (
      [
        { label: 'Ready to integrate', fg: TRACK.backend, items: groupOf(['ready']) },
        { label: 'Needs attention', fg: TRACK.alert, items: groupOf(['alert']) },
        { label: 'Can scaffold (design only)', fg: TRACK.frontend, items: groupOf(['scaffold']) },
        { label: 'Blocked', fg: TRACK.slate, items: groupOf(['wait_be', 'wait_design']) },
        { label: 'Closed', fg: TRACK.backend, items: groupOf(['closed']) },
      ] as FocusGroup[]
    )
      .filter((g) => g.items.length)
      .map((g) => ({ ...g, count: g.items.length }));
  });

  // ---- derived: Insights --------------------------------------------------
  readonly blockers = computed<Blocker[]>(() =>
    this.tasks()
      .filter((t) => ['wait_be', 'wait_design', 'alert'].includes(t.conv))
      .map((t) => ({
        uc: t.uc,
        title: t.title,
        reason: t.reason || t.alert || '',
        fg: conv(t.conv).fg,
        open: t.open,
      })),
  );

  readonly metrics = computed(() => {
    const tasks = this.tasks();
    const total = tasks.length || 1;
    const groupOf = (cs: ConvKey[]) => tasks.filter((t) => cs.includes(t.conv)).length;
    const designReady = tasks.filter((t) => ['design_ready', 'design_changed'].includes(t.d)).length;
    const contractsReady = tasks.filter((t) => t.b === 'contract_ready' || t.b === 'be_done').length;
    const feDone = tasks.filter((t) => t.f === 'fe_done').length;
    const pct = (n: number) => Math.round((n / total) * 100) + '%';
    return {
      total: tasks.length,
      designReady,
      contractsReady,
      feDone,
      nOpen: tasks.filter((t) => !t.closed).length,
      nReady: groupOf(['ready']),
      nAlert: groupOf(['alert']),
      nBlocked: groupOf(['wait_be', 'wait_design']),
      designPct: pct(designReady),
      contractPct: pct(contractsReady),
      fePct: pct(feDone),
    };
  });

  // ---- derived: selected task (drawer) ------------------------------------
  readonly selected = computed(() => {
    const uc = this.selectedUc();
    if (!uc) return null;
    const t = this.tasks().find((x) => x.uc === uc);
    if (!t) return null;
    const gn = t.dtoList;
    return {
      uc: t.uc,
      title: t.title,
      cv: t.cv,
      dp: t.dp,
      bp: t.bp,
      endpoint: t.endpoint,
      dtoList: gn,
      designer: t.designer,
      beDev: t.beDev,
      hasDiff: !!t.hasDiff,
      specFile: t.uc.toLowerCase().replace(/[-#]/g, '') + '.json',
      gen1: (gn[0] || 'Model') + '.ts',
      gen2: (gn[1] || gn[0] || 'Model') + '.ts',
      gen2name: gn[1] || gn[0] || 'Model',
      svcFile: t.title.split(' ')[0].toLowerCase() + '.service.ts',
    };
  });

  // ---- session / data loading ---------------------------------------------
  /** Seed the store from a resolved session and load the live board. */
  async startSession(s: BoardSession): Promise<void> {
    this.creds = { orgUrl: s.orgUrl, pat: s.pat };
    this.role.set(s.role ?? 'pm');
    this.identity.set({ name: s.displayName, ini: initials(s.displayName) });
    this.isAdmin.set(s.isAdmin);
    this.nav.set('mywork');
    await this.loadBoard();
    this.loadMembers();
  }

  /** Fetch the active sprint's tasks from Supabase. */
  async loadBoard(): Promise<void> {
    this.override.set('loading');
    try {
      const res = await this.supabase.invoke<BoardResult>('getBoard');
      this.applyBoard(res);
    } catch {
      this.override.set('error');
    }
  }

  /** Load the signed-in team (who picked which lens) for the Insights screen. */
  async loadMembers(): Promise<void> {
    try {
      const res = await this.supabase.invoke<{ members: { display_name: string; role: Role; is_admin: boolean }[] }>(
        'listMembers',
      );
      this.members.set(res.members ?? []);
    } catch {
      /* non-fatal */
    }
  }

  // ---- admin: sprint setup ------------------------------------------------
  async loadProjects(): Promise<void> {
    if (!this.creds || this.projects().length) return;
    try {
      const res = await this.supabase.invoke<{ projects: string[] }>('listProjects', this.creds);
      this.projects.set(res.projects);
    } catch (e) {
      this.fireToast((e as Error).message);
    }
  }

  async loadIterations(project: string): Promise<void> {
    this.selectedProject.set(project);
    this.selectedIteration.set('');
    if (!this.creds || !project) return;
    try {
      const res = await this.supabase.invoke<{ iterations: { name: string; path: string }[] }>(
        'listIterations',
        { ...this.creds, project },
      );
      this.iterations.set(res.iterations);
    } catch (e) {
      this.fireToast((e as Error).message);
    }
  }

  async pull(): Promise<void> {
    const project = this.selectedProject();
    const iterationPath = this.selectedIteration();
    if (!this.creds || !project || !iterationPath) return;
    this.busy.set(true);
    this.override.set('loading');
    try {
      const res = await this.supabase.invoke<BoardResult>('pullSprint', {
        ...this.creds,
        project,
        iterationPath,
      });
      this.applyBoard(res);
      this.nav.set('board');
      this.fireToast(`Pulled ${res.tasks.length} tasks from Azure`);
    } catch (e) {
      this.override.set('error');
      this.fireToast((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  /** A FE/BE member claims a story they're working on; the board reflects it. */
  async startWork(azureId?: number): Promise<void> {
    await this.workOp('startWork', azureId, 'Started — you own this story now');
  }
  /** Release a claimed story back to the pool. */
  async stopWork(azureId?: number): Promise<void> {
    await this.workOp('stopWork', azureId, 'Stopped — story is back in the pool');
  }
  /** Mark a claimed story done on this member's track. */
  async doneWork(azureId?: number): Promise<void> {
    await this.workOp('doneWork', azureId, 'Marked done · nice work');
  }

  private async workOp(op: string, azureId: number | undefined, toast: string): Promise<void> {
    if (!azureId) return;
    try {
      const res = await this.supabase.invoke<BoardResult>(op, {
        id: azureId,
        actor: this.identity().name,
        role: this.role(),
        // The member's own creds → the proxy attributes the Azure state change
        // to them (and skips Azure if absent).
        orgUrl: this.creds?.orgUrl,
        pat: this.creds?.pat,
      });
      this.applyBoard(res);
      this.fireToast(toast);
    } catch (e) {
      this.fireToast((e as Error).message);
    }
  }

  private applyBoard(res: BoardResult): void {
    this.rawTasks.set((res.tasks ?? []).map((r) => this.rowToTask(r)));
    this.sprintName.set(
      res.sprint ? `${res.sprint.project} — ${this.lastSegment(res.sprint.iteration_path)}` : '',
    );
    this.override.set(this.rawTasks().length ? null : 'empty');
  }

  private rowToTask(r: TaskRow): Task {
    const c = deriveConv(r.design_state, r.frontend_state, r.backend_state, r.macro_state);
    return {
      uc: r.uc || `#${r.id}`,
      azureId: r.id,
      title: r.title,
      designer: r.designer || '—',
      feDev: r.fe_dev || '—',
      beDev: r.be_dev || '—',
      d: r.design_state,
      f: r.frontend_state,
      b: r.backend_state,
      conv: c,
      endpoint: r.endpoint || '— pending',
      dtos: '',
      closed: c === 'closed',
      feStartedBy: r.fe_started_by,
      beStartedBy: r.be_started_by,
    };
  }

  private lastSegment(path: string): string {
    return path.split('\\').filter(Boolean).pop() ?? path;
  }

  // ---- navigation / commands ---------------------------------------------
  setNav(nav: Nav): void {
    this.nav.set(nav);
  }
  setLayout(layout: BoardLayout): void {
    this.layout.set(layout);
  }

  openTask(uc: string): void {
    this.selectedUc.set(uc);
  }
  closeTask(): void {
    this.selectedUc.set(null);
  }
  openGen(): void {
    this.genOpen.set(true);
  }
  closeGen(): void {
    this.genOpen.set(false);
  }
  confirmGen(): void {
    this.genOpen.set(false);
    this.fireToast('Types added · state set to Integration');
  }
  /** Drawer action — mark the open story done on the current member's track. */
  markDone(): void {
    const uc = this.selectedUc();
    const t = uc ? this.rawTasks().find((x) => x.uc === uc) : null;
    this.selectedUc.set(null);
    if (t) this.doneWork(t.azureId);
  }

  fireToast(msg: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.set(msg);
    this.toastTimer = setTimeout(() => this.toast.set(''), 2600);
  }

  /** Reset transient + session state when leaving the app (sign out). */
  reset(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.creds = null;
    this.rawTasks.set([]);
    this.members.set([]);
    this.projects.set([]);
    this.iterations.set([]);
    this.selectedProject.set('');
    this.selectedIteration.set('');
    this.sprintName.set('');
    this.isAdmin.set(false);
    this.identity.set({ name: '—', ini: '·' });
    this.nav.set('mywork');
    this.layout.set('lanes');
    this.override.set(null);
    this.selectedUc.set(null);
    this.genOpen.set(false);
    this.toast.set('');
  }

  // ---- CTA factories (event handlers wired into view-models) --------------
  private toastCta(msg: string) {
    return (e?: Event) => {
      e?.stopPropagation();
      this.fireToast(msg);
    };
  }
  private openCta(uc: string) {
    return (e?: Event) => {
      e?.stopPropagation();
      this.openTask(uc);
    };
  }
  private startCta(azureId?: number) {
    return (e?: Event) => {
      e?.stopPropagation();
      this.startWork(azureId);
    };
  }
  private stopCta(azureId?: number) {
    return (e?: Event) => {
      e?.stopPropagation();
      this.stopWork(azureId);
    };
  }
  private doneCta(azureId?: number) {
    return (e?: Event) => {
      e?.stopPropagation();
      this.doneWork(azureId);
    };
  }

  // ---- My Work group builders (per role) ----------------------------------
  private buildMyGroups(role: Role, tasks: DecoratedTask[]): MyWorkGroup[] {
    const G = TRACK.frontend, T = TRACK.design, S = TRACK.backend, R = TRACK.alert, M = TRACK.slate;
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
      const mk = (t: DecoratedTask) => {
        let sub: string, ctaLabel: string, msg: string;
        if (t.d === 'design_wip') {
          sub = 'In Figma · ' + (t.feDev !== '—' ? t.feDev + ' waiting' : 'FE unassigned');
          ctaLabel = 'Mark Ready for dev';
          msg = t.uc + ' marked Ready for development · FE notified';
        } else if (t.d === 'todo') {
          sub = 'Not started yet';
          ctaLabel = 'Start in Figma';
          msg = 'Started a frame for ' + t.uc;
        } else if (t.d === 'design_ready') {
          sub = 'Handed off · ' + t.feDev + ' notified';
          ctaLabel = 'Open frame';
          msg = 'Opening ' + t.uc + ' in Figma';
        } else {
          sub = 'Edited after handoff · FE alerted';
          ctaLabel = 'Re-export & notify FE';
          msg = t.uc + ' re-exported · ' + t.feDev + ' alerted';
        }
        return card(t, { sub, pill: pill(t.d), who: t.designer, color: T, ctaLabel, cta: this.toastCta(msg) });
      };
      return [
        grp('Designing now', G, tasks.filter((t) => t.d === 'design_wip').map(mk)),
        grp('Up next', M, tasks.filter((t) => t.d === 'todo').map(mk)),
        grp('Ready for development', T, tasks.filter((t) => t.d === 'design_ready').map(mk)),
        grp('Changed after handoff', R, tasks.filter((t) => t.d === 'design_changed').map(mk)),
      ].filter((g) => g.count);
    }

    if (role === 'frontend' || role === 'backend') {
      const me = this.identity().name;
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
          cta: this.doneCta(t.azureId),
          cta2Label: 'Stop',
          cta2: this.stopCta(t.azureId),
        });
      const available = (t: DecoratedTask) =>
        card(t, {
          sub: 'Tap Start to claim this story',
          pill: trackPill(t),
          who: role === 'frontend' ? t.feDev : t.beDev,
          color: trackColor,
          ctaLabel: 'Start',
          cta: this.startCta(t.azureId),
        });
      const done = (t: DecoratedTask) =>
        card(t, {
          sub: 'Done by you',
          pill: trackPill(t),
          who: me,
          color: S,
          ctaLabel: 'Open',
          cta: this.openCta(t.uc),
        });
      const taken = (t: DecoratedTask) =>
        card(t, {
          sub: 'Started by ' + startedBy(t),
          pill: trackPill(t),
          who: startedBy(t) || '—',
          color: M,
          ctaLabel: 'Open',
          cta: this.openCta(t.uc),
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
          cta: this.openCta(t.uc),
        });
      return [
        grp('In progress', G, tasks.filter((t) => started(t) && !doneish(t)).map(mk(owners, G))),
        grp('Done', S, tasks.filter((t) => doneish(t)).map(mk(doneSub, S))),
        grp('Not started yet', M, tasks.filter((t) => !started(t) && !doneish(t)).map(mk(() => 'No one has started this yet', M))),
      ].filter((g) => g.count);
    }

    return [];
  }
}
