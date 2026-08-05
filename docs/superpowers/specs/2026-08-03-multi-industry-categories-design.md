# Multi-Industry Product Categories — Design Spec

**Date:** 2026-08-03
**Status:** Approved (design), pending implementation plan

## 1. Summary

Today every product category picker (`BarcodeScanner.tsx`, `Inventory.tsx`) is
a hardcoded supermarket-flavored grid (Groceries, Dairy, Beverages, Cooking,
Grains, Canned, Noodles, Bakery), duplicated in two places and already out of
sync with each other. `products.category` itself is already a free `TEXT`
column with no enum/FK constraint — the rigidity is 100% in the frontend, not
the schema.

This feature lets any business owner — plumbing supplies, hair products,
electronics, pharmacy, etc. — get a category list relevant to their trade, and
freely customize it afterward. It does **not** change how sales, reports, or
bulk import consume `category` (still a plain string); it replaces the
hardcoded pickers with a per-tenant, owner-managed category list, seeded from
an industry template at signup.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Category source | Per-tenant custom list (`business_categories` table), seeded from an industry template at signup |
| v1 industry templates | Supermarket/Grocery, Hardware/Plumbing, Hair & Beauty, Fashion/Clothing, Electronics, Pharmacy, General/Other |
| Existing tenants | Backfilled to `industry='Supermarket'`, existing 8 categories become their (now-editable) `business_categories` rows — zero visible change on migration |
| `products.category` | Stays free `TEXT`, no FK — keeps offline-write path simple; `business_categories` is the UI's source of truth, not a DB-enforced constraint |
| Category icons | Curated ~24-icon Lucide picker per category; unmatched/legacy categories fall back to a generic box icon |
| Industry re-pick | Chosen once at signup; owner can re-run "Load starter categories" from Settings anytime (idempotent — skips existing names) |
| Rename | Renaming a category also bulk-updates `products.category` for every product using the old name, so history/reports stay consistent |
| Delete | Blocked if products still use the category — owner must bulk-reassign them to another category first |

## 3. Data model

```sql
-- migration_022_business_categories.sql
create table business_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  icon text not null default 'box',      -- lucide icon key
  sort_order int not null default 0,
  is_builtin boolean not null default false, -- true for 'Uncategorized', never deletable
  created_at timestamptz not null default now(),
  unique (user_id, lower(name))
);
-- RLS: identical auth.uid() = user_id pattern as every other tenant table

alter table business_profiles add column industry text;

-- Backfill: every existing business_profiles row -> industry='Supermarket'
-- + insert its 8 legacy categories into business_categories (is_builtin=false)
-- + insert one 'Uncategorized' row per tenant (is_builtin=true)
```

Industry templates themselves (`{industry, name, icon, sort_order}` for the 7
templates) are a **static app-side constant**, not a DB table — read-only
reference data with no per-tenant variation, so a DB round-trip isn't needed.

## 4. Onboarding & management UX

- **Signup**: new step after account creation — industry picker grid (7
  cards). Selection sets `business_profiles.industry` and bulk-inserts that
  template's categories.
- **Settings → "Manage Categories"**: list with name/icon/product-count per
  row; add/rename/change-icon/delete actions; "Load starter categories" button
  re-runs the template insert, skipping names that already exist
  case-insensitively.
- **Delete flow**: querying product count for the category; if >0, a modal
  forces reassignment to another category before delete proceeds.
- **Rename flow**: single transaction — update the `business_categories` row
  and `UPDATE products SET category = :new WHERE category = :old AND user_id
  = :uid`.

## 5. Impacted app code

| File | Change |
|---|---|
| `src/components/BarcodeScanner.tsx`, `src/pages/Inventory.tsx` | Drop local hardcoded `CATEGORY_OPTIONS`; both consume a shared `useCategories()` hook |
| `src/components/ProductIcon.tsx` | Icon lookup moves from hardcoded name→icon map to `business_categories.icon`; unmatched falls back to generic box |
| `src/lib/store.tsx` | New `categories` state + CRUD actions, loaded alongside products/sales; offline-cached via existing `services/offline.ts` pattern |
| `src/lib/bulkImport/rows.ts`, `src/lib/agent/writeTools.ts` | Default unknown/blank category changes from `'Groceries'` to `'Uncategorized'` |
| `src/pages/Settings.tsx` | New "Manage Categories" section |
| Signup flow (wherever account creation currently lands, e.g. `Login.tsx`/onboarding step) | New industry-picker step |
| `src/pages/Reports.tsx` | No logic change — already groups by whatever string is in `category`; benefits from corrected icons automatically |
| `src/db/` | New `migration_022_business_categories.sql` following existing numbered-migration convention |

Out of scope: `product_catalog` (crowd-sourced cross-tenant barcode catalog)
keeps its own free-text category untouched.

## 6. Testing

- New Vitest suite for `useCategories`: CRUD, rename-cascades-to-products,
  delete-blocked-when-in-use, delete-succeeds-when-unused — following the
  existing co-located `.test.ts` convention.
- Migration smoke test: confirm an existing tenant lands with exactly 8
  `Supermarket`-industry categories plus 1 `Uncategorized` row after running
  `migration_022`.
- Manual end-to-end: sign up as a new "Hardware/Plumbing" tenant, confirm
  starter categories appear, add/rename/delete a custom category, add a
  product against it, confirm Reports groups it correctly.
