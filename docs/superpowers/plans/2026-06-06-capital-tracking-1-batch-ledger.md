# Capital Tracking — Plan 1: Inventory Batch Ledger + FIFO Attribution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each restock into a costed inventory *batch* and make every sale draw down batches FIFO, writing a per-sale audit trail so profit is batch-accurate and every unit is traceable to its purchase.

**Architecture:** Two new tables — `stock_batches` (a purchase line with `qty_remaining` + `unit_cost`, plus a nullable `injection_id` reserved for Plan 2) and `batch_consumptions` (one row per sale→batch draw, carrying its own profit). A pure FIFO allocator decides which batches a sale consumes; the existing `recordSale`/`recordSaleBatch`/`deleteSaleGroup` functions are extended to apply and reverse those draws. `products.quantity` stays as a denormalized cache equal to `SUM(qty_remaining)`. A one-time migration backfills an "opening batch" per existing product.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres + RLS), Vitest (added here for the pure-logic tests), existing offline `sync_queue`.

**Spec:** `docs/superpowers/specs/2026-06-06-capital-tracking-design.md` (sections: Data model → `stock_batches`/`batch_consumptions`; Attribution mechanics; Testing).

---

### Task 1: Add Vitest

**Files:**
- Modify: `package.json` (scripts + devDependencies)
- Create: `vitest.config.ts`
- Create: `src/lib/fifo.test.ts` (temporary smoke test, replaced in Task 2)

- [ ] **Step 1: Install Vitest**

Run:
```bash
npm install -D vitest@^2.1.8
```
Expected: adds `vitest` to devDependencies, no errors.

- [ ] **Step 2: Add the test script**

In `package.json`, add to the `"scripts"` object (after `"lint"`):
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Create a smoke test `src/lib/fifo.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('vitest wiring', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: PASS — 1 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/fifo.test.ts
git commit -m "chore: add vitest test runner"
```

---

### Task 2: FIFO allocator (pure function)

A pure function that, given a product's open batches (oldest first) and a quantity
to sell, returns how many units come from each batch and any leftover that exceeds
tracked stock. No DB, fully unit-testable. This is the heart of attribution.

**Files:**
- Create: `src/lib/fifo.ts`
- Test: `src/lib/fifo.test.ts` (replace smoke test)

- [ ] **Step 1: Write the failing tests** — replace the entire contents of `src/lib/fifo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { allocateFifo, type FifoBatch } from './fifo'

const batch = (id: string, qty_remaining: number, unit_cost: number): FifoBatch => ({
  id,
  qty_remaining,
  unit_cost,
  injection_id: null,
})

describe('allocateFifo', () => {
  it('draws entirely from a single batch when it has enough', () => {
    const res = allocateFifo([batch('b1', 10, 5)], 4, 8)
    expect(res.draws).toEqual([
      { batch_id: 'b1', injection_id: null, qty: 4, unit_cost: 5, unit_price: 8, profit: 12 },
    ])
    expect(res.untrackedQty).toBe(0)
  })

  it('spans multiple batches oldest-first', () => {
    const res = allocateFifo([batch('b1', 3, 5), batch('b2', 10, 6)], 5, 10)
    expect(res.draws).toEqual([
      { batch_id: 'b1', injection_id: null, qty: 3, unit_cost: 5, unit_price: 10, profit: 15 },
      { batch_id: 'b2', injection_id: null, qty: 2, unit_cost: 6, unit_price: 10, profit: 8 },
    ])
    expect(res.untrackedQty).toBe(0)
  })

  it('carries injection_id through onto each draw', () => {
    const b: FifoBatch = { id: 'b1', qty_remaining: 5, unit_cost: 4, injection_id: 'inj-1' }
    const res = allocateFifo([b], 2, 9)
    expect(res.draws[0].injection_id).toBe('inj-1')
  })

  it('reports leftover as untracked when stock runs out', () => {
    const res = allocateFifo([batch('b1', 2, 5)], 5, 10)
    expect(res.draws).toEqual([
      { batch_id: 'b1', injection_id: null, qty: 2, unit_cost: 5, unit_price: 10, profit: 10 },
    ])
    expect(res.untrackedQty).toBe(3)
  })

  it('returns all-untracked when there are no batches', () => {
    const res = allocateFifo([], 4, 10)
    expect(res.draws).toEqual([])
    expect(res.untrackedQty).toBe(4)
  })

  it('skips empty batches', () => {
    const res = allocateFifo([batch('b1', 0, 5), batch('b2', 4, 6)], 2, 10)
    expect(res.draws).toEqual([
      { batch_id: 'b2', injection_id: null, qty: 2, unit_cost: 6, unit_price: 10, profit: 8 },
    ])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find module `./fifo` / `allocateFifo is not a function`.

- [ ] **Step 3: Implement `src/lib/fifo.ts`**

```ts
// Pure FIFO allocation: decide which batches a sale draws from.
// Callers pass batches already sorted oldest-first (purchased_at ASC).

export interface FifoBatch {
  id: string
  qty_remaining: number
  unit_cost: number
  injection_id: string | null
}

export interface FifoDraw {
  batch_id: string
  injection_id: string | null
  qty: number
  unit_cost: number
  unit_price: number
  profit: number
}

export interface FifoResult {
  draws: FifoDraw[]
  /** Units that exceeded all tracked batch stock (oversell). */
  untrackedQty: number
}

export function allocateFifo(
  batches: FifoBatch[],
  quantity: number,
  unitPrice: number
): FifoResult {
  const draws: FifoDraw[] = []
  let remaining = quantity

  for (const b of batches) {
    if (remaining <= 0) break
    if (b.qty_remaining <= 0) continue
    const take = Math.min(b.qty_remaining, remaining)
    draws.push({
      batch_id: b.id,
      injection_id: b.injection_id,
      qty: take,
      unit_cost: b.unit_cost,
      unit_price: unitPrice,
      profit: round2((unitPrice - b.unit_cost) * take),
    })
    remaining -= take
  }

  return { draws, untrackedQty: remaining }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS — all `allocateFifo` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fifo.ts src/lib/fifo.test.ts
git commit -m "feat: pure FIFO batch allocator"
```

---

### Task 3: Database migration — batch tables + backfill

**Files:**
- Create: `src/db/migration_012_stock_batches.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration_012: stock batches + per-sale consumption ledger
-- A batch = one purchase line received into inventory, optionally funded by a
-- capital injection (injection_id is added nullable now; the capital_injections
-- table arrives in Plan 2). batch_consumptions records each sale->batch draw so
-- profit is batch-accurate and traceable. products.quantity stays a cache equal
-- to SUM(qty_remaining) of a product's open batches.

CREATE TABLE IF NOT EXISTS stock_batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  injection_id UUID,                         -- FK added in Plan 2 migration
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_purchased INTEGER NOT NULL,
  qty_remaining INTEGER NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL,
  total_cost DECIMAL(10,2) NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own batches"
  ON stock_batches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own batches"
  ON stock_batches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own batches"
  ON stock_batches FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own batches"
  ON stock_batches FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS batch_consumptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES stock_batches(id) ON DELETE SET NULL,   -- NULL = untracked oversell
  injection_id UUID,                                              -- denormalized for fast aggregation
  qty INTEGER NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  profit DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE batch_consumptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own consumptions"
  ON batch_consumptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own consumptions"
  ON batch_consumptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own consumptions"
  ON batch_consumptions FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_batches_product ON stock_batches(product_id, purchased_at);
CREATE INDEX IF NOT EXISTS idx_batches_injection ON stock_batches(injection_id);
CREATE INDEX IF NOT EXISTS idx_batches_user ON stock_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_consumptions_injection ON batch_consumptions(injection_id);
CREATE INDEX IF NOT EXISTS idx_consumptions_created ON batch_consumptions(created_at);
CREATE INDEX IF NOT EXISTS idx_consumptions_sale ON batch_consumptions(sale_id);

ALTER PUBLICATION supabase_realtime ADD TABLE stock_batches;

-- Backfill: one opening batch per existing product so FIFO has stock from day one.
INSERT INTO stock_batches (user_id, product_id, qty_purchased, qty_remaining, unit_cost, total_cost, purchased_at)
SELECT user_id, id, quantity, quantity, cost_price, cost_price * quantity, created_at
FROM products
WHERE quantity > 0
  AND NOT EXISTS (SELECT 1 FROM stock_batches b WHERE b.product_id = products.id);
```

- [ ] **Step 2: Apply it in the Supabase SQL editor**

Open the Supabase project SQL editor, paste the file contents, run. Then verify:
```sql
SELECT count(*) FROM stock_batches;          -- ~ number of products with quantity > 0
SELECT count(*) FROM batch_consumptions;     -- 0
```
Expected: `stock_batches` has one row per in-stock product; `batch_consumptions` empty.

- [ ] **Step 3: Sanity-check the cache invariant**

```sql
SELECT p.id, p.quantity, COALESCE(SUM(b.qty_remaining),0) AS batch_qty
FROM products p
LEFT JOIN stock_batches b ON b.product_id = p.id
GROUP BY p.id
HAVING p.quantity <> COALESCE(SUM(b.qty_remaining),0);
```
Expected: 0 rows (every product's cache matches its batches).

- [ ] **Step 4: Commit**

```bash
git add src/db/migration_012_stock_batches.sql
git commit -m "feat: stock_batches + batch_consumptions schema and backfill"
```

---

### Task 4: TypeScript types

**Files:**
- Modify: `src/lib/supabase.ts` (append after the `Customer` interface, before `BusinessProfile`)

- [ ] **Step 1: Add the interfaces** — insert into `src/lib/supabase.ts` immediately after the `Customer` interface block:

```ts
export interface StockBatch {
  id: string
  user_id: string
  injection_id: string | null
  product_id: string
  qty_purchased: number
  qty_remaining: number
  unit_cost: number
  total_cost: number
  purchased_at: string
}

export interface BatchConsumption {
  id: string
  user_id: string
  sale_id: string
  batch_id: string | null
  injection_id: string | null
  qty: number
  unit_cost: number
  unit_price: number
  profit: number
  created_at: string
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat: StockBatch + BatchConsumption types"
```

---

### Task 5: Batch service layer

Thin DB helpers around batches: receive a batch, read a product's open batches
(oldest-first), apply FIFO draws (write consumptions + decrement `qty_remaining`),
and reverse a sale's consumptions. The pure decision lives in `allocateFifo`
(Task 2); these functions only do I/O.

**Files:**
- Create: `src/services/batchApi.ts`

- [ ] **Step 1: Implement `src/services/batchApi.ts`**

```ts
import { supabase } from '@/lib/supabase'
import type { StockBatch } from '@/lib/supabase'
import { allocateFifo, type FifoBatch, type FifoResult } from '@/lib/fifo'

async function uidOrThrow(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const uid = data.user?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

// Create a batch when stock is received. injectionId links it to capital (Plan 2);
// pass null for an ordinary restock.
export async function receiveStock(params: {
  productId: string
  qty: number
  unitCost: number
  injectionId?: string | null
  purchasedAt?: string
}): Promise<StockBatch> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('stock_batches')
    .insert({
      user_id: uid,
      product_id: params.productId,
      injection_id: params.injectionId ?? null,
      qty_purchased: params.qty,
      qty_remaining: params.qty,
      unit_cost: params.unitCost,
      total_cost: Math.round(params.unitCost * params.qty * 100) / 100,
      purchased_at: params.purchasedAt ?? new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data as StockBatch
}

// A product's open batches, oldest first — the FIFO input.
export async function fetchOpenBatches(productId: string): Promise<FifoBatch[]> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('stock_batches')
    .select('id, qty_remaining, unit_cost, injection_id')
    .eq('user_id', uid)
    .eq('product_id', productId)
    .gt('qty_remaining', 0)
    .order('purchased_at', { ascending: true })
  if (error) throw error
  return (data as FifoBatch[]) || []
}

// Apply a sale's FIFO draws: write consumption rows and decrement batch stock.
// Returns the FifoResult so the caller can use the true profit (sum of draws).
export async function consumeForSale(params: {
  saleId: string
  productId: string
  quantity: number
  unitPrice: number
}): Promise<FifoResult> {
  const uid = await uidOrThrow()
  const batches = await fetchOpenBatches(params.productId)
  const result = allocateFifo(batches, params.quantity, params.unitPrice)

  // One consumption row per real batch draw...
  const rows = result.draws.map((d) => ({
    user_id: uid,
    sale_id: params.saleId,
    batch_id: d.batch_id,
    injection_id: d.injection_id,
    qty: d.qty,
    unit_cost: d.unit_cost,
    unit_price: d.unit_price,
    profit: d.profit,
  }))
  // ...plus an untracked row if the sale oversold tracked stock, so totals reconcile.
  if (result.untrackedQty > 0) {
    rows.push({
      user_id: uid,
      sale_id: params.saleId,
      batch_id: null,
      injection_id: null,
      qty: result.untrackedQty,
      unit_cost: 0,
      unit_price: params.unitPrice,
      profit: Math.round(params.unitPrice * result.untrackedQty * 100) / 100,
    })
  }
  if (rows.length > 0) {
    const { error } = await supabase.from('batch_consumptions').insert(rows)
    if (error) throw error
  }

  // Decrement qty_remaining per drawn batch.
  for (const d of result.draws) {
    const batch = batches.find((b) => b.id === d.batch_id)
    if (!batch) continue
    const { error } = await supabase
      .from('stock_batches')
      .update({ qty_remaining: batch.qty_remaining - d.qty })
      .eq('id', d.batch_id)
      .eq('user_id', uid)
    if (error) throw error
  }

  return result
}

// Reverse a deleted sale: restore each batch's qty_remaining, then drop the rows.
export async function reverseConsumptions(saleIds: string[]): Promise<void> {
  const uid = await uidOrThrow()
  if (saleIds.length === 0) return

  const { data: cons, error: readErr } = await supabase
    .from('batch_consumptions')
    .select('id, batch_id, qty')
    .in('sale_id', saleIds)
    .eq('user_id', uid)
  if (readErr) throw readErr
  if (!cons || cons.length === 0) return

  // Restore stock per batch (skip untracked rows where batch_id is null).
  const restoreByBatch = new Map<string, number>()
  for (const c of cons) {
    if (!c.batch_id) continue
    restoreByBatch.set(c.batch_id, (restoreByBatch.get(c.batch_id) || 0) + c.qty)
  }
  if (restoreByBatch.size > 0) {
    const { data: batches } = await supabase
      .from('stock_batches')
      .select('id, qty_remaining')
      .in('id', Array.from(restoreByBatch.keys()))
      .eq('user_id', uid)
    await Promise.all(
      (batches || []).map((b) =>
        supabase
          .from('stock_batches')
          .update({ qty_remaining: (b.qty_remaining || 0) + (restoreByBatch.get(b.id) || 0) })
          .eq('id', b.id)
          .eq('user_id', uid)
      )
    )
  }

  const { error: delErr } = await supabase
    .from('batch_consumptions')
    .delete()
    .in('sale_id', saleIds)
    .eq('user_id', uid)
  if (delErr) throw delErr
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/batchApi.ts
git commit -m "feat: batch service (receive, FIFO consume, reverse)"
```

---

### Task 6: Consume batches inside `recordSale` / `recordSaleBatch`

Wire FIFO consumption into the existing sale write-path and overwrite the sale's
`profit` with the batch-accurate sum.

**Files:**
- Modify: `src/services/supabaseApi.ts:96-133` (`recordSale`) and `:138-174` (`recordSaleBatch`)

- [ ] **Step 1: Add the import** at the top of `src/services/supabaseApi.ts` (after the existing imports):

```ts
import { consumeForSale, reverseConsumptions } from '@/services/batchApi'
```

- [ ] **Step 2: Replace the body of `recordSale`** (the function at line 96). Replace from `// Reduce stock — scoped to user's own product` through the `return saleData as Sale` line with:

```ts
  // Consume batches FIFO → writes consumption rows + decrements batch stock.
  // The sale's profit becomes the true sum of the draws (batch-accurate).
  if (productId) {
    const result = await consumeForSale({
      saleId: saleData.id,
      productId,
      quantity: quantitySold,
      unitPrice: sale.unit_price,
    })
    const trueProfit = result.draws.reduce((s, d) => s + d.profit, 0)
      + (result.untrackedQty > 0 ? Math.round(sale.unit_price * result.untrackedQty * 100) / 100 : 0)
    // Keep products.quantity cache in step with the batches.
    const { data: product } = await supabase
      .from('products').select('quantity').eq('id', productId).eq('user_id', uid).single()
    if (product) {
      await supabase
        .from('products')
        .update({ quantity: Math.max(0, (product.quantity || 0) - quantitySold) })
        .eq('id', productId).eq('user_id', uid)
    }
    if (trueProfit !== saleData.profit) {
      const { data: fixed } = await supabase
        .from('sales').update({ profit: trueProfit }).eq('id', saleData.id).eq('user_id', uid)
        .select().single()
      if (fixed) return fixed as Sale
    }
  }

  return saleData as Sale
```

- [ ] **Step 3: Replace the stock-reduction loop in `recordSaleBatch`** (line ~153). Replace the `for (const { productId, qty } of items) { ... }` block with:

```ts
  // Map each inserted sale row to its product so we can attribute its profit.
  const inserted = (saleData as Sale[]) || []
  for (const { productId, qty } of items) {
    if (!productId) continue
    const saleRow = inserted.find((s) => s.product_id === productId)
    if (!saleRow) continue

    const result = await consumeForSale({
      saleId: saleRow.id,
      productId,
      quantity: qty,
      unitPrice: saleRow.unit_price,
    })
    const trueProfit = result.draws.reduce((s, d) => s + d.profit, 0)
      + (result.untrackedQty > 0 ? Math.round(saleRow.unit_price * result.untrackedQty * 100) / 100 : 0)

    const { data: product } = await supabase
      .from('products').select('quantity').eq('id', productId).eq('user_id', uid).single()
    if (product) {
      await supabase
        .from('products')
        .update({ quantity: Math.max(0, (product.quantity || 0) - qty) })
        .eq('id', productId).eq('user_id', uid)
    }
    if (trueProfit !== saleRow.profit) {
      await supabase.from('sales').update({ profit: trueProfit }).eq('id', saleRow.id).eq('user_id', uid)
      saleRow.profit = trueProfit
    }
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual smoke (online)**

Run: `npm run dev`, log in, make a single-product sale of a product that has a backfilled batch. In the Supabase editor:
```sql
SELECT * FROM batch_consumptions ORDER BY created_at DESC LIMIT 5;
SELECT id, profit FROM sales ORDER BY created_at DESC LIMIT 1;
SELECT product_id, qty_remaining FROM stock_batches ORDER BY purchased_at;
```
Expected: a consumption row exists, the sale's `profit` equals the draw profit, the batch's `qty_remaining` dropped by the quantity sold.

- [ ] **Step 6: Commit**

```bash
git add src/services/supabaseApi.ts
git commit -m "feat: attribute sales to batches via FIFO on record"
```

---

### Task 7: Restore batches inside `deleteSaleGroup`

**Files:**
- Modify: `src/services/supabaseApi.ts:178-219` (`deleteSaleGroup`)

- [ ] **Step 1: Reverse consumptions before restoring the quantity cache.** In `deleteSaleGroup`, immediately after the existing successful-delete guard (the `if (!deleted || deleted.length === 0) { throw ... }` block) and before the `// Restore stock:` comment, insert:

```ts
  // Restore batch stock and drop this sale's consumption rows.
  await reverseConsumptions(ids)
```

(The existing block that adds `quantity` back onto `products` stays — it keeps the
cache equal to `SUM(qty_remaining)` after `reverseConsumptions` restores the batches.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke**

In the running app, delete the sale you made in Task 6 Step 5. Then:
```sql
SELECT count(*) FROM batch_consumptions;     -- back to its pre-sale count
SELECT product_id, qty_remaining FROM stock_batches ORDER BY purchased_at;
```
Expected: the consumption rows for that sale are gone and `qty_remaining` is restored.

- [ ] **Step 4: Commit**

```bash
git add src/services/supabaseApi.ts
git commit -m "feat: restore batches when a sale is deleted"
```

---

### Task 8: "Receive stock" captures unit cost → creates a batch

Today's restock (`Inventory.tsx` `handleSaveRestock`) only bumps `quantity`. Make it
capture the unit cost of the received stock and create a batch, so new stock is
costed correctly instead of inheriting the product's old cost.

**Files:**
- Modify: `src/pages/Inventory.tsx` (`handleRestock` at line ~103, `handleSaveRestock` at line ~110, and the restock UI around line ~390-410)

- [ ] **Step 1: Add a unit-cost field to restock state.** Near the other restock state (`const [editQty, setEditQty] = useState(0)`), add:

```ts
  const [restockUnitCost, setRestockUnitCost] = useState('')
```

- [ ] **Step 2: Default the cost when opening restock.** In `handleRestock`, after it sets the product being restocked, set the default cost to the product's current cost. Locate `handleRestock` (line ~103) and add inside it:

```ts
    const product = state.products.find((p) => p.id === productId)
    setRestockUnitCost(product ? String(product.cost_price) : '')
```

- [ ] **Step 3: Create a batch on save.** Replace the body of `handleSaveRestock` (line ~110) with:

```ts
  const handleSaveRestock = async () => {
    const product = state.products.find((p) => p.id === editingProduct)
    if (!product || editQty <= 0) return
    const unitCost = parseFloat(restockUnitCost) || product.cost_price

    const newQty = product.quantity + editQty
    // Optimistic cache bump.
    updateProduct(product.id, { quantity: newQty }).catch(() => {})
    // Create the costed batch (online; offline restock still bumps the cache above).
    try {
      const { receiveStock } = await import('@/services/batchApi')
      await receiveStock({ productId: product.id, qty: editQty, unitCost })
    } catch {
      /* offline or error — cache already bumped; batch can be reconciled later */
    }
    showToast(`Restocked ${editQty} ${product.unit}(s)`, 'success')
    setEditingProduct(null)
    setEditQty(0)
    setRestockUnitCost('')
  }
```

- [ ] **Step 4: Add the cost input to the restock UI.** In the restock controls block (the `+`/`−` quantity stepper around line ~390), add a unit-cost input just above the Save button:

```tsx
                      <input
                        type="number"
                        inputMode="decimal"
                        value={restockUnitCost}
                        onChange={(e) => setRestockUnitCost(e.target.value)}
                        placeholder="Unit cost (GHS)"
                        className="w-full harsh-border rounded-sm px-3 py-2 text-sm mb-2"
                      />
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc -b --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual smoke**

In the app, restock a product with a unit cost different from its current cost. Verify:
```sql
SELECT product_id, qty_purchased, unit_cost FROM stock_batches ORDER BY purchased_at DESC LIMIT 1;
```
Expected: a new batch with the entered `unit_cost`. Then sell that product past its
older stock and confirm the newer batch's cost is used for the later units.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Inventory.tsx
git commit -m "feat: receive stock as a costed batch on restock"
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** `stock_batches`/`batch_consumptions` tables (Task 3, 4); restock→batch (Task 8); sale→FIFO + batch-accurate profit (Task 2, 5, 6); backfill opening batch (Task 3); reversals (Task 7); oversell fallback to untracked row (Task 2, 5); offline cache bump preserved (Task 6, 8). Capital/risk/alerts/report are intentionally Plans 2–3.
- **Type consistency:** `allocateFifo` / `FifoBatch` / `FifoDraw` / `FifoResult` (Task 2) are consumed unchanged in `batchApi.ts` (Task 5); `StockBatch`/`BatchConsumption` (Task 4) match the migration columns (Task 3).
- **Offline note:** consumption requires reading current batches, so it runs online; offline restock/sale keep the existing optimistic `quantity` path and reconcile when back online. Full offline batch-consumption queueing is deferred (not required for correctness once online).
