-- migration_027: business_profiles special case — Owner: full read/write.
-- Manager: view-only. Staff: no access at all (role_for() must be 'owner' or
-- 'manager' just to SELECT). See docs/superpowers/specs/2026-08-03-staff-rbac-design.md §5.

DROP POLICY IF EXISTS "Users can view own profile" ON business_profiles;
CREATE POLICY "Users can view own profile" ON business_profiles
  FOR SELECT USING (
    business_id_for(auth.uid()) = user_id
    AND role_for(auth.uid()) IN ('owner', 'manager')
  );

-- INSERT/UPDATE stay owner-only: Manager can view but never edit, Staff can't
-- touch this table at all. Reuses the same owner-only idiom as migration_026
-- — EXCEPT the INSERT policy below cannot use business_id_for(auth.uid())
-- as its identity check the way UPDATE does. business_id_for()'s first
-- branch requires an EXISTING business_profiles row for that uid — a
-- brand-new signup has none yet, so business_id_for(new_uid) resolves NULL,
-- and business_id_for(auth.uid()) = auth.uid() is NULL, which INSERT rejects.
-- That's a chicken-and-egg deadlock: no new tenant could ever create their
-- first profile row. COALESCE(business_id_for(auth.uid()), auth.uid()) falls
-- back to the caller's own raw identity only when business_id_for() found
-- nothing at all (the genuine bootstrap case) — an active Staff/Manager's
-- business_id_for() always resolves to their EMPLOYER's id (never NULL), so
-- they still fail this check and can never insert a profile on the owner's
-- behalf. is_tenant_active(auth.uid()) (not business_id_for(auth.uid())) is
-- deliberate too: for a brand-new uid with no business_profiles row yet, its
-- COALESCE(...,true) default correctly resolves "not suspended" without
-- requiring the row that's still being created.
DROP POLICY IF EXISTS "Users can insert own profile" ON business_profiles;
CREATE POLICY "Users can insert own profile" ON business_profiles
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND COALESCE(business_id_for(auth.uid()), auth.uid()) = auth.uid()
    AND is_tenant_active(auth.uid())
  );

-- The client's upsertBusinessProfile() always calls .upsert() (never a plain
-- .update()), which PostgREST sends as `Prefer: resolution=merge-duplicates`
-- — an INSERT ... ON CONFLICT DO UPDATE. Postgres requires BOTH the INSERT
-- and UPDATE row-security policies to permit that statement shape, not just
-- whichever branch actually runs at the row level. A brand-new owner's very
-- first save has no existing business_profiles row yet, so business_id_for()
-- correctly resolves NULL (the same bootstrap case the INSERT policy above
-- already handles) — but comparing that NULL directly against user_id/
-- auth.uid() is NULL (never true), which blocked the WHOLE upsert statement
-- even though no actual conflicting row exists and a plain insert would have
-- succeeded on its own. Found live in production testing: a fresh signup's
-- very first "Continue" on the industry picker 403'd with "new row violates
-- row-level security policy for table business_profiles" despite the INSERT
-- policy alone permitting it. Same COALESCE(...,auth.uid()) bootstrap
-- fallback as the INSERT policy fixes it here too.
DROP POLICY IF EXISTS "Users can update own profile" ON business_profiles;
CREATE POLICY "Users can update own profile" ON business_profiles
  FOR UPDATE USING (
    COALESCE(business_id_for(auth.uid()), auth.uid()) = user_id
    AND COALESCE(business_id_for(auth.uid()), auth.uid()) = auth.uid()
    AND is_tenant_active(COALESCE(business_id_for(auth.uid()), auth.uid()))
  );
