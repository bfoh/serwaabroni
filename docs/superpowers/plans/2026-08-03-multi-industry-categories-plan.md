# Multi-Industry Product Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two independently-hardcoded 8-category supermarket pickers (`BarcodeScanner.tsx`, `Inventory.tsx`) with a per-tenant, owner-managed `business_categories` list, seeded from one of 7 industry templates at signup, editable anytime from Settings — with zero visible change for existing (Supermarket) tenants.

**Architecture:** New `business_categories` table (RLS, per-tenant) + `business_profiles.industry` column. Static industry templates live as an app-side constant (`src/lib/categories.ts`), not a DB table. Pure business rules (delete-block, rename-cascade, seed-idempotency) live in framework-free `.ts` modules so they're Vitest-testable without mocking Supabase or React. `store.tsx` gets a `categories` state slice following the exact same load/CRUD/offline-fallback pattern as the existing `customers` slice. UI components (`BarcodeScanner.tsx`, `Inventory.tsx`, `Settings.tsx`, new `IndustryPicker.tsx`) consume `state.categories` instead of hardcoded arrays.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres + Auth + RLS), Tailwind/shadcn, Vitest (node environment, no jsdom/@testing-library — see Global Constraints), lucide-react `^0.562.0`.

## Global Constraints

- **Path alias:** `@/` → `src/` (see `vitest.config.ts` / `tsconfig.json`). Use it in all new imports, matching existing files.
- **Test runner:** `npx vitest run <path>` for a single file, `npm run test` for the whole suite. Vitest's `include` is `src/**/*.test.ts` (note: **not** `.tsx`) — this repo has **zero** component/hook tests today (confirmed: no `@testing-library/react`, no `jsdom`/`happy-dom` dependency, `environment: 'node'` in `vitest.config.ts`). Every existing `*.test.ts` file only tests plain exported functions (e.g. `src/lib/fifo.test.ts`, `src/services/adminApi.test.ts`). This plan follows that convention exactly: all genuinely new business logic is extracted into pure, dependency-free `.ts` modules and TDD'd; React components and the `store.tsx`/`*Api.ts` wiring that calls them are **not** unit tested (matching how `addCustomer`, `insertCustomer`, etc. aren't tested today) and are instead verified via `npm run build` (typecheck) plus a manual QA checklist. Do not invent a testing-library setup — that's a separate infra change outside this feature's scope.
- **DB migrations:** Plain numbered `.sql` files in `src/db/`, run manually via the Supabase SQL Editor — there is no local migration runner (`supabase/` only has `functions/` + `config.toml`, no `migrations/`). Every new migration must be idempotent (safe to re-run) — follow `src/db/migration_019_cash_movements.sql`'s `WHERE NOT EXISTS (...)` backfill style.
- **RLS convention:** every tenant table: `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `ALTER TABLE x ENABLE ROW LEVEL SECURITY`, one policy per operation named `"Users can {view,insert,update,delete} own X"`, all `USING/WITH CHECK (auth.uid() = user_id)`, added to `supabase_realtime` publication.
- **`products.category` stays a free `TEXT`** column, no FK/enum, per spec decision — this plan never adds a constraint to it. Category-name matching against products (delete-block, rename-cascade) is exact-string, case-sensitive, mirroring the existing `UPDATE products SET category = :new WHERE category = :old` semantics. The one exception is "Load starter categories" re-seeding, which is explicitly case-insensitive per spec.
- **Icon keys** stored in `business_categories.icon` are plain string keys (e.g. `'wrench'`) defined once in `CURATED_ICONS` (`src/lib/categories.ts`) and mapped to Lucide components once in `CATEGORY_ICON_MAP` (`src/lib/categoryIconMap.ts`). These two lists must stay in sync — `categoryIconMap.test.ts` enforces it. lucide-react icon names used here (`Box`, `Milk`, `CupSoda`, `Wheat`, `Package`, `Soup`, `Croissant`, `Utensils`, `Wrench`, `Hammer`, `Droplet`, `Scissors`, `Sparkles`, `Shirt`, `Footprints`, `Watch`, `Cpu`, `Smartphone`, `Laptop`, `Plug`, `Battery`, `Pill`, `Syringe`, `Stethoscope`) are long-standing, stable exports, but `node_modules` wasn't installed in this planning environment so they could not be mechanically verified against `^0.562.0` — Task 4's build step (`npm run build`) is the first real check; if any single name has been renamed upstream, swap in the closest equivalent Lucide icon and update both `CURATED_ICONS` and `CATEGORY_ICON_MAP` together.
- **Explicitly out of scope** (do not touch, per the approved spec): `product_catalog` (crowd-sourced cross-tenant barcode catalog) keeps its own free-text category; `src/pages/Reports.tsx` needs no change (already groups by whatever string is in `category`); `src/lib/i18n.ts` — category names are not translated today (rendered as raw strings, never passed through `t()`) and this feature doesn't change that; `src/lib/bulkImport/rows.ts`'s exported `CATEGORIES` constant (used only by `BulkReviewTable.tsx`'s own category `<select>`) stays hardcoded to the legacy 8 names — only its *default fallback value* changes in Task 8. Wiring `BulkReviewTable.tsx` to the shared category list is a reasonable follow-up but is not in the approved spec's file list, so it's left alone here.
- **Commit convention:** Conventional commits, lowercase type/scope, imperative summary (e.g. `feat(categories): ...`, `fix(inventory): ...`) — matches `git log` history in this repo.

---

### Task 1: Database migration — `business_categories` table + `industry` column

**Files:**
- Create: `src/db/migration_022_business_categories.sql`
- Test: none (Vitest can't exercise Postgres RLS) — verified via a manual Supabase SQL Editor checklist (Step 3 below)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: DB table `business_categories(id, user_id, name, icon, sort_order, is_builtin, created_at)`; `business_profiles.industry` column; Postgres function `rename_category(p_id uuid, p_new_name text) RETURNS business_categories` — consumed by Task 3's `renameCategoryDb()`.

- [ ] **Step 1: Write the migration file**

Create `src/db/migration_022_business_categories.sql`:

```sql
-- migration_022: multi-industry product categories.
-- Run AFTER migration_021. See docs/superpowers/specs/2026-08-03-multi-industry-categories-design.md

CREATE TABLE IF NOT EXISTS business_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'box',
  sort_order int NOT NULL DEFAULT 0,
  is_builtin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lower(name))
);

ALTER TABLE business_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own business_categories"   ON business_categories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own business_categories" ON business_categories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own business_categories" ON business_categories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own business_categories" ON business_categories FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_business_categories_user ON business_categories(user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE business_categories;

ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS industry text;

-- ────────────────────────────────────────────────────────────────────────
-- Backfill (idempotent — safe to re-run)
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

-- 3. Give every tenant with a business_profiles row the legacy 8 Supermarket
--    categories (now editable), skipping any name they already have
--    (case-insensitive) so this is safe to re-run.
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
WHERE NOT EXISTS (
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
```

- [ ] **Step 2: Run the migration**

Paste the full file contents into the Supabase SQL Editor for the project (`qumttowvyujqaubyshjq`, per `supabase/config.toml`) and run it. Expected: `Success. No rows returned` (the `CREATE TABLE`/`ALTER`/`INSERT ... SELECT` statements return no rows; the backfill `INSERT`s report row counts in the editor's result panel — non-zero counts are expected for step 3/4 if any tenants exist, zero is fine on a brand-new project).

- [ ] **Step 3: Manual smoke-test checklist (run in the SQL Editor)**

```sql
-- a) Every business_profiles row now has an industry.
SELECT count(*) FROM business_profiles WHERE industry IS NULL;
-- expected: 0

-- b) Pick one existing tenant (replace with a real user_id from your project)
--    and confirm exactly 8 Supermarket categories + 1 Uncategorized row.
SELECT name, icon, sort_order, is_builtin
FROM business_categories
WHERE user_id = '00000000-0000-0000-0000-000000000000'  -- replace
ORDER BY sort_order;
-- expected: Groceries, Dairy, Beverages, Cooking, Grains, Canned, Noodles,
--           Bakery (sort_order 0-7, is_builtin=false), then Uncategorized
--           (sort_order 99, is_builtin=true) — 9 rows total.

-- c) Re-run the whole migration file again — must not error, and must not
--    create duplicate rows.
SELECT user_id, lower(name), count(*)
FROM business_categories
GROUP BY user_id, lower(name)
HAVING count(*) > 1;
-- expected: 0 rows

-- d) rename_category works and cascades (run this AS the tenant, e.g. via
--    the Supabase dashboard's "Run as user" or a short-lived client session
--    authenticated as that user — SQL Editor itself runs as postgres/service
--    role, so auth.uid() there is NULL and the function will correctly raise
--    'category not found'; that NULL-auth.uid() rejection is itself a useful
--    confirmation the RLS-style guard is active).
```

- [ ] **Step 4: Commit**

```bash
git add src/db/migration_022_business_categories.sql
git commit -m "$(cat <<'EOF'
feat(categories): add business_categories table + industry column (migration_022)

Adds the per-tenant category table and business_profiles.industry column,
backfills every existing tenant to industry='Supermarket' with their legacy
8 categories plus a builtin Uncategorized row (zero visible change), and
adds the rename_category RPC for atomic rename-cascade onto products.
EOF
)"
```

---

### Task 2: Shared category constant + industry templates (`src/lib/categories.ts`)

**Files:**
- Create: `src/lib/categories.ts`
- Test: `src/lib/categories.test.ts`

**Interfaces:**
- Consumes: nothing new (pure data module)
- Produces: `INDUSTRIES: readonly Industry[]`, `type Industry`, `interface CategoryTemplateEntry { name: string; icon: string; sortOrder: number }`, `INDUSTRY_TEMPLATES: Record<Industry, CategoryTemplateEntry[]>`, `UNCATEGORIZED: CategoryTemplateEntry`, `CURATED_ICONS: string[]`, `templateForIndustry(industry: string): CategoryTemplateEntry[]`, `mergeSeedNames(existingNames: string[], template: CategoryTemplateEntry[]): CategoryTemplateEntry[]` — consumed by Task 3 (`templateForIndustry`, `mergeSeedNames`, `UNCATEGORIZED`), Task 4 (`CURATED_ICONS`), Task 5 (`templateForIndustry`), Task 6 (`CURATED_ICONS`), Task 7 (`INDUSTRIES`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/categories.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { INDUSTRIES, INDUSTRY_TEMPLATES, CURATED_ICONS, templateForIndustry, mergeSeedNames } from './categories'

describe('INDUSTRIES', () => {
  it('lists exactly the 7 approved industries in order', () => {
    expect(INDUSTRIES).toEqual([
      'Supermarket', 'Hardware/Plumbing', 'Hair & Beauty', 'Fashion/Clothing',
      'Electronics', 'Pharmacy', 'General/Other',
    ])
  })
})

describe('templateForIndustry', () => {
  it('returns the Supermarket template unchanged (legacy 8 categories)', () => {
    expect(templateForIndustry('Supermarket').map((c) => c.name)).toEqual([
      'Groceries', 'Dairy', 'Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles', 'Bakery',
    ])
  })

  it('falls back to General/Other for an unrecognized industry', () => {
    expect(templateForIndustry('Not A Real Industry')).toEqual(INDUSTRY_TEMPLATES['General/Other'])
  })
})

describe('mergeSeedNames', () => {
  it('keeps only template entries not already present, case-insensitively', () => {
    const existing = ['groceries', 'Bakery']
    const result = mergeSeedNames(existing, INDUSTRY_TEMPLATES['Supermarket'])
    expect(result.map((c) => c.name)).toEqual(['Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles'])
  })

  it('returns the full template when nothing exists yet', () => {
    expect(mergeSeedNames([], INDUSTRY_TEMPLATES['Pharmacy'])).toEqual(INDUSTRY_TEMPLATES['Pharmacy'])
  })
})

describe('CURATED_ICONS', () => {
  it('has exactly 24 unique icon keys', () => {
    expect(CURATED_ICONS.length).toBe(24)
    expect(new Set(CURATED_ICONS).size).toBe(24)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/categories.test.ts
```
Expected: fails with `Cannot find module './categories'` (or similar resolution error) — the module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/categories.ts`:

```ts
// Static, read-only reference data for the multi-industry category picker.
// See docs/superpowers/specs/2026-08-03-multi-industry-categories-design.md

export const INDUSTRIES = [
  'Supermarket',
  'Hardware/Plumbing',
  'Hair & Beauty',
  'Fashion/Clothing',
  'Electronics',
  'Pharmacy',
  'General/Other',
] as const

export type Industry = typeof INDUSTRIES[number]

export interface CategoryTemplateEntry {
  name: string
  icon: string
  sortOrder: number
}

// Curated set of Lucide icon keys offered in the category icon picker
// (Settings) and used to seed industry templates. Keep in sync with
// CATEGORY_ICON_MAP in src/lib/categoryIconMap.ts — every key here must have
// a matching entry there (enforced by categoryIconMap.test.ts).
export const CURATED_ICONS: string[] = [
  'box', 'milk', 'cup-soda', 'wheat', 'package', 'soup', 'croissant', 'utensils',
  'wrench', 'hammer', 'droplet', 'scissors', 'sparkles', 'shirt', 'footprints',
  'watch', 'cpu', 'smartphone', 'laptop', 'plug', 'battery', 'pill', 'syringe',
  'stethoscope',
]

// Builtin category every tenant gets, never deletable. Not part of any
// industry's editable template — inserted separately at seed time.
export const UNCATEGORIZED: CategoryTemplateEntry = { name: 'Uncategorized', icon: 'box', sortOrder: 99 }

export const INDUSTRY_TEMPLATES: Record<Industry, CategoryTemplateEntry[]> = {
  'Supermarket': [
    { name: 'Groceries', icon: 'box', sortOrder: 0 },
    { name: 'Dairy', icon: 'milk', sortOrder: 1 },
    { name: 'Beverages', icon: 'cup-soda', sortOrder: 2 },
    { name: 'Cooking', icon: 'utensils', sortOrder: 3 },
    { name: 'Grains', icon: 'wheat', sortOrder: 4 },
    { name: 'Canned', icon: 'package', sortOrder: 5 },
    { name: 'Noodles', icon: 'soup', sortOrder: 6 },
    { name: 'Bakery', icon: 'croissant', sortOrder: 7 },
  ],
  'Hardware/Plumbing': [
    { name: 'Pipes & Fittings', icon: 'wrench', sortOrder: 0 },
    { name: 'Tools', icon: 'hammer', sortOrder: 1 },
    { name: 'Paints & Sealants', icon: 'droplet', sortOrder: 2 },
    { name: 'Electrical', icon: 'plug', sortOrder: 3 },
    { name: 'Fasteners & Hardware', icon: 'box', sortOrder: 4 },
    { name: 'Safety Gear', icon: 'shirt', sortOrder: 5 },
  ],
  'Hair & Beauty': [
    { name: 'Hair Care', icon: 'scissors', sortOrder: 0 },
    { name: 'Extensions & Wigs', icon: 'shirt', sortOrder: 1 },
    { name: 'Skin Care', icon: 'droplet', sortOrder: 2 },
    { name: 'Makeup', icon: 'sparkles', sortOrder: 3 },
    { name: 'Fragrances', icon: 'sparkles', sortOrder: 4 },
    { name: 'Tools & Equipment', icon: 'plug', sortOrder: 5 },
  ],
  'Fashion/Clothing': [
    { name: 'Clothing', icon: 'shirt', sortOrder: 0 },
    { name: 'Footwear', icon: 'footprints', sortOrder: 1 },
    { name: 'Accessories', icon: 'watch', sortOrder: 2 },
    { name: 'Bags', icon: 'package', sortOrder: 3 },
    { name: 'Jewelry', icon: 'sparkles', sortOrder: 4 },
    { name: 'Fabrics', icon: 'box', sortOrder: 5 },
  ],
  'Electronics': [
    { name: 'Phones', icon: 'smartphone', sortOrder: 0 },
    { name: 'Computers', icon: 'laptop', sortOrder: 1 },
    { name: 'Accessories', icon: 'plug', sortOrder: 2 },
    { name: 'Components', icon: 'cpu', sortOrder: 3 },
    { name: 'Audio', icon: 'battery', sortOrder: 4 },
    { name: 'Home Appliances', icon: 'box', sortOrder: 5 },
  ],
  'Pharmacy': [
    { name: 'Medicines', icon: 'pill', sortOrder: 0 },
    { name: 'Supplements', icon: 'pill', sortOrder: 1 },
    { name: 'First Aid', icon: 'stethoscope', sortOrder: 2 },
    { name: 'Injections', icon: 'syringe', sortOrder: 3 },
    { name: 'Baby Care', icon: 'milk', sortOrder: 4 },
    { name: 'Personal Care', icon: 'droplet', sortOrder: 5 },
  ],
  'General/Other': [
    { name: 'General', icon: 'box', sortOrder: 0 },
    { name: 'Services', icon: 'wrench', sortOrder: 1 },
    { name: 'Supplies', icon: 'package', sortOrder: 2 },
    { name: 'Miscellaneous', icon: 'sparkles', sortOrder: 3 },
  ],
}

// Returns the editable starter category list for an industry. Unrecognized
// input (stale data, future template removal) falls back to General/Other
// rather than throwing.
export function templateForIndustry(industry: string): CategoryTemplateEntry[] {
  return INDUSTRY_TEMPLATES[industry as Industry] ?? INDUSTRY_TEMPLATES['General/Other']
}

// "Load starter categories" idempotency: keep only template entries whose
// name isn't already present (case-insensitive) among the tenant's existing
// categories.
export function mergeSeedNames(
  existingNames: string[],
  template: CategoryTemplateEntry[],
): CategoryTemplateEntry[] {
  const existingLower = new Set(existingNames.map((n) => n.toLowerCase()))
  return template.filter((t) => !existingLower.has(t.name.toLowerCase()))
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/categories.test.ts
```
Expected: `Test Files 1 passed`, `Tests 6 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/categories.ts src/lib/categories.test.ts
git commit -m "$(cat <<'EOF'
feat(categories): add industry templates + curated icon list

Static, framework-free reference data for the 7 v1 industry templates and
the 24-icon category picker, plus the case-insensitive "load starter
categories" merge helper. No DB/UI wiring yet.
EOF
)"
```

---

### Task 3: Category business logic + service layer + store slice

**Files:**
- Create: `src/lib/categoriesLogic.ts`
- Create: `src/lib/categoriesLogic.test.ts`
- Create: `src/services/categoriesApi.ts`
- Modify: `src/lib/supabase.ts` (add `BusinessCategory` interface)
- Modify: `src/lib/data.ts` (extend `StoredData` with `categories`)
- Modify: `src/lib/store.tsx` (add `categories` state slice + CRUD actions)

**Interfaces:**
- Consumes: Task 1's `rename_category` RPC; Task 2's `templateForIndustry`, `mergeSeedNames`, `UNCATEGORIZED`.
- Produces: `interface BusinessCategory { id: string; user_id: string; name: string; icon: string; sort_order: number; is_builtin: boolean; created_at: string }`; `canDeleteCategory(categoryName: string, products: {category:string}[]): {allowed: boolean; count: number}`; `applyCategoryRename<T extends {category:string}>(products: T[], oldName: string, newName: string): T[]`; `categoriesApi.ts` exports `fetchCategories()`, `insertCategory(input:{name,icon,sortOrder})`, `renameCategoryDb(id,newName)`, `deleteCategoryDb(id)`, `updateProductsCategoryBulk(fromName,toName)`, `seedCategoriesForIndustry(industry)`; `store.tsx`: `state.categories: BusinessCategory[]`, `addCategory(name,icon)`, `renameCategory(id,newName)`, `removeCategory(id): Promise<{blocked,count,reason?}>`, `loadStarterCategories(industry)` — consumed by Task 4 (nothing directly), Task 5 (`state.categories`), Task 6 (all of the above), Task 7 (`SET_CATEGORIES` action, `seedCategoriesForIndustry`).

- [ ] **Step 1: Write the failing test for the pure business rules**

Create `src/lib/categoriesLogic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { canDeleteCategory, applyCategoryRename } from './categoriesLogic'

describe('canDeleteCategory', () => {
  it('allows deleting a category no product uses', () => {
    const products = [{ category: 'Dairy' }, { category: 'Bakery' }]
    expect(canDeleteCategory('Grains', products)).toEqual({ allowed: true, count: 0 })
  })

  it('blocks deleting a category products still use, reporting the count', () => {
    const products = [{ category: 'Dairy' }, { category: 'Dairy' }, { category: 'Bakery' }]
    expect(canDeleteCategory('Dairy', products)).toEqual({ allowed: false, count: 2 })
  })
})

describe('applyCategoryRename', () => {
  it('renames matching products only, leaving others untouched', () => {
    const products = [{ id: '1', category: 'Dairy' }, { id: '2', category: 'Bakery' }]
    expect(applyCategoryRename(products, 'Dairy', 'Milk & Cheese')).toEqual([
      { id: '1', category: 'Milk & Cheese' },
      { id: '2', category: 'Bakery' },
    ])
  })

  it('is a no-op when no product uses the old name', () => {
    const products = [{ id: '1', category: 'Bakery' }]
    expect(applyCategoryRename(products, 'Dairy', 'Milk')).toEqual(products)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/categoriesLogic.test.ts
```
Expected: fails with `Cannot find module './categoriesLogic'`.

- [ ] **Step 3: Write minimal implementation of the pure logic**

Create `src/lib/categoriesLogic.ts`:

```ts
// Pure business rules for category CRUD — no I/O, fully unit-tested without
// a Supabase mock. See docs/superpowers/specs/2026-08-03-multi-industry-categories-design.md

export interface DeleteCheck {
  allowed: boolean
  count: number
}

// A category can only be deleted once no product references it by name.
export function canDeleteCategory(categoryName: string, products: { category: string }[]): DeleteCheck {
  const count = products.filter((p) => p.category === categoryName).length
  return { allowed: count === 0, count }
}

// Renaming a category cascades to every product using the old name, so
// history/reports keep showing a consistent category label.
export function applyCategoryRename<T extends { category: string }>(
  products: T[],
  oldName: string,
  newName: string,
): T[] {
  if (oldName === newName) return products
  let changed = false
  const next = products.map((p) => {
    if (p.category !== oldName) return p
    changed = true
    return { ...p, category: newName }
  })
  return changed ? next : products
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/categoriesLogic.test.ts
```
Expected: `Test Files 1 passed`, `Tests 4 passed`.

- [ ] **Step 5: Add the `BusinessCategory` type**

Modify `src/lib/supabase.ts` — insert a new interface right after the existing `Customer` interface (before `StockBatch`):

```ts
export interface BusinessCategory {
  id: string
  user_id: string
  name: string
  icon: string
  sort_order: number
  is_builtin: boolean
  created_at: string
}
```

- [ ] **Step 6: Extend local-storage cache to carry categories**

Modify `src/lib/data.ts`:

Before (line 1):
```ts
import type { Product, Sale, Debt, Expense } from './supabase'
```
After:
```ts
import type { Product, Sale, Debt, Expense, BusinessCategory } from './supabase'
```

Before (lines 34-42):
```ts
interface StoredData {
  products: Product[]
  sales: Sale[]
  debts: Debt[]
  expenses: Expense[]
  customers: any[]
  businessName: string
  ownerName: string
}
```
After:
```ts
interface StoredData {
  products: Product[]
  sales: Sale[]
  debts: Debt[]
  expenses: Expense[]
  customers: any[]
  categories: BusinessCategory[]
  businessName: string
  ownerName: string
}
```

Before (lines 64-73, the seed object):
```ts
  const data: StoredData & { version: string } = {
    products: seedProducts,
    sales: seedSales,
    debts: seedDebts,
    expenses: seedExpenses,
    customers: [],
    businessName: "Maame Doku's Shop",
    ownerName: 'Maame Doku',
    version: DATA_VERSION,
  }
```
After:
```ts
  const data: StoredData & { version: string } = {
    products: seedProducts,
    sales: seedSales,
    debts: seedDebts,
    expenses: seedExpenses,
    customers: [],
    categories: [],
    businessName: "Maame Doku's Shop",
    ownerName: 'Maame Doku',
    version: DATA_VERSION,
  }
```

(No `DATA_VERSION` bump — old cached JSON simply won't have a `categories` key; every read site below defaults it with `|| []`, matching how `customers` was introduced.)

- [ ] **Step 7: Create the categories service layer**

Create `src/services/categoriesApi.ts` (not unit tested — matches every other thin Supabase wrapper in this codebase, e.g. `services/cashApi.ts`, `services/supabaseApi.ts`, neither of which has a `*.test.ts`):

```ts
import { supabase } from '@/lib/supabase'
import type { BusinessCategory } from '@/lib/supabase'
import { templateForIndustry, mergeSeedNames, UNCATEGORIZED } from '@/lib/categories'

async function uidOrThrow(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const uid = data.user?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

export async function fetchCategories(): Promise<BusinessCategory[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('business_categories')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data as BusinessCategory[]) || []
}

export async function insertCategory(input: { name: string; icon: string; sortOrder: number }): Promise<BusinessCategory> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('business_categories')
    .insert({ user_id: uid, name: input.name, icon: input.icon, sort_order: input.sortOrder, is_builtin: false })
    .select()
    .single()

  if (error) throw error
  return data as BusinessCategory
}

// Renames the category AND cascades the new name onto every product using
// the old one, atomically (see rename_category in migration_022).
export async function renameCategoryDb(id: string, newName: string): Promise<BusinessCategory> {
  const { data, error } = await supabase.rpc('rename_category', { p_id: id, p_new_name: newName })
  if (error) throw error
  return data as BusinessCategory
}

export async function deleteCategoryDb(id: string): Promise<void> {
  const uid = await uidOrThrow()
  const { error } = await supabase.from('business_categories').delete().eq('id', id).eq('user_id', uid)
  if (error) throw error
}

// Bulk-moves every product from one category name to another. Used by the
// Settings delete-with-reassign flow (Task 6) before the now-unused category
// is removed.
export async function updateProductsCategoryBulk(fromName: string, toName: string): Promise<void> {
  const uid = await uidOrThrow()
  const { error } = await supabase.from('products').update({ category: toName }).eq('category', fromName).eq('user_id', uid)
  if (error) throw error
}

// "Load starter categories": idempotently inserts any template entries (plus
// the builtin Uncategorized row) the tenant doesn't already have, by name,
// case-insensitively.
export async function seedCategoriesForIndustry(industry: string): Promise<BusinessCategory[]> {
  const uid = await uidOrThrow()
  const existing = await fetchCategories()
  const template = [...templateForIndustry(industry), UNCATEGORIZED]
  const toInsert = mergeSeedNames(existing.map((c) => c.name), template)
  if (toInsert.length === 0) return existing

  const rows = toInsert.map((t, i) => ({
    user_id: uid,
    name: t.name,
    icon: t.icon,
    sort_order: existing.length + i,
    is_builtin: t.name === UNCATEGORIZED.name,
  }))
  const { data, error } = await supabase.from('business_categories').insert(rows).select()
  if (error) throw error
  return [...existing, ...((data as BusinessCategory[]) || [])]
}
```

- [ ] **Step 8: Wire the `categories` slice into `store.tsx`**

Modify `src/lib/store.tsx` with the following edits, in order:

**8a. Imports** — before (line 3):
```ts
import type { Product, Sale, Debt, Expense, BusinessProfile, Customer } from './supabase'
```
after:
```ts
import type { Product, Sale, Debt, Expense, BusinessProfile, Customer, BusinessCategory } from './supabase'
```

Add, right after the existing `import { amISuperAdmin, ... } from '@/services/adminApi'` block (after line 25):
```ts
import {
  fetchCategories, insertCategory, renameCategoryDb, deleteCategoryDb,
  seedCategoriesForIndustry, updateProductsCategoryBulk,
} from '@/services/categoriesApi'
import { canDeleteCategory, applyCategoryRename } from '@/lib/categoriesLogic'
```

**8b. `AppState`** — before (line 51):
```ts
  customers: Customer[]
```
after:
```ts
  customers: Customer[]
  categories: BusinessCategory[]
```

**8c. `Action` union** — add after `{ type: 'UPDATE_CUSTOMER'; customer: Customer }` (line 93):
```ts
  | { type: 'SET_CATEGORIES'; categories: BusinessCategory[] }
  | { type: 'ADD_CATEGORY'; category: BusinessCategory }
  | { type: 'UPDATE_CATEGORY'; category: BusinessCategory }
  | { type: 'DELETE_CATEGORY'; id: string }
```
And update `LOAD_ALL_DATA` (line 110) — before:
```ts
  | { type: 'LOAD_ALL_DATA'; products: Product[]; sales: Sale[]; debts: Debt[]; expenses: Expense[]; customers: Customer[]; alerts: Alert[]; balance: number; todaySales: number; todayProfit: number; pendingDebts: number }
```
after:
```ts
  | { type: 'LOAD_ALL_DATA'; products: Product[]; sales: Sale[]; debts: Debt[]; expenses: Expense[]; customers: Customer[]; categories: BusinessCategory[]; alerts: Alert[]; balance: number; todaySales: number; todayProfit: number; pendingDebts: number }
```

**8d. `initialState`** — add after `customers: [],` (line 128):
```ts
  categories: [],
```

**8e. Sort helper** — add a module-level helper right before `function appReducer` (after `persistFromState`, i.e. after line 158):
```ts
// Categories display order: explicit sort_order, then name as a tiebreak.
function byCategorySortOrder(a: BusinessCategory, b: BusinessCategory): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name)
}
```

**8f. `persistFromState`** — before:
```ts
function persistFromState(state: Pick<AppState, 'products' | 'sales' | 'debts' | 'expenses' | 'customers'>) {
  saveData({
    products: state.products,
    sales: state.sales,
    debts: state.debts,
    expenses: state.expenses,
    customers: state.customers,
    businessName: '',
    ownerName: '',
  })
}
```
after:
```ts
function persistFromState(state: Pick<AppState, 'products' | 'sales' | 'debts' | 'expenses' | 'customers' | 'categories'>) {
  saveData({
    products: state.products,
    sales: state.sales,
    debts: state.debts,
    expenses: state.expenses,
    customers: state.customers,
    categories: state.categories,
    businessName: '',
    ownerName: '',
  })
}
```

**8g. Reducer cases** — add after `case 'UPDATE_CUSTOMER': ...` (line 184):
```ts
    case 'SET_CATEGORIES': return { ...state, categories: [...action.categories].sort(byCategorySortOrder) }
    case 'ADD_CATEGORY': return { ...state, categories: [...state.categories, action.category].sort(byCategorySortOrder) }
    case 'UPDATE_CATEGORY': return { ...state, categories: state.categories.map((c) => (c.id === action.category.id ? action.category : c)) }
    case 'DELETE_CATEGORY': return { ...state, categories: state.categories.filter((c) => c.id !== action.id) }
```

`RESET_TENANT_DATA` — before (lines 212-216):
```ts
    case 'RESET_TENANT_DATA': return {
      ...state,
      products: [], sales: [], debts: [], expenses: [], customers: [], alerts: [],
      balance: 0, bankBalance: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0,
    }
```
after:
```ts
    case 'RESET_TENANT_DATA': return {
      ...state,
      products: [], sales: [], debts: [], expenses: [], customers: [], categories: [], alerts: [],
      balance: 0, bankBalance: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0,
    }
```

`LOAD_ALL_DATA` case — before (line 219):
```ts
    case 'LOAD_ALL_DATA': return { ...state, products: action.products, sales: action.sales, debts: action.debts, expenses: action.expenses, customers: action.customers, alerts: action.alerts, balance: action.balance, todaySales: action.todaySales, todayProfit: action.todayProfit, pendingDebts: action.pendingDebts }
```
after:
```ts
    case 'LOAD_ALL_DATA': return { ...state, products: action.products, sales: action.sales, debts: action.debts, expenses: action.expenses, customers: action.customers, categories: action.categories, alerts: action.alerts, balance: action.balance, todaySales: action.todaySales, todayProfit: action.todayProfit, pendingDebts: action.pendingDebts }
```

**8h. `StoreContextType`** — add after `updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>` (line 247):
```ts
  addCategory: (name: string, icon: string) => Promise<void>
  renameCategory: (id: string, newName: string) => Promise<void>
  removeCategory: (id: string) => Promise<{ blocked: boolean; count: number; reason?: 'builtin' | 'in-use' }>
  loadStarterCategories: (industry: string) => Promise<void>
```

**8i. `refreshData`** — add `fetchCategories()` to the `Promise.allSettled` call. Before (lines 396-412):
```ts
      const results = await Promise.allSettled([
        fetchProducts(),
        fetchSales(),
        fetchDebts(),
        fetchExpenses(),
        getDashboardSummary(),
        fetchBusinessProfile(),
        fetchCustomers(),
      ])

      const remoteProducts = results[0].status === 'fulfilled' ? results[0].value : []
      const remoteSales = results[1].status === 'fulfilled' ? results[1].value : []
      const remoteDebts = results[2].status === 'fulfilled' ? results[2].value : []
      const remoteExpenses = results[3].status === 'fulfilled' ? results[3].value : []
      const summary = results[4].status === 'fulfilled' ? results[4].value : { totalSales: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0, totalExpenses: 0, cashInHand: 0, cashInBank: 0 }
      const profile = results[5].status === 'fulfilled' ? results[5].value : null
      const remoteCustomers = results[6].status === 'fulfilled' ? results[6].value : []
```
after:
```ts
      const results = await Promise.allSettled([
        fetchProducts(),
        fetchSales(),
        fetchDebts(),
        fetchExpenses(),
        getDashboardSummary(),
        fetchBusinessProfile(),
        fetchCustomers(),
        fetchCategories(),
      ])

      const remoteProducts = results[0].status === 'fulfilled' ? results[0].value : []
      const remoteSales = results[1].status === 'fulfilled' ? results[1].value : []
      const remoteDebts = results[2].status === 'fulfilled' ? results[2].value : []
      const remoteExpenses = results[3].status === 'fulfilled' ? results[3].value : []
      const summary = results[4].status === 'fulfilled' ? results[4].value : { totalSales: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0, totalExpenses: 0, cashInHand: 0, cashInBank: 0 }
      const profile = results[5].status === 'fulfilled' ? results[5].value : null
      const remoteCustomers = results[6].status === 'fulfilled' ? results[6].value : []
      const remoteCategories = results[7].status === 'fulfilled' ? results[7].value : []
```

Add, right after the `customers` merge (lines 436-438):
```ts
      const categories = [...(local.categories || []).filter((c) => c.user_id === 'local'), ...remoteCategories]
        .filter(ownsRow)
        .sort(byCategorySortOrder)
```

`LOAD_ALL_DATA` dispatch in the try branch — before (lines 442-454):
```ts
      dispatch({
        type: 'LOAD_ALL_DATA',
        products,
        sales,
        debts,
        expenses,
        customers,
        alerts: generatedAlerts,
        balance: summary.cashInHand || 0,
        todaySales: summary.todaySales || 0,
        todayProfit: summary.todayProfit || 0,
        pendingDebts: summary.pendingDebts || 0,
      })
```
after:
```ts
      dispatch({
        type: 'LOAD_ALL_DATA',
        products,
        sales,
        debts,
        expenses,
        customers,
        categories,
        alerts: generatedAlerts,
        balance: summary.cashInHand || 0,
        todaySales: summary.todaySales || 0,
        todayProfit: summary.todayProfit || 0,
        pendingDebts: summary.pendingDebts || 0,
      })
```

Catch-fallback branch — before (lines 498-510):
```ts
      dispatch({
        type: 'LOAD_ALL_DATA',
        products: local.products,
        sales: local.sales,
        debts: local.debts,
        expenses: local.expenses,
        customers: local.customers || [],
        alerts: localAlerts,
        balance: totalSales - totalExpenses - creditSalesOutstanding,
        todaySales,
        todayProfit: todaySales * 0.2,
        pendingDebts,
      })
```
after:
```ts
      dispatch({
        type: 'LOAD_ALL_DATA',
        products: local.products,
        sales: local.sales,
        debts: local.debts,
        expenses: local.expenses,
        customers: local.customers || [],
        categories: local.categories || [],
        alerts: localAlerts,
        balance: totalSales - totalExpenses - creditSalesOutstanding,
        todaySales,
        todayProfit: todaySales * 0.2,
        pendingDebts,
      })
```

Demo/logged-out branch — before (lines 530-539):
```ts
      dispatch({
        type: 'LOAD_ALL_DATA',
        products: local.products,
        sales: local.sales,
        debts: local.debts,
        expenses: local.expenses,
        customers: local.customers || [],
        alerts: generateAlerts(local.products, local.sales, local.debts, local.expenses),
        balance: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0,
      })
```
after:
```ts
      dispatch({
        type: 'LOAD_ALL_DATA',
        products: local.products,
        sales: local.sales,
        debts: local.debts,
        expenses: local.expenses,
        customers: local.customers || [],
        categories: local.categories || [],
        alerts: generateAlerts(local.products, local.sales, local.debts, local.expenses),
        balance: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0,
      })
```

**8j. New CRUD actions** — add after `updateCustomer` (after line 820), before `logout`:
```ts
  const addCategory = useCallback(async (name: string, icon: string) => {
    try {
      const sortOrder = state.categories.length
      const inserted = await insertCategory({ name, icon, sortOrder })
      dispatch({ type: 'ADD_CATEGORY', category: inserted })
      showToast('Category added', 'success')
    } catch {
      const localCategory: BusinessCategory = {
        id: `local-${Date.now()}`,
        user_id: 'local',
        name,
        icon,
        sort_order: state.categories.length,
        is_builtin: false,
        created_at: new Date().toISOString(),
      }
      dispatch({ type: 'ADD_CATEGORY', category: localCategory })
      showToast('Saved locally (will sync when online)', 'success')
    }
  }, [state.categories, showToast])

  const renameCategory = useCallback(async (id: string, newName: string) => {
    const existing = state.categories.find((c) => c.id === id)
    if (!existing) return
    const oldName = existing.name
    try {
      const updated = await renameCategoryDb(id, newName)
      dispatch({ type: 'UPDATE_CATEGORY', category: updated })
      dispatch({ type: 'SET_PRODUCTS', products: applyCategoryRename(state.products, oldName, newName) })
      showToast('Category renamed', 'success')
    } catch {
      showToast('Could not rename category — check your connection', 'error')
    }
  }, [state.categories, state.products, showToast])

  const removeCategory = useCallback(async (id: string): Promise<{ blocked: boolean; count: number; reason?: 'builtin' | 'in-use' }> => {
    const cat = state.categories.find((c) => c.id === id)
    if (!cat) return { blocked: false, count: 0 }
    if (cat.is_builtin) {
      showToast("Uncategorized can't be deleted", 'error')
      return { blocked: true, count: 0, reason: 'builtin' }
    }
    const { allowed, count } = canDeleteCategory(cat.name, state.products)
    if (!allowed) return { blocked: true, count, reason: 'in-use' }
    try {
      await deleteCategoryDb(id)
      dispatch({ type: 'DELETE_CATEGORY', id })
      showToast('Category deleted', 'success')
    } catch {
      showToast('Could not delete category', 'error')
    }
    return { blocked: false, count: 0 }
  }, [state.categories, state.products, showToast])

  const loadStarterCategories = useCallback(async (industry: string) => {
    try {
      const categories = await seedCategoriesForIndustry(industry)
      dispatch({ type: 'SET_CATEGORIES', categories })
      showToast('Starter categories loaded', 'success')
    } catch {
      showToast('Could not load starter categories', 'error')
    }
  }, [showToast])
```

**8k. Provider value** — before (lines 880-889):
```ts
      addCustomer, updateCustomer,
      updateBusinessProfile,
```
after:
```ts
      addCustomer, updateCustomer,
      addCategory, renameCategory, removeCategory, loadStarterCategories,
      updateBusinessProfile,
```

- [ ] **Step 9: Verify nothing broke**

```bash
npm run build
npx vitest run
```
Expected: `npm run build` completes with no TypeScript errors (note: `updateProductsCategoryBulk` from `categoriesApi.ts` is unused until Task 6 — this will produce a `noUnusedLocals`-style error if the project's `tsconfig` enables it; if `npm run build` fails on that specific unused-import error, remove the `updateProductsCategoryBulk` import from `store.tsx`'s import list for now — it's re-added in Task 6 when it's actually used). `npx vitest run` reports all existing tests plus the 4 new `categoriesLogic` tests and 6 new `categories` tests passing, `0 failed`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/categoriesLogic.ts src/lib/categoriesLogic.test.ts src/services/categoriesApi.ts \
        src/lib/supabase.ts src/lib/data.ts src/lib/store.tsx
git commit -m "$(cat <<'EOF'
feat(categories): add categories store slice, service layer, and CRUD rules

Adds state.categories (loaded alongside products/sales/customers), the
categoriesApi service wrapping business_categories + rename_category RPC,
and the pure delete-block / rename-cascade rules with unit tests. No UI
consumes this yet.
EOF
)"
```

---

### Task 4: `ProductIcon.tsx` — Lucide icon lookup with legacy fallback

**Files:**
- Create: `src/lib/categoryIconMap.ts`
- Create: `src/lib/categoryIconMap.test.ts`
- Modify: `src/components/ProductIcon.tsx`

**Interfaces:**
- Consumes: Task 2's `CURATED_ICONS`.
- Produces: `CATEGORY_ICON_MAP: Record<string, LucideIcon>`; `ProductIcon` component new prop `iconKey?: string` — consumed by Task 5 (Inventory.tsx's call site) and Task 6 (Settings category rows).

- [ ] **Step 1: Write the failing test**

Create `src/lib/categoryIconMap.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CATEGORY_ICON_MAP } from './categoryIconMap'
import { CURATED_ICONS } from './categories'

describe('CATEGORY_ICON_MAP', () => {
  it('has a component for every curated icon key', () => {
    for (const key of CURATED_ICONS) {
      expect(CATEGORY_ICON_MAP[key]).toBeDefined()
    }
  })

  it('has no keys outside the curated list', () => {
    expect(Object.keys(CATEGORY_ICON_MAP).sort()).toEqual([...CURATED_ICONS].sort())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/categoryIconMap.test.ts
```
Expected: fails with `Cannot find module './categoryIconMap'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/categoryIconMap.ts`:

```ts
import {
  Box, Milk, CupSoda, Wheat, Package, Soup, Croissant, Utensils, Wrench, Hammer,
  Droplet, Scissors, Sparkles, Shirt, Footprints, Watch, Cpu, Smartphone, Laptop,
  Plug, Battery, Pill, Syringe, Stethoscope, type LucideIcon,
} from 'lucide-react'

// Maps a business_categories.icon key (see CURATED_ICONS in
// src/lib/categories.ts) to the Lucide component that renders it.
export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  'box': Box,
  'milk': Milk,
  'cup-soda': CupSoda,
  'wheat': Wheat,
  'package': Package,
  'soup': Soup,
  'croissant': Croissant,
  'utensils': Utensils,
  'wrench': Wrench,
  'hammer': Hammer,
  'droplet': Droplet,
  'scissors': Scissors,
  'sparkles': Sparkles,
  'shirt': Shirt,
  'footprints': Footprints,
  'watch': Watch,
  'cpu': Cpu,
  'smartphone': Smartphone,
  'laptop': Laptop,
  'plug': Plug,
  'battery': Battery,
  'pill': Pill,
  'syringe': Syringe,
  'stethoscope': Stethoscope,
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/categoryIconMap.test.ts
```
Expected: `Test Files 1 passed`, `Tests 2 passed`.

- [ ] **Step 5: Wire `ProductIcon.tsx` to the new map (no automated test — see Global Constraints)**

Modify `src/components/ProductIcon.tsx` — replace the full file:

```tsx
import type { ReactElement } from 'react'
import { CATEGORY_ICON_MAP } from '@/lib/categoryIconMap'

interface ProductIconProps {
  category: string
  iconKey?: string
  size?: number
  className?: string
}

export default function ProductIcon({ category, iconKey, size = 32, className = '' }: ProductIconProps) {
  const strokeWidth = 2
  const color = '#1A150D'

  // Custom/non-legacy categories carry their own stored icon key
  // (business_categories.icon) — render that via lucide-react when present.
  if (iconKey && CATEGORY_ICON_MAP[iconKey]) {
    const Lucide = CATEGORY_ICON_MAP[iconKey]
    return <Lucide size={size} color={color} strokeWidth={strokeWidth} className={className} />
  }

  const icons: Record<string, ReactElement> = {
    Dairy: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <rect x="8" y="10" width="16" height="18" rx="1" stroke={color} strokeWidth={strokeWidth} />
        <path d="M11 10V7C11 6 12 5 13 5H19C20 5 21 6 21 7V10" stroke={color} strokeWidth={strokeWidth} />
        <line x1="12" y1="14" x2="20" y2="14" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
    Groceries: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <rect x="6" y="8" width="20" height="22" rx="2" stroke={color} strokeWidth={strokeWidth} />
        <path d="M12 8V5C12 4 13 3 14 3H18C19 3 20 4 20 5V8" stroke={color} strokeWidth={strokeWidth} />
        <line x1="6" y1="14" x2="26" y2="14" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
    Beverages: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <path d="M10 6L12 28H20L22 6" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
        <ellipse cx="16" cy="6" rx="6" ry="2" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
    Cooking: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <path d="M10 10C10 10 8 16 8 20C8 24 11 27 16 27C21 27 24 24 24 20C24 16 22 10 22 10" stroke={color} strokeWidth={strokeWidth} />
        <ellipse cx="16" cy="10" rx="6" ry="2" stroke={color} strokeWidth={strokeWidth} />
        <path d="M16 4V2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    ),
    Grains: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <path d="M8 12L16 6L24 12V26H8V12Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
        <path d="M12 26V18H20V26" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
    Canned: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <rect x="9" y="6" width="14" height="22" rx="2" stroke={color} strokeWidth={strokeWidth} />
        <ellipse cx="16" cy="6" rx="7" ry="2" stroke={color} strokeWidth={strokeWidth} />
        <line x1="9" y1="22" x2="23" y2="22" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
    Noodles: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <rect x="6" y="10" width="20" height="16" rx="1" stroke={color} strokeWidth={strokeWidth} />
        <path d="M6 14H26" stroke={color} strokeWidth={strokeWidth} />
        <path d="M10 10V6M16 10V6M22 10V6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    ),
    Bakery: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <path d="M6 18C6 12 10 8 16 8C22 8 26 12 26 18V26H6V18Z" stroke={color} strokeWidth={strokeWidth} />
        <path d="M10 14C12 12 20 12 22 14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    ),
    default: (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
        <rect x="7" y="7" width="18" height="18" rx="2" stroke={color} strokeWidth={strokeWidth} />
        <circle cx="16" cy="16" r="4" stroke={color} strokeWidth={strokeWidth} />
      </svg>
    ),
  }

  return icons[category] || icons.default
}
```

(The 8 legacy hand-drawn SVGs and the generic `default` box are byte-for-byte unchanged — this guarantees zero visual regression for existing Supermarket tenants until they're given a real `iconKey`.)

- [ ] **Step 6: Verify with a typecheck build**

```bash
npm run build
```
Expected: succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/categoryIconMap.ts src/lib/categoryIconMap.test.ts src/components/ProductIcon.tsx
git commit -m "$(cat <<'EOF'
feat(categories): ProductIcon renders custom Lucide icons via iconKey

Adds CATEGORY_ICON_MAP (Lucide lookup for the 24 curated icon keys) and
wires ProductIcon to prefer a caller-supplied iconKey, falling back to the
existing hand-drawn legacy SVGs (unchanged) and the generic box default.
EOF
)"
```

---

### Task 5: Wire `BarcodeScanner.tsx` and `Inventory.tsx` pickers to the shared category list

**Files:**
- Modify: `src/components/BarcodeScanner.tsx`
- Modify: `src/pages/Inventory.tsx`
- Test: none (no component test infra in this repo — see Global Constraints); verified via `npm run build` + manual QA

**Interfaces:**
- Consumes: Task 2's `templateForIndustry`; Task 3's `state.categories`; Task 4's `ProductIcon` `iconKey` prop.
- Produces: nothing new (leaf UI wiring).

- [ ] **Step 1: Edit `BarcodeScanner.tsx`**

Import changes — before (line 1):
```ts
import { useState, useEffect, useRef, useCallback } from 'react'
```
after:
```ts
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
```

Add, after `import { uid, formatCurrency } from '@/lib/data'` (line 18):
```ts
import { templateForIndustry } from '@/lib/categories'
```

Delete line 102 entirely:
```ts
const CATEGORY_OPTIONS = ['Groceries', 'Dairy', 'Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles', 'Bakery']
```

Inside the component, right after `const { state, showToast, addProduct, updateProduct } = useStore()` (line 108), add:
```ts
  // Per-tenant category list (falls back to the Supermarket template before
  // categories have loaded, e.g. right after login or while offline).
  const categoryNames = useMemo(
    () => (state.categories.length > 0
      ? state.categories.map((c) => c.name)
      : templateForIndustry('Supermarket').map((c) => c.name)),
    [state.categories],
  )
```
(`useMemo` here is load-bearing, not stylistic: `categoryNames` feeds `resetManual`'s dependency array below, and an unmemoized `.map()` would produce a new array every render, re-triggering `resetManual` — and the `useEffect` that calls it on every render while the sheet is open, silently wiping the in-progress manual-entry form on every unrelated keystroke.)

Default values — before (lines 163, 165-172):
```ts
  const [manualCategory, setManualCategory] = useState('Groceries')

  const resetManual = useCallback(() => {
    setManualName('')
    setManualCost('')
    setManualPrice('')
    setManualQty(1)
    setManualUnit('piece')
    setManualCategory('Groceries')
  }, [])
```
after:
```ts
  const [manualCategory, setManualCategory] = useState(categoryNames[0] || 'Uncategorized')

  const resetManual = useCallback(() => {
    setManualName('')
    setManualCost('')
    setManualPrice('')
    setManualQty(1)
    setManualUnit('piece')
    setManualCategory(categoryNames[0] || 'Uncategorized')
  }, [categoryNames])
```

Fallback literals inside `processScannedCode` — before (line 237):
```ts
          category: json.category || 'Groceries',
```
after:
```ts
          category: json.category || categoryNames[0] || 'Uncategorized',
```

before (line 280):
```ts
        category: catalogData.category || 'Groceries',
```
after:
```ts
        category: catalogData.category || categoryNames[0] || 'Uncategorized',
```

before (line 316, the unknown-barcode fallback):
```ts
      category: 'Groceries',
```
after:
```ts
      category: categoryNames[0] || 'Uncategorized',
```

`processScannedCode`'s dependency array — before (line 322):
```ts
  }, [state.products])
```
after:
```ts
  }, [state.products, categoryNames])
```

The two category grids — before (line 836):
```tsx
                  {CATEGORY_OPTIONS.map((cat) => (
```
after:
```tsx
                  {categoryNames.map((cat) => (
```
before (line 1070):
```tsx
                    {CATEGORY_OPTIONS.map((cat) => (
```
after:
```tsx
                    {categoryNames.map((cat) => (
```

- [ ] **Step 2: Edit `Inventory.tsx`**

Import changes — before (line 1):
```ts
import { useState, useEffect } from 'react'
```
after:
```ts
import { useState, useEffect, useMemo } from 'react'
```

Add, after `import { formatStock, isMultiUnit } from '@/lib/units'` (line 12):
```ts
import { templateForIndustry } from '@/lib/categories'
```

Inside the component, right after `const { state, dispatch, showToast, t, addProduct, updateProduct, removeProduct, addDebt, updateDebt, removeDebt } = useStore()` (line 15), add:
```ts
  const categoryNames = useMemo(
    () => (state.categories.length > 0
      ? state.categories.map((c) => c.name)
      : templateForIndustry('Supermarket').map((c) => c.name)),
    [state.categories],
  )
```

Delete line 407 entirely:
```ts
  const categories = ['Groceries', 'Dairy', 'Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles', 'Bakery']
```

Reset-after-add — before (line 197):
```ts
      setNewProduct({ name: '', cost_price: '', selling_price: '', quantity: '', unit: 'piece', category: 'Groceries', multiUnit: false, packUnit: 'box', unitsPerPack: '', qtyUnitKind: 'base' })
```
after:
```ts
      setNewProduct({ name: '', cost_price: '', selling_price: '', quantity: '', unit: 'piece', category: categoryNames[0] || 'Uncategorized', multiUnit: false, packUnit: 'box', unitsPerPack: '', qtyUnitKind: 'base' })
```

"Add Product" open button — before (lines 422-427):
```tsx
            <button
              onClick={() => setShowAddProduct(true)}
              className="btn-tactile w-10 h-10 bg-accent-red flex items-center justify-center rounded-sm"
            >
              <Plus size={20} strokeWidth={2.5} className="text-white" />
            </button>
```
after:
```tsx
            <button
              onClick={() => {
                setNewProduct((prev) => ({ ...prev, category: categoryNames[0] || 'Uncategorized' }))
                setShowAddProduct(true)
              }}
              className="btn-tactile w-10 h-10 bg-accent-red flex items-center justify-center rounded-sm"
            >
              <Plus size={20} strokeWidth={2.5} className="text-white" />
            </button>
```

Inline-edit category select — before (line 629):
```tsx
                    {categories.map((cat) => (
```
after:
```tsx
                    {categoryNames.map((cat) => (
```

`ProductIcon` call — before (line 654):
```tsx
                    <ProductIcon category={product.category} size={28} />
```
after:
```tsx
                    <ProductIcon category={product.category} iconKey={state.categories.find((c) => c.name === product.category)?.icon} size={28} />
```

Add-product category grid — before (line 1082):
```tsx
                      {categories.map((cat) => (
```
after:
```tsx
                      {categoryNames.map((cat) => (
```

- [ ] **Step 3: Verify with a typecheck build**

```bash
npm run build
```
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Manual QA checklist**

```bash
npm run dev
```
- Log in as an existing (pre-migration) tenant → Inventory's category grid and BarcodeScanner's manual/confirm grids show the same 8 Supermarket categories as before, in the same order, with the same icons (unchanged hand-drawn SVGs).
- Add a product, confirm its category saves correctly and its icon renders in the stock list.
- Scan/type an unrecognized barcode → manual-entry sheet defaults to the tenant's first category, not a hardcoded 'Groceries'.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npm run test
```
Expected: all tests still pass (no test exercises these two files, so this simply confirms no import-time breakage elsewhere).

- [ ] **Step 6: Commit**

```bash
git add src/components/BarcodeScanner.tsx src/pages/Inventory.tsx
git commit -m "$(cat <<'EOF'
feat(categories): wire BarcodeScanner + Inventory pickers to state.categories

Removes the two independently-hardcoded CATEGORY_OPTIONS/categories arrays;
both pickers now render the tenant's own business_categories list (falling
back to the Supermarket template before it has loaded), and Inventory's
ProductIcon call passes the resolved icon key.
EOF
)"
```

---

### Task 6: Settings → "Manage Categories" UI

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/lib/store.tsx` (add `reassignAndDeleteCategory` action)
- Test: none (no component test infra); verified via `npm run build` + manual QA

**Interfaces:**
- Consumes: Task 2's `CURATED_ICONS`; Task 3's `state.categories`, `addCategory`, `renameCategory`, `removeCategory`, `loadStarterCategories`, `updateProductsCategoryBulk`, `deleteCategoryDb`, `applyCategoryRename`; Task 4's `CATEGORY_ICON_MAP`.
- Produces: store's `reassignAndDeleteCategory(id, fromName, toName): Promise<void>` — leaf, no downstream consumer.

- [ ] **Step 1: Add the `reassignAndDeleteCategory` store action**

Modify `src/lib/store.tsx`:

Add `updateProductsCategoryBulk` back into the `categoriesApi` import added in Task 3 (if it was removed in Task 3 Step 9 to satisfy an unused-import check) — the import block should read:
```ts
import {
  fetchCategories, insertCategory, renameCategoryDb, deleteCategoryDb,
  seedCategoriesForIndustry, updateProductsCategoryBulk,
} from '@/services/categoriesApi'
```

Add the new action, right after `loadStarterCategories` (added in Task 3 Step 8j):
```ts
  const reassignAndDeleteCategory = useCallback(async (id: string, fromName: string, toName: string) => {
    try {
      await updateProductsCategoryBulk(fromName, toName)
      dispatch({ type: 'SET_PRODUCTS', products: applyCategoryRename(state.products, fromName, toName) })
      await deleteCategoryDb(id)
      dispatch({ type: 'DELETE_CATEGORY', id })
      showToast('Products moved, category deleted', 'success')
    } catch {
      showToast('Could not delete category', 'error')
    }
  }, [state.products, showToast])
```

`StoreContextType` — add after `loadStarterCategories: (industry: string) => Promise<void>`:
```ts
  reassignAndDeleteCategory: (id: string, fromName: string, toName: string) => Promise<void>
```

Provider value — before:
```ts
      addCategory, renameCategory, removeCategory, loadStarterCategories,
```
after:
```ts
      addCategory, renameCategory, removeCategory, loadStarterCategories, reassignAndDeleteCategory,
```

- [ ] **Step 2: Add the Settings UI**

Modify `src/pages/Settings.tsx`.

Imports — before (line 1-7):
```tsx
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, LogOut, Download, Trash2, User, Store, Globe, Bell, HelpCircle, Shield, Camera, Share2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useNavigate } from 'react-router'
import { exportToCSV } from '@/lib/export'
import type { BusinessProfile } from '@/lib/supabase'
```
after:
```tsx
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, LogOut, Download, Trash2, User, Store, Globe, Bell, HelpCircle, Shield, Camera, Share2, Tag, Plus, Pencil, RefreshCw } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useNavigate } from 'react-router'
import { exportToCSV } from '@/lib/export'
import type { BusinessProfile } from '@/lib/supabase'
import { CURATED_ICONS } from '@/lib/categories'
import { CATEGORY_ICON_MAP } from '@/lib/categoryIconMap'
```

Store destructure — before (line 14):
```tsx
  const { state, dispatch, showToast, logout, updateBusinessProfile, resetAllData } = useStore()
```
after:
```tsx
  const { state, dispatch, showToast, logout, updateBusinessProfile, resetAllData, addCategory, renameCategory, removeCategory, loadStarterCategories, reassignAndDeleteCategory } = useStore()
```

New local state — add after `const [saving, setSaving] = useState(false)` (line 25):
```tsx
  const [showCategories, setShowCategories] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatIcon, setNewCatIcon] = useState(CURATED_ICONS[0])
  const [renamingCatId, setRenamingCatId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [reassignFrom, setReassignFrom] = useState<{ id: string; name: string; count: number } | null>(null)
  const [reassignTo, setReassignTo] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)
```

New menu item — before (line 140):
```tsx
    { icon: User, label: 'Edit Profile', action: () => setShowProfile(true) },
```
after:
```tsx
    { icon: User, label: 'Edit Profile', action: () => setShowProfile(true) },
    { icon: Tag, label: 'Manage Categories', badge: String(state.categories.length), action: () => setShowCategories(true) },
```

New modals — add right before the closing `</div>` of the component (i.e. immediately after the "Confirm Logout" `</AnimatePresence>` block, before the final `</div>` at the end of the returned JSX):

```tsx
      {/* Manage Categories Modal */}
      <AnimatePresence>
        {showCategories && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowCategories(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[90vw] max-w-sm max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b-2 border-ink sticky top-0 bg-sand">
                <h2 className="font-display text-lg text-ink uppercase">Categories</h2>
                <button onClick={() => setShowCategories(false)} className="w-8 h-8 flex items-center justify-center rounded-sm bg-warm-gray"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-4">
                <button
                  onClick={async () => {
                    setSavingCategory(true)
                    await loadStarterCategories(state.businessProfile?.industry || 'Supermarket')
                    setSavingCategory(false)
                  }}
                  disabled={savingCategory}
                  className="w-full h-10 bg-warm-gray rounded-sm font-display text-xs text-ink uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw size={14} /> Load starter categories
                </button>

                <div className="space-y-2">
                  {state.categories.map((cat) => {
                    const Icon = CATEGORY_ICON_MAP[cat.icon] || Tag
                    const count = state.products.filter((p) => p.category === cat.name).length
                    return (
                      <div key={cat.id} className="flex items-center gap-3 bg-light harsh-border rounded-sm px-3 py-2.5">
                        <Icon size={18} className="text-ink flex-shrink-0" />
                        {renamingCatId === cat.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="flex-1 h-8 px-2 bg-white harsh-border rounded-sm text-sm"
                          />
                        ) : (
                          <span className="flex-1 text-sm text-ink truncate">{cat.name}</span>
                        )}
                        <span className="text-[10px] text-muted-text">{count}</span>
                        {renamingCatId === cat.id ? (
                          <button
                            onClick={async () => {
                              if (renameValue.trim() && renameValue.trim() !== cat.name) {
                                await renameCategory(cat.id, renameValue.trim())
                              }
                              setRenamingCatId(null)
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-sm bg-accent-green/10"
                          >
                            <Pencil size={12} className="text-accent-green" />
                          </button>
                        ) : (
                          <button
                            onClick={() => { setRenamingCatId(cat.id); setRenameValue(cat.name) }}
                            className="w-7 h-7 flex items-center justify-center rounded-sm bg-warm-gray"
                          >
                            <Pencil size={12} className="text-ink" />
                          </button>
                        )}
                        {!cat.is_builtin && (
                          <button
                            onClick={async () => {
                              const result = await removeCategory(cat.id)
                              if (result.blocked && result.reason === 'in-use') {
                                setReassignFrom({ id: cat.id, name: cat.name, count: result.count })
                                setReassignTo(state.categories.find((c) => c.id !== cat.id)?.name || '')
                              }
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-sm bg-accent-red/10"
                          >
                            <Trash2 size={12} className="text-accent-red" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="pt-2 border-t border-ink/10">
                  <p className="text-[10px] text-muted-text uppercase tracking-wider mb-2">Add category</p>
                  <input
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="e.g. Frozen Foods"
                    className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm mb-2"
                  />
                  <div className="grid grid-cols-8 gap-1.5 mb-2">
                    {CURATED_ICONS.map((iconKey) => {
                      const Icon = CATEGORY_ICON_MAP[iconKey]
                      return (
                        <button
                          key={iconKey}
                          type="button"
                          onClick={() => setNewCatIcon(iconKey)}
                          className={`w-8 h-8 flex items-center justify-center rounded-sm border-2 ${newCatIcon === iconKey ? 'bg-ink border-ink' : 'bg-light border-ink'}`}
                        >
                          <Icon size={14} className={newCatIcon === iconKey ? 'text-white' : 'text-ink'} />
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={async () => {
                      if (!newCatName.trim()) { showToast('Enter a category name', 'error'); return }
                      setSavingCategory(true)
                      await addCategory(newCatName.trim(), newCatIcon)
                      setNewCatName('')
                      setSavingCategory(false)
                    }}
                    disabled={savingCategory}
                    className="w-full h-10 bg-ink text-white rounded-sm font-display text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Plus size={14} /> Add Category
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Reassign-then-delete Modal */}
      <AnimatePresence>
        {reassignFrom && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-[70]" onClick={() => setReassignFrom(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[71] w-[85vw] max-w-sm p-5"
            >
              <h3 className="font-display text-lg text-ink uppercase mb-2">Move products first</h3>
              <p className="text-sm text-ink mb-4">
                {reassignFrom.count} product{reassignFrom.count === 1 ? '' : 's'} still use "{reassignFrom.name}". Choose where to move them before deleting it.
              </p>
              <select
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="w-full h-11 px-3 bg-light harsh-border rounded-sm text-sm mb-4"
              >
                {state.categories.filter((c) => c.id !== reassignFrom.id).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
              <div className="flex gap-3">
                <button onClick={() => setReassignFrom(null)} className="flex-1 h-10 bg-warm-gray rounded-sm font-display text-xs uppercase">Cancel</button>
                <button
                  onClick={async () => {
                    if (!reassignTo) return
                    await reassignAndDeleteCategory(reassignFrom.id, reassignFrom.name, reassignTo)
                    setReassignFrom(null)
                  }}
                  className="flex-1 h-10 bg-accent-red text-white rounded-sm font-display text-xs uppercase flex items-center justify-center gap-1.5"
                >
                  <Trash2 size={12} /> Move & Delete
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
```

- [ ] **Step 3: Verify with a typecheck build**

```bash
npm run build
```
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Manual QA checklist**

```bash
npm run dev
```
- Settings → "Manage Categories" shows the tenant's real category list with product counts.
- Add a new category with a chosen icon → appears in the list, and in Inventory's category picker.
- Rename a category that has products → confirm those products' category updates (check Inventory/Reports).
- Try to delete "Uncategorized" → blocked with a toast, no modal.
- Try to delete a category with products → reassignment modal opens; pick a target, confirm → products move, category disappears.
- Delete a category with zero products → deletes immediately, no modal.
- "Load starter categories" → re-adds only missing template names (rename one back and reload to confirm idempotency).

- [ ] **Step 5: Run the full test suite**

```bash
npm run test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings.tsx src/lib/store.tsx
git commit -m "$(cat <<'EOF'
feat(categories): add Settings -> Manage Categories UI

Add/rename/delete-with-reassign category flows plus "Load starter
categories", wired to the categories store slice from earlier tasks.
EOF
)"
```

---

### Task 7: Signup industry-picker step

**Files:**
- Create: `src/components/IndustryPicker.tsx`
- Modify: `src/lib/supabase.ts` (add `BusinessProfile.industry`)
- Modify: `src/lib/store.tsx` (add `chooseIndustry` action)
- Modify: `src/App.tsx` (gate on `businessProfile === null`)
- Test: none (no component test infra); verified via `npm run build` + manual QA

**Interfaces:**
- Consumes: Task 2's `INDUSTRIES`; Task 3's `SET_CATEGORIES` action, `seedCategoriesForIndustry`.
- Produces: `IndustryPicker` component; store's `chooseIndustry(industry: string): Promise<void>`; `BusinessProfile.industry?: string | null`.

- [ ] **Step 1: Add `industry` to `BusinessProfile`**

Modify `src/lib/supabase.ts` — before:
```ts
export interface BusinessProfile {
  id: string
  user_id: string
  business_name: string
  owner_name: string | null
  phone: string | null
  email: string | null
  logo_url?: string | null
  currency: string
  language: string
  status?: 'active' | 'suspended'
```
after:
```ts
export interface BusinessProfile {
  id: string
  user_id: string
  business_name: string
  owner_name: string | null
  phone: string | null
  email: string | null
  logo_url?: string | null
  currency: string
  language: string
  industry?: string | null
  status?: 'active' | 'suspended'
```

- [ ] **Step 2: Add the `chooseIndustry` store action**

Modify `src/lib/store.tsx` — add, right after `reassignAndDeleteCategory` (from Task 6):
```ts
  const chooseIndustry = useCallback(async (industry: string) => {
    const profile: BusinessProfile = {
      id: state.user?.id || 'local',
      user_id: state.user?.id || 'local',
      business_name: state.user?.business_name || 'My Shop',
      owner_name: null,
      phone: state.user?.phone || null,
      email: state.user?.email || null,
      currency: 'GHS',
      language: state.language,
      industry,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    try {
      const saved = await upsertBusinessProfile(profile)
      dispatch({ type: 'SET_BUSINESS_PROFILE', profile: saved })
    } catch {
      dispatch({ type: 'SET_BUSINESS_PROFILE', profile })
    }
    try {
      const seeded = await seedCategoriesForIndustry(industry)
      dispatch({ type: 'SET_CATEGORIES', categories: seeded })
    } catch {
      showToast('Could not load starter categories — try again from Settings', 'error')
    }
  }, [state.user, state.language, showToast])
```

`StoreContextType` — add after `reassignAndDeleteCategory: (id: string, fromName: string, toName: string) => Promise<void>`:
```ts
  chooseIndustry: (industry: string) => Promise<void>
```

Provider value — add `chooseIndustry` alongside `reassignAndDeleteCategory`.

- [ ] **Step 3: Create the `IndustryPicker` component**

Create `src/components/IndustryPicker.tsx`:

```tsx
import { useState } from 'react'
import { Loader2, ArrowRight } from 'lucide-react'
import { useStore } from '@/lib/store'
import { INDUSTRIES } from '@/lib/categories'

export default function IndustryPicker() {
  const { showToast, chooseIndustry } = useStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleContinue = async () => {
    if (!selected) { showToast('Pick your business type', 'error'); return }
    setSaving(true)
    try {
      await chooseIndustry(selected)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-sand px-6 py-10 flex flex-col items-center">
      <h1 className="font-display text-2xl text-ink uppercase tracking-tight text-center mb-2">What do you sell?</h1>
      <p className="text-sm text-muted-text text-center mb-6">
        We'll set up starter categories for your trade — you can change them anytime in Settings.
      </p>
      <div className="w-full max-w-sm grid grid-cols-2 gap-3 mb-8">
        {INDUSTRIES.map((industry) => (
          <button
            key={industry}
            type="button"
            onClick={() => setSelected(industry)}
            className={`py-5 px-3 rounded-sm border-2 font-display text-xs uppercase tracking-wider text-center ${
              selected === industry ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'
            }`}
          >
            {industry}
          </button>
        ))}
      </div>
      <button
        onClick={handleContinue}
        disabled={saving || !selected}
        className="w-full max-w-sm h-14 bg-ink text-white font-display text-sm uppercase tracking-wider rounded-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving ? <Loader2 size={20} className="animate-spin" /> : <>Continue <ArrowRight size={18} /></>}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Gate `App.tsx` on a missing business profile**

Modify `src/App.tsx`.

Import — before (line 12):
```tsx
import Login from '@/pages/Login'
```
after:
```tsx
import Login from '@/pages/Login'
import IndustryPicker from '@/components/IndustryPicker'
```

Gate — before (lines 115-122):
```tsx
  if (state.isAuthenticated && state.suspended && !state.isSuperAdmin) {
    return (
      <div className="h-[100dvh] w-full bg-sand flex flex-col overflow-hidden">
        <ImpersonationBanner />
        <div className="flex-1 overflow-hidden"><SuspendedScreen /></div>
      </div>
    )
  }
```
after:
```tsx
  if (state.isAuthenticated && state.suspended && !state.isSuperAdmin) {
    return (
      <div className="h-[100dvh] w-full bg-sand flex flex-col overflow-hidden">
        <ImpersonationBanner />
        <div className="flex-1 overflow-hidden"><SuspendedScreen /></div>
      </div>
    )
  }

  // Every real tenant has a business_profiles row after migration_022 (see
  // that migration's backfill). A logged-in user with none is a brand-new
  // signup who hasn't picked their industry yet.
  if (state.isAuthenticated && !state.dataLoading && !state.suspended && state.businessProfile === null) {
    return (
      <div className="h-[100dvh] w-full bg-sand flex flex-col overflow-hidden">
        <IndustryPicker />
      </div>
    )
  }
```

Note: `src/pages/Login.tsx` needs **no changes**. Supabase's own `onAuthStateChange` listener in `store.tsx` already dispatches `SET_USER` and triggers `refreshData()` as soon as `signUp()` creates a session; `refreshData()` finds no `business_profiles` row for a fresh signup, so `state.businessProfile` stays `null` and the new gate above shows `IndustryPicker` instead of `MainApp` — no route changes needed either, since this check runs before the `<Routes>` block in `App()`.

- [ ] **Step 5: Verify with a typecheck build**

```bash
npm run build
```
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Manual QA checklist**

```bash
npm run dev
```
- Sign up a brand-new account → after account creation, the app shows the industry picker (not the dashboard).
- Pick "Hardware/Plumbing" → Continue → app proceeds to the dashboard; Settings → Manage Categories shows the Hardware/Plumbing starter list; Inventory's category picker shows the same list.
- Log out and back in as an existing (pre-feature) tenant → goes straight to the dashboard, no industry picker (their `business_profiles.industry` is already `'Supermarket'` from the migration backfill).

- [ ] **Step 7: Commit**

```bash
git add src/components/IndustryPicker.tsx src/lib/supabase.ts src/lib/store.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat(categories): add signup industry picker

New tenants pick their industry right after signup (gated on a missing
business_profiles row), which seeds their starter category list and stores
business_profiles.industry. Existing tenants are unaffected — migration_022
already backfilled them to industry='Supermarket'.
EOF
)"
```

---

### Task 8: bulkImport / agent default-category fallback → 'Uncategorized'

**Files:**
- Modify: `src/lib/bulkImport/rows.ts`
- Modify: `src/lib/bulkImport/rows.test.ts`
- Modify: `src/lib/agent/writeTools.ts`
- Modify: `src/lib/agent/writeTools.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of the categories module — this is just changing two literal default values, since `products.category` remains free `TEXT`).
- Produces: nothing new; updated default behavior.

- [ ] **Step 1: Update the failing/changed tests first**

Modify `src/lib/bulkImport/rows.test.ts` — before:
```ts
describe('normalizeRow', () => {
  it('applies defaults', () => {
    const r = normalizeRow({ name: 'Milo', cost_price: 4, selling_price: 8, quantity: 10 })
    expect(r).toMatchObject({ name: 'Milo', unit: 'piece', category: 'Groceries', unitsPerPack: 1 })
    expect(r.id).toBeTruthy()
  })
})
```
after:
```ts
describe('normalizeRow', () => {
  it('applies defaults', () => {
    const r = normalizeRow({ name: 'Milo', cost_price: 4, selling_price: 8, quantity: 10 })
    expect(r).toMatchObject({ name: 'Milo', unit: 'piece', category: 'Uncategorized', unitsPerPack: 1 })
    expect(r.id).toBeTruthy()
  })
})
```

Modify `src/lib/agent/writeTools.test.ts` — add a new test right after the existing `'builds a new_product preview'` test (after line 65):
```ts
  it('defaults category to Uncategorized when not provided', () => {
    const r = buildPreview(
      { name: 'new_product', input: { name: 'Rice 5kg', cost_price: 40, sell_price: 55, qty: 10 } },
      ctx,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.newProduct?.category).toBe('Uncategorized')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/bulkImport/rows.test.ts src/lib/agent/writeTools.test.ts
```
Expected: `rows.test.ts`'s "applies defaults" test fails (`category: 'Groceries'` still produced by the current implementation, expected `'Uncategorized'`); `writeTools.test.ts`'s new test fails (`category` is currently `'default'`, expected `'Uncategorized'`).

- [ ] **Step 3: Write minimal implementation**

Modify `src/lib/bulkImport/rows.ts` — before (line 82):
```ts
    category: (raw.category ?? 'Groceries').trim() || 'Groceries',
```
after:
```ts
    category: (raw.category ?? 'Uncategorized').trim() || 'Uncategorized',
```

Modify `src/lib/agent/writeTools.ts` — before (line 105):
```ts
    const category = String(input.category ?? 'default')
```
after:
```ts
    const category = String(input.category ?? 'Uncategorized')
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/bulkImport/rows.test.ts src/lib/agent/writeTools.test.ts
```
Expected: `Test Files 2 passed`, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bulkImport/rows.ts src/lib/bulkImport/rows.test.ts \
        src/lib/agent/writeTools.ts src/lib/agent/writeTools.test.ts
git commit -m "$(cat <<'EOF'
fix(categories): default unknown/blank category to Uncategorized

Bulk import and the voice agent's new_product tool both defaulted unknown
categories to 'Groceries' (or, for the agent, the meaningless 'default'
string) — every tenant now has a real Uncategorized category, so this is
the correct fallback regardless of industry.
EOF
)"
```

---

### Task 9: Final end-to-end verification (manual)

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: sign-off that the feature works end-to-end, per the spec's own testing section.

- [ ] **Step 1: Run the full automated suite one more time**

```bash
npm run build
npm run test
```
Expected: build succeeds with zero TypeScript errors; all Vitest tests pass, including the new `categories.test.ts`, `categoriesLogic.test.ts`, `categoryIconMap.test.ts`, and the updated `rows.test.ts` / `writeTools.test.ts`.

- [ ] **Step 2: Fresh-signup end-to-end checklist**

```bash
npm run dev
```
- Sign up a new account with a fresh email.
- Confirm the industry picker appears; select "Hardware/Plumbing" → Continue.
- Confirm you land on the dashboard, and Inventory's "Add Product" category grid shows exactly: Pipes & Fittings, Tools, Paints & Sealants, Electrical, Fasteners & Hardware, Safety Gear.
- Add a product under "Pipes & Fittings" — confirm it saves and its stock-list icon renders (wrench).
- Go to Settings → Manage Categories: add a custom category "Copper Fittings" with a chosen icon.
- Add a second product under "Copper Fittings".
- Rename "Copper Fittings" → "Copper & Brass Fittings" — confirm the product added under it now shows the new name in Inventory and in Reports.
- Try deleting "Pipes & Fittings" (has a product) → reassignment modal appears; reassign to "Tools" → confirm the product moves and the category disappears from the list.
- Delete "Copper & Brass Fittings" (now that its product was optionally moved, or with 0 products) → deletes immediately.
- Go to Reports → confirm category totals reflect the moves/renames correctly (no logic change was needed there — it groups by whatever string is in `category`, and now displays correctly because the icon map was extended).

- [ ] **Step 3: Existing-tenant regression checklist**

- Log in as (or seed, via the SQL from Task 1 Step 3, then log in as) a pre-migration Supermarket tenant.
- Confirm: no industry picker shown; Inventory and BarcodeScanner category pickers show exactly the original 8 categories in the original order with the original icons; existing products' categories and icons are unchanged.

- [ ] **Step 4: Sign off**

No commit for this task — it is a verification pass over work already committed in Tasks 1-8. If any checklist item fails, return to the relevant task, fix it there (new commit), and re-run this checklist.
