-- migration_023: business_members — staff/manager accounts scoped to an owner's
-- tenant. See docs/superpowers/specs/2026-08-03-staff-rbac-design.md §3.
-- user_id columns on every other domain table are NEVER renamed; RLS instead
-- re-targets via business_id_for() below.

CREATE TABLE IF NOT EXISTS business_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- owner's user_id = tenant id
  member_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,          -- null until invite accepted
  invited_email  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('manager','staff')),
  status         text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','removed')),
  invited_at     timestamptz NOT NULL DEFAULT now(),
  joined_at      timestamptz,
  UNIQUE (business_id, invited_email)
);

ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;

-- Staff/manager management is owner-only — a member can never read or edit
-- their own row directly; activate_membership() below is their one narrow
-- SECURITY DEFINER escape hatch for self-activation on first login.
CREATE POLICY "Owner can view own staff" ON business_members
  FOR SELECT USING (auth.uid() = business_id);
CREATE POLICY "Owner can insert own staff" ON business_members
  FOR INSERT WITH CHECK (auth.uid() = business_id);
CREATE POLICY "Owner can update own staff" ON business_members
  FOR UPDATE USING (auth.uid() = business_id);
CREATE POLICY "Owner can delete own staff" ON business_members
  FOR DELETE USING (auth.uid() = business_id);

CREATE INDEX IF NOT EXISTS idx_business_members_business ON business_members(business_id);
CREATE INDEX IF NOT EXISTS idx_business_members_member ON business_members(member_user_id);

-- ============================================================
-- business_id_for(uid): "which tenant does this caller belong to."
-- Owner resolves to their own id; an ACTIVE staff/manager resolves to their
-- employer's id. MUST be SECURITY DEFINER (unlike the spec's illustrative
-- snippet, which omits it): a staff member's own business_members row is only
-- visible under the owner-only RLS policies above, so a plain SECURITY
-- INVOKER function called by the staff member themselves would see zero rows
-- and always resolve NULL — locking every staff/manager out of every table.
-- This mirrors the existing is_super_admin()/is_tenant_active() pattern in
-- migration_005_super_admin.sql, which uses SECURITY DEFINER for exactly
-- this reason (a lookup function that must read a table the caller can't).
--
-- LIMIT 1 on the membership subquery is defense-in-depth: this model assumes
-- one active business per member_user_id (activate_membership() below only
-- ever activates one row per login), but a scalar subquery returning >1 row
-- raises a hard Postgres error rather than resolving gracefully — LIMIT 1
-- keeps this function total (always returns exactly one value or NULL) even
-- if that invariant is ever violated by a manual data edit.
-- ============================================================
CREATE OR REPLACE FUNCTION business_id_for(uid uuid)
  RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM auth.users WHERE id = uid AND EXISTS(SELECT 1 FROM business_profiles WHERE business_profiles.user_id = uid)),
    (SELECT business_id FROM business_members WHERE member_user_id = uid AND status = 'active' LIMIT 1)
  )
$$;

-- role_for(uid): 'owner' | 'manager' | 'staff' | NULL. Same SECURITY DEFINER
-- requirement, rationale, and LIMIT 1 defense-in-depth as business_id_for() above.
CREATE OR REPLACE FUNCTION role_for(uid uuid)
  RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT 'owner' FROM business_profiles WHERE user_id = uid),
    (SELECT role FROM business_members WHERE member_user_id = uid AND status = 'active' LIMIT 1)
  )
$$;

-- activate_membership(): self-service invite acceptance. An invited row has
-- member_user_id = NULL and status = 'invited' until the invitee's FIRST
-- login, which calls this. It matches the caller's own auth email to any
-- invited_email row and flips it to active. Must be SECURITY DEFINER: the
-- owner-only UPDATE policy above would otherwise block the invitee (who is
-- not the owner) from ever activating their own row.
--
-- Scoped to activate AT MOST ONE row per call (ORDER BY invited_at ASC LIMIT
-- 1), not every 'invited' row matching the caller's email: invited_email has
-- no UNIQUE constraint on its own (only UNIQUE(business_id, invited_email)),
-- so the same email can legitimately be invited by more than one owner. This
-- model assumes one active business per member_user_id — business_id_for()/
-- role_for() each resolve to a single value — so activating every matching
-- invite at once would silently attach one auth user to multiple businesses
-- simultaneously and make those lookups return more than one row. Any other
-- pending invite for the same email is left untouched in 'invited' status.
CREATE OR REPLACE FUNCTION activate_membership()
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_email text;
BEGIN
  caller_email := (SELECT email FROM auth.users WHERE id = auth.uid());
  IF caller_email IS NULL THEN RETURN; END IF;
  UPDATE business_members
     SET status = 'active', member_user_id = auth.uid(), joined_at = now()
   WHERE id = (
     SELECT id FROM business_members
     WHERE invited_email = caller_email AND status = 'invited'
     ORDER BY invited_at ASC
     LIMIT 1
   );
END $$;
