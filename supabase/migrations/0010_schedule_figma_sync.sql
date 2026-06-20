-- Schedule the figma-worker Edge Function so a designer marking a UC-n frame
-- "Ready for development" in Figma flips the matching task to Design Ready.
--
-- The worker is an HTTP function (verify_jwt = true), so the cron call sends the
-- service-role key as Bearer + apikey, read from Vault at run time so the secret
-- never sits in the job definition. One-time prerequisite (run once, in the SQL
-- editor, NOT committed):
--   select vault.create_secret('<service_role key>', 'cron_service_key');
--
-- Safe no-op until FIGMA_TOKEN is set and a project_source is configured: the
-- worker early-returns when there's no token / no enabled source.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-runnable: drop a prior schedule of the same name before (re)creating it.
select cron.unschedule('figma-sync')
where exists (select 1 from cron.job where jobname = 'figma-sync');

select cron.schedule('figma-sync', '*/5 * * * *', $job$
  select net.http_post(
    url     := 'https://agynsfjrhpabioiwjdpq.supabase.co/functions/v1/figma-worker',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_key'),
      'apikey',                      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_key')
    ),
    body := '{}'::jsonb
  );
$job$);
