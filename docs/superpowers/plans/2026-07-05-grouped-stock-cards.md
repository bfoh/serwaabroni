# Grouped Stock Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On My Stock, render products that share a name as one card with a name+total header and one dated "stock entry" per underlying product, each keeping its own Re-stock/history/edit/delete.

**Architecture:** A pure `groupByName` helper groups the already-filtered products; the big per-product card JSX in `Inventory.tsx` is extracted into a `renderProductCard(product, index, grouped)` function so it can render either as a standalone card (single) or as a bordered-less entry inside a group card (duplicates). Display-only — no data changes.

**Tech Stack:** React + TypeScript + Vite, Vitest.

## Global Constraints

- Display-only: no products are merged, edited, or written to the DB; add/edit/restock/delete logic is unchanged.
- Group by `name.trim().toLowerCase()`, preserving first-seen order; group only when 2+ products share a name (a single product renders exactly as today).
- Header total: sum quantities + shared unit when every entry shares a `unit`, else `"<n> stock entries"`.
- Tests: Vitest, node env, `*.test.ts` under `src/`, `import { describe, it, expect } from 'vitest'`, alias `@` → `src`.
- Format money via `formatCurrency` from `@/lib/data` where money is shown (existing card already does).

---

### Task 1: Grouping helper

**Files:**
- Create: `src/lib/inventoryGroups.ts`
- Test: `src/lib/inventoryGroups.test.ts`

**Interfaces:**
- Consumes: `Product` from `@/lib/supabase`.
- Produces:
  - `export interface ProductGroup { key: string; name: string; products: Product[] }`
  - `export function groupByName(products: Product[]): ProductGroup[]`
  - `export function groupTotalLabel(products: Product[]): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/inventoryGroups.test.ts
import { describe, it, expect } from 'vitest'
import { groupByName, groupTotalLabel } from './inventoryGroups'
import type { Product } from '@/lib/supabase'

const p = (over: Partial<Product>): Product => ({
  id: 'x', user_id: 'u', name: 'Milo', cost_price: 10, selling_price: 20, quantity: 5,
  unit: 'tin', units_per_pack: 1, category: 'Beverages', low_stock_threshold: 5,
  created_at: '2026-06-06T00:00:00Z', ...over,
})

describe('groupByName', () => {
  it('groups same-named products (case/space-insensitive), keeping order', () => {
    const list = [
      p({ id: 'a', name: 'Test Milo 400g' }),
      p({ id: 'b', name: 'Dell' }),
      p({ id: 'c', name: ' test milo 400g ' }),
    ]
    const groups = groupByName(list)
    expect(groups.map((g) => g.products.map((x) => x.id))).toEqual([['a', 'c'], ['b']])
    expect(groups[0].name).toBe('Test Milo 400g') // first-seen original casing
    expect(groups[0].key).toBe('test milo 400g')
  })
})

describe('groupTotalLabel', () => {
  it('sums quantity with the shared unit', () => {
    expect(groupTotalLabel([p({ quantity: 70, unit: 'tin' }), p({ quantity: 11, unit: 'tin' })])).toBe('81 tin')
  })
  it('falls back to entry count when units differ', () => {
    expect(groupTotalLabel([p({ quantity: 70, unit: 'tin' }), p({ quantity: 11, unit: 'box' })])).toBe('2 stock entries')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/inventoryGroups.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/inventoryGroups.ts
import type { Product } from '@/lib/supabase'

export interface ProductGroup {
  key: string
  name: string
  products: Product[]
}

export function groupByName(products: Product[]): ProductGroup[] {
  const groups: ProductGroup[] = []
  const byKey = new Map<string, ProductGroup>()
  for (const product of products) {
    const key = product.name.trim().toLowerCase()
    let group = byKey.get(key)
    if (!group) {
      group = { key, name: product.name, products: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.products.push(product)
  }
  return groups
}

export function groupTotalLabel(products: Product[]): string {
  const unit = products[0]?.unit
  const sameUnit = products.every((p) => p.unit === unit)
  if (sameUnit && unit) {
    const total = products.reduce((sum, p) => sum + (p.quantity || 0), 0)
    return `${total} ${unit}`
  }
  return `${products.length} stock entries`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/inventoryGroups.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventoryGroups.ts src/lib/inventoryGroups.test.ts
git commit -m "feat(inventory): add product grouping helper"
```

---

### Task 2: Extract the per-product card into a function (behaviour-preserving)

**Files:**
- Modify: `src/pages/Inventory.tsx`

**Interfaces:**
- Produces (local, inside the `Inventory` component, so it closes over all existing state/handlers): `const renderProductCard = (product: Product, index: number, grouped = false): JSX.Element => ( ... )`.

**Goal of this task:** move the existing card markup into a function **without changing behaviour** — same output when called as `renderProductCard(product, index)`. Grouping is wired in Task 3.

- [ ] **Step 1: Read the current block**

Open `src/pages/Inventory.tsx`. The product list is currently:

```tsx
{filteredProducts.map((product, index) => (
  <motion.div
    key={product.id}
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.03 }}
    className="bg-light harsh-border rounded-sm overflow-hidden"
  >
    { /* …~300 lines: inline edit form, display body, restock form, action row… */ }
  </motion.div>
))}
```

(The `motion.div` opens at the line with `className="bg-light harsh-border rounded-sm overflow-hidden"` and closes at its matching `</motion.div>` just before `))}`.)

- [ ] **Step 2: Define `renderProductCard` above the returned JSX**

Just before the component's `return (` (after the handlers/`const` declarations), add a function that RETURNS the exact same `motion.div` block. Move the whole `motion.div … </motion.div>` markup verbatim into it, changing only:
- the parameter list and the outer element classes/wrapper (below),
- the product-name line (below).

```tsx
const renderProductCard = (product: Product, index: number, grouped = false) => (
  <motion.div
    key={product.id}
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.03 }}
    className={grouped ? 'overflow-hidden' : 'bg-light harsh-border rounded-sm overflow-hidden'}
  >
    { /* the SAME inner markup that was inside the map, moved here unchanged
         except the name line in Step 3 */ }
  </motion.div>
)
```

Keep every inner reference to `product` and `index` exactly as-is (all handlers like `inlineEditId === product.id`, `setHistoryProduct(product)`, `handleSaveRestock`, etc. keep working because this function is declared inside the component).

- [ ] **Step 3: Make the product-name line conditional on `!grouped`**

Find the display-body name line (currently `<p className="font-medium text-sm truncate">{product.name}</p>`). Wrap it so the name is hidden when grouped (the group header will show it):

```tsx
{!grouped && <p className="font-medium text-sm truncate">{product.name}</p>}
```

Leave the rest of the display body (qty · unit · price, cost, "Stocked: …", profit bar, actions) unchanged.

- [ ] **Step 4: Replace the map to call the function (still ungrouped)**

Change the list to call the function so behaviour is identical to before:

```tsx
{filteredProducts.map((product, index) => renderProductCard(product, index))}
```

- [ ] **Step 5: Typecheck + build (behaviour unchanged)**

Run: `npx tsc -b && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 6: Manual check**

Run `npm run dev`, open My Stock. The list looks and behaves exactly as before (cards, inline edit, restock, delete, history all work). No grouping yet.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Inventory.tsx
git commit -m "refactor(inventory): extract per-product card into renderProductCard"
```

---

### Task 3: Group duplicates into one card

**Files:**
- Modify: `src/pages/Inventory.tsx`

**Interfaces:**
- Consumes: `groupByName`, `groupTotalLabel`, `ProductGroup` (Task 1); `renderProductCard` (Task 2).

- [ ] **Step 1: Import the helper**

Add at the top of `src/pages/Inventory.tsx`:

```tsx
import { groupByName, groupTotalLabel } from '@/lib/inventoryGroups'
```

- [ ] **Step 2: Replace the flat map with grouped rendering**

Change:

```tsx
{filteredProducts.map((product, index) => renderProductCard(product, index))}
```

to:

```tsx
{groupByName(filteredProducts).map((group, gi) =>
  group.products.length === 1 ? (
    renderProductCard(group.products[0], gi)
  ) : (
    <motion.div
      key={group.key}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: gi * 0.03 }}
      className="bg-light harsh-border rounded-sm overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b-2 border-ink/10 bg-warm-gray/30">
        <p className="font-medium text-sm truncate mr-2">{group.name}</p>
        <span className="text-xs text-muted-text shrink-0">{groupTotalLabel(group.products)}</span>
      </div>
      <div className="divide-y divide-ink/10">
        {group.products.map((p, i) => renderProductCard(p, i, true))}
      </div>
    </motion.div>
  ),
)}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc -b && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, open My Stock:
1. Two products named "Test Milo 400g" (70 tin, 11 tin) now show as **one card**: header "Test Milo 400g — 81 tin", then two entries each with its own "Stocked: …" date, profit bar, and Re-stock/history/edit/delete.
2. Re-stock, inline-edit, delete, and the history clock each still operate on the correct individual entry.
3. A product with a unique name renders as a normal single card (unchanged).
4. Search and the "All stock / injection" filter still work; grouping reflects the filtered list.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass (existing + Task 1).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Inventory.tsx
git commit -m "feat(inventory): group same-named products into one card with dated entries"
```

---

## Self-Review

- **Spec coverage:** grouping by name (Task 1), group-only-when-2+ and single unchanged (Task 3), header total sum-or-count (Tasks 1,3), per-entry actions preserved (Task 2 keeps all handlers keyed by product.id), display-only/no data change (all tasks), one-file scope + helper (Tasks 1–3). ✓
- **Placeholder scan:** the only non-verbatim part is Task 2's move of the existing ~300-line card markup, which is explicitly a "move existing block unchanged except the two noted lines" refactor, with the exact wrapper/name diffs shown. No TBD/TODO. ✓
- **Type consistency:** `ProductGroup`, `groupByName`, `groupTotalLabel`, `renderProductCard(product, index, grouped)` names/shapes match across tasks. ✓

## Out of scope

- Merging/deduping products in the DB; preventing future duplicates at add/import; grouping by barcode.
