/**
 * ContractBoard domain model.
 *
 * Mirrors the task lifecycle from the planning doc: three tracks
 * (Design → Frontend → Backend) each with their own micro-state, plus a
 * derived "convergence" view that answers "what is this task blocked on?".
 */

export type Role = 'designer' | 'frontend' | 'backend' | 'pm';

/** Design track (Figma → Ready for development). */
export type DesignState =
  | 'todo'
  | 'design_wip'
  | 'design_ready'
  | 'design_changed';

/** Frontend track — needs BOTH design + contract before full integration. */
export type FrontendState =
  | 'fe_blocked'
  | 'fe_scaffold'
  | 'fe_integration'
  | 'fe_changed'
  | 'fe_done';

/** Backend track (OpenAPI → Contract ready). */
export type BackendState = 'be_wip' | 'contract_ready' | 'be_done';

/** Any per-track state that maps to a status pill. */
export type PillKey =
  | DesignState
  | FrontendState
  | BackendState
  | 'closed';

/** Cross-track convergence — the answer to "what's blocking this?". */
export type ConvKey =
  | 'ready'
  | 'scaffold'
  | 'alert'
  | 'wait_design'
  | 'wait_be'
  | 'closed';

export type Nav = 'mywork' | 'board' | 'insights' | 'settings';
export type BoardLayout = 'lanes' | 'matrix' | 'conv';
/** Prototype/data-fetch states layered over the board. */
export type BoardOverride = null | 'loading' | 'empty' | 'error';

/** Visual token for a status chip — color + label (never color alone). */
export interface Pill {
  label: string;
  fg: string;
  bg: string;
}

/** A work item, keyed by its Azure/UC id, with all three track states. */
export interface Task {
  uc: string;
  /** Azure DevOps work item id — the write-back key for state/completed-work. */
  azureId?: number;
  /** Azure project this task belongs to — drives the multi-project switcher. */
  project?: string | null;
  /** The project's OpenAPI spec URL — what `ng-openapi-gen` generates from. */
  specUrl?: string | null;
  title: string;
  designer: string;
  feDev: string;
  beDev: string;
  d: DesignState;
  f: FrontendState;
  b: BackendState;
  conv: ConvKey;
  endpoint: string;
  /** " · "-joined DTO names. */
  dtos: string;
  hasDiff?: boolean;
  reason?: string;
  alert?: string;
  closed?: boolean;
  /** Who pressed "Start" on each track (the member working the story). */
  feStartedBy?: string | null;
  beStartedBy?: string | null;
}

/** Task enriched with the view tokens the templates consume. */
export interface DecoratedTask extends Task {
  dp: Pill;
  fp: Pill;
  bp: Pill;
  cv: Pill;
  dtoList: string[];
  /** Opens the task detail drawer. */
  open: (e?: Event) => void;
}

export interface RoleInfo {
  name: string;
  ini: string;
  track: string;
  color: string;
  tab: string;
}

// ---- per-project sources + N:N task mapping (design: per-project-sources) ----

/** A project's configured sync sources (admin Settings). No secret values. */
export interface ProjectSource {
  id: string;
  org_url: string;
  project: string;
  openapi_spec_url: string | null;
  figma_file_key: string | null;
  poll_enabled: boolean;
  poll_interval_s: number;
  updated_at: string;
}

/** One OpenAPI endpoint a task requires (many per task). */
export interface TaskEndpointLink {
  id: string;
  operation_id: string;
  endpoint: string | null;
  is_required: boolean;
  is_manual: boolean;
  present: boolean;
  last_diff: unknown | null;
  updated_at: string;
}

/** One Figma frame a task requires (many per task). */
export interface TaskScreenLink {
  id: string;
  node_id: string;
  frame_name: string | null;
  is_required: boolean;
  is_manual: boolean;
  status: 'wip' | 'ready' | 'changed' | 'unknown';
  fingerprint: string | null;
  updated_at: string;
}

/** The endpoints + screens mapped to one task, for the drawer editor. */
export interface TaskLinks {
  endpoints: TaskEndpointLink[];
  screens: TaskScreenLink[];
}
