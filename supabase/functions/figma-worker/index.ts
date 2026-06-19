// Figma sync worker (Supabase Edge Function, scheduled).
//
// Polls the linked Figma file's Dev Mode status, stores a design_snapshot, and
// flips mapped tasks to Design Ready when a frame is marked "Ready for
// development" / Design Changed when it is edited after handoff (TC-22/24).
// v1 uses Figma `lastModified` at the node level, not a pixel diff (§9.7).
//
// Secrets: supabase secrets set FIGMA_TOKEN=... FIGMA_FILE_KEY=...

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

Deno.serve(async () => {
  // TODO: GET file nodes + dev status → upsert design_snapshot → detect
  //       ready/changed vs previous → update task.design_state + insert activity.
  return Response.json({ ok: true, note: 'figma-worker stub — poll Dev Mode status' });
});
