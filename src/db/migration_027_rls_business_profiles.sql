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

DROP POLICY IF EXISTS "Users can update own profile" ON business_profiles;
CREATE POLICY "Users can update own profile" ON business_profiles
  FOR UPDATE USING (
    business_id_for(auth.uid()) = user_id
    AND business_id_for(auth.uid()) = auth.uid()
    AND is_tenant_active(business_id_for(auth.uid()))
  );
