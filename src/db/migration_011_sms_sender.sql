-- migration_011: per-tenant SMS sender ID
--
-- Lets a shop send SMS under its own brand instead of the shared default sender.
-- NOTE: Ghana networks only DELIVER sender IDs registered with Arkesel/NCA. The API
-- accepts any value but silently drops unregistered names (confirmed by testing), so
-- this only works once the shop has registered that exact ID with Arkesel. When empty,
-- the edge functions use ARKESEL_SENDER_ID and the shop name appears in the message body.

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS sms_sender_id text;
