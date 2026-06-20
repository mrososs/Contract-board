// Figma sync worker (Supabase Edge Function, scheduled).
//
// Polls the linked Figma file's Dev Mode status, stores a design_snapshot, and
// flips mapped tasks to Design Ready when a frame is marked "Ready for
// development" / Design Changed when it is edited after handoff (TC-22/24).
// v1 uses Figma's file `version` as the change basis, not a pixel diff (§9.7).
//
// Frames are mapped to tasks by UC convention (B2): the UC number in the frame
// name is matched against `task.uc`; the resolved node is persisted to
// `task_mapping`.
//
// Secrets: supabase secrets set FIGMA_TOKEN=... FIGMA_FILE_KEY=...

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

/** Frame marked "Ready for development" → DesignReady (TC-22). */
function isReady(frame: FrameSnapshot): boolean {
  return frame.status === 'ready';
}

/** Edited (new file version) after it was marked ready → DesignChanged (TC-24). */
function detectChanged(prev: FrameSnapshot | undefined, next: FrameSnapshot): boolean {
  return !!prev && prev.status === 'ready' && next.status === 'ready' && next.fingerprint !== prev.fingerprint;
}

/** Pull the UC number out of a frame name, e.g. "UC-12 · Booking" -> "UC-12". */
function parseUc(s: string | undefined | null): string | null {
  const m = String(s ?? '').match(/\bUC[-_\s]?(\d+)\b/i);
  return m ? `UC-${m[1]}` : null;
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

/** Walk the tree, collecting the first UC-named node per UC (frames/sections). */
function collectFrames(root: FigmaNode, version: string): Map<string, FrameSnapshot> {
  const out = new Map<string, FrameSnapshot>();
  const walk = (n: FigmaNode) => {
    const uc = parseUc(n.name);
    if (uc && !out.has(uc.toUpperCase())) {
      out.set(uc.toUpperCase(), {
        nodeId: n.id,
        name: n.name,
        status: figmaStatus(n),
        fingerprint: version,
      });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

// --- the run ----------------------------------------------------------------

interface TaskRow {
  id: number;
  uc: string | null;
  design_state: string;
}

async function run(): Promise<Record<string, unknown>> {
  const token = Deno.env.get('FIGMA_TOKEN');
  const fileKey = Deno.env.get('FIGMA_FILE_KEY');
  if (!token || !fileKey) return { ok: true, skipped: 'FIGMA_TOKEN / FIGMA_FILE_KEY not set' };

  const { data: sprint } = await db
    .from('sprint')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sprint) return { ok: true, skipped: 'no active sprint' };
  const sprintId = sprint.id as string;

  const { data: taskRows } = await db
    .from('task')
    .select('id, uc, design_state')
    .eq('sprint_id', sprintId);
  const tasks = (taskRows ?? []) as TaskRow[];
  const byUc = new Map<string, TaskRow>();
  for (const t of tasks) if (t.uc) byUc.set(t.uc.toUpperCase(), t);
  if (!byUc.size) return { ok: true, skipped: 'no UC-tagged tasks in sprint' };

  // Fetch the file. On failure, leave design state untouched (TC-18 spirit).
  let file: { document: FigmaNode; version: string };
  try {
    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=4`, {
      headers: { 'X-Figma-Token': token },
    });
    if (!res.ok) throw new Error(`figma ${res.status}`);
    file = (await res.json()) as { document: FigmaNode; version: string };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const frames = collectFrames(file.document, file.version);
  const events: { kind: string; message: string }[] = [];

  for (const [uc, frame] of frames) {
    const task = byUc.get(uc);
    if (!task) continue;

    // Latest stored snapshot for this node → the diff base.
    const { data: prevRow } = await db
      .from('design_snapshot')
      .select('node_id, status, fingerprint')
      .eq('task_id', task.id)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const prev: FrameSnapshot | undefined = prevRow
      ? {
          nodeId: prevRow.node_id as string,
          name: '',
          status: prevRow.status as DesignStatus,
          fingerprint: (prevRow.fingerprint as string) ?? '',
        }
      : undefined;

    // Persist the convention mapping (B2).
    await db
      .from('task_mapping')
      .upsert(
        { task_id: task.id, figma_node_id: frame.nodeId, figma_frame_name: frame.name, is_manual: false },
        { onConflict: 'task_id' },
      );

    // Record this observation.
    await db.from('design_snapshot').insert({
      task_id: task.id,
      node_id: frame.nodeId,
      status: frame.status,
      fingerprint: frame.fingerprint,
    });

    if (detectChanged(prev, frame)) {
      await db
        .from('task')
        .update({ design_state: 'design_changed', updated_at: new Date().toISOString() })
        .eq('id', task.id);
      await db.from('activity').insert({
        task_id: task.id,
        kind: 'design_changed',
        actor: 'figma-worker',
        message: `Design changed after handoff · ${frame.name}`,
        payload: { nodeId: frame.nodeId },
      });
      events.push({ kind: 'design_changed', message: `${uc} ${frame.name}` });
    } else if (isReady(frame) && task.design_state !== 'design_ready' && task.design_state !== 'design_changed') {
      await db
        .from('task')
        .update({ design_state: 'design_ready', updated_at: new Date().toISOString() })
        .eq('id', task.id);
      await db.from('activity').insert({
        task_id: task.id,
        kind: 'design_ready',
        actor: 'figma-worker',
        message: `Design ready for development · ${frame.name}`,
        payload: { nodeId: frame.nodeId },
      });
      events.push({ kind: 'design_ready', message: `${uc} ${frame.name}` });
    } else if (!isReady(frame) && task.design_state === 'todo') {
      // Frame exists but not handed off yet → reflect work-in-progress.
      await db.from('task').update({ design_state: 'design_wip' }).eq('id', task.id);
    }
  }

  return { ok: true, frames: frames.size, events };
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
