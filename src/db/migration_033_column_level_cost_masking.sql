-- migration_033: close the raw-API cost_price/profit bypass.
--
-- Found live in production RBAC testing: app-layer masking
-- (STAFF_SAFE_PRODUCT_COLUMNS/STAFF_SAFE_SALE_COLUMNS in supabaseApi.ts,
-- documented from the start as an app-layer-only control since "RLS is
-- row-scoped, not column-scoped") is trivially bypassed by any caller who
-- issues their own REST call with `select=*` instead of going through the
-- app's client code — e.g. a Staff account's own browser console. RLS
-- correctly restricts which ROWS a caller can see; it was never protecting
-- these two COLUMNS at all.
--
-- Postgres has no per-caller-role column masking built in (GRANT/REVOKE
-- operates on the underlying Postgres role — every app role maps to the
-- same `authenticated` Postgres role, so column privileges can't
-- distinguish an owner's session from a staff session). The standard fix:
-- revoke SELECT on the sensitive column entirely for `authenticated` (so
-- literally nobody can read it via a direct table query, regardless of
-- app role), and force ALL reads through a SECURITY DEFINER function that
-- runs as its owner (unaffected by the revoke on `authenticated`) and
-- applies the SAME role-based masking server-side instead of trusting the
-- client to ask for the right columns.

REVOKE SELECT (cost_price) ON products FROM authenticated;
REVOKE SELECT (profit) ON sales FROM authenticated;

-- Replaces the SELECT half of fetchProducts()/getDashboardSummary()'s
-- products query. INSERT/UPDATE/DELETE are untouched by the column revoke
-- above (it only blocks reading the column) and keep going straight to the
-- table as before, still governed by the existing RLS policies.
CREATE OR REPLACE FUNCTION get_products()
  RETURNS TABLE (
    id uuid, user_id uuid, name text, cost_price numeric, selling_price numeric,
    quantity integer, unit text, pack_unit text, units_per_pack integer,
    category text, low_stock_threshold integer, barcode text, qr_code text,
    created_at timestamptz, updated_at timestamptz
  )
  LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_business_id uuid := business_id_for(auth.uid());
  v_role text := role_for(auth.uid());
BEGIN
  IF v_business_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT
      p.id, p.user_id, p.name,
      CASE WHEN v_role = 'staff' THEN 0::numeric ELSE p.cost_price END,
      p.selling_price, p.quantity, p.unit, p.pack_unit, p.units_per_pack,
      p.category, p.low_stock_threshold, p.barcode, p.qr_code, p.created_at, p.updated_at
    FROM products p
    WHERE p.user_id = v_business_id
    ORDER BY p.created_at DESC;
END;
$$;

-- Replaces the SELECT half of fetchSales()/getDashboardSummary()'s sales
-- query. Preserves fetchSales()'s existing LIMIT 200.
CREATE OR REPLACE FUNCTION get_sales()
  RETURNS TABLE (
    id uuid, user_id uuid, product_id uuid, product_name text, quantity integer,
    unit_price numeric, sale_unit text, sale_unit_qty numeric, total numeric,
    profit numeric, customer_name text, customer_phone text, payment_method text,
    qr_invoice text, sale_group_id uuid, created_at timestamptz
  )
  LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_business_id uuid := business_id_for(auth.uid());
  v_role text := role_for(auth.uid());
BEGIN
  IF v_business_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT
      s.id, s.user_id, s.product_id, s.product_name, s.quantity, s.unit_price,
      s.sale_unit, s.sale_unit_qty, s.total,
      CASE WHEN v_role = 'staff' THEN 0::numeric ELSE s.profit END,
      s.customer_name, s.customer_phone, s.payment_method, s.qr_invoice,
      s.sale_group_id, s.created_at
    FROM sales s
    WHERE s.user_id = v_business_id
    ORDER BY s.created_at DESC
    LIMIT 200;
END;
$$;

-- Super admin console (adminApi.ts) reads sales.profit directly for a
-- target tenant during impersonation/audit — a separate, already-trusted
-- code path (gated by is_super_admin(), not the owner/manager/staff
-- matrix). The column revoke above applies to `authenticated` uniformly,
-- so this needs its own SECURITY DEFINER escape hatch rather than sharing
-- get_sales() (which scopes to the CALLER's own tenant, not an arbitrary
-- target tenant an admin is inspecting).
CREATE OR REPLACE FUNCTION admin_get_sales(target_user_id uuid)
  RETURNS SETOF sales
  LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT * FROM sales WHERE user_id = target_user_id;
END;
$$;
