-- migration_011: per-tenant SMS sender ID
--
-- Lets each shop send SMS under its own brand instead of the shared fallback.
-- NOTE: Arkesel only delivers from sender IDs that are pre-registered and approved
-- on the account (alphanumeric, max 11 chars, no spaces). An unapproved value will
-- be rejected or replaced by Arkesel. The edge functions fall back to ARKESEL_SENDER_ID
-- when this is empty.

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS sms_sender_id text;
