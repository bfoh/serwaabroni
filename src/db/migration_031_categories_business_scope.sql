-- migration_031: re-target business_categories RLS + rename_category() to
-- business_id_for(), matching every other tenant table's re-target in
-- migrations 024-027. Found in the RBAC feature's final whole-branch review:
-- the multi-industry categories feature (which landed on this branch before
-- RBAC work began) was never updated for the new business_id_for() model —
-- an active Manager/Staff account's category reads/writes stayed scoped to
-- their own raw auth uid, so state.categories was always empty for them
-- (every picker silently fell back to the generic Supermarket template
-- regardless of the tenant's real industry) and any category they created
-- became an orphan row under their own uid, invisible to the owner.
--
-- No role restriction is added here (unlike expenses/business_profiles) —
-- categories are read/write for all three roles, matching stockView/
-- stockEdit's "true for all roles" shape, since choosing a product's
-- category is part of the same add/edit-stock workflow Staff already has.

DROP POLICY IF EXISTS "Users can view own business_categories" ON business_categories;
CREATE POLICY "Users can view own business_categories" ON business_categories
  FOR SELECT USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own business_categories" ON business_categories;
CREATE POLICY "Users can insert own business_categories" ON business_categories
  FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own business_categories" ON business_categories;
CREATE POLICY "Users can update own business_categories" ON business_categories
  FOR UPDATE USING (business_id_for(auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own business_categories" ON business_categories;
CREATE POLICY "Users can delete own business_categories" ON business_categories
  FOR DELETE USING (business_id_for(auth.uid()) = user_id);

-- rename_category() itself scoped every statement to raw auth.uid() — for a
-- Manager/Staff caller this only ever found/renamed their own orphan rows
-- (which shouldn't exist once the client-side fix lands), never the real
-- tenant's category. Re-targeted to business_id_for(auth.uid()); still
-- SECURITY DEFINER for the same reason as the original (atomic rename +
-- cascade across two tables in one call), still fully scoped so a caller can
-- never touch another business's rows.
CREATE OR REPLACE FUNCTION rename_category(p_id uuid, p_new_name text)
  RETURNS business_categories
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row business_categories;
  v_old_name text;
  v_business_id uuid;
BEGIN
  v_business_id := business_id_for(auth.uid());
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'not a recognized business member';
  END IF;

  SELECT * INTO v_row FROM business_categories WHERE id = p_id AND user_id = v_business_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'category not found';
  END IF;
  v_old_name := v_row.name;

  UPDATE business_categories SET name = p_new_name
    WHERE id = p_id AND user_id = v_business_id
    RETURNING * INTO v_row;

  UPDATE products SET category = p_new_name
    WHERE category = v_old_name AND user_id = v_business_id;

  RETURN v_row;
END $$;
