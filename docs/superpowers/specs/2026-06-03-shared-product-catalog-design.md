# Shared Product Catalog — Design

**Date:** 2026-06-03
**Status:** Approved (pending spec review)

## Problem

serwaabroni shops scan barcodes/QRs to add products. Today a scan resolves against:
the tenant's own products, then external APIs (OpenFoodFacts, UPCItemDB) in
`src/components/BarcodeScanner.tsx`. Those global databases miss local, unbranded, or
Ghana-specific goods — exactly the staples these shops sell. Each shop re-types the same
product names from scratch.

A **shared, platform-wide product catalog** lets one shop's naming of a barcode benefit every
other shop: scan an unknown code, get a suggested name/category that a peer already entered.

## Goal

A platform-wide catalog mapping `barcode/QR -> product identity` (name, brand, category, unit),
populated automatically as tenants save products, readable by all tenants, inserted into the
scanner lookup chain between "my products" and the external API. Identity only — no prices,
no stock, no tenant identity ever crosses tenant lines.

## Constraints

- Pure Vite SPA, no backend → all cross-tenant logic is Postgres (RLS + `SECURITY DEFINER`
  RPCs). No service-role key in the browser. (Same model as migration_005.)
- Must not leak competitive data: `cost_price`, `selling_price`, `quantity`, or which tenant
  sells what. The contribution RPC takes only identity params and physically cannot read price.
- Reuse existing patterns: `src/db/migration_00X.sql`, `supabaseApi`/`adminApi` service style,
  the existing `BarcodeScanner` lookup chain, `normalizeBarcode`.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Shared fields | Identity only: name, brand, category, unit. No price/stock/tenant. |
| Population | Automatic on product save (with a barcode/QR). |
| Conflict resolution | Confidence vote — most-reported `(code,name)` becomes canonical. |
| Vote dedup | **None in v1** — any save with a code = one vote. (Simple; revisit if spam appears.) |
| Images | **Skipped in v1.** |
| Opt-out | Settings toggle "Contribute to community catalog", default ON. Reading always available. |

## Architecture

```
Tenant saves a product with a barcode
        │  (fire-and-forget, never blocks the save)
        ▼
contribute_catalog_entry(code,name,brand,category,unit)   SECURITY DEFINER
   ├─ guard: is_tenant_active(auth.uid())
   ├─ +1 vote for (code,name) in product_catalog_reports
   └─ recompute canonical -> upsert product_catalog

Tenant scans a code in BarcodeScanner
   1. my products  (existing local match)
   2. get_catalog_entry(code)   <-- NEW shared tier
   3. external API (OpenFoodFacts -> UPCItemDB, existing)
   4. manual entry
   -> a hit pre-fills the editable new-product form (tenant still sets price)
```

## Data model — `src/db/migration_006_product_catalog.sql`

```sql
-- Canonical entry per code (the current vote winner)
CREATE TABLE IF NOT EXISTS product_catalog (
  code         text PRIMARY KEY,             -- normalized barcode or QR
  name         text NOT NULL,
  brand        text,
  category     text,
  unit         text,
  report_count int  NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Per-variant tally (the votes behind the winner)
CREATE TABLE IF NOT EXISTS product_catalog_reports (
  code     text NOT NULL,
  name     text NOT NULL,
  brand    text,
  category text,
  unit     text,
  votes    int NOT NULL DEFAULT 0,
  PRIMARY KEY (code, name)
);

ALTER TABLE product_catalog          ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_catalog_reports  ENABLE ROW LEVEL SECURITY;

-- Catalog is readable by any authenticated tenant; writes only via the RPC.
CREATE POLICY "Authenticated can read catalog"
  ON product_catalog FOR SELECT USING (auth.role() = 'authenticated');
-- No client policies on product_catalog_reports => invisible to clients.

-- Opt-out flag on the per-shop record.
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS catalog_contribute boolean NOT NULL DEFAULT true;
```

### Write RPC
```sql
CREATE OR REPLACE FUNCTION contribute_catalog_entry(
  p_code text, p_name text, p_brand text, p_category text, p_unit text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE win record;
BEGIN
  IF NOT is_tenant_active(auth.uid()) THEN RETURN; END IF;     -- suspended => no-op
  IF p_code IS NULL OR length(trim(p_code)) = 0
     OR p_name IS NULL OR length(trim(p_name)) = 0 THEN RETURN; END IF;

  INSERT INTO product_catalog_reports (code, name, brand, category, unit, votes)
    VALUES (p_code, p_name, p_brand, p_category, p_unit, 1)
  ON CONFLICT (code, name) DO UPDATE
    SET votes = product_catalog_reports.votes + 1,
        brand = COALESCE(excluded.brand, product_catalog_reports.brand),
        category = COALESCE(excluded.category, product_catalog_reports.category),
        unit = COALESCE(excluded.unit, product_catalog_reports.unit);

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
```

Note: `is_tenant_active` is defined in migration_005, so migration_006 depends on migration_005.

### Read
Catalog is plain readable, so the client reads it directly (no RPC needed):
`supabase.from('product_catalog').select('name,brand,category,unit').eq('code', code).maybeSingle()`.

## Frontend

### `src/services/catalogApi.ts` (new)
- `lookupCatalog(code: string): Promise<CatalogEntry | null>` — direct `product_catalog` read by
  normalized code. Returns `{ name, brand, category, unit }` or null.
- `contributeCatalog(code, name, brand, category, unit): Promise<void>` — `supabase.rpc(
  'contribute_catalog_entry', …)`; swallow errors (fire-and-forget, never disrupts UX).

### `src/lib/store.tsx` — contribute on save
In `addProduct` (and the batch path if products are added with codes there), after a successful
DB insert, if the product has `barcode` or `qr_code` and `state.businessProfile?.catalog_contribute
!== false`, call `contributeCatalog(normalizeBarcode(code), name, brand?, category, unit)`
without awaiting (or `void`-ed) so it never blocks or fails the save. `brand` is not a
`Product` field today → pass `null`/omit; brand stays optional in the catalog.

### `src/components/BarcodeScanner.tsx` — new lookup tier
Insert the catalog lookup between the local-product match and the external API call
(around the existing `lookupProduct` step). Add `'catalog'` to the `source` union. On a catalog
hit, pre-fill the same fields the API path fills (name, category, unit), leaving price empty for
the tenant to set, and tag `source: 'catalog'`.

### `src/pages/Settings.tsx` — opt-out toggle
Add a "Contribute to community catalog" item bound to `business_profiles.catalog_contribute`,
default ON, persisted via the existing `updateBusinessProfile` path. Reading the catalog is not
affected by this toggle.

## Privacy model

- The contribution RPC accepts only identity parameters; it has no access to and never reads
  price or stock. Tenant identity is never stored in the catalog.
- `product_catalog_reports` has RLS on with no client policies → vote internals are not
  client-visible. `product_catalog` exposes only identity columns.
- Opt-out stops contribution entirely for a shop that wants it.

## Testing strategy

No automated test runner in this repo. Verify via `npx tsc --noEmit -p tsconfig.app.json`,
`npm run build`, plus manual SQL/browser checks:

- **SQL:** call `contribute_catalog_entry` with two different names for one code across several
  calls; assert the majority name becomes the `product_catalog` canonical and `report_count`
  equals total votes. Suspended tenant → RPC is a no-op (no row written). A client `INSERT` into
  `product_catalog`/`product_catalog_reports` is rejected by RLS.
- **Browser:** Shop A saves a product with a barcode → Shop B scanning the same barcode sees the
  name/category pre-filled with `source: 'catalog'`, and B's price field is empty. Toggling the
  Settings opt-out off stops A from contributing new scans (catalog reads still work).

## Out of scope (YAGNI)

- Images. Per-tenant vote dedup / anti-spam ledger. Admin moderation UI for the catalog
  (the super-admin console can be extended later). Sharing or suggesting prices.

## Migrations / manual steps

1. Apply `src/db/migration_005_super_admin.sql` first (provides `is_tenant_active`).
2. Apply `src/db/migration_006_product_catalog.sql`.
