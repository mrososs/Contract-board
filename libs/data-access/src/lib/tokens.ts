import { BackendState, ConvKey, DesignState, FrontendState, Pill, PillKey, Role, RoleInfo } from './models';

/** Track accent colors — single source shared with the global theme. */
export const TRACK = {
  design: '#3BA7B3',
  frontend: '#CBA86E',
  backend: '#7FB07F',
  alert: '#D9885F',
  slate: '#9097A0',
} as const;

/** Status-pill lookup: [label, foreground, background]. */
const PILL: Record<PillKey, [string, string, string]> = {
  todo: ['To Do', '#9097A0', 'rgba(144,151,160,0.13)'],
  design_wip: ['Designing', '#CBA86E', 'rgba(203,168,110,0.15)'],
  design_ready: ['Design Ready', '#3BA7B3', 'rgba(59,167,179,0.16)'],
  design_changed: ['Design Changed', '#D9885F', 'rgba(217,136,95,0.16)'],
  be_wip: ['Building', '#CBA86E', 'rgba(203,168,110,0.15)'],
  contract_ready: ['Contract Ready', '#3BA7B3', 'rgba(59,167,179,0.16)'],
  be_done: ['BE Done', '#7FB07F', 'rgba(127,176,127,0.16)'],
  fe_blocked: ['Blocked', '#9097A0', 'rgba(144,151,160,0.13)'],
  fe_scaffold: ['Scaffolding', '#CBA86E', 'rgba(203,168,110,0.15)'],
  fe_integration: ['Integrating', '#CBA86E', 'rgba(203,168,110,0.15)'],
  fe_changed: ['Re-syncing', '#D9885F', 'rgba(217,136,95,0.16)'],
  fe_done: ['FE Done', '#7FB07F', 'rgba(127,176,127,0.16)'],
  closed: ['Closed', '#7FB07F', 'rgba(127,176,127,0.16)'],
};

export function pill(state: PillKey): Pill {
  const m = PILL[state] ?? PILL.todo;
  return { label: m[0], fg: m[1], bg: m[2] };
}

const CONV: Record<ConvKey, [string, string]> = {
  ready: ['Ready to integrate', '#7FB07F'],
  scaffold: ['Scaffolding from design', '#CBA86E'],
  alert: ['Needs attention', '#D9885F'],
  wait_design: ['Waiting on design', '#9097A0'],
  wait_be: ['Waiting on backend', '#9097A0'],
  closed: ['Closed', '#7FB07F'],
};

export function conv(c: ConvKey): Pill {
  const m = CONV[c] ?? CONV.scaffold;
  return { label: m[0], fg: m[1], bg: m[1] + '22' };
}

/**
 * Derive the cross-track convergence from the three track states (+ Azure
 * macro-status). Live rows have no stored `conv` — the demo data hard-coded it.
 * Encodes the planning-doc gate: the Frontend needs BOTH a ready design and a
 * ready contract before it can fully integrate.
 */
export function deriveConv(
  d: DesignState,
  f: FrontendState,
  b: BackendState,
  macro?: string | null,
): ConvKey {
  if (macro === 'Closed' || macro === 'Done' || (f === 'fe_done' && b === 'be_done')) {
    return 'closed';
  }
  if (d === 'design_changed' || f === 'fe_changed') return 'alert';
  const designReady = d === 'design_ready';
  const contractReady = b === 'contract_ready' || b === 'be_done';
  if (designReady && contractReady) return 'ready';
  if (designReady) return f === 'fe_scaffold' ? 'scaffold' : 'wait_be';
  return 'wait_design';
}

/** Two-letter initials, or a middot for unassigned ("—"). */
export function initials(name: string): string {
  if (!name || name === '—') return '·';
  const p = name.split(' ');
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

// Role describes the LENS, not the person — identity (name/initials) comes from
// the Azure-resolved session and is merged in by the store. The name/ini here
// are only fallbacks shown before an identity is resolved.
const ROLES: Record<Role, RoleInfo> = {
  designer: { name: 'Designer', ini: 'D', track: 'Design', color: TRACK.design, tab: 'My design queue' },
  frontend: { name: 'Frontend', ini: 'F', track: 'Frontend', color: TRACK.frontend, tab: 'What can I touch?' },
  backend: { name: 'Backend', ini: 'B', track: 'Backend', color: TRACK.backend, tab: 'My services' },
  pm: { name: 'Lead / PM', ini: 'PM', track: 'Lead / PM', color: TRACK.slate, tab: 'Team pulse' },
};

export function roleInfo(role: Role): RoleInfo {
  return ROLES[role] ?? ROLES.frontend;
}
