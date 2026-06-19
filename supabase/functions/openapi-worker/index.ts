// OpenAPI sync worker (Supabase Edge Function, scheduled).
//
// Polls the backend's OpenAPI spec, stores a snapshot, diffs against the last
// one, and flips mapped tasks to Contract Ready / Contract Changed — then
// writes an `activity` row so the FE owner is notified via Realtime.
// On an unreachable / malformed spec it keeps the last good snapshot and marks
// it stale; it never fabricates a state change (TC-18/19).
//
// Schedule with pg_cron or an external cron hitting this endpoint.
// Secrets: supabase secrets set OPENAPI_SPEC_URL=...

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

Deno.serve(async () => {
  // TODO: fetch OPENAPI_SPEC_URL → flatten operations → upsert spec_snapshot
  //       → diff vs previous → update task.backend_state + insert activity.
  return Response.json({ ok: true, note: 'openapi-worker stub — poll + diff the spec' });
});
