// OpenAPI sync worker (Supabase Edge Function, scheduled).
//
// Polls the backend's OpenAPI spec, stores a snapshot, diffs against the last
// one, and flips mapped tasks to Contract Ready / records a Contract Changed
// activity — then writes an `activity` row so the FE owner is notified via
// Realtime. On an unreachable / malformed spec it keeps the last good snapshot
// and marks it stale; it never fabricates a state change (TC-18/19).
//
// Tasks are mapped to operations by UC convention (B2): the UC number embedded
// in the operationId / tag / path is matched against `task.uc`. The resolved
// mapping is persisted to `task_mapping` so a later manual override can stick.
//
// Schedule with pg_cron or an external cron hitting this endpoint.
// Secrets: supabase secrets set OPENAPI_SPEC_URL=...

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

// --- the contract diff (mirror of libs/openapi-sync, ported for Deno) -------

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

interface TaskRow {
  id: number;
  uc: string | null;
  backend_state: string;
  endpoint: string | null;
}

async function run(): Promise<Json> {
  const specUrl = Deno.env.get('OPENAPI_SPEC_URL');
  if (!specUrl) return { ok: true, skipped: 'OPENAPI_SPEC_URL not set' };

  // Active sprint — the worker only touches the board the admin pulled.
  const { data: sprint } = await db
    .from('sprint')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sprint) return { ok: true, skipped: 'no active sprint' };
  const sprintId = sprint.id as string;

  // Previous snapshot (for the diff).
  const { data: prevSnap } = await db
    .from('spec_snapshot')
    .select('id, operations')
    .eq('sprint_id', sprintId)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevOps = (prevSnap?.operations ?? {}) as Operations;

  // Fetch + parse the spec. On any failure: mark the last snapshot stale and
  // bail without touching task state (TC-18).
  let spec: Json;
  const tagsByOp: Record<string, string[]> = {};
  try {
    const res = await fetch(specUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`spec fetch ${res.status}`);
    spec = (await res.json()) as Json;
  } catch (e) {
    if (prevSnap) await db.from('spec_snapshot').update({ is_stale: true }).eq('id', prevSnap.id);
    return { ok: false, stale: true, error: (e as Error).message };
  }

  // Collect tags per operationId for UC matching.
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
    .select('id, uc, backend_state, endpoint')
    .eq('sprint_id', sprintId);
  const tasks = (taskRows ?? []) as TaskRow[];
  const byUc = new Map<string, TaskRow>();
  for (const t of tasks) if (t.uc) byUc.set(t.uc.toUpperCase(), t);

  const events: { kind: string; message: string; flipped: boolean }[] = [];

  for (const op of Object.values(nextOps)) {
    const uc = operationUc(op, tagsByOp[op.operationId] ?? []);
    if (!uc) continue;
    const task = byUc.get(uc.toUpperCase());
    if (!task) continue;

    // Persist / refresh the convention mapping (B2). Don't clobber a manual one.
    await db
      .from('task_mapping')
      .upsert(
        { task_id: task.id, openapi_operation_id: op.operationId, is_manual: false },
        { onConflict: 'task_id', ignoreDuplicates: false },
      );

    const isNew = !(op.operationId in prevOps);
    const diff = diffOperation(prevOps[op.operationId], op);
    const endpoint = `${op.method} ${op.path}`;

    if (isNew && task.backend_state === 'be_wip') {
      // Contract Ready detected for the first time (TC-07).
      await db
        .from('task')
        .update({ backend_state: 'contract_ready', endpoint, updated_at: new Date().toISOString() })
        .eq('id', task.id);
      await db.from('activity').insert({
        task_id: task.id,
        kind: 'contract_ready',
        actor: 'openapi-worker',
        message: `Contract ready · ${endpoint}`,
        payload: { operationId: op.operationId, fields: Object.keys(op.fields) },
      });
      events.push({ kind: 'contract_ready', message: `${uc} ${endpoint}`, flipped: true });
    } else if (!isNew && hasChanges(diff)) {
      // DTO changed after it was ready (TC-09/10) — notify, don't downgrade.
      await db
        .from('task')
        .update({ endpoint, updated_at: new Date().toISOString() })
        .eq('id', task.id);
      await db.from('activity').insert({
        task_id: task.id,
        kind: 'contract_changed',
        actor: 'openapi-worker',
        message: `Contract changed · ${endpoint}`,
        payload: diff,
      });
      events.push({ kind: 'contract_changed', message: `${uc} ${endpoint}`, flipped: false });
    } else if (task.endpoint === '— pending' || task.endpoint == null) {
      // First time we can name the endpoint, even if state is unchanged.
      await db.from('task').update({ endpoint }).eq('id', task.id);
    }
  }

  // Store the fresh snapshot last (so a mid-run crash doesn't lose the diff base).
  await db
    .from('spec_snapshot')
    .insert({ sprint_id: sprintId, operations: nextOps, is_stale: false });

  return { ok: true, operations: Object.keys(nextOps).length, events };
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
