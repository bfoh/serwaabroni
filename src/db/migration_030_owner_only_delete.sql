-- migration_030: restrict DELETE on products/sales/debts/customers to the
-- OWNER only. Found in the RBAC feature's final whole-branch review: the
-- permission matrix's own wording for these areas is "add/edit" (products)
-- and "view, record payment" (customers/debts) — never "delete" — for both
-- Manager and Staff, but migrations 024/025 re-targeted every CRUD operation
-- identically via business_id_for() with no role check. Combined with
-- Settings' "Reset All Data" action (which bulk-deletes across all four of
-- these tables under the owner's business id, resolved identically for any
-- caller via getCurrentUserId()), any Staff or Manager account could destroy
-- the entire business's product catalogue, sales history, debts, and
-- customer list in one tap — this migration is what actually prevents that
-- at the real enforcement layer, not just hiding the button in the UI
-- (Settings.tsx / App.tsx also gate the Reset action and the Settings route
-- itself, but those are UX, not the security boundary).
--
-- role_for(auth.uid()) = 'owner' matches this repo's is_tenant_active-style
-- idiom exactly (see migration_026 for the identical "owner-only" shape,
-- migration_029 for the identical role_for() gating pattern applied to
-- expenses).

DROP POLICY IF EXISTS "Users can delete own products" ON products;
CREATE POLICY "Users can delete own products" ON products
  FOR DELETE USING (
    business_id_for(auth.uid()) = user_id
    AND role_for(auth.uid()) = 'owner'
    AND is_tenant_active(business_id_for(auth.uid()))
  );

DROP POLICY IF EXISTS "Users can delete own sales" ON sales;
CREATE POLICY "Users can delete own sales" ON sales
  FOR DELETE USING (
    business_id_for(auth.uid()) = user_id
    AND role_for(auth.uid()) = 'owner'
    AND is_tenant_active(business_id_for(auth.uid()))
  );

-- debts DELETE never had an is_tenant_active check (migration_018's original
-- shape, preserved through migration_024) — only the role gate is added here.
DROP POLICY IF EXISTS "Users can delete own debts" ON debts;
CREATE POLICY "Users can delete own debts" ON debts
  FOR DELETE USING (
    business_id_for(auth.uid()) = user_id
    AND role_for(auth.uid()) = 'owner'
  );

DROP POLICY IF EXISTS "Users can delete own customers" ON customers;
CREATE POLICY "Users can delete own customers" ON customers
  FOR DELETE USING (
    business_id_for(auth.uid()) = user_id
    AND role_for(auth.uid()) = 'owner'
    AND is_tenant_active(business_id_for(auth.uid()))
  );
