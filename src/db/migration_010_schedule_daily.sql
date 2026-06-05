-- migration_010: schedule the daily-tasks edge function via pg_cron + pg_net
--
-- Run this MANUALLY in the Supabase SQL editor AFTER:
--   1. Deploying the daily-tasks edge function.
--   2. Setting the CRON_SECRET function secret (supabase secrets set CRON_SECRET=...).
-- Replace <CRON_SECRET> below with that same value. Do not commit the real secret.
--
-- The schedule '0 18 * * *' runs at 18:00 UTC daily (Ghana is UTC+0). Adjust as needed.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any previous schedule with this name before (re)creating it.
SELECT cron.unschedule('serwaabroni-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'serwaabroni-daily');

SELECT cron.schedule(
  'serwaabroni-daily',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://qumttowvyujqaubyshjq.supabase.co/functions/v1/daily-tasks',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'X-Cron-Secret', '<CRON_SECRET>'
               ),
    body    := '{}'::jsonb
  );
  $$
);
