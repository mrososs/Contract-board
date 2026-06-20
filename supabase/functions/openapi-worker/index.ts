// OpenAPI sync worker (Supabase Edge Function, scheduled).
//
// For EVERY enabled project_source it polls that project's OpenAPI spec, stores a
// per-project snapshot, diffs against the last one, and maintains the project's
// task_endpoint rows (N:N — a task may require many endpoints). A task flips to
// Contract Ready only when ALL its required endpoints are present; a DTO change
// after an endpoint was ready records a Contract Changed activity. On an
// unreachable / malformed spec it keeps the last good snapshot and marks it stale;
// it never fabricates a state change (TC-18/19).
//
// Tasks are mapped to operations by UC convention (B2): the UC number embedded in
// the operationId / tag / path is matched against `task.uc`. Multiple operations
// sharing a UC all attach to that task (that's the 1:N). Manual mappings
// (is_manual=true) are never auto-pruned.
//
// Schedule with pg_cron or an external cron hitting this endpoint.
// Per-project sources are configured via azure-proxy.setProjectSource.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// --- the contract diff ------------------------------------------------------

interface OperationShape {
  operationId: string;
  method: string;
  path: string;
  /** Flattened DTO field → type map, for diffing. */
  fields: Record<string, string>;
}
type Operations = Record<string, OperationShape>;

interface DtoDiff {
  added: string[];
  removed: string[];
  changed: { field: string; from: string; to: string }[];
}

/** Field-level DTO diff that drives the "Contract Changed" flag (TC-09/10). */
function diffOperation(prev: OperationShape | undefined, next: OperationShape | undefined): DtoDiff {
  const diff: DtoDiff = { added: [], removed: [], changed: [] };
  const prevF = prev?.fields ?? {};
  const nextF = next?.fields ?? {};
  for (const f of Object.keys(nextF)) {
    if (!(f in prevF)) diff.added.push(f);
    else if (prevF[f] !== nextF[f]) diff.changed.push({ field: f, from: prevF[f], to: nextF[f] });
  }
  for (const f of Object.keys(prevF)) if (!(f in nextF)) diff.removed.push(f);
  return diff;
}

function hasChanges(d: DtoDiff): boolean {
  return d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0;
}

/** Pull the UC number out of any string, e.g. "createUC12Booking" -> "UC-12". */
function parseUc(s: string | undefined | null): string | null {
  const m = String(s ?? '').match(/\bUC[-_\s]?(\d+)\b/i);
  return m ? `UC-${m[1]}` : null;
}

// --- OpenAPI flattening -----------------------------------------------------

type Json = Record<string, unknown>;
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

/** Resolve a local `#/components/schemas/Name` ref against the spec. */
function deref(spec: Json, schema: Json | undefined, seen = new Set<string>()): Json | undefined {
  if (!schema) return undefined;
  const ref = schema['$ref'] as string | undefined;
  if (!ref) return schema;
  if (seen.has(ref)) return undefined; // guard against recursive schemas
  seen.add(ref);
  const name = ref.split('/').pop()!;
  const target = ((spec.components as Json)?.['schemas'] as Json)?.[name] as Json | undefined;
  return deref(spec, target, seen);
}

/** A short type label for a property schema, used as the diff value. */
function typeLabel(spec: Json, schema: Json | undefined): string {
  if (!schema) return 'unknown';
  const ref = schema['$ref'] as string | undefined;
  if (ref) return ref.split('/').pop()!;
  const t = schema['type'] as string | undefined;
  if (t === 'array') {
    const items = schema['items'] as Json | undefined;
    const itemRef = items?.['$ref'] as string | undefined;
    return `${itemRef ? itemRef.split('/').pop() : (items?.['type'] ?? 'any')}[]`;
  }
  const fmt = schema['format'] as string | undefined;
  return fmt ? `${t}(${fmt})` : (t ?? 'object');
}

/** Flatten the top-level properties of a schema into field → type. */
function flattenSchema(spec: Json, schema: Json | undefined, into: Record<string, string>, prefix = ''): void {
  const resolved = deref(spec, schema);
  if (!resolved) return;
  let target = resolved;
  if (resolved['type'] === 'array') {
    const items = deref(spec, resolved['items'] as Json);
    if (!items) return;
    target = items;
  }
  const props = target['properties'] as Json | undefined;
  if (!props) return;
  for (const [name, raw] of Object.entries(props)) {
    into[prefix + name] = typeLabel(spec, raw as Json);
  }
}

/** Flatten a whole spec into operationId → shape (request + 2xx response DTOs). */
function flattenSpec(spec: Json): Operations {
  const ops: Operations = {};
  const paths = (spec.paths ?? {}) as Json;
  for (const [path, pathItemRaw] of Object.entries(paths)) {
    const pathItem = pathItemRaw as Json;
    for (const method of METHODS) {
      const op = pathItem[method] as Json | undefined;
      if (!op) continue;
      const operationId =
        (op['operationId'] as string | undefined) ?? `${method.toUpperCase()} ${path}`;
      const fields: Record<string, string> = {};

      const reqSchema = (((op['requestBody'] as Json)?.['content'] as Json)?.['application/json'] as Json)?.[
        'schema'
      ] as Json | undefined;
      flattenSchema(spec, reqSchema, fields, 'req.');

      const responses = (op['responses'] ?? {}) as Json;
      const okCode = ['200', '201', '2XX', 'default'].find((c) => c in responses);
      const resSchema = okCode
        ? (((responses[okCode] as Json)?.['content'] as Json)?.['application/json'] as Json)?.['schema']
        : undefined;
      flattenSchema(spec, resSchema as Json | undefined, fields, 'res.');

      ops[operationId] = { operationId, method: method.toUpperCase(), path, fields };
    }
  }
  return ops;
}

/** Find the UC an operation belongs to: operationId, then tags, then path. */
function operationUc(op: OperationShape, tags: string[]): string | null {
  return parseUc(op.operationId) ?? parseUc(tags.join(' ')) ?? parseUc(op.path);
}

// --- the run ----------------------------------------------------------------

interface ProjectSource {
  org_url: string;
  project: string;
  openapi_spec_url: string | null;
  poll_enabled: boolean;
}

interface TaskRow {
  id: number;
  uc: string | null;
  backend_state: string;
}

interface EndpointRow {
  id: string;
  task_id: number;
  operation_id: string;
  is_required: boolean;
  is_manual: boolean;
  present: boolean;
}

async function run(): Promise<Json> {
  const { data: sources } = await db
    .from('project_source')
    .select('org_url, project, openapi_spec_url, poll_enabled')
    .eq('poll_enabled', true);
  if (!sources?.length) return { ok: true, skipped: 'no enabled project sources' };

  const projects: Json[] = [];
  for (const src of sources as ProjectSource[]) {
    projects.push(await runProject(src));
  }
  return { ok: true, projects };
}

async function runProject(src: ProjectSource): Promise<Json> {
  if (!src.openapi_spec_url) return { project: src.project, skipped: 'no spec url' };

  // Active sprint for THIS project (per-project active sprint).
  const { data: sprint } = await db
    .from('sprint')
    .select('id')
    .eq('org_url', src.org_url)
    .eq('project', src.project)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sprint) return { project: src.project, skipped: 'no active sprint' };
  const sprintId = sprint.id as string;

  // Previous snapshot (the diff base).
  const { data: prevSnap } = await db
    .from('spec_snapshot')
    .select('id, operations')
    .eq('sprint_id', sprintId)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevOps = (prevSnap?.operations ?? {}) as Operations;

  // Fetch + parse the spec. On any failure: mark the last snapshot stale and bail
  // without touching task state (TC-18).
  let spec: Json;
  try {
    const res = await fetch(src.openapi_spec_url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`spec fetch ${res.status}`);
    spec = (await res.json()) as Json;
  } catch (e) {
    if (prevSnap) await db.from('spec_snapshot').update({ is_stale: true }).eq('id', prevSnap.id);
    return { project: src.project, ok: false, stale: true, error: (e as Error).message };
  }

  // Collect tags per operationId for UC matching (same key as flattenSpec).
  const tagsByOp: Record<string, string[]> = {};
  for (const [path, pathItemRaw] of Object.entries((spec.paths ?? {}) as Json)) {
    const pathItem = pathItemRaw as Json;
    for (const method of METHODS) {
      const op = pathItem[method] as Json | undefined;
      if (!op) continue;
      const id = (op['operationId'] as string | undefined) ?? `${method.toUpperCase()} ${path}`;
      tagsByOp[id] = ((op['tags'] as string[] | undefined) ?? []).map(String);
    }
  }

  const nextOps = flattenSpec(spec);

  // Tasks in this sprint, indexed by UC.
  const { data: taskRows } = await db
    .from('task')
    .select('id, uc, backend_state')
    .eq('sprint_id', sprintId);
  const tasks = (taskRows ?? []) as TaskRow[];
  const byUc = new Map<string, TaskRow>();
  for (const t of tasks) if (t.uc) byUc.set(t.uc.toUpperCase(), t);

  // 1) Convention scan — ensure a (non-manual) task_endpoint row exists for every
  //    operation whose UC matches a task. ignoreDuplicates so we never clobber an
  //    existing row's present/last_diff/is_manual. This is where 1:N happens:
  //    several ops sharing UC-12 each become a row for the UC-12 task.
  const autoRows: { task_id: number; operation_id: string; is_manual: boolean; is_required: boolean }[] = [];
  for (const op of Object.values(nextOps)) {
    const uc = operationUc(op, tagsByOp[op.operationId] ?? []);
    if (!uc) continue;
    const task = byUc.get(uc.toUpperCase());
    if (!task) continue;
    autoRows.push({ task_id: task.id, operation_id: op.operationId, is_manual: false, is_required: true });
  }
  if (autoRows.length) {
    await db.from('task_endpoint').upsert(autoRows, { onConflict: 'task_id,operation_id', ignoreDuplicates: true });
  }

  // 2) Walk every task_endpoint row (auto + manual) and update present / diffs.
  const taskIds = tasks.map((t) => t.id);
  const { data: epRows } = taskIds.length
    ? await db
        .from('task_endpoint')
        .select('id, task_id, operation_id, is_required, is_manual, present')
        .in('task_id', taskIds)
    : { data: [] as EndpointRow[] };
  const endpoints = (epRows ?? []) as EndpointRow[];

  const events: { kind: string; message: string }[] = [];
  const byTask = new Map<number, EndpointRow[]>();
  for (const row of endpoints) {
    const op = nextOps[row.operation_id];
    const nowPresent = !!op;
    const endpoint = op ? `${op.method} ${op.path}` : null;
    const diff = diffOperation(prevOps[row.operation_id], op);

    const patch: Record<string, unknown> = { present: nowPresent, updated_at: new Date().toISOString() };
    if (endpoint) patch.endpoint = endpoint;

    if (nowPresent && !row.present) {
      // This endpoint just appeared (one of N).
      await db.from('activity').insert({
        task_id: row.task_id,
        kind: 'endpoint_ready',
        actor: 'openapi-worker',
        message: `Endpoint ready · ${endpoint}`,
        payload: { operationId: row.operation_id, fields: op ? Object.keys(op.fields) : [] },
      });
      events.push({ kind: 'endpoint_ready', message: `${endpoint}` });
    } else if (nowPresent && row.present && row.operation_id in prevOps && hasChanges(diff)) {
      // DTO changed after it was ready (TC-09/10) — notify, don't downgrade.
      patch.last_diff = diff;
      await db.from('activity').insert({
        task_id: row.task_id,
        kind: 'contract_changed',
        actor: 'openapi-worker',
        message: `Contract changed · ${endpoint}`,
        payload: diff,
      });
      events.push({ kind: 'contract_changed', message: `${endpoint}` });
    }

    await db.from('task_endpoint').update(patch).eq('id', row.id);

    row.present = nowPresent; // reflect for the aggregate below
    const arr = byTask.get(row.task_id) ?? [];
    arr.push(row);
    byTask.set(row.task_id, arr);
  }

  // 3) Recompute each task's backend_state from the aggregate.
  for (const task of tasks) {
    const rows = byTask.get(task.id) ?? [];
    const required = rows.filter((r) => r.is_required);
    if (!required.length) continue;
    const presentCount = required.filter((r) => r.present).length;
    const allPresent = presentCount === required.length;

    // A concise endpoint label that also surfaces partial progress on the card.
    const label =
      allPresent && required.length === 1
        ? `${nextOps[required[0].operation_id]?.method} ${nextOps[required[0].operation_id]?.path}`
        : `${presentCount}/${required.length} endpoints`;

    if (allPresent && task.backend_state === 'be_wip') {
      await db
        .from('task')
        .update({ backend_state: 'contract_ready', endpoint: label, block_note: null, updated_at: new Date().toISOString() })
        .eq('id', task.id);
      await db.from('activity').insert({
        task_id: task.id,
        kind: 'contract_ready',
        actor: 'openapi-worker',
        message: `Contract ready · ${label}`,
        payload: { endpoints: required.map((r) => r.operation_id) },
      });
      events.push({ kind: 'contract_ready', message: `${task.uc ?? task.id} ${label}` });
    } else if (task.backend_state === 'be_wip') {
      // Still partial — keep the count visible on the card.
      await db.from('task').update({ endpoint: label }).eq('id', task.id);
    }
  }

  // Store the fresh snapshot last (so a mid-run crash doesn't lose the diff base).
  await db.from('spec_snapshot').insert({ sprint_id: sprintId, operations: nextOps, is_stale: false });

  return { project: src.project, ok: true, operations: Object.keys(nextOps).length, events };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const result = await run();
    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
