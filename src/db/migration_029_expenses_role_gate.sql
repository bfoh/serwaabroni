-- migration_029: gate expenses RLS by role — Owner and Manager full access,
-- Staff none, per docs/superpowers/specs/2026-08-03-staff-rbac-design.md §5
-- ("Expenses ✅ Owner ✅ Manager ❌ Staff") and src/lib/permissions.ts's
-- MATRIX.expenses.
--
-- migration_025 re-targeted expenses to business_id_for(auth.uid()) = user_id
-- with no role restriction — since business_id_for() resolves the SAME
-- business id for owner, manager, and staff alike, that left Staff with full
-- SELECT/INSERT/UPDATE/DELETE on expenses at the DB layer, contradicting the
-- permission matrix Task 7 built to mirror this exact RLS. Found during
-- Task 7's review (cross-checking the matrix against the actual migrations),
-- not a defect in migration_025's own re-targeting logic — it simply never
-- had the role gate migration_027 later introduced for business_profiles.
--
-- Reuses that same role_for(auth.uid()) IN ('owner','manager') idiom.

DROP POLICY IF EXISTS "Users can view own expenses" ON expenses;
CREATE POLICY "Users can view own expenses" ON expenses
  FOR SELECT USING (
    business_id_for(auth.uid()) = user_id
    AND role_for(auth.uid()) IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "Users can insert own expenses" ON expenses;
CREATE POLICY "Users can insert own expenses" ON expenses
  FOR INSERT WITH CHECK (
    business_id_for(auth.uid()) = user_id
    AND role_for(auth.uid()) IN ('owner', 'manager')
    AND is_tenant_active(business_id_for(auth.uid()))
  );

DROP POLICY IF EXISTS "Users can update own expenses" ON expenses;
CREATE POLICY "Users can update own expenses" ON expenses
  FOR UPDATE USING (
    business_id_for(auth.uid()) = user_id
    AND role_for(auth.uid()) IN ('owner', 'manager')
    AND is_tenant_active(business_id_for(auth.uid()))
  );

DROP POLICY IF EXISTS "Users can delete own expenses" ON expenses;
CREATE POLICY "Users can delete own expenses" ON expenses
  FOR DELETE USING (
    business_id_for(auth.uid()) = user_id
    AND role_for(auth.uid()) IN ('owner', 'manager')
    AND is_tenant_active(business_id_for(auth.uid()))
  );
