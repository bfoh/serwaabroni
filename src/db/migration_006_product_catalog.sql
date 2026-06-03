-- migration_006: shared product catalog (identity only; crowd-voted)
-- Run AFTER migration_005 (depends on is_tenant_active()).

-- 1. Canonical entry per code (current vote winner)
CREATE TABLE IF NOT EXISTS product_catalog (
  code         text PRIMARY KEY,            -- normalized barcode or QR
  name         text NOT NULL,
  brand        text,
  category     text,
  unit         text,
  report_count int  NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 2. Per-variant tally (votes behind the winner)
CREATE TABLE IF NOT EXISTS product_catalog_reports (
  code     text NOT NULL,
  name     text NOT NULL,
  brand    text,
  category text,
  unit     text,
  votes    int NOT NULL DEFAULT 0,
  PRIMARY KEY (code, name)
);

ALTER TABLE product_catalog         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_catalog_reports ENABLE ROW LEVEL SECURITY;

-- Catalog readable by any authenticated tenant; writes only via the RPC.
DROP POLICY IF EXISTS "Authenticated can read catalog" ON product_catalog;
CREATE POLICY "Authenticated can read catalog"
  ON product_catalog FOR SELECT USING (auth.role() = 'authenticated');
-- product_catalog_reports: RLS on, no policies => invisible to clients.

-- 3. Opt-out flag on the per-shop record
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS catalog_contribute boolean NOT NULL DEFAULT true;

-- 4. Write RPC: +1 vote for (code,name), promote majority to canonical
CREATE OR REPLACE FUNCTION contribute_catalog_entry(
  p_code text, p_name text, p_brand text, p_category text, p_unit text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE win record;
BEGIN
  IF NOT is_tenant_active(auth.uid()) THEN RETURN; END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0
     OR p_name IS NULL OR length(trim(p_name)) = 0 THEN RETURN; END IF;

  INSERT INTO product_catalog_reports (code, name, brand, category, unit, votes)
    VALUES (p_code, p_name, p_brand, p_category, p_unit, 1)
  ON CONFLICT (code, name) DO UPDATE
    SET votes    = product_catalog_reports.votes + 1,
        brand    = COALESCE(excluded.brand, product_catalog_reports.brand),
        category = COALESCE(excluded.category, product_catalog_reports.category),
        unit     = COALESCE(excluded.unit, product_catalog_reports.unit);

  SELECT name, brand, category, unit INTO win
    FROM product_catalog_reports WHERE code = p_code
    ORDER BY votes DESC, name ASC LIMIT 1;

  INSERT INTO product_catalog (code, name, brand, category, unit, report_count, updated_at)
    VALUES (p_code, win.name, win.brand, win.category, win.unit,
            (SELECT COALESCE(sum(votes),0) FROM product_catalog_reports WHERE code = p_code),
            now())
  ON CONFLICT (code) DO UPDATE
    SET name = excluded.name, brand = excluded.brand, category = excluded.category,
        unit = excluded.unit, report_count = excluded.report_count, updated_at = now();
END $$;
