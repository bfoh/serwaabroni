-- migration_034: migration_033's column REVOKE had no effect — fix it.
--
-- Verified live via a raw fetch() as Staff AFTER applying migration_033:
-- products?select=* still returned the real cost_price. Root cause: earlier
-- RLS setup did `GRANT SELECT ON products TO authenticated` (a table-level,
-- all-columns grant). `REVOKE SELECT (cost_price) ON products FROM
-- authenticated` only revokes a column-specific grant — since cost_price
-- was never granted at the column level (it was covered by the blanket
-- table-level grant), that REVOKE had nothing to remove. The table-level
-- grant still implicitly covers every column, cost_price included.
--
-- Fix: revoke the blanket table-level SELECT entirely, then re-grant SELECT
-- on the explicit column list that excludes cost_price/profit. Table-level
-- INSERT/UPDATE/DELETE grants are untouched — this migration only narrows
-- what can be read directly, mirroring what get_products()/get_sales()
-- already do server-side.

REVOKE SELECT ON products FROM authenticated;
GRANT SELECT (
  id, user_id, name, selling_price, quantity, unit, pack_unit, units_per_pack,
  category, low_stock_threshold, barcode, qr_code, created_at, updated_at
) ON products TO authenticated;

REVOKE SELECT ON sales FROM authenticated;
GRANT SELECT (
  id, user_id, product_id, product_name, quantity, unit_price, sale_unit,
  sale_unit_qty, total, customer_name, customer_phone, payment_method,
  qr_invoice, sale_group_id, created_at
) ON sales TO authenticated;
