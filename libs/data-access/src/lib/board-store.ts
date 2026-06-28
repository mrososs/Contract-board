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
  ProjectSource,
  Role,
  Task,
  TaskLinks,
} from './models';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { buildMyGroups, MyWorkGroup } from './my-work-groups';
import { DEMO_ACTIVITY, DEMO_ENDPOINT_PROBES, DEMO_LINKS, DEMO_MEMBERS, DEMO_PROJECTS, DEMO_SOURCES, DEMO_TASKS } from './demo-data';
import { SupabaseService } from './supabase.service';
import { conv, deriveConv, initials, pill, roleInfo, TRACK } from './tokens';

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

/** A detected event for the activity feed (B4) — design ready, contract ready… */
export interface ActivityItem {
  id: string;
  kind: string;
  actor: string | null;
  message: string;
  created_at: string;
  uc?: string | null;
  title?: string | null;
}

/** A raw `activity` row as broadcast by the DB (snake_case, no task meta). */
interface ActivityRow {
  id: string;
  task_id: number | null;
  kind: string;
  actor: string | null;
  message: string;
  created_at: string;
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
  sprint_id?: string;
  project?: string | null;
  spec_url?: string | null;
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
  block_note: string | null;
  fe_started_by: string | null;
  be_started_by: string | null;
}
interface BoardResult {
  sprint: { project: string; iteration_path: string } | null;
  /** All active sprints (one per project) for the multi-project board. */
  sprints?: { project: string; iteration_path: string }[];
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
  /** Self-contained demo/mock mode — backend calls are short-circuited to local mutations. */
  readonly demoMode = signal(false);
  readonly rawTasks = signal<Task[]>([]);
  /** Multi-project board filter — '' shows every active project, else one. */
  readonly boardProject = signal<string>('');
  /** The team that has signed in (display_name + chosen role) — drives Insights. */
  readonly members = signal<{ display_name: string; role: Role; is_admin: boolean }[]>([]);

  // ---- activity feed (B4) + realtime (B3) ---------------------------------
  /** Detected events, newest first — design/contract ready, DTO changed, done. */
  readonly activity = signal<ActivityItem[]>([]);
  readonly activityOpen = signal(false);
  /** Events that arrived while the feed was closed — drives the bell badge. */
  readonly activityUnread = signal(0);

  /** The live 'board' broadcast channel; torn down on reset. */
  private channel: RealtimeChannel | null = null;

  // ---- admin: sprint setup ------------------------------------------------
  readonly sprintName = signal<string>('');
  readonly projects = signal<string[]>([]);
  readonly iterations = signal<{ name: string; path: string }[]>([]);
  readonly selectedProject = signal<string>('');
  readonly selectedIteration = signal<string>('');
  readonly busy = signal(false);

  // ---- per-project sources (admin Settings) -------------------------------
  readonly projectSources = signal<ProjectSource[]>([]);
  readonly sourcesBusy = signal(false);

  // ---- per-task mapping (drawer: endpoints + screens) ---------------------
  readonly taskLinks = signal<TaskLinks>({ endpoints: [], screens: [] });

  /** Azure credentials for this session — kept in memory only, never persisted. */
  private creds: { orgUrl: string; pat: string } | null = null;
  private toastTimer?: ReturnType<typeof setTimeout>;

  /** Distinct projects present on the board (drives the project switcher). */
  readonly boardProjects = computed<string[]>(() => {
    const set = new Set<string>();
    for (const t of this.rawTasks()) if (t.project) set.add(t.project);
    return [...set].sort();
  });

  // ---- derived: tasks (scoped to the selected project, if any) ------------
  readonly tasks = computed<DecoratedTask[]>(() => {
    const proj = this.boardProject();
    return this.rawTasks()
      .filter((t) => !proj || t.project === proj)
      .map((t) => ({
        ...t,
        dp: pill(t.d),
        fp: pill(t.f),
        bp: pill(t.b),
        cv: conv(t.conv),
        dtoList: t.dtos ? t.dtos.split(' · ') : [],
        open: () => this.openTask(t.uc),
      }));
  });

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
      case 'settings':
        return 'Project sources';
      default:
        return 'Insights';
    }
  });

  // ---- derived: My Work (role-focused) ------------------------------------
  readonly myGroups = computed<MyWorkGroup[]>(() =>
    buildMyGroups(this.role(), this.tasks(), {
      me: this.identity().name,
      toastCta: (msg) => this.toastCta(msg),
      openCta: (uc) => this.openCta(uc),
      startCta: (id) => this.startCta(id),
      stopCta: (id) => this.stopCta(id),
      doneCta: (id) => this.doneCta(id),
      designCta: (id, state) => this.designCta(id, state),
    }),
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
      /** Real spec URL (from the project's configured source) + the command to run. */
      specUrl: t.specUrl ?? null,
      genCmd: `npx ng-openapi-gen --input ${t.specUrl ?? '<set the OpenAPI spec URL in Settings>'} --output src/app/api`,
      /** Design handoff toggle for the designer drawer controls. */
      designReady: t.d === 'design_ready',
      /** Backend has published the contract (FE can integrate, not just scaffold). */
      contractReady: t.b === 'contract_ready' || t.b === 'be_done',
      /** FE is building UI from the design ahead of the contract. */
      scaffolding: t.f === 'fe_scaffold',
      /** FE blocker note (if raised) — shown as a banner to all lenses. */
      blockNote: t.reason ?? null,
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
    this.loadActivity();
    this.subscribeRealtime();
  }

  // ---- demo mode (self-contained mock; no backend) ------------------------
  /** Enter demo mode: seed a full mock board and bypass all backend calls. */
  startDemo(): void {
    this.demoMode.set(true);
    this.creds = null;
    this.identity.set({ name: 'Demo User', ini: 'DU' });
    this.isAdmin.set(false);
    this.role.set('pm');
    this.nav.set('mywork');
    this.boardProject.set('');
    // Recompute conv/closed from the track states so the board is consistent.
    this.rawTasks.set(
      DEMO_TASKS.map((t) => {
        const c = deriveConv(t.d, t.f, t.b, null);
        return { ...t, conv: c, closed: c === 'closed' };
      }),
    );
    this.members.set(DEMO_MEMBERS);
    this.activity.set(DEMO_ACTIVITY.map((a) => ({ ...a })));
    this.projects.set([...DEMO_PROJECTS]);
    this.projectSources.set(DEMO_SOURCES.map((s) => ({ ...s })));
    this.sprintName.set('Visits Management System — Sprint 1 (demo)');
    this.override.set(null);
  }

  /** Demo lens switcher — flip the role with no backend. */
  demoSetRole(role: Role): void {
    this.role.set(role);
    this.nav.set('mywork');
    this.closeTask();
  }

  /** Local in-memory task patch (demo) — re-derives conv/closed. */
  private patchTask(azureId: number | undefined, partial: Partial<Task>): void {
    if (azureId == null) return;
    this.rawTasks.update((list) =>
      list.map((t) => {
        if (t.azureId !== azureId) return t;
        const next = { ...t, ...partial };
        next.conv = deriveConv(next.d, next.f, next.b, null);
        next.closed = next.conv === 'closed';
        return next;
      }),
    );
  }

  /** Local start/stop/done (demo) mirroring the proxy's per-track effect. */
  private demoWork(op: string, azureId: number | undefined): void {
    const me = this.identity().name;
    const fe = this.role() === 'frontend';
    let partial: Partial<Task> = {};
    if (op === 'startWork') {
      if (fe) {
        // FE can start as soon as the design is ready: integrate when the
        // contract is already published, otherwise scaffold the UI from design.
        const cur = this.rawTasks().find((x) => x.azureId === azureId);
        const contractReady = cur?.b === 'contract_ready' || cur?.b === 'be_done';
        partial = { feStartedBy: me, feDev: me, f: contractReady ? 'fe_integration' : 'fe_scaffold' };
      } else {
        partial = { beStartedBy: me, beDev: me };
      }
    } else if (op === 'stopWork') {
      partial = fe ? { feStartedBy: null, f: 'fe_blocked' } : { beStartedBy: null };
    } else if (op === 'doneWork') {
      partial = fe ? { f: 'fe_done' } : { b: 'be_done' };
    }
    this.patchTask(azureId, partial);
  }

  /** Prepend a synthetic activity item (demo). */
  private pushDemoActivity(kind: string, message: string, azureId: number): void {
    const meta = this.rawTasks().find((x) => x.azureId === azureId);
    const item: ActivityItem = {
      id: 'demo-' + azureId + '-' + this.activity().length,
      kind,
      actor: this.identity().name,
      message,
      created_at: new Date().toISOString(),
      uc: meta?.uc ?? null,
      title: meta?.title ?? null,
    };
    this.activity.update((list) => [item, ...list].slice(0, 50));
    if (!this.activityOpen()) this.activityUnread.update((n) => n + 1);
  }

  /**
   * Demo "Test endpoints": replay the seeded probe scenario (DEMO_ENDPOINT_PROBES)
   * for this task so the walkthrough shows the live check deterministically — all
   * healthy flips it Contract Ready; a 500 holds it at Building with the failure
   * surfaced on the endpoints, the card label, and the activity feed.
   */
  private demoTestEndpoints(id: number): void {
    const now = new Date().toISOString();
    const cur = this.taskLinks();
    const scenario = DEMO_ENDPOINT_PROBES[id];
    const endpoints = cur.endpoints.map((e) => {
      const hit = scenario?.find((s) => s.operationId === e.operation_id);
      if (hit) return { ...e, health: hit.health, last_status: hit.status, last_checked_at: now };
      return e.present ? { ...e, health: 'ok' as const, last_status: 200, last_checked_at: now } : e;
    });
    this.taskLinks.set({ endpoints, screens: cur.screens });

    const required = endpoints.filter((e) => e.is_required);
    const failures = required.filter((e) => e.health === 'failed');
    const total = required.length;

    if (!failures.length) {
      const label = total === 1 ? required[0].endpoint ?? 'endpoint' : `${total} endpoints`;
      this.patchTask(id, { b: 'contract_ready', endpoint: label });
      this.pushDemoActivity('contract_ready', `Contract ready · ${label}`, id);
      this.fireToast('All endpoints healthy — contract verified');
    } else {
      const summary = failures.map((f) => `${f.endpoint ?? f.operation_id} → ${f.last_status ?? 'unreachable'}`).join('; ');
      this.patchTask(id, { endpoint: `${failures.length}/${total} endpoint${failures.length > 1 ? 's' : ''} failing` });
      this.pushDemoActivity('contract_check_failed', `Endpoint check failed · ${summary}`, id);
      this.fireToast(`${failures.length} endpoint${failures.length > 1 ? 's' : ''} failing`);
    }
  }

  /** Local endpoint/screen mapping mutations (demo). */
  private demoLinkOp(op: string, payload: Record<string, unknown>): void {
    const now = new Date().toISOString();
    const rid = () => 'demo-' + Math.random().toString(36).slice(2, 9);
    const cur = this.taskLinks();
    const eps = [...cur.endpoints];
    const scrs = [...cur.screens];
    if (op === 'setTaskEndpoint') {
      eps.push({ id: rid(), operation_id: String(payload['operationId']), endpoint: null, is_required: true, is_manual: true, present: false, last_diff: null, updated_at: now });
    } else if (op === 'addDesignLink') {
      const url = String(payload['url']);
      scrs.push({ id: rid(), node_id: url, frame_name: (payload['label'] as string) || 'Figma screen', url, is_required: true, is_manual: true, status: 'ready', fingerprint: null, updated_at: now });
    } else if (op === 'setTaskScreen') {
      scrs.push({ id: rid(), node_id: String(payload['nodeId']), frame_name: (payload['frameName'] as string) || null, url: null, is_required: true, is_manual: true, status: 'unknown', fingerprint: null, updated_at: now });
    } else if (op === 'deleteTaskLink') {
      const id = String(payload['id']);
      this.taskLinks.set(payload['kind'] === 'endpoint'
        ? { endpoints: eps.filter((e) => e.id !== id), screens: scrs }
        : { endpoints: eps, screens: scrs.filter((s) => s.id !== id) });
      return;
    }
    this.taskLinks.set({ endpoints: eps, screens: scrs });
  }

  // ---- realtime (B3) ------------------------------------------------------
  /**
   * Subscribe to the live 'board' broadcast (migration 0006). The DB broadcasts
   * each task / activity change to a public channel, so the browser stays live
   * without anon table-read access — we patch `rawTasks` and prepend `activity`
   * in place instead of refetching the whole board on every change.
   */
  private subscribeRealtime(): void {
    if (this.channel) return;
    this.channel = this.supabase.client
      .channel('board')
      .on('broadcast', { event: 'task' }, ({ payload }) => this.onTaskBroadcast(payload as TaskRow))
      .on('broadcast', { event: 'activity' }, ({ payload }) => this.onActivityBroadcast(payload as ActivityRow))
      .subscribe();
  }

  /** A single task changed elsewhere — patch it into the board in place. */
  private onTaskBroadcast(row: TaskRow | null): void {
    if (!row || row.id == null) return;
    const task = this.rowToTask(row);
    this.rawTasks.update((list) => {
      const i = list.findIndex((t) => t.azureId === task.azureId);
      if (i === -1) return [...list, task];
      const copy = list.slice();
      copy[i] = task;
      return copy;
    });
    if (this.override() === 'empty' && this.rawTasks().length) this.override.set(null);
  }

  /** A new detected event — prepend to the feed and badge it if the feed is shut. */
  private onActivityBroadcast(row: ActivityRow | null): void {
    if (!row || !row.id) return;
    const meta = this.rawTasks().find((t) => t.azureId === row.task_id);
    const item: ActivityItem = {
      id: row.id,
      kind: row.kind,
      actor: row.actor,
      message: row.message,
      created_at: row.created_at,
      uc: meta?.uc ?? null,
      title: meta?.title ?? null,
    };
    this.activity.update((list) => (list.some((a) => a.id === item.id) ? list : [item, ...list].slice(0, 50)));
    if (!this.activityOpen()) this.activityUnread.update((n) => n + 1);
  }

  // ---- activity feed (B4) -------------------------------------------------
  /** Load recent detected events (history) for the active sprint. */
  async loadActivity(): Promise<void> {
    if (this.demoMode()) return;
    try {
      const res = await this.supabase.invoke<{ activity: ActivityItem[] }>('getActivity');
      this.activity.set(res.activity ?? []);
    } catch {
      /* non-fatal — live broadcasts still populate the feed */
    }
  }

  toggleActivity(): void {
    const open = !this.activityOpen();
    this.activityOpen.set(open);
    if (open) this.activityUnread.set(0);
  }
  closeActivity(): void {
    this.activityOpen.set(false);
  }

  /** Fetch the active sprint's tasks from Supabase. */
  async loadBoard(): Promise<void> {
    if (this.demoMode()) return;
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
    if (this.demoMode()) return;
    try {
      const res = await this.supabase.invoke<{ members: { display_name: string; role: Role; is_admin: boolean }[] }>(
        'listMembers',
      );
      this.members.set(res.members ?? []);
    } catch {
      /* non-fatal */
    }
  }

  // ---- per-project sources (admin Settings) -------------------------------
  /** Load the configured per-project sources (admin only). */
  async loadProjectSources(): Promise<void> {
    if (!this.creds) return;
    try {
      const res = await this.supabase.invoke<{ sources: ProjectSource[] }>('listProjectSources', this.creds);
      this.projectSources.set(res.sources ?? []);
    } catch (e) {
      this.fireToast((e as Error).message);
    }
  }

  /** Upsert a project's spec URL / Figma file key + poll settings (admin only). */
  async saveProjectSource(p: {
    project: string;
    openapiSpecUrl: string;
    figmaFileKey: string;
    pollEnabled?: boolean;
    pollIntervalS?: number;
  }): Promise<void> {
    if (this.demoMode()) {
      this.projectSources.update((list) => {
        const row: ProjectSource = {
          id: 'demo-' + p.project, org_url: 'dev.azure.com/demo', project: p.project,
          openapi_spec_url: p.openapiSpecUrl || null, figma_file_key: p.figmaFileKey || null,
          poll_enabled: p.pollEnabled ?? true, poll_interval_s: p.pollIntervalS ?? 300,
          updated_at: new Date().toISOString(),
        };
        const i = list.findIndex((s) => s.project === p.project);
        if (i === -1) return [...list, row];
        const copy = list.slice(); copy[i] = row; return copy;
      });
      this.fireToast(`Saved sources for ${p.project}`);
      return;
    }
    if (!this.creds) return;
    this.sourcesBusy.set(true);
    try {
      const res = await this.supabase.invoke<{ sources: ProjectSource[] }>('setProjectSource', {
        ...this.creds,
        ...p,
      });
      this.projectSources.set(res.sources ?? []);
      this.fireToast(`Saved sources for ${p.project}`);
    } catch (e) {
      this.fireToast((e as Error).message);
    } finally {
      this.sourcesBusy.set(false);
    }
  }

  /** Connection test for an OpenAPI spec URL — returns op count or an error. */
  testOpenApi(openapiSpecUrl: string): Promise<{ ok: boolean; operations?: number; error?: string }> {
    if (this.demoMode()) return Promise.resolve({ ok: true, operations: 12 });
    return this.supabase.invoke('testOpenApiSource', { ...this.creds, openapiSpecUrl });
  }
  /** Connection test for a Figma file key — returns the file name or an error. */
  testFigma(figmaFileKey: string): Promise<{ ok: boolean; name?: string; error?: string }> {
    if (this.demoMode()) return Promise.resolve({ ok: true, name: 'Demo Figma File' });
    return this.supabase.invoke('testFigmaSource', { ...this.creds, figmaFileKey });
  }

  // ---- per-task mapping (drawer: endpoints + screens) ---------------------
  /** Load the endpoints + screens mapped to a task (drawer open). */
  async loadTaskLinks(taskId: number): Promise<void> {
    if (this.demoMode()) {
      const seed = DEMO_LINKS[taskId];
      this.taskLinks.set(seed ? { endpoints: [...seed.endpoints], screens: [...seed.screens] } : { endpoints: [], screens: [] });
      return;
    }
    try {
      const res = await this.supabase.invoke<TaskLinks>('listTaskLinks', { taskId });
      this.taskLinks.set({ endpoints: res.endpoints ?? [], screens: res.screens ?? [] });
    } catch {
      this.taskLinks.set({ endpoints: [], screens: [] });
    }
  }

  // ---- designer dashboard (manual design handoff) -------------------------
  /** Designer sets the design micro-state by hand (Start / Finish / Stop). */
  async setDesignState(azureId: number | undefined, state: string): Promise<void> {
    if (!azureId) return;
    if (this.demoMode()) {
      this.patchTask(azureId, { d: state as DesignState });
      if (state === 'design_ready') this.pushDemoActivity('design_ready', 'Design ready for development', azureId);
      this.fireToast(state === 'design_ready' ? 'Design marked Ready for development' : 'Design updated');
      return;
    }
    try {
      const res = await this.supabase.invoke<BoardResult>('setDesignState', {
        id: azureId,
        state,
        actor: this.identity().name,
      });
      this.applyBoard(res);
      this.fireToast(state === 'design_ready' ? 'Design marked Ready for development — FE/BE notified' : 'Design updated');
    } catch (e) {
      this.fireToast((e as Error).message);
    }
  }

  /** Designer pastes a Figma screen URL onto the open task. */
  async addDesignLink(url: string, label?: string): Promise<void> {
    const id = this.currentTaskId();
    if (!id || !url.trim()) return;
    await this.linkOp('addDesignLink', { taskId: id, url: url.trim(), label });
  }

  /** Drawer Finish/Reopen for the open task (designer). */
  finishDesign(): void {
    this.setDesignState(this.currentTaskId(), 'design_ready');
  }
  reopenDesign(): void {
    this.setDesignState(this.currentTaskId(), 'design_wip');
  }

  /** FE raises a blocker with a note → backend goes back to Building (rework). */
  async raiseBlocker(note: string): Promise<void> {
    const id = this.currentTaskId();
    if (!id || !note.trim()) return;
    if (this.demoMode()) {
      this.patchTask(id, { f: 'fe_blocked', b: 'be_wip', reason: note.trim() });
      this.pushDemoActivity('fe_blocker', note.trim(), id);
      this.fireToast('Blocker sent to backend');
      return;
    }
    try {
      const res = await this.supabase.invoke<BoardResult>('raiseBlocker', {
        id,
        note: note.trim(),
        actor: this.identity().name,
        orgUrl: this.creds?.orgUrl,
        pat: this.creds?.pat,
      });
      this.applyBoard(res);
      this.fireToast('Blocker sent to backend');
    } catch (e) {
      this.fireToast((e as Error).message);
    }
  }

  /** Pin a manual endpoint mapping to the open task. */
  async addEndpoint(operationId: string): Promise<void> {
    const id = this.currentTaskId();
    if (!id || !operationId.trim()) return;
    await this.linkOp('setTaskEndpoint', { taskId: id, operationId: operationId.trim() });
  }
  /** Pin a manual screen mapping to the open task. */
  async addScreen(nodeId: string, frameName?: string): Promise<void> {
    const id = this.currentTaskId();
    if (!id || !nodeId.trim()) return;
    await this.linkOp('setTaskScreen', { taskId: id, nodeId: nodeId.trim(), frameName });
  }
  /** Remove a mapping row from the open task. */
  async removeLink(kind: 'endpoint' | 'screen', linkId: string): Promise<void> {
    const id = this.currentTaskId();
    if (!id) return;
    await this.linkOp('deleteTaskLink', { taskId: id, kind, id: linkId });
  }

  /**
   * On-demand: smoke-test the open task's required endpoints against the live API
   * and run the Contract Ready gate (same check the openapi-worker runs on poll).
   */
  async testTaskEndpoints(): Promise<void> {
    const id = this.currentTaskId();
    if (!id) return;
    if (this.demoMode()) {
      this.demoTestEndpoints(id);
      return;
    }
    this.fireToast('Testing endpoints…');
    try {
      const res = await this.supabase.invoke<TaskLinks & { tested?: number; failed?: number; message?: string }>(
        'testTaskEndpoints',
        { taskId: id },
      );
      this.taskLinks.set({ endpoints: res.endpoints ?? [], screens: res.screens ?? [] });
      await this.loadBoard(); // backend_state may have flipped — refresh the pills
      const failed = res.failed ?? 0;
      this.fireToast(
        res.message ? res.message : failed ? `${failed} endpoint${failed > 1 ? 's' : ''} failing` : 'All endpoints healthy — contract verified',
      );
    } catch (e) {
      this.fireToast((e as Error).message);
    }
  }

  private async linkOp(op: string, payload: Record<string, unknown>): Promise<void> {
    if (this.demoMode()) {
      this.demoLinkOp(op, payload);
      return;
    }
    try {
      const res = await this.supabase.invoke<TaskLinks>(op, payload);
      this.taskLinks.set({ endpoints: res.endpoints ?? [], screens: res.screens ?? [] });
    } catch (e) {
      this.fireToast((e as Error).message);
    }
  }

  private currentTaskId(): number | undefined {
    const uc = this.selectedUc();
    return uc ? this.rawTasks().find((x) => x.uc === uc)?.azureId : undefined;
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
    if (this.demoMode()) {
      this.iterations.set([{ name: 'Sprint 1', path: `${project}\\Sprint 1` }]);
      return;
    }
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
    if (this.demoMode()) {
      this.nav.set('board');
      this.fireToast('Demo board is already loaded');
      return;
    }
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
    if (this.demoMode()) {
      this.demoWork(op, azureId);
      this.fireToast(toast);
      return;
    }
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
      project: r.project ?? null,
      specUrl: r.spec_url ?? null,
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
      reason: r.block_note ?? undefined,
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

  /** Switch the board to a single project (or '' for all active projects). */
  setBoardProject(project: string): void {
    this.boardProject.set(project);
  }

  openTask(uc: string): void {
    this.selectedUc.set(uc);
    const t = this.rawTasks().find((x) => x.uc === uc);
    this.taskLinks.set({ endpoints: [], screens: [] });
    if (t?.azureId) this.loadTaskLinks(t.azureId);
  }
  closeTask(): void {
    this.selectedUc.set(null);
    this.taskLinks.set({ endpoints: [], screens: [] });
  }
  openGen(): void {
    this.genOpen.set(true);
  }
  closeGen(): void {
    this.genOpen.set(false);
  }
  /** "Add to repo & set Integration" — flip the open task to fe_integration. */
  async confirmGen(): Promise<void> {
    const id = this.currentTaskId();
    this.genOpen.set(false);
    if (!id) return;
    if (this.demoMode()) {
      this.patchTask(id, { f: 'fe_integration' });
      this.fireToast('Types added · task moved to Integration');
      return;
    }
    try {
      const res = await this.supabase.invoke<BoardResult>('markIntegration', { id });
      this.applyBoard(res);
      this.fireToast('Task moved to Integration — run the copied command in your repo');
    } catch (e) {
      this.fireToast((e as Error).message);
    }
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
    if (this.channel) {
      this.supabase.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.creds = null;
    this.demoMode.set(false);
    this.rawTasks.set([]);
    this.boardProject.set('');
    this.projectSources.set([]);
    this.taskLinks.set({ endpoints: [], screens: [] });
    this.members.set([]);
    this.activity.set([]);
    this.activityOpen.set(false);
    this.activityUnread.set(0);
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
  private designCta(azureId: number | undefined, state: string) {
    return (e?: Event) => {
      e?.stopPropagation();
      this.setDesignState(azureId, state);
    };
  }
}
