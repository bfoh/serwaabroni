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
-- touch this table at all. Reuses the same owner-only idiom as migration_026.
DROP POLICY IF EXISTS "Users can insert own profile" ON business_profiles;
CREATE POLICY "Users can insert own profile" ON business_profiles
  FOR INSERT WITH CHECK (
    business_id_for(auth.uid()) = user_id
    AND business_id_for(auth.uid()) = auth.uid()
    AND is_tenant_active(business_id_for(auth.uid()))
  );

DROP POLICY IF EXISTS "Users can update own profile" ON business_profiles;
CREATE POLICY "Users can update own profile" ON business_profiles
  FOR UPDATE USING (
    business_id_for(auth.uid()) = user_id
    AND business_id_for(auth.uid()) = auth.uid()
    AND is_tenant_active(business_id_for(auth.uid()))
  );
