-- migration_009: outbound notification preferences + delivery log
--
-- Adds owner notification preferences to business_profiles and a notification_log
-- table used by the send-notification / daily-tasks edge functions for auditing and
-- de-duplication (so the same reminder/summary is not sent twice in a day).

-- 1. Per-shop notification preferences -------------------------------------------------
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS notify_sms            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_email          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_whatsapp       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_receipts       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_debt_reminders boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_daily_summary  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_critical       boolean NOT NULL DEFAULT true;

-- 2. Delivery log ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text NOT NULL,           -- 'debt_reminder' | 'receipt' | 'daily_summary' | 'critical'
  channel    text NOT NULL,           -- 'sms' | 'email' | 'whatsapp'
  recipient  text NOT NULL,           -- phone or email actually contacted
  ref_id     text,                    -- related debt/sale id (for dedupe + tracing)
  status     text NOT NULL DEFAULT 'sent',  -- 'sent' | 'failed' | 'skipped'
  error      text,
  sent_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Owners may read their own log. Writes happen via the service-role edge functions,
-- which bypass RLS, so no INSERT policy is granted to clients.
DROP POLICY IF EXISTS "Users can view own notification log" ON notification_log;
CREATE POLICY "Users can view own notification log"
  ON notification_log FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notification_log_user ON notification_log(user_id);

-- Dedupe guard: one (type, channel, recipient, ref_id) per calendar day.
-- daily-tasks / send-notification check this before sending.
-- (sent_at AT TIME ZONE 'UTC')::date is IMMUTABLE (fixed zone), unlike a bare
-- timestamptz::date cast which depends on the session TimeZone.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notification_per_day
  ON notification_log (user_id, type, channel, recipient, COALESCE(ref_id, ''), ((sent_at AT TIME ZONE 'UTC')::date))
  WHERE status = 'sent';
