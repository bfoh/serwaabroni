-- migration_025: re-target expenses/customers/stock_batches/batch_consumptions
-- RLS to business_id_for(). See migration_024 for the same pattern + rationale.

-- ---- expenses ----
DROP POLICY IF EXISTS "Users can view own expenses" ON expenses;
CREATE POLICY "Users can view own expenses" ON expenses
  FOR SELECT USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own expenses" ON expenses;
CREATE POLICY "Users can insert own expenses" ON expenses
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

DROP POLICY IF EXISTS "Users can delete own expenses" ON expenses;
CREATE POLICY "Users can delete own expenses" ON expenses
  FOR DELETE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

-- ---- customers ----
DROP POLICY IF EXISTS "Users can view own customers" ON customers;
CREATE POLICY "Users can view own customers" ON customers
  FOR SELECT USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own customers" ON customers;
CREATE POLICY "Users can insert own customers" ON customers
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

DROP POLICY IF EXISTS "Users can update own customers" ON customers;
CREATE POLICY "Users can update own customers" ON customers
  FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

DROP POLICY IF EXISTS "Users can delete own customers" ON customers;
CREATE POLICY "Users can delete own customers" ON customers
  FOR DELETE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

-- ---- stock_batches ---- (never had is_tenant_active — preserved as-is)
DROP POLICY IF EXISTS "Users can view own batches" ON stock_batches;
CREATE POLICY "Users can view own batches" ON stock_batches
  FOR SELECT USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own batches" ON stock_batches;
CREATE POLICY "Users can insert own batches" ON stock_batches
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own batches" ON stock_batches;
CREATE POLICY "Users can update own batches" ON stock_batches
  FOR UPDATE USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own batches" ON stock_batches;
CREATE POLICY "Users can delete own batches" ON stock_batches
  FOR DELETE USING (business_id_for(auth.uid()) = user_id);

-- ---- batch_consumptions ----
DROP POLICY IF EXISTS "Users can view own consumptions" ON batch_consumptions;
CREATE POLICY "Users can view own consumptions" ON batch_consumptions
  FOR SELECT USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own consumptions" ON batch_consumptions;
CREATE POLICY "Users can insert own consumptions" ON batch_consumptions
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own consumptions" ON batch_consumptions;
CREATE POLICY "Users can delete own consumptions" ON batch_consumptions
  FOR DELETE USING (business_id_for(auth.uid()) = user_id);
