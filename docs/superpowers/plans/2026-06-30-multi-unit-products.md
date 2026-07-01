# Multi-Unit Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a product be stocked/sold in a bigger "pack" unit (box) and a smaller "base" unit (sachet), converting automatically while keeping all stock and money math in base units.

**Architecture:** Base unit is canonical. `products.quantity`, stock batches, `sales.quantity`, and all prices stay per base unit — so FIFO, capital, and the cash ledger are untouched. Two new product columns (`pack_unit`, `units_per_pack`) describe the pack; two display-only sale columns (`sale_unit`, `sale_unit_qty`) record what unit a sale was entered in. A new pure module `src/lib/units.ts` does every conversion.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest (pure-logic tests only), Supabase (Postgres + JS client), Tailwind.

## Global Constraints

- Currency display via `formatCurrency` from `src/lib/data.ts` (Ghana Cedis).
- `units_per_pack` is an integer ≥ 1; default 1 means single-unit (legacy) product.
- All stored quantities/prices are **per base unit**; the pack is always derived.
- New DB columns must be nullable or have a default — no backfill, existing rows must keep working.
- Money rounding: 2 decimals via `Math.round(n*100)/100`.
- Supabase insert helpers spread the whole object (`.insert({ ...obj, user_id })`), so new fields persist automatically once they are on the type and populated by the caller — do **not** add column lists.
- Run `npm run build` (runs `tsc -b`) to typecheck; `npm test` runs Vitest.

---

### Task 1: Database migration + types

**Files:**
- Create: `src/db/migration_020_product_units.sql`
- Modify: `src/lib/supabase.ts:22-36` (`Product`), `src/lib/supabase.ts:38-53` (`Sale`)

**Interfaces:**
- Produces: `Product.pack_unit?: string | null`, `Product.units_per_pack: number`; `Sale.sale_unit?: string | null`, `Sale.sale_unit_qty?: number | null`. Every later task consumes these.

- [ ] **Step 1: Write the migration**

Create `src/db/migration_020_product_units.sql`:

```sql
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
```

- [ ] **Step 2: Add fields to the `Product` type**

In `src/lib/supabase.ts`, inside `interface Product`, after `unit: string` (line 30) add:

```ts
  pack_unit?: string | null
  units_per_pack: number
```

- [ ] **Step 3: Add fields to the `Sale` type**

In `src/lib/supabase.ts`, inside `interface Sale`, after `unit_price: number` (line 44) add:

```ts
  sale_unit?: string | null
  sale_unit_qty?: number | null
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: `units_per_pack` is now required on `Product`, so the build FAILS in `Inventory.tsx` (object literals at the add/edit handlers don't set it). That is expected — Task 3 fixes it. Confirm the only errors are "Property 'units_per_pack' is missing" in `src/pages/Inventory.tsx`. If any other file errors, note it.

- [ ] **Step 5: Commit**

```bash
git add src/db/migration_020_product_units.sql src/lib/supabase.ts
git commit -m "feat(db): add pack_unit/units_per_pack and sale_unit columns"
```

> Apply `migration_020_product_units.sql` in the Supabase SQL editor before testing live. The build error from Step 4 is resolved by Task 3; if running tasks out of order, temporarily make `units_per_pack` optional.

---

### Task 2: `units.ts` conversion module (TDD)

**Files:**
- Create: `src/lib/units.ts`
- Test: `src/lib/units.test.ts`

**Interfaces:**
- Consumes: `Product`, `Sale` from `src/lib/supabase.ts` (Task 1).
- Produces:
  - `type UnitKind = 'pack' | 'base'`
  - `isMultiUnit(p): boolean`
  - `factorOf(p): number`
  - `toBase(qty: number, kind: UnitKind, p): number`
  - `splitStock(baseQty: number, factor: number): { packs: number; loose: number }`
  - `priceFor(p, kind: UnitKind): number`
  - `costFor(p, kind: UnitKind): number`
  - `formatStock(p): string`
  - `saleDisplay(s): { qty: number; unitLabel: string | null; unitPrice: number; qtyLabel: string }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/units.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isMultiUnit, factorOf, toBase, splitStock,
  priceFor, costFor, formatStock, saleDisplay,
} from './units'

const indomie = {
  quantity: 95, unit: 'sachet', pack_unit: 'box', units_per_pack: 10,
  cost_price: 2.5, selling_price: 3,
}
const single = {
  quantity: 7, unit: 'pack', pack_unit: null, units_per_pack: 1,
  cost_price: 10, selling_price: 14,
}

describe('isMultiUnit / factorOf', () => {
  it('detects multi-unit', () => {
    expect(isMultiUnit(indomie)).toBe(true)
    expect(isMultiUnit(single)).toBe(false)
    expect(isMultiUnit({ pack_unit: 'box', units_per_pack: 1 })).toBe(false)
  })
  it('clamps a bad factor to 1', () => {
    expect(factorOf({ units_per_pack: 0 })).toBe(1)
    expect(factorOf({ units_per_pack: 2.5 })).toBe(1)
    expect(factorOf({ units_per_pack: 10 })).toBe(10)
  })
})

describe('toBase', () => {
  it('multiplies packs, passes base through', () => {
    expect(toBase(10, 'pack', indomie)).toBe(100)
    expect(toBase(4, 'base', indomie)).toBe(4)
    expect(toBase(3, 'pack', single)).toBe(3) // factor 1
  })
})

describe('splitStock', () => {
  it('splits whole packs and loose', () => {
    expect(splitStock(95, 10)).toEqual({ packs: 9, loose: 5 })
    expect(splitStock(100, 10)).toEqual({ packs: 10, loose: 0 })
    expect(splitStock(7, 10)).toEqual({ packs: 0, loose: 7 })
    expect(splitStock(0, 10)).toEqual({ packs: 0, loose: 0 })
  })
  it('treats bad factor as 1', () => {
    expect(splitStock(5, 0)).toEqual({ packs: 5, loose: 0 })
  })
})

describe('priceFor / costFor', () => {
  it('derives pack from base', () => {
    expect(priceFor(indomie, 'pack')).toBe(30)
    expect(priceFor(indomie, 'base')).toBe(3)
    expect(costFor(indomie, 'pack')).toBe(25)
    expect(costFor(single, 'pack')).toBe(10) // factor 1
  })
})

describe('formatStock', () => {
  it('mixes packs and loose for multi-unit', () => {
    expect(formatStock(indomie)).toBe('9 box 5 sachet (95 sachets)'.replace(' sachets', ' sachet'))
  })
  it('shows only loose when under one pack', () => {
    expect(formatStock({ ...indomie, quantity: 7 })).toBe('7 sachet (7 sachet)')
  })
  it('shows plain count for single-unit', () => {
    expect(formatStock(single)).toBe('7 pack')
  })
})

describe('saleDisplay', () => {
  it('uses sale_unit when present', () => {
    const d = saleDisplay({ quantity: 20, unit_price: 3, total: 60, sale_unit: 'box', sale_unit_qty: 2 })
    expect(d.qtyLabel).toBe('2 box')
    expect(d.unitPrice).toBe(30)
  })
  it('falls back to base quantity', () => {
    const d = saleDisplay({ quantity: 4, unit_price: 3, total: 12, sale_unit: null, sale_unit_qty: null })
    expect(d.qtyLabel).toBe('4')
    expect(d.unitPrice).toBe(3)
  })
})
```

> Note: `formatStock(indomie)` expected value is `'9 box 5 sachet (95 sachet)'` — the test above builds that string. Keep the parenthetical unit singular (`95 sachet`) for simplicity; do not pluralize.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- units`
Expected: FAIL — `Cannot find module './units'`.

- [ ] **Step 3: Implement `units.ts`**

Create `src/lib/units.ts`:

```ts
import type { Product, Sale } from './supabase'

export type UnitKind = 'pack' | 'base'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function factorOf(p: Pick<Product, 'units_per_pack'>): number {
  const f = p.units_per_pack ?? 1
  return Number.isInteger(f) && f >= 1 ? f : 1
}

export function isMultiUnit(
  p: Pick<Product, 'pack_unit' | 'units_per_pack'>
): boolean {
  return !!p.pack_unit && factorOf(p) > 1
}

export function toBase(
  qty: number,
  kind: UnitKind,
  p: Pick<Product, 'units_per_pack'>
): number {
  return kind === 'pack' ? qty * factorOf(p) : qty
}

export function splitStock(
  baseQty: number,
  factor: number
): { packs: number; loose: number } {
  const f = Number.isInteger(factor) && factor >= 1 ? factor : 1
  const packs = Math.floor(baseQty / f)
  return { packs, loose: baseQty - packs * f }
}

export function priceFor(
  p: Pick<Product, 'selling_price' | 'units_per_pack'>,
  kind: UnitKind
): number {
  return kind === 'pack' ? round2(p.selling_price * factorOf(p)) : p.selling_price
}

export function costFor(
  p: Pick<Product, 'cost_price' | 'units_per_pack'>,
  kind: UnitKind
): number {
  return kind === 'pack' ? round2(p.cost_price * factorOf(p)) : p.cost_price
}

export function formatStock(
  p: Pick<Product, 'quantity' | 'unit' | 'pack_unit' | 'units_per_pack'>
): string {
  const baseUnit = p.unit || 'pc'
  if (!isMultiUnit(p)) return `${p.quantity} ${baseUnit}`
  const { packs, loose } = splitStock(p.quantity, factorOf(p))
  const parts: string[] = []
  if (packs > 0) parts.push(`${packs} ${p.pack_unit}`)
  if (loose > 0 || packs === 0) parts.push(`${loose} ${baseUnit}`)
  return `${parts.join(' ')} (${p.quantity} ${baseUnit})`
}

export function saleDisplay(
  s: Pick<Sale, 'quantity' | 'unit_price' | 'total' | 'sale_unit' | 'sale_unit_qty'>
): { qty: number; unitLabel: string | null; unitPrice: number; qtyLabel: string } {
  const qty = s.sale_unit_qty != null ? s.sale_unit_qty : s.quantity
  const unitLabel = s.sale_unit ?? null
  const unitPrice = qty > 0 ? round2(s.total / qty) : s.unit_price
  return { qty, unitLabel, unitPrice, qtyLabel: unitLabel ? `${qty} ${unitLabel}` : `${qty}` }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- units`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/units.ts src/lib/units.test.ts
git commit -m "feat(units): pure pack/base conversion helpers"
```

---

### Task 3: Add/Edit product form + stock list display

**Files:**
- Modify: `src/pages/Inventory.tsx` — state `newProduct` (line 47-54), `handleAddProduct` (111-179), `handleOpenEdit`/`handleSaveEdit` (243-309), the add-product form JSX (around 780-815), the inline-edit form (around 455-475), and the stock-quantity line in the list (line 511).

**Interfaces:**
- Consumes: `formatStock`, `priceFor`, `toBase` from `src/lib/units.ts` (Task 2); `Product.pack_unit`/`units_per_pack` (Task 1).
- Produces: products created/edited with `pack_unit` + `units_per_pack` populated; this is what Tasks 4–6 read.

> This is a UI task; there is no React test harness in this repo. Verification is `npm run build` plus a manual checklist. Keep edits minimal and follow the existing class names.

- [ ] **Step 1: Extend the `newProduct` state**

In `src/pages/Inventory.tsx`, replace the `useState` at line 47-54 with:

```tsx
  const [newProduct, setNewProduct] = useState({
    name: '',
    cost_price: '',
    selling_price: '',
    quantity: '',
    unit: 'piece',
    category: 'Groceries',
    multiUnit: false,
    packUnit: 'box',
    unitsPerPack: '',
    qtyUnitKind: 'base' as 'pack' | 'base',
  })
```

- [ ] **Step 2: Convert quantity + set pack fields in `handleAddProduct`**

In `handleAddProduct`, after `const qty = parseInt(newProduct.quantity)` (line 119) add:

```tsx
    const factor = newProduct.multiUnit ? parseInt(newProduct.unitsPerPack) : 1
    if (newProduct.multiUnit && (!Number.isInteger(factor) || factor < 2 || !newProduct.packUnit.trim())) {
      showToast('For pack products set a pack name and units-per-pack of 2 or more', 'error')
      return
    }
    const baseQty = newProduct.qtyUnitKind === 'pack' ? qty * factor : qty
```

Then in the `addProduct({ ... })` call (line 133-145) change `quantity: qty` to `quantity: baseQty`, change `low_stock_threshold: Math.max(3, Math.floor(qty * 0.2))` to `Math.max(3, Math.floor(baseQty * 0.2))`, and add after `unit: newProduct.unit,`:

```tsx
        pack_unit: newProduct.multiUnit ? newProduct.packUnit.trim() : null,
        units_per_pack: factor,
```

Also in the supplier-credit debt block, the cost uses `costPrice * qty`; change to `costPrice * baseQty` (line 148) and `(${qty} ${newProduct.unit})` to `(${baseQty} ${newProduct.unit})` (line 156).

- [ ] **Step 3: Reset the new pack fields**

In the reset `setNewProduct({...})` at line 168, replace with:

```tsx
      setNewProduct({ name: '', cost_price: '', selling_price: '', quantity: '', unit: 'piece', category: 'Groceries', multiUnit: false, packUnit: 'box', unitsPerPack: '', qtyUnitKind: 'base' })
```

- [ ] **Step 4: Add the pack controls to the add-product form**

In the add-product modal JSX, immediately above the QUANTITY field block (the `<label>...{t('quantity')}` near line 788), insert:

```tsx
                    <div className="mb-3">
                      <label className="flex items-center gap-2 text-micro text-muted-text">
                        <input
                          type="checkbox"
                          checked={newProduct.multiUnit}
                          onChange={(e) => setNewProduct({ ...newProduct, multiUnit: e.target.checked, qtyUnitKind: e.target.checked ? newProduct.qtyUnitKind : 'base' })}
                        />
                        SOLD IN PACKS (e.g. box of sachets)
                      </label>
                      {newProduct.multiUnit && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={newProduct.packUnit}
                            onChange={(e) => setNewProduct({ ...newProduct, packUnit: e.target.value })}
                            placeholder="Pack name (box)"
                            className="h-12 px-3 bg-light harsh-border rounded-sm text-base font-body"
                          />
                          <input
                            type="number"
                            inputMode="numeric"
                            value={newProduct.unitsPerPack}
                            onChange={(e) => setNewProduct({ ...newProduct, unitsPerPack: e.target.value })}
                            placeholder={`${newProduct.unit}s per ${newProduct.packUnit || 'pack'}`}
                            className="h-12 px-3 bg-light harsh-border rounded-sm text-base font-body"
                          />
                        </div>
                      )}
                    </div>
```

- [ ] **Step 5: Add a unit toggle to the add-product QUANTITY field**

The QUANTITY input lives in a two-column row with the UNIT `<select>` (line 800). When `multiUnit` is on, the seller chooses whether the typed quantity is packs or base units. Replace the QUANTITY `<label>` text region to append a toggle. Directly under the quantity `<input>` (after line 794) add:

```tsx
                      {newProduct.multiUnit && (
                        <div className="mt-1.5 flex gap-1">
                          {(['pack', 'base'] as const).map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => setNewProduct({ ...newProduct, qtyUnitKind: k })}
                              className={`flex-1 py-1.5 text-micro uppercase rounded-sm border-2 border-ink ${newProduct.qtyUnitKind === k ? 'bg-ink text-white' : 'bg-light text-ink'}`}
                            >
                              {k === 'pack' ? (newProduct.packUnit || 'pack') : newProduct.unit}
                            </button>
                          ))}
                        </div>
                      )}
```

Below the SELLING PRICE input, add a derived pack-price hint:

```tsx
                      {newProduct.multiUnit && newProduct.selling_price && parseInt(newProduct.unitsPerPack) > 1 && (
                        <p className="mt-1 text-micro text-muted-text">
                          = {formatCurrency(parseFloat(newProduct.selling_price) * parseInt(newProduct.unitsPerPack))} / {newProduct.packUnit || 'pack'}
                        </p>
                      )}
```

- [ ] **Step 6: Carry pack fields through edit**

In `handleOpenEdit` (line 243) the inline-edit form only handles a few fields and does not expose pack settings; to keep scope tight, **preserve** the existing pack fields on save rather than editing them. In `handleSaveEdit`, the `updated` object (line 281-290) already spreads `...original`, so `pack_unit`/`units_per_pack` are preserved automatically. Confirm no change needed there. (Editing the factor itself is out of scope for this task; a product's pack setup is fixed at creation. Document this in the commit message.)

- [ ] **Step 7: Show mixed stock in the list**

At line 511, replace:

```tsx
                      <span className="text-xs text-muted-text">{product.quantity} {product.unit}(s)</span>
```

with:

```tsx
                      <span className="text-xs text-muted-text">{formatStock(product)}</span>
```

Add the import at the top of the file: `import { formatStock } from '@/lib/units'`.

- [ ] **Step 8: Typecheck + build**

Run: `npm run build`
Expected: PASS. The Task 1 "missing units_per_pack" error is now resolved because `handleAddProduct` sets it. If `handleSaveEdit`'s `updated` literal errors on `units_per_pack`, confirm it spreads `...original` (it does) — no literal needed.

- [ ] **Step 9: Manual verification**

Run `npm run dev`. In Inventory → Add Product: tick "Sold in packs", set box / 10, enter 10 in the quantity with the "box" toggle selected, sell price 3. Confirm the hint shows `= GH₵30.00 / box`. Save. The list row should read `10 box 0 sachet (100 sachet)` (or `10 box (100 sachet)` depending on loose=0 — expected `10 box 0 sachet ...`? No: loose 0 and packs>0 → only `10 box`). Confirm it reads `10 box (100 piece)`-style. Add a normal product without the toggle and confirm it still shows `7 piece`.

- [ ] **Step 10: Commit**

```bash
git add src/pages/Inventory.tsx
git commit -m "feat(inventory): multi-unit product entry + mixed stock display"
```

---

### Task 4: Restock with a pack/base unit toggle

**Files:**
- Modify: `src/pages/Inventory.tsx` — restock state, `handleSaveRestock` (189-241), and the restock UI (the block that renders when `editingProduct === product.id`).

**Interfaces:**
- Consumes: `toBase` from `src/lib/units.ts`; `isMultiUnit`.
- Produces: restock writes base-unit qty into `receiveStock` (unchanged API).

- [ ] **Step 1: Add restock unit state**

Near the other restock state (search for `editQty`), add:

```tsx
  const [restockUnitKind, setRestockUnitKind] = useState<'pack' | 'base'>('base')
```

- [ ] **Step 2: Convert restock qty to base in `handleSaveRestock`**

In `handleSaveRestock`, after `const unitCost = parseFloat(restockUnitCost) || product.cost_price` (line 199) add:

```tsx
    const baseAdd = restockUnitKind === 'pack' ? editQty * (product.units_per_pack ?? 1) : editQty
```

Then replace every `editQty` used for stock/cost math in this function with `baseAdd`:
- line 200 `const newQty = product.quantity + editQty` → `+ baseAdd`
- line 208 `receiveStock({ ..., qty: editQty, ... })` → `qty: baseAdd`
- line 214 `const cost = Math.round(unitCost * editQty * 100) / 100` → `* baseAdd *`
- line 222 description `(${editQty} ${product.unit})` → `(${baseAdd} ${product.unit})`

Leave the toast at line 232 showing the entered amount, but make it unit-aware:

```tsx
    showToast(restockUnpaid ? `Restocked — owe ${supplierName.trim()}` : `Restocked ${editQty} ${restockUnitKind === 'pack' ? (product.pack_unit || 'pack') : product.unit}(s)`, 'success')
```

- [ ] **Step 3: Reset the toggle**

In the reset block at the end of `handleSaveRestock` (after line 238) add `setRestockUnitKind('base')`. Also reset it in `handleRestock` (line 181-187) by adding `setRestockUnitKind('base')`.

- [ ] **Step 4: Add the toggle to the restock UI**

Find the restock input where `editQty` is set (search `setEditQty`). Above that quantity input, when the product is multi-unit, render the toggle:

```tsx
                {isMultiUnit(product) && (
                  <div className="flex gap-1 mb-2">
                    {(['pack', 'base'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setRestockUnitKind(k)}
                        className={`flex-1 py-1.5 text-micro uppercase rounded-sm border-2 border-ink ${restockUnitKind === k ? 'bg-ink text-white' : 'bg-light text-ink'}`}
                      >
                        {k === 'pack' ? (product.pack_unit || 'pack') : product.unit}
                      </button>
                    ))}
                  </div>
                )}
```

Add `isMultiUnit` to the existing units import: `import { formatStock, isMultiUnit } from '@/lib/units'`.

- [ ] **Step 5: Typecheck + build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Run `npm run dev`. Restock the Indomie product: pick "box", enter 2 → after save the list shows the stock grew by 20 base units (e.g. `12 box (120 piece)`). Restock a single-unit product (no toggle shown) and confirm it still adds raw units.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Inventory.tsx
git commit -m "feat(inventory): restock in pack or base units"
```

---

### Task 5: Sell in pack or base units

**Files:**
- Modify: `src/components/AddSaleSheet.tsx` — `CartItem` type (13-21), `addToCart` (75-101), `changeQty` (103-115), the cart-line JSX (369-433), and `handleConfirm`'s sale mapping (135-149).

**Interfaces:**
- Consumes: `priceFor`, `toBase`, `isMultiUnit`, `factorOf`, `splitStock`, `type UnitKind` from `src/lib/units.ts`.
- Produces: each `Sale` row written with base `quantity`, per-base `unit_price`, plus display `sale_unit` + `sale_unit_qty`; `addSaleBatch` items use base qty.

- [ ] **Step 1: Extend `CartItem`**

Replace the `CartItem` type (line 13-21) with:

```tsx
type CartItem = {
  product_id: string
  name: string
  category: string
  unit_price: number      // per base unit (canonical)
  cost_price: number      // per base unit
  quantity: number        // in the chosen unitKind
  stock: number           // base units in stock
  unitKind: 'pack' | 'base'
  pack_unit: string | null
  units_per_pack: number
}
```

- [ ] **Step 2: Set unit fields when adding to cart**

In `addToCart` (line 87-98) replace the pushed object with:

```tsx
      return [
        ...prev,
        {
          product_id: p.id,
          name: p.name,
          category: p.category,
          unit_price: p.selling_price,
          cost_price: p.cost_price,
          quantity: Math.min(1, p.quantity),
          stock: p.quantity,
          unitKind: 'base' as const,
          pack_unit: p.pack_unit ?? null,
          units_per_pack: p.units_per_pack ?? 1,
        },
      ]
```

- [ ] **Step 3: Add a max-in-chosen-unit helper and cap on quantity**

At the top of the component body (after the `useStore` line ~24) add:

```tsx
  const maxInUnit = (i: CartItem) =>
    i.unitKind === 'pack' ? Math.floor(i.stock / i.units_per_pack) : i.stock
```

Update `changeQty` (line 103-115) to cap against `maxInUnit`:

```tsx
  const changeQty = (productId: string, delta: number) => {
    setCart((prev) => {
      const item = prev.find((i) => i.product_id === productId)
      if (!item) return prev
      const max = maxInUnit(item)
      if (delta > 0 && item.quantity + delta > max) {
        showToast(`Only ${max} ${item.unitKind === 'pack' ? (item.pack_unit || 'pack') : 'left'} in stock`, 'error')
      }
      return prev.map((i) =>
        i.product_id === productId
          ? { ...i, quantity: Math.max(1, Math.min(max, i.quantity + delta)) }
          : i
      )
    })
  }
```

- [ ] **Step 4: Make totals account for pack pricing**

The cart math at lines 38-49 uses `i.unit_price * i.quantity`, but `unit_price` is per base while `quantity` may be packs. Add a per-line effective price. Replace the three `useMemo` blocks (38-49) with:

```tsx
  const linePrice = (i: CartItem) =>
    i.unitKind === 'pack' ? i.unit_price * i.units_per_pack : i.unit_price
  const lineCost = (i: CartItem) =>
    i.unitKind === 'pack' ? i.cost_price * i.units_per_pack : i.cost_price

  const total = useMemo(
    () => cart.reduce((sum, i) => sum + linePrice(i) * i.quantity, 0),
    [cart]
  )
  const profit = useMemo(
    () => cart.reduce((sum, i) => sum + (linePrice(i) - lineCost(i)) * i.quantity, 0),
    [cart]
  )
  const itemCount = useMemo(
    () => cart.reduce((sum, i) => sum + i.quantity, 0),
    [cart]
  )
```

- [ ] **Step 5: Add the Box/Base toggle and use `linePrice` in the cart line**

In the cart-line JSX, the price text at line 374-376 uses `i.unit_price`; change to `linePrice(i)`:

```tsx
                              <p className="text-xs text-muted-text">
                                {formatCurrency(linePrice(i))} · {formatCurrency(linePrice(i) * i.quantity)}
                              </p>
```

Then, directly under the product name `<p>` (line 373), add the toggle for multi-unit lines:

```tsx
                              {i.units_per_pack > 1 && i.pack_unit && (
                                <div className="flex gap-1 mt-1">
                                  {(['pack', 'base'] as const).map((k) => {
                                    const disabled = k === 'pack' && i.stock < i.units_per_pack
                                    return (
                                      <button
                                        key={k}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() =>
                                          setCart((prev) =>
                                            prev.map((it) =>
                                              it.product_id === i.product_id
                                                ? { ...it, unitKind: k, quantity: 1 }
                                                : it
                                            )
                                          )
                                        }
                                        className={`px-2 py-0.5 text-micro uppercase rounded-sm border border-ink disabled:opacity-30 ${i.unitKind === k ? 'bg-ink text-white' : 'bg-light text-ink'}`}
                                      >
                                        {k === 'pack' ? i.pack_unit : i.unit_price ? 'unit' : 'unit'}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
```

> The base-unit button label: the `CartItem` does not carry the base unit name. Add `unit: string` to `CartItem`, set `unit: p.unit` in `addToCart` (Step 2), and use `i.unit` as the base button label instead of the `'unit'` placeholder above. Make that addition now.

The numeric `<input>` and `changeQty` already operate in the chosen unit; update the inline `onChange` cap (line 394-400) to use `maxInUnit(i)`:

```tsx
                                  if (!isNaN(val)) {
                                    const max = maxInUnit(i)
                                    if (val > max) {
                                      showToast(`Only ${max} in stock`, 'error')
                                    }
                                    setCart((prev) =>
                                      prev.map((item) =>
                                        item.product_id === i.product_id
                                          ? { ...item, quantity: Math.min(maxInUnit(item), Math.max(0, val)) }
                                          : item
                                      )
                                    )
                                  }
```

- [ ] **Step 6: Write base qty + display unit into the sale rows**

In `handleConfirm`, replace the `sales` and `items` mapping (line 135-149) with:

```tsx
      const sales = cart.map((i) => {
        const baseQty = i.unitKind === 'pack' ? i.quantity * i.units_per_pack : i.quantity
        const lineTotal = linePrice(i) * i.quantity
        return {
          id: uid(),
          product_id: i.product_id,
          product_name: i.name,
          quantity: baseQty,
          unit_price: i.unit_price, // per base unit; unit_price * baseQty === lineTotal
          total: lineTotal,
          profit: (linePrice(i) - lineCost(i)) * i.quantity,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          payment_method: paymentMethod,
          sale_group_id: groupId,
          sale_unit: i.unitKind === 'pack' ? i.pack_unit : null,
          sale_unit_qty: i.unitKind === 'pack' ? i.quantity : null,
          created_at: createdAt,
        }
      })
      const items = cart.map((i) => ({
        productId: i.product_id,
        qty: i.unitKind === 'pack' ? i.quantity * i.units_per_pack : i.quantity,
      }))
```

Also update the receipt-notification `items` map (line 220) to use `linePrice`:

```tsx
            items: cart.map((i) => ({ name: i.name, qty: i.quantity, price: linePrice(i), total: linePrice(i) * i.quantity })),
```

- [ ] **Step 7: Add the units import**

At the top of `AddSaleSheet.tsx` add:

```tsx
import { /* (linePrice helpers are local) */ } from '@/lib/units'
```

> Actually the helpers used (`linePrice`, `lineCost`, `maxInUnit`) are defined locally and need no import. Only add an import if you choose to reuse `priceFor`. Skip the import line if unused to avoid a lint error.

- [ ] **Step 8: Typecheck + build**

Run: `npm run build`
Expected: PASS. Confirm `CartItem` has the `unit` field (Step 5 note) and every cart literal sets it.

- [ ] **Step 9: Manual verification**

Run `npm run dev`. Sell Indomie: toggle the line to "box", qty 2 → total `GH₵60.00`, profit reflects pack margin. Confirm sale records and Inventory stock drops by 20 base units. Sell again in "sachet", qty 3 → total `GH₵9.00`, stock drops by 3. With stock below one box, confirm the "box" toggle is disabled. Sell a single-unit product and confirm no toggle and unchanged behavior.

- [ ] **Step 10: Commit**

```bash
git add src/components/AddSaleSheet.tsx
git commit -m "feat(sales): sell in pack or base units, deduct base stock"
```

---

### Task 6: Show the sold unit on receipts and reports

**Files:**
- Modify: `src/components/ReceiptModal.tsx:29-30` (text item lines) and the canvas item loop (around line 107); `src/pages/Reports.tsx:212` (sale line) and the per-product aggregation (58-69).

**Interfaces:**
- Consumes: `saleDisplay` from `src/lib/units.ts`.

- [ ] **Step 1: Use `saleDisplay` in the receipt text lines**

In `src/components/ReceiptModal.tsx`, add `import { saleDisplay } from '@/lib/units'`. Replace lines 29-30:

```tsx
  const itemLines = sales
    .map((s) => {
      const d = saleDisplay(s)
      return `${s.product_name}  ${d.qtyLabel} x ${formatCurrency(d.unitPrice)} = ${formatCurrency(s.total)}`
    })
```

- [ ] **Step 2: Use `saleDisplay` in the canvas loop**

In the `sales.forEach((s, idx) => {...})` block (around line 107) find where the quantity/price string is drawn and replace the per-line text with the same `saleDisplay`-derived `qtyLabel`/`unitPrice`. Read the block first; mirror the format used in Step 1 (`${d.qtyLabel} x ${formatCurrency(d.unitPrice)}`).

- [ ] **Step 3: Show the sold unit in the Reports sale list**

In `src/pages/Reports.tsx`, add `import { saleDisplay } from '@/lib/units'`. Replace line 212:

```tsx
                          <div className="truncate flex-1 mr-2 text-ink/80">{sale.product_name} <span className="text-muted-text ml-1">x{saleDisplay(sale).qtyLabel}</span></div>
```

- [ ] **Step 4: Leave per-product aggregation in base units**

The aggregation at lines 58-69 sums `sale.quantity` (base) — keep it; mixing base and pack counts there would be wrong. Add no change; just confirm it still reads `sale.quantity`.

- [ ] **Step 5: Typecheck + build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Make a pack sale (2 boxes) and open its receipt: the line reads `Indomie  2 box x GH₵30.00 = GH₵60.00`. A base sale reads `... 4 x GH₵3.00 = GH₵12.00`. Reports recent-sales shows `Indomie x2 box`. Download the receipt image/PDF and confirm the same text.

- [ ] **Step 7: Commit**

```bash
git add src/components/ReceiptModal.tsx src/pages/Reports.tsx
git commit -m "feat(display): show sold unit on receipts and reports"
```

---

## Self-Review

**Spec coverage:**
- Store in base units → Tasks 1–2 (columns + helpers), enforced in 3–5.
- Restock in bigger unit → Task 4.
- Sell sub-pack and whole-pack with correct deduction → Task 5.
- Mixed stock display → Task 3 (`formatStock`).
- Display-only sale unit columns → Task 1 + Task 5 (write) + Task 6 (read).
- Auto-derived pack price → `priceFor` (Task 2), used in Tasks 3 & 5.
- Backward compatibility / opt-in → default `units_per_pack=1`, toggles hidden when not multi-unit (Tasks 3–5).
- FIFO/capital/ledger untouched → no batchApi/fifo edits in any task. ✓

**Placeholder scan:** Task 5 Step 5 originally had a `'unit'` placeholder label; the inline note resolves it by adding `CartItem.unit` and using `i.unit`. Task 6 Step 2 says "read the block first" because the canvas draw code wasn't quoted — acceptable (it points at the exact loop and the exact format string to apply). No TODO/TBD remain.

**Type consistency:** `UnitKind = 'pack' | 'base'` used everywhere. `units_per_pack` (number, default 1), `pack_unit` (string|null), `sale_unit` (string|null), `sale_unit_qty` (number|null) match across types, helpers, form, cart, and display. `saleDisplay`/`formatStock`/`priceFor`/`toBase`/`splitStock`/`isMultiUnit`/`factorOf` names are identical in definition (Task 2) and use (Tasks 3–6).
