-- migration_026: cash_movements, capital_injections, and repayment_installments
-- stay OWNER-ONLY per docs/superpowers/specs/2026-08-03-staff-rbac-design.md §3/§5.
-- Manager and Staff resolve business_id_for(auth.uid()) to the owner's id (same
-- as every other table) but must ALSO satisfy
-- "business_id_for(auth.uid()) = auth.uid()" — only ever true when the caller
-- IS the owner (business_id_for(owner) always equals the owner's own uid).

-- ---- cash_movements ----
DROP POLICY IF EXISTS "Users can view own cash_movements" ON cash_movements;
CREATE POLICY "Users can view own cash_movements" ON cash_movements
  FOR SELECT USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

DROP POLICY IF EXISTS "Users can insert own cash_movements" ON cash_movements;
CREATE POLICY "Users can insert own cash_movements" ON cash_movements
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

DROP POLICY IF EXISTS "Users can update own cash_movements" ON cash_movements;
CREATE POLICY "Users can update own cash_movements" ON cash_movements
  FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

DROP POLICY IF EXISTS "Users can delete own cash_movements" ON cash_movements;
CREATE POLICY "Users can delete own cash_movements" ON cash_movements
  FOR DELETE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

-- ---- capital_injections ----
DROP POLICY IF EXISTS "Users can view own injections" ON capital_injections;
CREATE POLICY "Users can view own injections" ON capital_injections
  FOR SELECT USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

DROP POLICY IF EXISTS "Users can insert own injections" ON capital_injections;
CREATE POLICY "Users can insert own injections" ON capital_injections
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

DROP POLICY IF EXISTS "Users can update own injections" ON capital_injections;
CREATE POLICY "Users can update own injections" ON capital_injections
  FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

DROP POLICY IF EXISTS "Users can delete own injections" ON capital_injections;
CREATE POLICY "Users can delete own injections" ON capital_injections
  FOR DELETE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

-- ---- repayment_installments ----
DROP POLICY IF EXISTS "Users can view own installments" ON repayment_installments;
CREATE POLICY "Users can view own installments" ON repayment_installments
  FOR SELECT USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

DROP POLICY IF EXISTS "Users can insert own installments" ON repayment_installments;
CREATE POLICY "Users can insert own installments" ON repayment_installments
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

DROP POLICY IF EXISTS "Users can update own installments" ON repayment_installments;
CREATE POLICY "Users can update own installments" ON repayment_installments
  FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

DROP POLICY IF EXISTS "Users can delete own installments" ON repayment_installments;
CREATE POLICY "Users can delete own installments" ON repayment_installments
  FOR DELETE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());
