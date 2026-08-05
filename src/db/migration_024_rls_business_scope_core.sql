-- migration_024: re-target products/sales/debts RLS from "auth.uid() = user_id"
-- to "business_id_for(auth.uid()) = user_id" so an active Manager/Staff member
-- resolves to their employer's rows. See migration_023 for business_id_for().
--
-- Every is_tenant_active(auth.uid()) becomes is_tenant_active(business_id_for(auth.uid())).
-- The original form checked the CALLER's own business_profiles row, which is
-- empty for a staff/manager account, so COALESCE(...,'true') in
-- is_tenant_active() always passed and silently bypassed suspension
-- enforcement for staff. Resolving the owner's id first is a required
-- corollary of the business_id_for() re-target, not a scope change.

-- ---- products ----
DROP POLICY IF EXISTS "Users can view own products" ON products;
CREATE POLICY "Users can view own products" ON products
  FOR SELECT USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own products" ON products;
CREATE POLICY "Users can insert own products" ON products
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

DROP POLICY IF EXISTS "Users can update own products" ON products;
CREATE POLICY "Users can update own products" ON products
  FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

DROP POLICY IF EXISTS "Users can delete own products" ON products;
CREATE POLICY "Users can delete own products" ON products
  FOR DELETE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

-- ---- sales ----
DROP POLICY IF EXISTS "Users can view own sales" ON sales;
CREATE POLICY "Users can view own sales" ON sales
  FOR SELECT USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own sales" ON sales;
CREATE POLICY "Users can insert own sales" ON sales
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

DROP POLICY IF EXISTS "Users can update own sales" ON sales;
CREATE POLICY "Users can update own sales" ON sales
  FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

DROP POLICY IF EXISTS "Users can delete own sales" ON sales;
CREATE POLICY "Users can delete own sales" ON sales
  FOR DELETE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

-- ---- debts ----
DROP POLICY IF EXISTS "Users can view own debts" ON debts;
CREATE POLICY "Users can view own debts" ON debts
  FOR SELECT USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own debts" ON debts;
CREATE POLICY "Users can insert own debts" ON debts
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

DROP POLICY IF EXISTS "Users can update own debts" ON debts;
CREATE POLICY "Users can update own debts" ON debts
  FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

-- debts DELETE (migration_018) never had an is_tenant_active check — preserved
-- as-is, only the identity check is re-targeted.
DROP POLICY IF EXISTS "Users can delete own debts" ON debts;
CREATE POLICY "Users can delete own debts" ON debts
  FOR DELETE USING (business_id_for(auth.uid()) = user_id);
