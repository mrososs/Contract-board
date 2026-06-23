// Figma sync worker (Supabase Edge Function, scheduled).
//
// For EVERY enabled project_source with a figma_file_key it polls that project's
// Figma file Dev Mode status and maintains the project's task_screen rows (N:N —
// a task may require many frames). A task flips to Design Ready only when ALL its
// required frames are "Ready for development"; a frame edited after handoff
// (file `version` changed) records a Design Changed activity (TC-22/24). v1 uses
// the file `version` as the change basis, not a pixel diff (§9.7).
//
// Frames are mapped to tasks by the Azure work-item id: a `#<id>` token in a frame
// name is matched against `task.id`, with the legacy UC convention (`UC-n` in the
// name -> `task.uc`) kept as a fallback. Every matched frame attaches (that's the
// 1:N). Manual mappings (is_manual=true) are never auto-pruned.
//
// Figma auth uses the shared FIGMA_TOKEN secret; per-project tokens are a planned
// follow-up (project_source.figma_token_ref is reserved for it).

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

type DesignStatus = 'wip' | 'ready' | 'changed' | 'unknown';

interface FrameSnapshot {
  nodeId: string;
  name: string;
  status: DesignStatus;
  /** Figma file `version` at detection time — the change basis (§9.7). */
  fingerprint: string;
}

/** Pull the UC number out of a frame name, e.g. "UC-12 · Booking" -> "UC-12". */
function parseUc(s: string | undefined | null): string | null {
  const m = String(s ?? '').match(/\bUC[-_\s]?(\d+)\b/i);
  return m ? `UC-${m[1]}` : null;
}

/** Pull an Azure work-item id out of a "#912312" token in a frame name. */
function parseAzureId(s: string | undefined | null): number | null {
  const m = String(s ?? '').match(/#(\d+)/);
  return m ? Number(m[1]) : null;
}

// --- Figma document traversal -----------------------------------------------

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  devStatus?: { type?: string };
  children?: FigmaNode[];
}

function figmaStatus(node: FigmaNode): DesignStatus {
  const t = node.devStatus?.type;
  if (t === 'READY_FOR_DEV') return 'ready';
  if (t === 'COMPLETED') return 'ready';
  return 'wip';
}

/** Walk the tree, collecting EVERY node carrying a #id or UC token — supports 1:N. */
function collectFrames(
  root: FigmaNode,
  version: string,
): { id: number | null; uc: string | null; frame: FrameSnapshot }[] {
  const out: { id: number | null; uc: string | null; frame: FrameSnapshot }[] = [];
  const walk = (n: FigmaNode) => {
    const id = parseAzureId(n.name);
    const uc = parseUc(n.name);
    if (id !== null || uc) {
      out.push({
        id,
        uc: uc ? uc.toUpperCase() : null,
        frame: { nodeId: n.id, name: n.name, status: figmaStatus(n), fingerprint: version },
      });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

// --- the run ----------------------------------------------------------------

interface ProjectSource {
  org_url: string;
  project: string;
  figma_file_key: string | null;
  poll_enabled: boolean;
}

interface TaskRow {
  id: number;
  uc: string | null;
  design_state: string;
}

interface ScreenRow {
  id: string;
  task_id: number;
  node_id: string;
  is_required: boolean;
  is_manual: boolean;
  status: DesignStatus;
  fingerprint: string | null;
}

async function run(): Promise<Record<string, unknown>> {
  const token = Deno.env.get('FIGMA_TOKEN');
  const { data: sources } = await db
    .from('project_source')
    .select('org_url, project, figma_file_key, poll_enabled')
    .eq('poll_enabled', true);
  if (!sources?.length) return { ok: true, skipped: 'no enabled project sources' };
  if (!token) return { ok: true, skipped: 'FIGMA_TOKEN not set' };

  const projects: Record<string, unknown>[] = [];
  for (const src of sources as ProjectSource[]) {
    projects.push(await runProject(src, token));
  }
  return { ok: true, projects };
}

async function runProject(src: ProjectSource, token: string): Promise<Record<string, unknown>> {
  if (!src.figma_file_key) return { project: src.project, skipped: 'no figma file key' };

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

  const { data: taskRows } = await db
    .from('task')
    .select('id, uc, design_state')
    .eq('sprint_id', sprintId);
  const tasks = (taskRows ?? []) as TaskRow[];
  const byUc = new Map<string, TaskRow>();
  const byId = new Map<number, TaskRow>();
  for (const t of tasks) {
    if (t.uc) byUc.set(t.uc.toUpperCase(), t);
    byId.set(t.id, t);
  }
  if (!byId.size) return { project: src.project, skipped: 'no tasks' };

  // Fetch the file. On failure, leave design state untouched (TC-18 spirit).
  let file: { document: FigmaNode; version: string };
  try {
    const res = await fetch(`https://api.figma.com/v1/files/${src.figma_file_key}?depth=4`, {
      headers: { 'X-Figma-Token': token },
    });
    if (!res.ok) throw new Error(`figma ${res.status}`);
    file = (await res.json()) as { document: FigmaNode; version: string };
  } catch (e) {
    return { project: src.project, ok: false, error: (e as Error).message };
  }

  const collected = collectFrames(file.document, file.version);
  const nodeMap = new Map<string, FrameSnapshot>();
  for (const { frame } of collected) nodeMap.set(frame.nodeId, frame);

  // 1) Convention scan — ensure a (non-manual) task_screen row per frame whose
  //    #id (preferred) or UC matches a task. ignoreDuplicates so live
  //    status/fingerprint stick.
  const autoRows: { task_id: number; node_id: string; frame_name: string; is_manual: boolean; is_required: boolean }[] = [];
  for (const { id, uc, frame } of collected) {
    const task = (id !== null ? byId.get(id) : undefined) ?? (uc ? byUc.get(uc) : undefined);
    if (!task) continue;
    autoRows.push({ task_id: task.id, node_id: frame.nodeId, frame_name: frame.name, is_manual: false, is_required: true });
  }
  if (autoRows.length) {
    await db.from('task_screen').upsert(autoRows, { onConflict: 'task_id,node_id', ignoreDuplicates: true });
  }

  // 2) Walk every task_screen row and update status / detect changes.
  const taskIds = tasks.map((t) => t.id);
  const { data: scrRows } = taskIds.length
    ? await db
        .from('task_screen')
        .select('id, task_id, node_id, is_required, is_manual, status, fingerprint')
        .in('task_id', taskIds)
    : { data: [] as ScreenRow[] };
  const screens = (scrRows ?? []) as ScreenRow[];

  const events: { kind: string; message: string }[] = [];
  const byTask = new Map<number, ScreenRow[]>();
  for (const row of screens) {
    const frame = nodeMap.get(row.node_id);
    if (frame) {
      const wasReady = row.status === 'ready';
      const editedAfterHandoff = wasReady && frame.status === 'ready' && !!row.fingerprint && frame.fingerprint !== row.fingerprint;
      const newStatus: DesignStatus = editedAfterHandoff ? 'changed' : frame.status;

      if (editedAfterHandoff) {
        await db.from('activity').insert({
          task_id: row.task_id,
          kind: 'design_changed',
          actor: 'figma-worker',
          message: `Design changed after handoff · ${frame.name}`,
          payload: { nodeId: frame.nodeId },
        });
        events.push({ kind: 'design_changed', message: frame.name });
      } else if (frame.status === 'ready' && !wasReady) {
        await db.from('activity').insert({
          task_id: row.task_id,
          kind: 'screen_ready',
          actor: 'figma-worker',
          message: `Screen ready for development · ${frame.name}`,
          payload: { nodeId: frame.nodeId },
        });
        events.push({ kind: 'screen_ready', message: frame.name });
      }

      await db
        .from('task_screen')
        .update({ status: newStatus, fingerprint: frame.fingerprint, frame_name: frame.name, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      row.status = newStatus; // reflect for the aggregate
    }
    const arr = byTask.get(row.task_id) ?? [];
    arr.push(row);
    byTask.set(row.task_id, arr);
  }

  // 3) Recompute each task's design_state from the aggregate.
  for (const task of tasks) {
    const rows = (byTask.get(task.id) ?? []).filter((r) => r.is_required);
    if (!rows.length) continue;
    const anyChanged = rows.some((r) => r.status === 'changed');
    const allReady = rows.every((r) => r.status === 'ready');

    if (anyChanged && task.design_state !== 'design_changed') {
      await db.from('task').update({ design_state: 'design_changed', updated_at: new Date().toISOString() }).eq('id', task.id);
    } else if (allReady && task.design_state !== 'design_ready' && task.design_state !== 'design_changed') {
      await db.from('task').update({ design_state: 'design_ready', updated_at: new Date().toISOString() }).eq('id', task.id);
      await db.from('activity').insert({
        task_id: task.id,
        kind: 'design_ready',
        actor: 'figma-worker',
        message: `Design ready for development · ${rows.length} screen(s)`,
        payload: { screens: rows.length },
      });
      events.push({ kind: 'design_ready', message: `${task.uc ?? task.id} (${rows.length} screens)` });
    } else if (!allReady && task.design_state === 'todo') {
      await db.from('task').update({ design_state: 'design_wip' }).eq('id', task.id);
    }
  }

  return { project: src.project, ok: true, frames: collected.length, events };
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
