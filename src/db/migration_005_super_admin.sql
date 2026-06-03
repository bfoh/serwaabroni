-- migration_005: super admin tenant management
-- Run AFTER migration_004. All admin authority is enforced here in Postgres.

-- ============================================================
-- 1. Admin registry (RLS on, no client policies => invisible to clients)
-- ============================================================
CREATE TABLE IF NOT EXISTS super_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Tenant lifecycle columns on the per-shop record
-- ============================================================
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'active'
                                            CHECK (status IN ('active','suspended')),
  ADD COLUMN IF NOT EXISTS suspended_at     timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;

-- ============================================================
-- 3. Gate functions
-- ============================================================
CREATE OR REPLACE FUNCTION is_super_admin(uid uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE user_id = uid);
$$;

CREATE OR REPLACE FUNCTION is_tenant_active(uid uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT status <> 'suspended' FROM business_profiles WHERE user_id = uid),
    true
  );
$$;

CREATE OR REPLACE FUNCTION am_i_super_admin()
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_super_admin(auth.uid());
$$;

-- ============================================================
-- 4. Admin read bypass (second permissive SELECT policy per table; OR'd)
-- ============================================================
CREATE POLICY "Super admin reads all products"
  ON products FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin reads all sales"
  ON sales FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin reads all debts"
  ON debts FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin reads all expenses"
  ON expenses FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin reads all customers"
  ON customers FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin reads all business_profiles"
  ON business_profiles FOR SELECT USING (is_super_admin(auth.uid()));

-- ============================================================
-- 5. Suspend enforcement: recreate owner WRITE policies to require active tenant
--    (reads left intact; suspended tenant can view but not mutate)
-- ============================================================
-- products
DROP POLICY IF EXISTS "Users can insert own products" ON products;
CREATE POLICY "Users can insert own products" ON products
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own products" ON products;
CREATE POLICY "Users can update own products" ON products
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own products" ON products;
CREATE POLICY "Users can delete own products" ON products
  FOR DELETE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- sales
DROP POLICY IF EXISTS "Users can insert own sales" ON sales;
CREATE POLICY "Users can insert own sales" ON sales
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own sales" ON sales;
CREATE POLICY "Users can update own sales" ON sales
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own sales" ON sales;
CREATE POLICY "Users can delete own sales" ON sales
  FOR DELETE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- debts
DROP POLICY IF EXISTS "Users can insert own debts" ON debts;
CREATE POLICY "Users can insert own debts" ON debts
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own debts" ON debts;
CREATE POLICY "Users can update own debts" ON debts
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- expenses
DROP POLICY IF EXISTS "Users can insert own expenses" ON expenses;
CREATE POLICY "Users can insert own expenses" ON expenses
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own expenses" ON expenses;
CREATE POLICY "Users can update own expenses" ON expenses
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own expenses" ON expenses;
CREATE POLICY "Users can delete own expenses" ON expenses
  FOR DELETE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- customers
DROP POLICY IF EXISTS "Users can insert own customers" ON customers;
CREATE POLICY "Users can insert own customers" ON customers
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own customers" ON customers;
CREATE POLICY "Users can update own customers" ON customers
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own customers" ON customers;
CREATE POLICY "Users can delete own customers" ON customers
  FOR DELETE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- business_profiles (so a suspended tenant cannot flip their own status back)
DROP POLICY IF EXISTS "Users can insert own profile" ON business_profiles;
CREATE POLICY "Users can insert own profile" ON business_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own profile" ON business_profiles;
CREATE POLICY "Users can update own profile" ON business_profiles
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- ============================================================
-- 6. Admin action RPCs (each re-checks admin; SECURITY DEFINER bypasses RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION admin_platform_summary()
  RETURNS TABLE (tenant_count int, active_count int, suspended_count int,
                 gross_revenue numeric, total_profit numeric, total_expenses numeric)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT (SELECT count(*)::int FROM auth.users),
           (SELECT count(*)::int FROM business_profiles WHERE status = 'active'),
           (SELECT count(*)::int FROM business_profiles WHERE status = 'suspended'),
           COALESCE((SELECT sum(total)  FROM sales),0)::numeric,
           COALESCE((SELECT sum(profit) FROM sales),0)::numeric,
           COALESCE((SELECT sum(amount) FROM expenses),0)::numeric;
END $$;

CREATE OR REPLACE FUNCTION admin_list_tenants()
  RETURNS TABLE (user_id uuid, email text, business_name text, status text,
                 created_at timestamptz, total_sales numeric, total_profit numeric,
                 total_expenses numeric, sale_count int, last_activity timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT u.id, u.email::text,
           COALESCE(bp.business_name, 'Unnamed shop'),
           COALESCE(bp.status, 'active'),
           u.created_at,
           COALESCE((SELECT sum(total)  FROM sales    s WHERE s.user_id = u.id),0)::numeric,
           COALESCE((SELECT sum(profit) FROM sales    s WHERE s.user_id = u.id),0)::numeric,
           COALESCE((SELECT sum(amount) FROM expenses e WHERE e.user_id = u.id),0)::numeric,
           COALESCE((SELECT count(*)::int FROM sales s WHERE s.user_id = u.id),0),
           (SELECT max(created_at) FROM sales s WHERE s.user_id = u.id)
    FROM auth.users u
    LEFT JOIN business_profiles bp ON bp.user_id = u.id
    ORDER BY u.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION admin_set_tenant_status(p_user_id uuid, p_status text, p_reason text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'bad status'; END IF;
  INSERT INTO business_profiles (user_id, business_name, status, suspended_at, suspended_reason)
    VALUES (p_user_id, 'My Shop', p_status,
            CASE WHEN p_status='suspended' THEN now() END,
            CASE WHEN p_status='suspended' THEN p_reason END)
  ON CONFLICT (user_id) DO UPDATE
    SET status = excluded.status,
        suspended_at = CASE WHEN excluded.status='suspended' THEN now() END,
        suspended_reason = CASE WHEN excluded.status='suspended' THEN p_reason END;
END $$;

CREATE OR REPLACE FUNCTION admin_delete_tenant(p_user_id uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'cannot delete yourself'; END IF;
  DELETE FROM auth.users WHERE id = p_user_id;  -- cascades all tenant tables
END $$;

-- ============================================================
-- 7. BOOTSTRAP (edit the email, then run once; safe to re-run)
-- ============================================================
-- INSERT INTO super_admins (user_id)
--   SELECT id FROM auth.users WHERE email = 'YOUR_ADMIN_EMAIL'
--   ON CONFLICT DO NOTHING;
