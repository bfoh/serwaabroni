# Shared Product Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A platform-wide barcode/QR → product-identity catalog, auto-populated as tenants save products and read by every tenant as a new scanner lookup tier, sharing identity only (never price/stock/tenant).

**Architecture:** All cross-tenant logic is Postgres: two tables (`product_catalog` canonical + `product_catalog_reports` votes) and a `SECURITY DEFINER` RPC `contribute_catalog_entry` that tallies votes and promotes the majority name. The SPA reads the catalog directly (RLS allows authenticated reads) and contributes fire-and-forget on product save. No service-role key in the browser.

**Tech Stack:** Vite + React + TypeScript, Supabase (Postgres + RLS + RPC), existing `BarcodeScanner` lookup chain, `normalizeBarcode` from `src/lib/scanner.ts`. **No test runner exists** — verification is `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`, plus the manual SQL/browser checks per task.

**Spec:** `docs/superpowers/specs/2026-06-03-shared-product-catalog-design.md`

**Dependency:** `migration_005` must be applied first — it defines `is_tenant_active()`, used by the contribution RPC.

---

## File Structure

- Create: `src/db/migration_006_product_catalog.sql` — tables, RLS, opt-out column, `contribute_catalog_entry` RPC.
- Create: `src/services/catalogApi.ts` — `lookupCatalog()` read + `contributeCatalog()` fire-and-forget write.
- Modify: `src/lib/supabase.ts` — add `catalog_contribute?: boolean` to `BusinessProfile`.
- Modify: `src/lib/store.tsx` — contribute to catalog after a successful product insert.
- Modify: `src/components/BarcodeScanner.tsx` — insert the catalog lookup tier; add `'catalog'` source.
- Modify: `src/pages/Settings.tsx` — "Community Catalog" opt-out toggle.

---

## Task 1: Database migration

**Files:**
- Create: `src/db/migration_006_product_catalog.sql`

- [ ] **Step 1: Write the migration file**

Create `src/db/migration_006_product_catalog.sql` with exactly this content:

```sql
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
```

- [ ] **Step 2: Apply in Supabase**

Paste the whole file into the Supabase SQL editor and run it. Confirm no errors.

- [ ] **Step 3: Verify structure + vote logic (SQL editor)**

```sql
-- tables + column exist
SELECT to_regclass('public.product_catalog'), to_regclass('public.product_catalog_reports');
SELECT column_name FROM information_schema.columns
 WHERE table_name='business_profiles' AND column_name='catalog_contribute';

-- vote promotion: simulate 1x "Milo Tin", 2x "Milo 400g" for one code.
-- (run as a normal authenticated session; replace the code string freely)
SELECT contribute_catalog_entry('TESTCODE1','Milo Tin',NULL,'Beverages','tin');
SELECT contribute_catalog_entry('TESTCODE1','Milo 400g',NULL,'Beverages','tin');
SELECT contribute_catalog_entry('TESTCODE1','Milo 400g',NULL,'Beverages','tin');
SELECT name, report_count FROM product_catalog WHERE code='TESTCODE1';
-- expect: name='Milo 400g', report_count=3
DELETE FROM product_catalog WHERE code='TESTCODE1';
DELETE FROM product_catalog_reports WHERE code='TESTCODE1';
```

Expected: both `to_regclass` non-null, the column row present, canonical name `Milo 400g` with `report_count = 3`.

- [ ] **Step 4: Commit**

```bash
git add src/db/migration_006_product_catalog.sql
git commit -m "feat(db): shared product catalog tables + crowd-vote RPC"
```

---

## Task 2: Catalog API service

**Files:**
- Create: `src/services/catalogApi.ts`

- [ ] **Step 1: Write the service**

Create `src/services/catalogApi.ts`:

```ts
// ============================================
// CATALOG API — shared, platform-wide product identity.
// Read is a plain authenticated SELECT; write is a fire-and-forget RPC.
// Identity only — never price/stock/tenant.
// ============================================
import { supabase } from '@/lib/supabase'
import { normalizeBarcode } from '@/lib/scanner'

export interface CatalogEntry {
  name: string
  brand: string | null
  category: string | null
  unit: string | null
}

export async function lookupCatalog(code: string | null | undefined): Promise<CatalogEntry | null> {
  const norm = normalizeBarcode(code)
  if (!norm) return null
  const { data, error } = await supabase
    .from('product_catalog')
    .select('name, brand, category, unit')
    .eq('code', norm)
    .maybeSingle()
  if (error || !data) return null
  return data as CatalogEntry
}

// Fire-and-forget: a failure here must never disrupt saving a product.
export async function contributeCatalog(
  code: string | null | undefined,
  name: string,
  brand: string | null,
  category: string | null,
  unit: string | null,
): Promise<void> {
  const norm = normalizeBarcode(code)
  if (!norm || !name) return
  try {
    await supabase.rpc('contribute_catalog_entry', {
      p_code: norm, p_name: name, p_brand: brand, p_category: category, p_unit: unit,
    })
  } catch { /* ignore — best-effort contribution */ }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors. (Confirm `normalizeBarcode` is exported from `src/lib/scanner.ts` — it is, at line 32.)

- [ ] **Step 3: Commit**

```bash
git add src/services/catalogApi.ts
git commit -m "feat(catalog): catalogApi lookup + fire-and-forget contribute"
```

---

## Task 3: Contribute on product save

**Files:**
- Modify: `src/lib/supabase.ts`
- Modify: `src/lib/store.tsx`

- [ ] **Step 1: Add the opt-out field to the `BusinessProfile` type**

In `src/lib/supabase.ts`, in the `BusinessProfile` interface (just after the `suspended_reason?: string | null` line added by migration_005 work), add:

```ts
  catalog_contribute?: boolean
```

- [ ] **Step 2: Import the contribute helper in the store**

In `src/lib/store.tsx`, after the existing `import { amISuperAdmin } from '@/services/adminApi'` line, add:

```ts
import { contributeCatalog } from '@/services/catalogApi'
```

- [ ] **Step 3: Call it after a successful product insert**

In `src/lib/store.tsx`, find the `addProduct` callback:

```ts
  const addProduct = useCallback(async (product: Omit<Product, 'user_id'>) => {
    try {
      const inserted = await insertProduct(product)
      dispatch({ type: 'ADD_PRODUCT', product: inserted })
      showToast('Product added', 'success')
    } catch {
```

Replace the `try` body so it contributes when the product has a code and the shop has not opted
out:

```ts
  const addProduct = useCallback(async (product: Omit<Product, 'user_id'>) => {
    try {
      const inserted = await insertProduct(product)
      dispatch({ type: 'ADD_PRODUCT', product: inserted })
      const code = inserted.barcode || inserted.qr_code
      if (code && state.businessProfile?.catalog_contribute !== false) {
        void contributeCatalog(code, inserted.name, null, inserted.category, inserted.unit)
      }
      showToast('Product added', 'success')
    } catch {
```

(Leave the existing `catch` block unchanged. `brand` is not a `Product` field, so pass `null`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts src/lib/store.tsx
git commit -m "feat(catalog): contribute product identity on save (opt-out aware)"
```

---

## Task 4: Catalog lookup tier in the scanner

**Files:**
- Modify: `src/components/BarcodeScanner.tsx`

- [ ] **Step 1: Import the lookup**

At the top of `src/components/BarcodeScanner.tsx`, add to the imports:

```ts
import { lookupCatalog } from '@/services/catalogApi'
```

- [ ] **Step 2: Add `'catalog'` to the `source` union**

Find the line defining the source union (around line 32):

```ts
  source: 'qr' | 'barcode-local' | 'barcode-api' | 'manual'
```

Replace it with:

```ts
  source: 'qr' | 'barcode-local' | 'barcode-api' | 'catalog' | 'manual'
```

- [ ] **Step 3: Insert the catalog tier between local match and external API**

Find this boundary in the scan handler (the local-product block returns, then the API call):

```ts
      setShowItemSheet(true)
      return
    }

    // 3. Barcode — check online product databases (food + general retail)
    const apiData = await lookupProduct(code)
```

Insert the catalog tier so it reads:

```ts
      setShowItemSheet(true)
      return
    }

    // 2b. Shared community catalog (other tenants' crowd-sourced identity)
    const catalogData = await lookupCatalog(code)
    if (catalogData) {
      setCurrentItem({
        id: uid(),
        barcode: code,
        name: catalogData.name,
        cost_price: 0,
        selling_price: 0,
        quantity: 1,
        unit: catalogData.unit || 'piece',
        category: catalogData.category || 'Groceries',
        low_stock_threshold: 5,
        source: 'catalog',
      })
      setShowItemSheet(true)
      return
    }

    // 3. Barcode — check online product databases (food + general retail)
    const apiData = await lookupProduct(code)
```

- [ ] **Step 4: Handle the `'catalog'` source in any source-label UI**

Search the file for where `source` is rendered to the user (e.g. a label/badge switching on
`'barcode-api'`). If such a label exists, add a `catalog` case with text `From community catalog`.
Run this to find it:

Run: `grep -n "barcode-api\|source ===\|source==" src/components/BarcodeScanner.tsx`

For each place that maps `'barcode-api'` to display text, add an equivalent line for `'catalog'`
with the label `From community catalog`. If no such display mapping exists, skip this step (the
union member is still valid).

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/BarcodeScanner.tsx
git commit -m "feat(catalog): add shared-catalog tier to barcode scanner lookup"
```

---

## Task 5: Settings opt-out toggle

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Import the icon**

In `src/pages/Settings.tsx`, add `Share2` to the existing `lucide-react` import line (it already
imports `Shield`, `Trash2`, etc.):

```ts
import { X, ChevronRight, LogOut, Download, Trash2, User, Store, Globe, Bell, HelpCircle, Shield, Camera, Share2 } from 'lucide-react'
```

- [ ] **Step 2: Add the toggle menu item**

In the `menuItems` array (the one starting `const menuItems = [`), add this entry right after the
`Language` item:

```ts
    { icon: Share2, label: 'Community Catalog',
      badge: state.businessProfile?.catalog_contribute === false ? 'Off' : 'On',
      action: () => {
        if (!state.businessProfile) { showToast('Set up your shop profile first', 'error'); return }
        const enabled = state.businessProfile.catalog_contribute !== false
        updateBusinessProfile({ ...state.businessProfile, catalog_contribute: !enabled })
      } },
```

(`state`, `showToast`, and `updateBusinessProfile` are already destructured from `useStore()` at
the top of this component — confirm and reuse them; do not add duplicates.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(catalog): community-catalog opt-out toggle in Settings"
```

---

## Task 6: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Contribution + cross-tenant read (browser, two accounts)**

Run `npm run dev`.
- Shop A: add a product with a barcode (scan or type a barcode, give it a name/category/unit, save).
- Shop B (different login): open the scanner, scan the **same** barcode.
- Expect: the new-product sheet pre-fills A's name/category/unit, tagged `source: 'catalog'`, with
  B's `cost_price`/`selling_price` left at 0 for B to set.

- [ ] **Step 2: Privacy check (SQL)**

```sql
SELECT * FROM product_catalog LIMIT 5;
-- expect only: code, name, brand, category, unit, report_count, updated_at
-- (NO price, NO quantity, NO user_id/tenant)
```

- [ ] **Step 3: Opt-out (browser)**

- Shop A: Settings → toggle "Community Catalog" to **Off**.
- Shop A: add a NEW product with a fresh barcode.
- Verify in SQL that the fresh barcode did NOT create a `product_catalog` row:

```sql
SELECT count(*) FROM product_catalog WHERE code = '<fresh-normalized-barcode>';  -- expect 0
```

- Reading is unaffected: Shop A scanning a barcode another shop contributed still gets a catalog hit.

- [ ] **Step 4: Suspended tenant cannot contribute (SQL, optional)**

With a suspended tenant session (status='suspended' via admin console), calling
`contribute_catalog_entry(...)` is a silent no-op (RPC returns early). Confirm no new row appears.

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A && git commit -m "test(catalog): manual verification pass for shared product catalog"
```

---

## Notes for the implementer

- This repo has **no automated test framework**; do not scaffold one. Verification is typecheck +
  build + the manual SQL/browser steps above.
- `migration_005` MUST be applied before `migration_006` (the RPC calls `is_tenant_active`).
- Contribution is always fire-and-forget (`void`/try-swallow) — saving a product must succeed even
  if the catalog write fails or the user is offline.
- The scanner already normalizes codes via `normalizeBarcode`; `catalogApi` normalizes again so
  reads/writes use the identical key the local-product match uses.
