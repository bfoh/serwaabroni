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
-- touch this table at all. business_id_for()'s first branch requires an
-- EXISTING business_profiles row for that uid — a brand-new signup has none
-- yet, so business_id_for(new_uid) resolves NULL. COALESCE(business_id_for
-- (auth.uid()), auth.uid()) falls back to the caller's own raw identity only
-- when business_id_for() found nothing at all (the genuine bootstrap case)
-- — an active Staff/Manager's business_id_for() always resolves to their
-- EMPLOYER's id (never NULL), so they still fail this check and can never
-- touch a profile on the owner's behalf.
--
-- Collapsed into a single SECURITY DEFINER function (rather than the
-- 3-clause AND expression inline in each policy, as this originally
-- shipped) after live production testing repeatedly reproduced "new row
-- violates row-level security policy for table business_profiles" on a
-- brand-new signup's very first INSERT — despite every individual clause
-- independently verifying true, both via literal-value SQL tests AND a
-- debug trigger that computed each clause live inside the actual failing
-- request and printed all-true. Disabling RLS made the identical request
-- succeed, confirming the block was genuinely RLS enforcement on this
-- policy, not application logic. The exact mechanism was never conclusively
-- identified, but a single function call replacing a compound inline
-- boolean expression is the standard, robust way to sidestep whatever
-- Postgres/PostgREST-specific interaction was at play — it also makes
-- INSERT and UPDATE share one definition instead of two near-duplicates.
CREATE OR REPLACE FUNCTION can_own_business_profile(p_user_id uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    auth.uid() = p_user_id
    AND COALESCE(business_id_for(auth.uid()), auth.uid()) = auth.uid()
    AND is_tenant_active(auth.uid());
$$;

DROP POLICY IF EXISTS "Users can insert own profile" ON business_profiles;
CREATE POLICY "Users can insert own profile" ON business_profiles
  FOR INSERT WITH CHECK (can_own_business_profile(user_id));

DROP POLICY IF EXISTS "Users can update own profile" ON business_profiles;
CREATE POLICY "Users can update own profile" ON business_profiles
  FOR UPDATE USING (can_own_business_profile(user_id));
