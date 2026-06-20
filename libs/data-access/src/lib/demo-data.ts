/**
 * Demo-mode fixtures — a self-contained mock board for recording a client
 * walkthrough. No Supabase / Azure. Seeded into BoardStore by `startDemo()`;
 * `conv` is recomputed there via `deriveConv`, so the values here are indicative.
 *
 * The 12 tasks are arranged so every state, lane, convergence group, My-Work
 * group (designer / frontend / backend / PM), and Insights metric is non-empty.
 * The signed-in demo user is "Demo User" — several tasks are started by them so
 * the per-role "Working on" / "Done" groups populate.
 */
import { ProjectSource, Role, Task, TaskLinks } from './models';

const ME = 'Demo User';
const ts = '2026-06-20T09:00:00.000Z';

/** One mock task. `conv`/`closed` are recomputed on seed. */
function t(p: Partial<Task> & Pick<Task, 'uc' | 'azureId' | 'title' | 'd' | 'f' | 'b'>): Task {
  return {
    designer: 'Sara',
    feDev: 'Omar',
    beDev: 'Hana',
    conv: 'wait_design',
    endpoint: '— pending',
    dtos: '',
    project: 'Visits Management System',
    feStartedBy: null,
    beStartedBy: null,
    ...p,
  };
}

export const DEMO_TASKS: Task[] = [
  t({ uc: 'UC-01', azureId: 1001, title: 'User Login (Mobile) — Plan-Based Auth', d: 'todo', f: 'fe_blocked', b: 'be_wip', beStartedBy: 'Hana', beDev: 'Hana' }),
  t({ uc: 'UC-02', azureId: 1002, title: 'VMS Plans Page Update', d: 'design_wip', f: 'fe_blocked', b: 'be_wip' }),
  t({ uc: 'UC-03', azureId: 1003, title: 'Web Portal Login (Free Trial & Standard)', d: 'design_ready', f: 'fe_scaffold', b: 'be_wip' }),
  t({ uc: 'UC-04', azureId: 1004, title: 'Manage Subscription Entry Point', d: 'design_ready', f: 'fe_scaffold', b: 'contract_ready',
    feStartedBy: 'Omar', beStartedBy: ME, beDev: ME, endpoint: 'POST /uc-4/subscriptions', dtos: 'Subscription · Plan', specUrl: 'https://api.example.com/swagger/v1/swagger.json' }),
  t({ uc: 'UC-05', azureId: 1005, title: 'Standard Plan Self-Renewal with Online Payment', d: 'design_ready', f: 'fe_integration', b: 'contract_ready',
    feStartedBy: ME, feDev: ME, beStartedBy: 'Hana', endpoint: 'POST /uc-5/renew', dtos: 'RenewRequest · RenewResult', specUrl: 'https://api.example.com/swagger/v1/swagger.json' }),
  t({ uc: 'UC-06', azureId: 1006, title: 'Site Management: Add & Activate Site', d: 'design_ready', f: 'fe_changed', b: 'contract_ready',
    feStartedBy: 'Omar', beStartedBy: 'Hana', hasDiff: true, reason: 'Contract DTOs changed after FE started', endpoint: 'POST /uc-6/sites', dtos: 'Site · SiteList', specUrl: 'https://api.example.com/swagger/v1/swagger.json' }),
  t({ uc: 'UC-07', azureId: 1007, title: 'Subscription Expiry & Access Block', d: 'design_changed', f: 'fe_integration', b: 'be_wip',
    project: 'VMS Mobile', feStartedBy: 'Omar', reason: 'Design edited after handoff — review before continuing' }),
  t({ uc: 'UC-08', azureId: 1008, title: 'Edit User Profile (Personal Info)', d: 'design_ready', f: 'fe_done', b: 'be_wip',
    feStartedBy: ME, feDev: ME, endpoint: 'POST /uc-8/profile', dtos: 'Profile', specUrl: 'https://api.example.com/swagger/v1/swagger.json' }),
  t({ uc: 'UC-09', azureId: 1009, title: 'Change Password (Logged-in User)', d: 'design_ready', f: 'fe_blocked', b: 'be_wip' }),
  t({ uc: 'UC-10', azureId: 1010, title: 'Subscription Cancellation & Reactivation', d: 'design_ready', f: 'fe_done', b: 'be_done',
    feStartedBy: ME, feDev: ME, beStartedBy: ME, beDev: ME, endpoint: 'POST /uc-10/cancel', dtos: 'CancelResult' }),
  t({ uc: 'UC-11', azureId: 1011, title: 'Manage App Users (List)', d: 'design_ready', f: 'fe_done', b: 'be_done',
    project: 'iSaned App', feStartedBy: 'Omar', beStartedBy: 'Hana', endpoint: 'GET /uc-11/users', dtos: 'UserList' }),
  t({ uc: 'UC-12', azureId: 1012, title: 'Landing Page Content Updates', d: 'todo', f: 'fe_blocked', b: 'be_wip',
    project: 'iSaned App', designer: 'Dave', feDev: 'Eve', beDev: 'Frank', beStartedBy: 'Frank' }),
];

export const DEMO_MEMBERS: { display_name: string; role: Role; is_admin: boolean }[] = [
  { display_name: 'Sara Adel', role: 'designer', is_admin: false },
  { display_name: 'Omar Khaled', role: 'frontend', is_admin: false },
  { display_name: 'Hana Mostafa', role: 'backend', is_admin: false },
  { display_name: 'Demo User', role: 'pm', is_admin: false },
];

export const DEMO_ACTIVITY = [
  { id: 'demo-a1', kind: 'contract_ready', actor: 'openapi-worker', message: 'Contract ready · POST /uc-4/subscriptions', created_at: ts, uc: 'UC-04', title: 'Manage Subscription Entry Point' },
  { id: 'demo-a2', kind: 'design_ready', actor: 'Sara', message: 'Design ready for development', created_at: ts, uc: 'UC-03', title: 'Web Portal Login' },
  { id: 'demo-a3', kind: 'endpoint_ready', actor: 'openapi-worker', message: 'Endpoint ready · POST /uc-5/renew', created_at: ts, uc: 'UC-05', title: 'Self-Renewal with Online Payment' },
  { id: 'demo-a4', kind: 'contract_changed', actor: 'openapi-worker', message: 'Contract changed · POST /uc-6/sites', created_at: ts, uc: 'UC-06', title: 'Site Management' },
];

/** Per-task endpoints/screens (keyed by azureId) for the drawer N:N + design links. */
export const DEMO_LINKS: Record<number, TaskLinks> = {
  1004: {
    endpoints: [
      { id: 'e1', operation_id: 'createUC4Subscription', endpoint: 'POST /uc-4/subscriptions', is_required: true, is_manual: false, present: true, last_diff: null, updated_at: ts },
      { id: 'e2', operation_id: 'getUC4Plans', endpoint: 'GET /uc-4/plans', is_required: true, is_manual: false, present: true, last_diff: null, updated_at: ts },
    ],
    screens: [
      { id: 's1', node_id: 'https://figma.com/design/DEMO/Subscription', frame_name: 'UC-4 · Subscription', url: 'https://figma.com/design/DEMO/Subscription', is_required: true, is_manual: true, status: 'ready', fingerprint: null, updated_at: ts },
    ],
  },
  1005: {
    endpoints: [
      { id: 'e3', operation_id: 'createUC5Renew', endpoint: 'POST /uc-5/renew', is_required: true, is_manual: false, present: true, last_diff: null, updated_at: ts },
    ],
    screens: [
      { id: 's2', node_id: 'https://figma.com/design/DEMO/Renew', frame_name: 'UC-5 · Renewal', url: 'https://figma.com/design/DEMO/Renew', is_required: true, is_manual: true, status: 'ready', fingerprint: null, updated_at: ts },
    ],
  },
  1006: {
    endpoints: [
      { id: 'e4', operation_id: 'createUC6Site', endpoint: 'POST /uc-6/sites', is_required: true, is_manual: false, present: true, last_diff: null, updated_at: ts },
    ],
    screens: [],
  },
};

export const DEMO_PROJECTS = ['Visits Management System', 'VMS Mobile', 'iSaned App'];

export const DEMO_SOURCES: ProjectSource[] = [
  { id: 'src-1', org_url: 'dev.azure.com/demo', project: 'Visits Management System', openapi_spec_url: 'https://api.example.com/swagger/v1/swagger.json', figma_file_key: 'DEMOfilekey123', poll_enabled: true, poll_interval_s: 300, updated_at: ts },
];
