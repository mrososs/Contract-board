// Azure DevOps proxy (Supabase Edge Function).
//
// Azure REST blocks direct browser (CORS) calls and the PAT must stay
// server-side — so ALL Azure traffic goes through here (planning doc §5).
// The admin pastes their PAT in the login form; it is sent per-request and
// NEVER stored. Writes use the caller's own PAT so Azure records who acted.
//
// DB access uses the auto-injected SUPABASE_SERVICE_ROLE_KEY (bypasses RLS);
// the browser only ever holds the public anon key and invokes this function.
//
// Deploy:  supabase functions deploy azure-proxy   (or via the Supabase MCP)

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Admin identities (set the active Project/Sprint + pull the board). Read from
// the ADMIN_EMAILS secret (comma-separated) so adding/removing an admin needs no
// code change + redeploy (A1). Falls back to the original owner when the secret
// isn't set, so deploying this can never lock the admin out — once you set
// `ADMIN_EMAILS` the fallback is dead weight and can be removed. Matched
// case-insensitively against the Azure-resolved unique name, and on the
// local-part prefix so org email variants still match.
const ADMIN_EMAILS = (Deno.env.get('ADMIN_EMAILS') ?? 'mohamed.osama@obeikan.com.sa')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const AZURE_API = '7.1';

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ProxyRequest {
  op:
    | 'resolveIdentity'
    | 'setRole'
    | 'listProjects'
    | 'listIterations'
    | 'pullSprint'
    | 'getBoard'
    | 'getActivity'
    | 'listMembers'
    | 'startWork'
    | 'stopWork'
    | 'doneWork'
    | 'setState'
    | 'addCompletedWork'
    // per-project sources (admin) + N:N task mapping
    | 'listProjectSources'
    | 'setProjectSource'
    | 'testOpenApiSource'
    | 'testFigmaSource'
    | 'listTaskLinks'
    | 'setTaskEndpoint'
    | 'setTaskScreen'
    | 'deleteTaskLink';
  payload: Record<string, unknown>;
}

// --- helpers ---------------------------------------------------------------

/** "https://dev.azure.com/iSaned" | "dev.azure.com/iSaned" -> { base, org }. */
function parseOrg(orgUrl: string): { base: string; org: string } {
  const clean = String(orgUrl).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const org = clean.split('/').filter(Boolean).pop() ?? '';
  return { base: `https://${clean}`, org };
}

function patHeader(pat: string): string {
  return 'Basic ' + btoa(':' + pat);
}

async function azure(
  url: string,
  pat: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: patHeader(pat),
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Azure ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

function isAdmin(uniqueName: string): boolean {
  const u = (uniqueName ?? '').toLowerCase();
  return ADMIN_EMAILS.some((e) => {
    const prefix = e.split('@')[0];
    return u === e || (!!prefix && u.startsWith(prefix));
  });
}

/**
 * Move a work item to the state whose process category matches — so it works on
 * any template (Agile "Active/Closed", Scrum "Committed/Done", CMMI, custom).
 * Best-effort: returns the applied state name, or the current state if the type
 * has no matching state / the PATCH is rejected. Writes under the caller's PAT.
 */
async function azureSetCategory(
  base: string,
  pat: string,
  id: number,
  category: 'Proposed' | 'InProgress' | 'Completed',
): Promise<string | null> {
  try {
    const wi = (await azure(
      `${base}/_apis/wit/workitems/${id}?fields=System.WorkItemType,System.TeamProject,System.State&api-version=${AZURE_API}`,
      pat,
    )) as { fields: Record<string, string> };
    const type = wi.fields['System.WorkItemType'];
    const project = wi.fields['System.TeamProject'];
    const current = wi.fields['System.State'];
    const st = (await azure(
      `${base}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=${AZURE_API}`,
      pat,
    )) as { value?: { name: string; category: string }[] };
    const target = (st.value ?? []).find((s) => s.category === category);
    if (!target || target.name === current) return current;
    await azure(`${base}/_apis/wit/workitems/${id}?api-version=${AZURE_API}`, pat, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify([{ op: 'add', path: '/fields/System.State', value: target.name }]),
    });
    return target.name;
  } catch (_e) {
    return null; // never block the local workflow update on an Azure hiccup
  }
}

/** Pull the UC / work-item tag out of a title, e.g. "UC-12 Foo" -> "UC-12". */
function parseUc(title: string): string | null {
  const m = String(title).match(/\bUC[-\s]?(\d+)\b/i);
  return m ? `UC-${m[1]}` : null;
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
function fail(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// --- ops -------------------------------------------------------------------

/** Resolve "who owns this token" via connectionData — identity, no password. */
async function resolveIdentity(p: Record<string, unknown>) {
  const { base } = parseOrg(p.orgUrl as string);
  const pat = p.pat as string;
  const data = (await azure(
    `${base}/_apis/connectionData?api-version=${AZURE_API}-preview`,
    pat,
  )) as {
    authenticatedUser?: {
      providerDisplayName?: string;
      properties?: { Account?: { $value?: string } };
    };
  };
  const au = data.authenticatedUser ?? {};
  const displayName = au.providerDisplayName ?? 'Unknown';
  const uniqueName = au.properties?.Account?.$value ?? displayName;
  const admin = isAdmin(uniqueName);

  // Upsert the person; admins default to the 'pm' (full-board) lens.
  const { data: existing } = await db
    .from('app_user')
    .select('id, role')
    .eq('azure_unique_name', uniqueName)
    .maybeSingle();

  const role = existing?.role ?? (admin ? 'pm' : null);
  await db.from('app_user').upsert(
    { azure_unique_name: uniqueName, display_name: displayName, is_admin: admin, role },
    { onConflict: 'azure_unique_name' },
  );

  return { displayName, uniqueName, isAdmin: admin, role };
}

async function setRole(p: Record<string, unknown>) {
  const uniqueName = p.uniqueName as string;
  const role = p.role as string;
  await db.from('app_user').update({ role }).eq('azure_unique_name', uniqueName);
  return { uniqueName, role };
}

async function listProjects(p: Record<string, unknown>) {
  const { base } = parseOrg(p.orgUrl as string);
  const data = (await azure(
    `${base}/_apis/projects?api-version=${AZURE_API}&$top=200`,
    p.pat as string,
  )) as { value?: { name: string }[] };
  return { projects: (data.value ?? []).map((x) => x.name).sort() };
}

async function listIterations(p: Record<string, unknown>) {
  const { base } = parseOrg(p.orgUrl as string);
  const project = encodeURIComponent(p.project as string);
  const data = (await azure(
    `${base}/${project}/_apis/work/teamsettings/iterations?api-version=${AZURE_API}`,
    p.pat as string,
  )) as { value?: { name: string; path: string }[] };
  return {
    iterations: (data.value ?? []).map((x) => ({ name: x.name, path: x.path })),
  };
}

async function pullSprint(p: Record<string, unknown>) {
  const { base } = parseOrg(p.orgUrl as string);
  const pat = p.pat as string;
  const project = p.project as string;
  const iterationPath = p.iterationPath as string;
  const projectEnc = encodeURIComponent(project);

  // 1) WIQL — IDs only, filtered Azure-side to this project + sprint.
  //    Story-level items only (not child Tasks/Bugs) via the process-agnostic
  //    Requirement category: User Story (Agile) / Product Backlog Item (Scrum) /
  //    Requirement (CMMI). Each board card is one story.
  const wiql = [
    'SELECT [System.Id] FROM WorkItems',
    `WHERE [System.TeamProject] = '${project.replace(/'/g, "''")}'`,
    `  AND [System.IterationPath] = '${iterationPath.replace(/'/g, "''")}'`,
    `  AND [System.WorkItemType] IN GROUP 'Microsoft.RequirementCategory'`,
    'ORDER BY [System.State]',
  ].join('\n');
  const wiqlRes = (await azure(
    `${base}/${projectEnc}/_apis/wit/wiql?api-version=${AZURE_API}`,
    pat,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: wiql }),
    },
  )) as { workItems?: { id: number }[] };
  const ids = (wiqlRes.workItems ?? []).map((w) => w.id);

  // 2) Batched details for those IDs.
  let items: { id: number; fields: Record<string, unknown> }[] = [];
  if (ids.length) {
    const batch = (await azure(
      `${base}/_apis/wit/workitemsbatch?api-version=${AZURE_API}`,
      pat,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: ids.slice(0, 200),
          fields: [
            'System.Id',
            'System.Title',
            'System.State',
            'System.AssignedTo',
            'System.IterationPath',
            'System.WorkItemType',
          ],
        }),
      },
    )) as { value?: { id: number; fields: Record<string, unknown> }[] };
    items = batch.value ?? [];
  }

  // 3) Upsert the active sprint, then the tasks. Deactivation is scoped to THIS
  //    project so each project keeps its own active sprint (multi-project board).
  const { org } = parseOrg(p.orgUrl as string);
  const orgUrl = `dev.azure.com/${org}`;
  await db
    .from('sprint')
    .update({ is_active: false })
    .eq('org_url', orgUrl)
    .eq('project', project)
    .neq('iteration_path', iterationPath);
  const { data: sprintRow, error: sErr } = await db
    .from('sprint')
    .upsert(
      { org_url: orgUrl, project, iteration_path: iterationPath, is_active: true },
      { onConflict: 'org_url,project,iteration_path' },
    )
    .select('id')
    .single();
  if (sErr) throw new Error(`sprint upsert: ${sErr.message}`);
  const sprintId = sprintRow!.id;

  const rows = items.map((it) => {
    const f = it.fields;
    const assigned = f['System.AssignedTo'] as { displayName?: string } | undefined;
    const who = assigned?.displayName ?? '—';
    const title = (f['System.Title'] as string) ?? `Work item ${it.id}`;
    return {
      id: it.id,
      sprint_id: sprintId,
      uc: parseUc(title),
      title,
      macro_state: (f['System.State'] as string) ?? null,
      assigned_to: who,
      // One Azure assignee maps across the three lanes until the sync workers
      // refine per-track ownership; track micro-states keep their defaults.
      designer: who,
      fe_dev: who,
      be_dev: who,
      endpoint: '— pending',
    };
  });

  // Drop rows that are no longer in this sprint's pull (e.g. removed, or the
  // old all-types pull). Upsert below preserves the `*_started_by` fields on
  // surviving stories because we don't include them in the payload.
  const incoming = rows.map((r) => r.id);
  const stale = db.from('task').delete().eq('sprint_id', sprintId);
  await (incoming.length ? stale.not('id', 'in', `(${incoming.join(',')})`) : stale);

  if (rows.length) {
    const { error: tErr } = await db.from('task').upsert(rows, { onConflict: 'id' });
    if (tErr) throw new Error(`task upsert: ${tErr.message}`);
  }

  return getBoard();
}

/**
 * Recent detected events for the active sprint (Design Ready, Contract Ready,
 * DTO changed, FE/BE done …) — feeds the activity panel. Reads use the service
 * role so the browser never queries the table directly; live updates arrive via
 * the Realtime 'board' broadcast (see migration 0006).
 */
async function getActivity() {
  // All active sprints (one per project) — activity spans every live project.
  const { data: sprints } = await db.from('sprint').select('id').eq('is_active', true);
  const sprintIds = (sprints ?? []).map((s) => s.id);
  if (!sprintIds.length) return { activity: [] };

  const { data: tasks } = await db
    .from('task')
    .select('id, uc, title')
    .in('sprint_id', sprintIds);
  const ids = (tasks ?? []).map((t) => t.id);
  if (!ids.length) return { activity: [] };
  const meta = new Map((tasks ?? []).map((t) => [t.id, { uc: t.uc, title: t.title }]));

  const { data } = await db
    .from('activity')
    .select('id, task_id, kind, actor, message, created_at')
    .in('task_id', ids)
    .order('created_at', { ascending: false })
    .limit(50);

  return {
    activity: (data ?? []).map((a) => ({
      ...a,
      uc: meta.get(a.task_id)?.uc ?? null,
      title: meta.get(a.task_id)?.title ?? null,
    })),
  };
}

/** The team that has signed in, with the lens each picked — drives Insights. */
async function listMembers() {
  const { data } = await db
    .from('app_user')
    .select('display_name, role, is_admin')
    .not('role', 'is', null)
    .order('display_name');
  return { members: data ?? [] };
}

/**
 * The board across ALL active sprints (one per project). Returns every live
 * project's sprint plus the union of their tasks, each task tagged with its
 * `project` so the UI can filter/switch. `sprint` is kept as the most-recent
 * active sprint for backwards compatibility with the single-project client.
 */
async function getBoard() {
  const { data: sprints } = await db
    .from('sprint')
    .select('id, project, iteration_path')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  const list = sprints ?? [];
  if (!list.length) return { sprint: null, sprints: [], tasks: [] };

  const byId = new Map(list.map((s) => [s.id, s]));
  const { data: tasks } = await db
    .from('task')
    .select(
      'id, sprint_id, uc, title, macro_state, assigned_to, designer, fe_dev, be_dev, endpoint, design_state, frontend_state, backend_state, fe_started_by, fe_started_at, be_started_by, be_started_at',
    )
    .in('sprint_id', list.map((s) => s.id))
    .order('id');

  const withProject = (tasks ?? []).map((t) => ({
    ...t,
    project: byId.get(t.sprint_id)?.project ?? null,
  }));
  return { sprint: list[0], sprints: list, tasks: withProject };
}

/**
 * A FE/BE member claims a user story they're working on. Records the actor on
 * that track (so the board shows who's on each story) and nudges the track
 * state — frontend → Integrating; backend stays Building. Supabase-only for now
 * (no Azure macro write, to stay safe across process templates).
 */
async function startWork(p: Record<string, unknown>) {
  const id = p.id as number;
  const actor = (p.actor as string) || 'Unknown';
  const role = p.role as string;
  const at = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (role === 'frontend') {
    patch = { fe_started_by: actor, fe_started_at: at, fe_dev: actor, frontend_state: 'fe_integration', updated_at: at };
  } else if (role === 'backend') {
    patch = { be_started_by: actor, be_started_at: at, be_dev: actor, updated_at: at };
  } else {
    throw new Error('Only Frontend or Backend can start a story.');
  }
  const { error } = await db.from('task').update(patch).eq('id', id);
  if (error) throw new Error(`startWork: ${error.message}`);
  await reflectAzure(p, id, 'InProgress');
  return getBoard();
}

/** Reflect a local workflow change back to Azure (best-effort, caller's PAT). */
async function reflectAzure(
  p: Record<string, unknown>,
  id: number,
  category: 'Proposed' | 'InProgress' | 'Completed',
) {
  const pat = p.pat as string;
  const orgUrl = p.orgUrl as string;
  if (!pat || !orgUrl) return;
  const { base } = parseOrg(orgUrl);
  const applied = await azureSetCategory(base, pat, id, category);
  if (applied) {
    await db.from('task').update({ macro_state: applied, updated_at: new Date().toISOString() }).eq('id', id);
  }
}

/** Release a claimed story back to the pool (Stop). */
async function stopWork(p: Record<string, unknown>) {
  const id = p.id as number;
  const role = p.role as string;
  const at = new Date().toISOString();
  const { data: row } = await db.from('task').select('assigned_to').eq('id', id).maybeSingle();
  const who = (row && row.assigned_to) || '—';
  let patch: Record<string, unknown>;
  if (role === 'frontend') {
    patch = { fe_started_by: null, fe_started_at: null, frontend_state: 'fe_blocked', fe_dev: who, updated_at: at };
  } else if (role === 'backend') {
    patch = { be_started_by: null, be_started_at: null, be_dev: who, updated_at: at };
  } else {
    throw new Error('Only Frontend or Backend can stop a story.');
  }
  const { error } = await db.from('task').update(patch).eq('id', id);
  if (error) throw new Error(`stopWork: ${error.message}`);
  // If the story is now fully unclaimed, revert Azure to the not-started state.
  const { data: after } = await db
    .from('task')
    .select('fe_started_by, be_started_by, frontend_state, backend_state')
    .eq('id', id)
    .maybeSingle();
  if (after && !after.fe_started_by && !after.be_started_by &&
      after.frontend_state !== 'fe_done' && after.backend_state !== 'be_done') {
    await reflectAzure(p, id, 'Proposed');
  }
  return getBoard();
}

/** Mark a claimed story done on the caller's track (FE → fe_done, BE → be_done). */
async function doneWork(p: Record<string, unknown>) {
  const id = p.id as number;
  const role = p.role as string;
  const at = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (role === 'frontend') patch = { frontend_state: 'fe_done', updated_at: at };
  else if (role === 'backend') patch = { backend_state: 'be_done', updated_at: at };
  else throw new Error('Only Frontend or Backend can finish a story.');
  const { error } = await db.from('task').update(patch).eq('id', id);
  if (error) throw new Error(`doneWork: ${error.message}`);
  await reflectAzure(p, id, 'Completed');
  return getBoard();
}

/** Per-user write — Azure records the state change under the caller's identity. */
async function setState(p: Record<string, unknown>) {
  const { base } = parseOrg(p.orgUrl as string);
  const id = p.id as number;
  const state = p.state as string;
  await azure(`${base}/_apis/wit/workitems/${id}?api-version=${AZURE_API}`, p.pat as string, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify([{ op: 'add', path: '/fields/System.State', value: state }]),
  });
  await db.from('task').update({ macro_state: state, updated_at: new Date().toISOString() }).eq('id', id);
  return { id, state };
}

/** Completed Work is ADDITIVE — never clobber the PM estimate (TC-15). */
async function addCompletedWork(p: Record<string, unknown>) {
  const { base } = parseOrg(p.orgUrl as string);
  const id = p.id as number;
  const hours = Number(p.hours ?? 0);
  const field = 'Microsoft.VSTS.Scheduling.CompletedWork';
  const current = (await azure(
    `${base}/_apis/wit/workitems/${id}?fields=${field}&api-version=${AZURE_API}`,
    p.pat as string,
  )) as { fields?: Record<string, number> };
  const next = (current.fields?.[field] ?? 0) + hours;
  await azure(`${base}/_apis/wit/workitems/${id}?api-version=${AZURE_API}`, p.pat as string, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify([{ op: 'add', path: `/fields/${field}`, value: next }]),
  });
  return { id, completedWork: next };
}

// --- per-project sources + N:N task mapping --------------------------------

/**
 * Resolve the caller from their PAT and assert they may manage sources — the
 * sprint puller does this: a PM/lead (app_user.role = 'pm') or an admin. Mirrors
 * the audience of the Pull controls.
 */
async function requirePmOrAdmin(p: Record<string, unknown>): Promise<void> {
  const orgUrl = p.orgUrl as string;
  const pat = p.pat as string;
  if (!orgUrl || !pat) throw new Error('orgUrl and pat are required');
  const { base } = parseOrg(orgUrl);
  const data = (await azure(
    `${base}/_apis/connectionData?api-version=${AZURE_API}-preview`,
    pat,
  )) as { authenticatedUser?: { properties?: { Account?: { $value?: string } }; providerDisplayName?: string } };
  const au = data.authenticatedUser ?? {};
  const uniqueName = au.properties?.Account?.$value ?? au.providerDisplayName ?? '';
  if (isAdmin(uniqueName)) return;
  const { data: row } = await db
    .from('app_user')
    .select('role')
    .eq('azure_unique_name', uniqueName)
    .maybeSingle();
  if (row?.role !== 'pm') throw new Error('Only a PM/lead or admin can manage project sources');
}

/** List configured per-project sources (admin). Secret VALUES are never returned. */
async function listProjectSources(p: Record<string, unknown>) {
  await requirePmOrAdmin(p);
  const { data } = await db
    .from('project_source')
    .select('id, org_url, project, openapi_spec_url, figma_file_key, poll_enabled, poll_interval_s, updated_at')
    .order('project');
  return { sources: data ?? [] };
}

/** Upsert a project's spec URL / Figma file key + poll settings (admin). */
async function setProjectSource(p: Record<string, unknown>) {
  await requirePmOrAdmin(p);
  const { org } = parseOrg(p.orgUrl as string);
  const project = p.project as string;
  if (!project) throw new Error('project is required');
  const row = {
    org_url: `dev.azure.com/${org}`,
    project,
    openapi_spec_url: (p.openapiSpecUrl as string) || null,
    figma_file_key: (p.figmaFileKey as string) || null,
    poll_enabled: p.pollEnabled === undefined ? true : !!p.pollEnabled,
    poll_interval_s: Number(p.pollIntervalS ?? 300),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('project_source').upsert(row, { onConflict: 'org_url,project' });
  if (error) throw new Error(`setProjectSource: ${error.message}`);
  return listProjectSources(p);
}

/** Connection test: fetch the spec once and count operations (admin). */
async function testOpenApiSource(p: Record<string, unknown>) {
  await requirePmOrAdmin(p);
  const url = p.openapiSpecUrl as string;
  if (!url) throw new Error('openapiSpecUrl is required');
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, error: `spec fetch ${res.status}` };
    const spec = (await res.json()) as { paths?: Record<string, Record<string, unknown>> };
    let operations = 0;
    for (const item of Object.values(spec.paths ?? {})) {
      for (const m of ['get', 'put', 'post', 'delete', 'patch']) if (item?.[m]) operations++;
    }
    return { ok: true, operations };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Connection test: fetch the Figma file once using the shared FIGMA_TOKEN (admin). */
async function testFigmaSource(p: Record<string, unknown>) {
  await requirePmOrAdmin(p);
  const fileKey = p.figmaFileKey as string;
  if (!fileKey) throw new Error('figmaFileKey is required');
  const token = Deno.env.get('FIGMA_TOKEN');
  if (!token) return { ok: false, error: 'FIGMA_TOKEN secret is not set' };
  try {
    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=1`, {
      headers: { 'X-Figma-Token': token },
    });
    if (!res.ok) return { ok: false, error: `figma ${res.status}` };
    const file = (await res.json()) as { name?: string; lastModified?: string };
    return { ok: true, name: file.name ?? '(unnamed)', lastModified: file.lastModified ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Endpoints + screens mapped to a task (for the drawer editor). */
async function listTaskLinks(p: Record<string, unknown>) {
  const taskId = Number(p.taskId);
  if (!taskId) throw new Error('taskId is required');
  const [eps, scrs] = await Promise.all([
    db.from('task_endpoint')
      .select('id, operation_id, endpoint, is_required, is_manual, present, last_diff, updated_at')
      .eq('task_id', taskId)
      .order('operation_id'),
    db.from('task_screen')
      .select('id, node_id, frame_name, is_required, is_manual, status, fingerprint, updated_at')
      .eq('task_id', taskId)
      .order('frame_name'),
  ]);
  return { endpoints: eps.data ?? [], screens: scrs.data ?? [] };
}

/** Add / edit a manual endpoint mapping (is_manual=true so workers won't prune it). */
async function setTaskEndpoint(p: Record<string, unknown>) {
  const taskId = Number(p.taskId);
  const operationId = p.operationId as string;
  if (!taskId || !operationId) throw new Error('taskId and operationId are required');
  const { error } = await db.from('task_endpoint').upsert(
    {
      task_id: taskId,
      operation_id: operationId,
      is_required: p.isRequired === undefined ? true : !!p.isRequired,
      is_manual: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'task_id,operation_id' },
  );
  if (error) throw new Error(`setTaskEndpoint: ${error.message}`);
  return listTaskLinks(p);
}

/** Add / edit a manual screen mapping. */
async function setTaskScreen(p: Record<string, unknown>) {
  const taskId = Number(p.taskId);
  const nodeId = p.nodeId as string;
  if (!taskId || !nodeId) throw new Error('taskId and nodeId are required');
  const { error } = await db.from('task_screen').upsert(
    {
      task_id: taskId,
      node_id: nodeId,
      frame_name: (p.frameName as string) || null,
      is_required: p.isRequired === undefined ? true : !!p.isRequired,
      is_manual: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'task_id,node_id' },
  );
  if (error) throw new Error(`setTaskScreen: ${error.message}`);
  return listTaskLinks(p);
}

/** Remove a mapping row by kind ('endpoint' | 'screen') + id. */
async function deleteTaskLink(p: Record<string, unknown>) {
  const kind = p.kind as string;
  const id = p.id as string;
  if (!id || (kind !== 'endpoint' && kind !== 'screen')) {
    throw new Error("kind ('endpoint' | 'screen') and id are required");
  }
  const table = kind === 'endpoint' ? 'task_endpoint' : 'task_screen';
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) throw new Error(`deleteTaskLink: ${error.message}`);
  return listTaskLinks(p);
}

// --- dispatch --------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  let body: ProxyRequest;
  try {
    body = (await req.json()) as ProxyRequest;
  } catch {
    return fail('Invalid JSON body');
  }

  const { op, payload = {} } = body;
  try {
    switch (op) {
      case 'resolveIdentity':
        return ok(await resolveIdentity(payload));
      case 'setRole':
        return ok(await setRole(payload));
      case 'listProjects':
        return ok(await listProjects(payload));
      case 'listIterations':
        return ok(await listIterations(payload));
      case 'pullSprint':
        return ok(await pullSprint(payload));
      case 'getBoard':
        return ok(await getBoard());
      case 'getActivity':
        return ok(await getActivity());
      case 'listMembers':
        return ok(await listMembers());
      case 'startWork':
        return ok(await startWork(payload));
      case 'stopWork':
        return ok(await stopWork(payload));
      case 'doneWork':
        return ok(await doneWork(payload));
      case 'setState':
        return ok(await setState(payload));
      case 'addCompletedWork':
        return ok(await addCompletedWork(payload));
      case 'listProjectSources':
        return ok(await listProjectSources(payload));
      case 'setProjectSource':
        return ok(await setProjectSource(payload));
      case 'testOpenApiSource':
        return ok(await testOpenApiSource(payload));
      case 'testFigmaSource':
        return ok(await testFigmaSource(payload));
      case 'listTaskLinks':
        return ok(await listTaskLinks(payload));
      case 'setTaskEndpoint':
        return ok(await setTaskEndpoint(payload));
      case 'setTaskScreen':
        return ok(await setTaskScreen(payload));
      case 'deleteTaskLink':
        return ok(await deleteTaskLink(payload));
      default:
        return fail(`Unknown op: ${op}`);
    }
  } catch (e) {
    return fail((e as Error).message ?? 'Azure proxy error', 502);
  }
});
