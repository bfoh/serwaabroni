-- migration_025: re-target expenses/customers/stock_batches/batch_consumptions
-- RLS to business_id_for(). See migration_024 for the same pattern + rationale.
--
-- WARNING: do not re-run this file after migration_029. migration_029 adds a
-- role_for(auth.uid()) IN ('owner','manager') gate on top of the four
-- expenses policies this file declares, reusing the SAME policy names
-- (DROP POLICY IF EXISTS + CREATE POLICY). Re-running migration_025 after
-- migration_029 would silently strip that gate back out — no error, just a
-- quiet return to Staff having full expenses CRUD. Run each numbered
-- migration file exactly once, in order; never re-run an earlier one after a
-- later one has already applied.

-- ---- expenses ----
DROP POLICY IF EXISTS "Users can view own expenses" ON expenses;
CREATE POLICY "Users can view own expenses" ON expenses
  FOR SELECT USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own expenses" ON expenses;
CREATE POLICY "Users can insert own expenses" ON expenses
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

-- Not in the original task brief — migration_005_super_admin.sql:97-99 created
-- this policy (absent from schema.sql, which only had SELECT/INSERT/DELETE for
-- expenses), so it's live in the deployed schema and needs the same re-target
-- as every other owner-scoped policy in this file. The app issues no UPDATE
-- against expenses today (verified: no .update() call site on this table), so
-- leaving it un-retargeted would fail closed rather than leak access — but
-- it's a real completeness gap worth closing now rather than a landmine for
-- a future expense-editing feature.
DROP POLICY IF EXISTS "Users can update own expenses" ON expenses;
CREATE POLICY "Users can update own expenses" ON expenses
  FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

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
