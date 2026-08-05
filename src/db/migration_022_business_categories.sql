-- migration_022: multi-industry product categories.
-- Run AFTER migration_021. See docs/superpowers/specs/2026-08-03-multi-industry-categories-design.md

CREATE TABLE IF NOT EXISTS business_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'box',
  sort_order int NOT NULL DEFAULT 0,
  is_builtin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_categories_user_name ON business_categories (user_id, lower(name));

ALTER TABLE business_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own business_categories"   ON business_categories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own business_categories" ON business_categories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own business_categories" ON business_categories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own business_categories" ON business_categories FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_business_categories_user ON business_categories(user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE business_categories;

ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS industry text;

-- ────────────────────────────────────────────────────────────────────────
-- Backfill (idempotent — steps 1-4 below are safe to re-run). The RLS
-- policies and ALTER PUBLICATION statements ABOVE this section are NOT
-- re-run-safe (CREATE POLICY / ALTER PUBLICATION both error on a second run)
-- — same convention as migration_005_super_admin.sql / migration_019_cash_movements.sql.
-- ────────────────────────────────────────────────────────────────────────

-- 1. Ensure every auth user who has ever used the app as a tenant (has a
--    product or a sale) has a business_profiles row. Today a row is only
--    created the first time someone saves Settings → Edit Profile, so many
--    real tenants have none yet. Without this, the app-side "new signup"
--    gate (business_profiles IS NULL) would incorrectly fire for existing
--    users who simply never opened Settings.
INSERT INTO business_profiles (user_id, business_name, industry)
SELECT u.id, 'My Shop', 'Supermarket'
FROM auth.users u
WHERE EXISTS (SELECT 1 FROM products p WHERE p.user_id = u.id)
   OR EXISTS (SELECT 1 FROM sales s WHERE s.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

-- 2. Backfill industry for every business_profiles row that predates this
--    column (including rows just inserted above, and any pre-existing row
--    created via Settings before today).
UPDATE business_profiles SET industry = 'Supermarket' WHERE industry IS NULL;

-- 3. Give every SUPERMARKET tenant with a business_profiles row the legacy 8
--    Supermarket categories (now editable), skipping any name they already
--    have (case-insensitive) so this is safe to re-run. Scoped to
--    industry='Supermarket' so re-running this file after a non-Supermarket
--    tenant has signed up can never inject supermarket categories into their
--    list — step 2 above only ever defaults NULLs to 'Supermarket', so a
--    genuinely new non-Supermarket tenant's industry is never NULL by the
--    time this runs.
INSERT INTO business_categories (user_id, name, icon, sort_order, is_builtin)
SELECT bp.user_id, v.name, v.icon, v.sort_order, false
FROM business_profiles bp
CROSS JOIN (VALUES
  ('Groceries', 'box', 0),
  ('Dairy', 'milk', 1),
  ('Beverages', 'cup-soda', 2),
  ('Cooking', 'utensils', 3),
  ('Grains', 'wheat', 4),
  ('Canned', 'package', 5),
  ('Noodles', 'soup', 6),
  ('Bakery', 'croissant', 7)
) AS v(name, icon, sort_order)
WHERE bp.industry = 'Supermarket'
  AND NOT EXISTS (
    SELECT 1 FROM business_categories bc
    WHERE bc.user_id = bp.user_id AND lower(bc.name) = lower(v.name)
  );

-- 4. Every tenant also gets a builtin 'Uncategorized' row (never deletable),
--    skipping tenants that already have one.
INSERT INTO business_categories (user_id, name, icon, sort_order, is_builtin)
SELECT bp.user_id, 'Uncategorized', 'box', 99, true
FROM business_profiles bp
WHERE NOT EXISTS (
  SELECT 1 FROM business_categories bc
  WHERE bc.user_id = bp.user_id AND lower(bc.name) = lower('Uncategorized')
);

-- ────────────────────────────────────────────────────────────────────────
-- rename_category: atomically rename a category row AND cascade the new
-- name onto every product using the old one (single function body = single
-- implicit transaction). SECURITY DEFINER to update both tables in one
-- call; every statement is explicitly scoped to auth.uid() so a caller can
-- never touch another tenant's rows.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rename_category(p_id uuid, p_new_name text)
  RETURNS business_categories
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row business_categories;
  v_old_name text;
BEGIN
  SELECT * INTO v_row FROM business_categories WHERE id = p_id AND user_id = auth.uid();
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'category not found';
  END IF;
  v_old_name := v_row.name;

  UPDATE business_categories SET name = p_new_name
    WHERE id = p_id AND user_id = auth.uid()
    RETURNING * INTO v_row;

  UPDATE products SET category = p_new_name
    WHERE category = v_old_name AND user_id = auth.uid();

  RETURN v_row;
END $$;
