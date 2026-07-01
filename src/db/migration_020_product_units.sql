-- migration_020: multi-unit products (pack <-> base conversion).
-- products.unit is the BASE unit. pack_unit is the optional bigger unit,
-- units_per_pack the conversion factor (>=1, 1 = single-unit/legacy).
-- sales.sale_unit / sale_unit_qty are DISPLAY ONLY; quantity stays base units.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pack_unit text,
  ADD COLUMN IF NOT EXISTS units_per_pack integer NOT NULL DEFAULT 1;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS sale_unit text,
  ADD COLUMN IF NOT EXISTS sale_unit_qty numeric;
