# Bulk Stock Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user load many products at once by filling a downloadable CSV template or photographing a stock list, review the parsed rows in an editable table, then bulk-save them as opening stock (no cash impact) or a purchase.

**Architecture:** Two intake tabs (Template, Photo) feed the same editable review table. CSV is parsed by a small hand-rolled parser; the photo is read by Claude vision in a JWT-gated Supabase edge function. On confirm, a single `saveBulkRows` orchestrator writes each row through the existing store (`addProduct` for new, `updateProduct` + `receiveStock` for restock), honoring an opening-stock vs purchase cash mode enabled by a new `opening` flag on `receiveStock`/`addProduct`.

**Tech Stack:** React 18 + TypeScript + Vite, Vitest (node env), Supabase (Deno Edge Functions), Anthropic Claude vision (Haiku).

## Global Constraints

- Currency is Ghana Cedis; format money via `formatCurrency` from `@/lib/data`.
- All DB writes go through existing store functions (`addProduct`, `updateProduct`, `receiveStock`, `addDebt`). No new direct Supabase writes from bulk-import client code.
- Opening-stock intake must NOT post a cash movement or create a supplier debt.
- Edge functions authenticate the caller by validating `userJwt` via GoTrue (send anon key as `Authorization: Bearer`, user token in body), exactly like `supabase/functions/serwaa-agent`. Secrets (`ANTHROPIC_API_KEY`) live only in Supabase.
- LLM/vision model is `claude-haiku-4-5-20251001`.
- Tests: Vitest, node environment, files `*.test.ts` under `src/`, `import { describe, it, expect } from 'vitest'`, path alias `@` → `src`.
- Reuse existing helpers; do not re-implement CSV escaping/download or product matching where one exists (`export.ts` `download`, `@/lib/agent/match` `matchProduct`).
- Category options: `['Groceries', 'Dairy', 'Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles', 'Bakery']`. Default category `Groceries`, default unit `piece`.

---

## Phase 1 — CSV template import

### Task 1: `opening` flag on receiveStock / addProduct

**Files:**
- Modify: `src/services/batchApi.ts` (add `shouldPostStockCash`, use it; add `opening` param)
- Modify: `src/lib/store.tsx` (`addProduct` opts + pass-through)
- Test: `src/services/batchApi.test.ts`

**Interfaces:**
- Produces: `export function shouldPostStockCash(o: { unpaid?: boolean; opening?: boolean; totalCost: number }): boolean`
- `receiveStock` params gain `opening?: boolean`.
- `addProduct` opts become `{ account?: CashAccount; unpaid?: boolean; opening?: boolean }` and pass `opening` to `receiveStock`.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/batchApi.test.ts
import { describe, it, expect } from 'vitest'
import { shouldPostStockCash } from './batchApi'

describe('shouldPostStockCash', () => {
  it('posts cash for a normal paid purchase', () => {
    expect(shouldPostStockCash({ totalCost: 100 })).toBe(true)
  })
  it('does not post for supplier credit', () => {
    expect(shouldPostStockCash({ unpaid: true, totalCost: 100 })).toBe(false)
  })
  it('does not post for opening stock', () => {
    expect(shouldPostStockCash({ opening: true, totalCost: 100 })).toBe(false)
  })
  it('does not post when there is no cost', () => {
    expect(shouldPostStockCash({ totalCost: 0 })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/batchApi.test.ts`
Expected: FAIL — `shouldPostStockCash` not exported.

- [ ] **Step 3: Implement in `batchApi.ts`**

Add the helper near the top (after imports):

```ts
// Whether a received stock batch should post a cash outflow. Opening stock
// (recording inventory already owned) and supplier credit (unpaid) do not.
export function shouldPostStockCash(o: { unpaid?: boolean; opening?: boolean; totalCost: number }): boolean {
  return !o.unpaid && !o.opening && o.totalCost > 0
}
```

Add `opening?: boolean` to the `receiveStock` params type:

```ts
export async function receiveStock(params: {
  productId: string
  qty: number
  unitCost: number
  injectionId?: string | null
  purchasedAt?: string
  account?: import('@/lib/cashBalances').CashAccount
  unpaid?: boolean
  opening?: boolean
}): Promise<StockBatch> {
```

Replace the cash-posting guard:

```ts
  if (shouldPostStockCash({ unpaid: params.unpaid, opening: params.opening, totalCost: batch.total_cost })) {
```

- [ ] **Step 4: Thread `opening` through `addProduct` in `store.tsx`**

Change the `addProduct` signature's `opts` type (both the context type near line 235 and the `useCallback` near line 559) from `{ account?: CashAccount; unpaid?: boolean }` to `{ account?: CashAccount; unpaid?: boolean; opening?: boolean }`, and pass it in the `receiveStock` call inside `addProduct`:

```ts
          await receiveStock({
            productId: inserted.id,
            qty: inserted.quantity,
            unitCost: inserted.cost_price,
            injectionId: injectionId || null,
            purchasedAt: inserted.created_at,
            account: opts?.account ?? 'cash',
            unpaid: opts?.unpaid ?? false,
            opening: opts?.opening ?? false,
          })
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run src/services/batchApi.test.ts && npx tsc -b`
Expected: PASS (4 tests); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/batchApi.ts src/services/batchApi.test.ts src/lib/store.tsx
git commit -m "feat(bulk): add opening-stock flag that skips cash posting on receiveStock"
```

---

### Task 2: CSV parser

**Files:**
- Create: `src/lib/bulkImport/csv.ts`
- Test: `src/lib/bulkImport/csv.test.ts`

**Interfaces:**
- Produces:
  - `export function parseCSV(text: string): string[][]` — RFC-4180 subset (comma-separated, `"`-quoted fields, `""` escaped quote inside quotes, CRLF/LF, strips leading BOM, skips fully-blank lines).
  - `export function toCSVRow(cells: (string | number | null)[]): string` — quotes a cell containing a comma, quote, or newline.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bulkImport/csv.test.ts
import { describe, it, expect } from 'vitest'
import { parseCSV, toCSVRow } from './csv'

describe('parseCSV', () => {
  it('parses simple rows', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  it('parses a quoted field containing a comma', () => {
    expect(parseCSV('name,qty\n"Pomo, Gino tomato mix 200g",5')).toEqual([
      ['name', 'qty'],
      ['Pomo, Gino tomato mix 200g', '5'],
    ])
  })
  it('parses escaped quotes and CRLF, strips BOM, skips blank lines', () => {
    expect(parseCSV('﻿a,b\r\n"say ""hi""",2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['say "hi"', '2'],
    ])
  })
})

describe('toCSVRow', () => {
  it('quotes only when needed and escapes quotes', () => {
    expect(toCSVRow(['plain', 'has,comma', 'has"quote', 5, null])).toBe('plain,"has,comma","has""quote",5,')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bulkImport/csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/bulkImport/csv.ts
// A small RFC-4180-subset CSV parser/serializer. No dependency.
export function parseCSV(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    // Skip fully-blank lines (one empty field).
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }
  while (i < clean.length) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      pushField()
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      pushField()
      pushRow()
      i++
      continue
    }
    field += ch
    i++
  }
  // Flush the last field/row (file may not end with a newline).
  pushField()
  pushRow()
  return rows
}

export function toCSVRow(cells: (string | number | null)[]): string {
  return cells
    .map((val) => {
      if (val === null || val === undefined) return ''
      const s = String(val)
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    })
    .join(',')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bulkImport/csv.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bulkImport/csv.ts src/lib/bulkImport/csv.test.ts
git commit -m "feat(bulk): add CSV parser/serializer"
```

---

### Task 3: Template builder + download

**Files:**
- Modify: `src/lib/export.ts` (export the private `download` helper)
- Create: `src/lib/bulkImport/template.ts`
- Test: `src/lib/bulkImport/template.test.ts`

**Interfaces:**
- Consumes: `toCSVRow` (Task 2), `download` from `@/lib/export`.
- Produces:
  - `export const TEMPLATE_HEADERS: string[]`
  - `export function buildTemplateCSV(): string`
  - `export function downloadTemplate(): void`

- [ ] **Step 1: Export `download` from `export.ts`**

In `src/lib/export.ts`, change `function download(` to `export function download(`. No other change.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/bulkImport/template.test.ts
import { describe, it, expect } from 'vitest'
import { TEMPLATE_HEADERS, buildTemplateCSV } from './template'

describe('buildTemplateCSV', () => {
  it('has the documented headers in order', () => {
    expect(TEMPLATE_HEADERS).toEqual([
      'Name', 'Quantity', 'Unit', 'Cost Price', 'Selling Price',
      'Category', 'Pack Unit', 'Units Per Pack', 'Low Stock Threshold',
    ])
  })
  it('emits a header row and one example row', () => {
    const lines = buildTemplateCSV().split('\n')
    expect(lines[0]).toBe('Name,Quantity,Unit,Cost Price,Selling Price,Category,Pack Unit,Units Per Pack,Low Stock Threshold')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Indomie')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/bulkImport/template.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/bulkImport/template.ts
import { download } from '@/lib/export'
import { toCSVRow } from './csv'

export const TEMPLATE_HEADERS = [
  'Name', 'Quantity', 'Unit', 'Cost Price', 'Selling Price',
  'Category', 'Pack Unit', 'Units Per Pack', 'Low Stock Threshold',
]

const EXAMPLE_ROW = ['Indomie', 24, 'sachet', 2.5, 3, 'Noodles', 'box', 40, 5]

export function buildTemplateCSV(): string {
  return [toCSVRow(TEMPLATE_HEADERS), toCSVRow(EXAMPLE_ROW)].join('\n')
}

export function downloadTemplate(): void {
  download('serwaabroni-stock-template.csv', '﻿' + buildTemplateCSV())
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/bulkImport/template.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/export.ts src/lib/bulkImport/template.ts src/lib/bulkImport/template.test.ts
git commit -m "feat(bulk): add downloadable CSV stock template"
```

---

### Task 4: Row model, normalization, validation

**Files:**
- Create: `src/lib/bulkImport/rows.ts`
- Test: `src/lib/bulkImport/rows.test.ts`

**Interfaces:**
- Consumes: `matchProduct` from `@/lib/agent/match`; `Product` from `@/lib/supabase`; `TEMPLATE_HEADERS` from `./template`.
- Produces:
  - `export const UNITS: string[]` and `export const CATEGORIES: string[]`
  - `export interface DraftRow { id: string; name: string; quantity: number; unit: string; costPrice: number; sellPrice: number; category: string; packUnit: string | null; unitsPerPack: number; lowStockThreshold: number | null }`
  - `export interface RawRow { name?: string; quantity?: number; unit?: string; cost_price?: number; selling_price?: number; category?: string; pack_unit?: string; units_per_pack?: number; low_stock_threshold?: number }`
  - `export function rowsFromMatrix(matrix: string[][]): RawRow[]` — maps a parsed CSV matrix (first row = headers matched case-insensitively against `TEMPLATE_HEADERS`) to `RawRow[]`.
  - `export function normalizeRow(raw: RawRow): DraftRow` — coerce/default (`unit` `piece`, `category` `Groceries`, `unitsPerPack` 1, generates `id`).
  - `export function rowStatus(row: DraftRow, products: Product[]): { status: 'new' | 'restock' | 'invalid'; matchId: string | null; errors: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bulkImport/rows.test.ts
import { describe, it, expect } from 'vitest'
import { rowsFromMatrix, normalizeRow, rowStatus } from './rows'
import type { Product } from '@/lib/supabase'

const prod = (name: string, id = name): Product => ({
  id, user_id: 'u', name, cost_price: 1, selling_price: 2, quantity: 4,
  unit: 'piece', units_per_pack: 1, category: 'Groceries', low_stock_threshold: 5,
  created_at: '2026-07-01T00:00:00Z',
})

describe('rowsFromMatrix', () => {
  it('maps headers (any case/order) to RawRow fields', () => {
    const matrix = [
      ['Name', 'Cost Price', 'Selling Price', 'Quantity'],
      ['Milo', '4', '8', '10'],
    ]
    expect(rowsFromMatrix(matrix)).toEqual([
      { name: 'Milo', cost_price: 4, selling_price: 8, quantity: 10 },
    ])
  })
})

describe('normalizeRow', () => {
  it('applies defaults', () => {
    const r = normalizeRow({ name: 'Milo', cost_price: 4, selling_price: 8, quantity: 10 })
    expect(r).toMatchObject({ name: 'Milo', unit: 'piece', category: 'Groceries', unitsPerPack: 1 })
    expect(r.id).toBeTruthy()
  })
})

describe('rowStatus', () => {
  const products = [prod('Indomie'), prod('Milo')]
  it('flags invalid when cost is missing/zero', () => {
    const r = normalizeRow({ name: 'Rice', cost_price: 0, selling_price: 5, quantity: 2 })
    expect(rowStatus(r, products).status).toBe('invalid')
  })
  it('marks a matched name as restock', () => {
    const r = normalizeRow({ name: 'indomie', cost_price: 2, selling_price: 3, quantity: 5 })
    const s = rowStatus(r, products)
    expect(s.status).toBe('restock')
    expect(s.matchId).toBe('Indomie')
  })
  it('marks an unmatched valid row as new', () => {
    const r = normalizeRow({ name: 'Rice 5kg', cost_price: 40, selling_price: 55, quantity: 3 })
    expect(rowStatus(r, products).status).toBe('new')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bulkImport/rows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/bulkImport/rows.ts
import type { Product } from '@/lib/supabase'
import { matchProduct } from '@/lib/agent/match'
import { uid } from '@/lib/data'
import { TEMPLATE_HEADERS } from './template'

export const CATEGORIES = ['Groceries', 'Dairy', 'Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles', 'Bakery']
export const UNITS = ['piece', 'sachet', 'bag', 'tin', 'bottle', 'box', 'pack', 'kg']

export interface RawRow {
  name?: string
  quantity?: number
  unit?: string
  cost_price?: number
  selling_price?: number
  category?: string
  pack_unit?: string
  units_per_pack?: number
  low_stock_threshold?: number
}

export interface DraftRow {
  id: string
  name: string
  quantity: number
  unit: string
  costPrice: number
  sellPrice: number
  category: string
  packUnit: string | null
  unitsPerPack: number
  lowStockThreshold: number | null
}

// Header label → RawRow key.
const HEADER_KEY: Record<string, keyof RawRow> = {
  'name': 'name',
  'quantity': 'quantity',
  'unit': 'unit',
  'cost price': 'cost_price',
  'selling price': 'selling_price',
  'category': 'category',
  'pack unit': 'pack_unit',
  'units per pack': 'units_per_pack',
  'low stock threshold': 'low_stock_threshold',
}

const NUMERIC: Set<keyof RawRow> = new Set([
  'quantity', 'cost_price', 'selling_price', 'units_per_pack', 'low_stock_threshold',
])

export function rowsFromMatrix(matrix: string[][]): RawRow[] {
  if (matrix.length < 2) return []
  const headers = matrix[0].map((h) => HEADER_KEY[h.trim().toLowerCase()])
  const out: RawRow[] = []
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]
    const row: RawRow = {}
    headers.forEach((key, c) => {
      if (!key) return
      const raw = (cells[c] ?? '').trim()
      if (raw === '') return
      if (NUMERIC.has(key)) {
        const n = Number(raw.replace(/[^\d.-]/g, ''))
        if (!Number.isNaN(n)) (row[key] as number) = n
      } else {
        (row[key] as string) = raw
      }
    })
    if (Object.keys(row).length > 0) out.push(row)
  }
  return out
}

export function normalizeRow(raw: RawRow): DraftRow {
  const quantity = Number(raw.quantity ?? 0)
  return {
    id: uid(),
    name: (raw.name ?? '').trim(),
    quantity,
    unit: (raw.unit ?? 'piece').trim() || 'piece',
    costPrice: Number(raw.cost_price ?? 0),
    sellPrice: Number(raw.selling_price ?? 0),
    category: (raw.category ?? 'Groceries').trim() || 'Groceries',
    packUnit: raw.pack_unit ? raw.pack_unit.trim() : null,
    unitsPerPack: Number(raw.units_per_pack ?? 1) || 1,
    lowStockThreshold:
      raw.low_stock_threshold === undefined ? null : Number(raw.low_stock_threshold),
  }
}

export function rowStatus(
  row: DraftRow,
  products: Product[],
): { status: 'new' | 'restock' | 'invalid'; matchId: string | null; errors: string[] } {
  const errors: string[] = []
  if (!row.name) errors.push('name')
  if (!(row.costPrice > 0)) errors.push('cost')
  if (!(row.sellPrice > 0)) errors.push('sell')
  if (!(row.quantity > 0)) errors.push('quantity')
  if (errors.length > 0) return { status: 'invalid', matchId: null, errors }

  const m = matchProduct(row.name, products)
  if (m.product) return { status: 'restock', matchId: m.product.id, errors: [] }
  return { status: 'new', matchId: null, errors: [] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bulkImport/rows.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bulkImport/rows.ts src/lib/bulkImport/rows.test.ts
git commit -m "feat(bulk): add row model, CSV mapping, and validation"
```

---

### Task 5: Bulk-save orchestrator

**Files:**
- Create: `src/lib/bulkImport/save.ts`
- Test: `src/lib/bulkImport/save.test.ts`

**Interfaces:**
- Consumes: `DraftRow`, `rowStatus` (Task 4); `uid` from `@/lib/data`; `Product` from `@/lib/supabase`.
- Produces:
  - `export type CashMode = { kind: 'opening' } | { kind: 'purchase'; account: 'cash' | 'bank' } | { kind: 'supplier_credit'; supplierName: string; supplierPhone: string | null }`
  - `export interface BulkSaveApi { addProduct: (product: Record<string, unknown>, injectionId: string | null, opts: { account?: 'cash' | 'bank'; unpaid?: boolean; opening?: boolean }) => Promise<void>; updateProduct: (id: string, updates: Record<string, unknown>) => Promise<void>; receiveStock: (params: { productId: string; qty: number; unitCost: number; account?: 'cash' | 'bank'; unpaid?: boolean; opening?: boolean }) => Promise<unknown>; addDebt: (debt: Record<string, unknown>) => Promise<void>; findQty: (id: string) => number }`
  - `export interface BulkSaveResult { added: number; restocked: number; failed: number; failures: { name: string; error: string }[] }`
  - `export async function saveBulkRows(rows: DraftRow[], products: Product[], mode: CashMode, api: BulkSaveApi, onProgress?: (done: number, total: number) => void): Promise<BulkSaveResult>`

Behavior: for each row use `rowStatus` to skip `invalid`; **new** → `addProduct(product, null, cashOpts)`; **restock** → `updateProduct(matchId, { quantity: findQty(matchId) + row.quantity })` then `receiveStock({ productId: matchId, qty: row.quantity, unitCost: row.costPrice, ...cashOpts })`. `cashOpts`: opening → `{ opening: true }`; purchase → `{ account }`; supplier_credit → `{ unpaid: true }`. For supplier_credit, accumulate total cost and after the loop create ONE `owing` debt. Count outcomes; capture per-row failures without aborting the rest.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bulkImport/save.test.ts
import { describe, it, expect, vi } from 'vitest'
import { saveBulkRows, type CashMode } from './save'
import { normalizeRow } from './rows'
import type { Product } from '@/lib/supabase'

const products: Product[] = [{
  id: 'indomie', user_id: 'u', name: 'Indomie', cost_price: 2, selling_price: 3, quantity: 10,
  unit: 'piece', units_per_pack: 1, category: 'Noodles', low_stock_threshold: 5, created_at: '2026-07-01T00:00:00Z',
}]

function fakeApi() {
  return {
    addProduct: vi.fn().mockResolvedValue(undefined),
    updateProduct: vi.fn().mockResolvedValue(undefined),
    receiveStock: vi.fn().mockResolvedValue(undefined),
    addDebt: vi.fn().mockResolvedValue(undefined),
    findQty: vi.fn().mockReturnValue(10),
  }
}

const newRow = normalizeRow({ name: 'Rice 5kg', cost_price: 40, selling_price: 55, quantity: 3 })
const restockRow = normalizeRow({ name: 'Indomie', cost_price: 2, selling_price: 3, quantity: 24 })

describe('saveBulkRows', () => {
  it('opening mode: new via addProduct(opening), restock via updateProduct+receiveStock(opening), no debt/cash', async () => {
    const api = fakeApi()
    const res = await saveBulkRows([newRow, restockRow], products, { kind: 'opening' }, api)
    expect(res).toMatchObject({ added: 1, restocked: 1, failed: 0 })
    expect(api.addProduct.mock.calls[0][2]).toEqual({ opening: true })
    expect(api.updateProduct).toHaveBeenCalledWith('indomie', { quantity: 34 }) // 10 + 24
    expect(api.receiveStock.mock.calls[0][0]).toMatchObject({ productId: 'indomie', qty: 24, unitCost: 2, opening: true })
    expect(api.addDebt).not.toHaveBeenCalled()
  })

  it('purchase paid: passes the account and posts no debt', async () => {
    const api = fakeApi()
    const mode: CashMode = { kind: 'purchase', account: 'bank' }
    await saveBulkRows([newRow], products, mode, api)
    expect(api.addProduct.mock.calls[0][2]).toEqual({ account: 'bank' })
    expect(api.addDebt).not.toHaveBeenCalled()
  })

  it('supplier credit: unpaid opts + one aggregate owing debt', async () => {
    const api = fakeApi()
    const mode: CashMode = { kind: 'supplier_credit', supplierName: 'Ali', supplierPhone: null }
    await saveBulkRows([newRow, restockRow], products, mode, api)
    expect(api.addProduct.mock.calls[0][2]).toEqual({ unpaid: true })
    expect(api.addDebt).toHaveBeenCalledTimes(1)
    const debt = api.addDebt.mock.calls[0][0]
    expect(debt).toMatchObject({ person_name: 'Ali', type: 'owing', amount: 40 * 3 + 2 * 24 })
  })

  it('reports per-row failures without aborting', async () => {
    const api = fakeApi()
    api.addProduct.mockRejectedValueOnce(new Error('boom'))
    const res = await saveBulkRows([newRow, restockRow], products, { kind: 'opening' }, api)
    expect(res.failed).toBe(1)
    expect(res.restocked).toBe(1)
    expect(res.failures[0].name).toBe('Rice 5kg')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bulkImport/save.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/bulkImport/save.ts
import type { Product } from '@/lib/supabase'
import { uid } from '@/lib/data'
import { rowStatus, type DraftRow } from './rows'

export type CashMode =
  | { kind: 'opening' }
  | { kind: 'purchase'; account: 'cash' | 'bank' }
  | { kind: 'supplier_credit'; supplierName: string; supplierPhone: string | null }

export interface BulkSaveApi {
  addProduct: (
    product: Record<string, unknown>,
    injectionId: string | null,
    opts: { account?: 'cash' | 'bank'; unpaid?: boolean; opening?: boolean },
  ) => Promise<void>
  updateProduct: (id: string, updates: Record<string, unknown>) => Promise<void>
  receiveStock: (params: {
    productId: string
    qty: number
    unitCost: number
    account?: 'cash' | 'bank'
    unpaid?: boolean
    opening?: boolean
  }) => Promise<unknown>
  addDebt: (debt: Record<string, unknown>) => Promise<void>
  findQty: (id: string) => number
}

export interface BulkSaveResult {
  added: number
  restocked: number
  failed: number
  failures: { name: string; error: string }[]
}

function cashOpts(mode: CashMode): { account?: 'cash' | 'bank'; unpaid?: boolean; opening?: boolean } {
  if (mode.kind === 'opening') return { opening: true }
  if (mode.kind === 'purchase') return { account: mode.account }
  return { unpaid: true }
}

export async function saveBulkRows(
  rows: DraftRow[],
  products: Product[],
  mode: CashMode,
  api: BulkSaveApi,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkSaveResult> {
  const opts = cashOpts(mode)
  const result: BulkSaveResult = { added: 0, restocked: 0, failed: 0, failures: [] }
  let supplierTotal = 0
  const total = rows.length

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const status = rowStatus(row, products)
    try {
      if (status.status === 'invalid') throw new Error('invalid row')
      if (status.status === 'new') {
        const nowIso = new Date().toISOString()
        await api.addProduct(
          {
            id: uid(),
            name: row.name,
            cost_price: row.costPrice,
            selling_price: row.sellPrice,
            quantity: row.quantity,
            unit: row.unit,
            pack_unit: row.packUnit,
            units_per_pack: row.unitsPerPack,
            category: row.category,
            low_stock_threshold: row.lowStockThreshold ?? Math.max(3, Math.floor(row.quantity * 0.2)),
            barcode: null,
            qr_code: null,
            created_at: nowIso,
          },
          null,
          opts,
        )
        result.added++
      } else {
        const id = status.matchId as string
        await api.updateProduct(id, { quantity: api.findQty(id) + row.quantity })
        await api.receiveStock({ productId: id, qty: row.quantity, unitCost: row.costPrice, ...opts })
        result.restocked++
      }
      supplierTotal += Math.round(row.costPrice * row.quantity * 100) / 100
    } catch (e) {
      result.failed++
      result.failures.push({ name: row.name || 'row', error: e instanceof Error ? e.message : String(e) })
    }
    onProgress?.(i + 1, total)
  }

  if (mode.kind === 'supplier_credit' && supplierTotal > 0) {
    await api.addDebt({
      id: uid(),
      person_name: mode.supplierName,
      phone: mode.supplierPhone,
      amount: Math.round(supplierTotal * 100) / 100,
      amount_paid: 0,
      payments: [],
      description: `Bulk stock (${result.added + result.restocked} items)`,
      type: 'owing',
      due_date: null,
      injection_id: null,
      sale_group_id: null,
      is_paid: false,
      paid_at: null,
      created_at: new Date().toISOString(),
    })
  }

  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bulkImport/save.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bulkImport/save.ts src/lib/bulkImport/save.test.ts
git commit -m "feat(bulk): add bulk-save orchestrator (opening/purchase/supplier-credit)"
```

---

### Task 6: Review table component

**Files:**
- Create: `src/components/inventory/BulkReviewTable.tsx`

**Interfaces:**
- Consumes: `DraftRow`, `rowStatus`, `UNITS`, `CATEGORIES` (Task 4); `formatCurrency` from `@/lib/data`; `Product` from `@/lib/supabase`; `Trash2` from `lucide-react`.
- Produces: `export default function BulkReviewTable({ rows, products, onChange, onImport, importing }: { rows: DraftRow[]; products: Product[]; onChange: (rows: DraftRow[]) => void; onImport: () => void; importing: boolean })`.
- Behavior: renders each row as editable inputs (name text; quantity/cost/sell numeric; unit + category selects); a Status pill (New / Restock / Fix) from `rowStatus`; a delete button; a footer with counts and an **Import** button disabled while any row is `invalid` or `rows` is empty or `importing`.

- [ ] **Step 1: Implement**

```tsx
// src/components/inventory/BulkReviewTable.tsx
import { Trash2 } from 'lucide-react'
import type { Product } from '@/lib/supabase'
import { rowStatus, UNITS, CATEGORIES, type DraftRow } from '@/lib/bulkImport/rows'

export default function BulkReviewTable({
  rows, products, onChange, onImport, importing,
}: {
  rows: DraftRow[]
  products: Product[]
  onChange: (rows: DraftRow[]) => void
  onImport: () => void
  importing: boolean
}) {
  const set = (id: string, patch: Partial<DraftRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id))

  const statuses = rows.map((r) => rowStatus(r, products))
  const anyInvalid = statuses.some((s) => s.status === 'invalid')
  const newCount = statuses.filter((s) => s.status === 'new').length
  const restockCount = statuses.filter((s) => s.status === 'restock').length

  const pill = (s: 'new' | 'restock' | 'invalid') =>
    s === 'invalid' ? 'bg-accent-red text-white'
      : s === 'restock' ? 'bg-warm-gray text-ink'
      : 'bg-accent-green text-white'
  const label = (s: 'new' | 'restock' | 'invalid') => (s === 'invalid' ? 'Fix' : s === 'restock' ? 'Restock' : 'New')

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <div className="min-w-[640px] space-y-2">
          {rows.map((r, i) => {
            const s = statuses[i]
            const err = (k: string) => s.errors.includes(k) ? 'border-accent-red' : 'border-ink/20'
            return (
              <div key={r.id} className="flex items-center gap-2 text-xs">
                <input
                  value={r.name}
                  onChange={(e) => set(r.id, { name: e.target.value })}
                  placeholder="Name"
                  className={`flex-1 min-w-0 harsh-border rounded-sm px-2 py-1.5 border ${err('name')}`}
                />
                <input
                  type="number" inputMode="decimal" value={r.quantity || ''}
                  onChange={(e) => set(r.id, { quantity: Number(e.target.value) })}
                  placeholder="Qty"
                  className={`w-16 harsh-border rounded-sm px-2 py-1.5 border ${err('quantity')}`}
                />
                <select
                  value={r.unit} onChange={(e) => set(r.id, { unit: e.target.value })}
                  className="w-20 harsh-border rounded-sm px-1 py-1.5 border border-ink/20"
                >
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <input
                  type="number" inputMode="decimal" value={r.costPrice || ''}
                  onChange={(e) => set(r.id, { costPrice: Number(e.target.value) })}
                  placeholder="Cost"
                  className={`w-20 harsh-border rounded-sm px-2 py-1.5 border ${err('cost')}`}
                />
                <input
                  type="number" inputMode="decimal" value={r.sellPrice || ''}
                  onChange={(e) => set(r.id, { sellPrice: Number(e.target.value) })}
                  placeholder="Sell"
                  className={`w-20 harsh-border rounded-sm px-2 py-1.5 border ${err('sell')}`}
                />
                <select
                  value={r.category} onChange={(e) => set(r.id, { category: e.target.value })}
                  className="w-28 harsh-border rounded-sm px-1 py-1.5 border border-ink/20"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className={`shrink-0 px-2 py-1 rounded-sm text-[10px] uppercase ${pill(s.status)}`}>{label(s.status)}</span>
                <button onClick={() => remove(r.id)} aria-label="Remove row" className="shrink-0 text-muted-text hover:text-accent-red">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-ink/10 pt-3">
        <span className="text-xs text-muted-text">{newCount} new · {restockCount} restock</span>
        <button
          onClick={onImport}
          disabled={importing || rows.length === 0 || anyInvalid}
          className="btn-tactile bg-ink text-white text-sm uppercase tracking-wide px-5 py-2.5 rounded-sm disabled:opacity-50"
        >
          {importing ? 'Importing…' : `Import ${rows.length}`}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/inventory/BulkReviewTable.tsx
git commit -m "feat(bulk): add editable review table"
```

---

### Task 7: Bulk-add sheet (Template tab) + Inventory entry

**Files:**
- Create: `src/components/inventory/BulkAddSheet.tsx`
- Modify: `src/pages/Inventory.tsx` (add a "Bulk add" button + render the sheet)

**Interfaces:**
- Consumes: `useStore` from `@/lib/store`; `parseCSV` (Task 2); `downloadTemplate` (Task 3); `rowsFromMatrix`, `normalizeRow`, type `DraftRow` (Task 4); `saveBulkRows`, type `CashMode`, `BulkSaveApi` (Task 5); `BulkReviewTable` (Task 6); `receiveStock` from `@/services/batchApi`; `Sheet` UI from `@/components/ui/sheet`.
- Produces: `export default function BulkAddSheet({ open, onClose }: { open: boolean; onClose: () => void })`.
- Behavior: **Template** tab with a "Download template" button (`downloadTemplate`) and a file input (`accept=".csv,text/csv"`). On file select: read text, `parseCSV` → `rowsFromMatrix` → `normalizeRow` per row → set `rows`. Render `BulkReviewTable`. A cash-mode control (Opening / Purchase→account cash|bank / Supplier credit→name) sets a `CashMode`. On Import call `saveBulkRows(rows, state.products, mode, api)`; show the result summary; keep failed rows.

- [ ] **Step 1: Implement the sheet**

```tsx
// src/components/inventory/BulkAddSheet.tsx
import { useRef, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useStore } from '@/lib/store'
import { receiveStock } from '@/services/batchApi'
import { parseCSV } from '@/lib/bulkImport/csv'
import { downloadTemplate } from '@/lib/bulkImport/template'
import { rowsFromMatrix, normalizeRow, type DraftRow } from '@/lib/bulkImport/rows'
import { saveBulkRows, type CashMode, type BulkSaveApi } from '@/lib/bulkImport/save'
import BulkReviewTable from './BulkReviewTable'

export default function BulkAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, addProduct, updateProduct, addDebt, showToast } = useStore()
  const [rows, setRows] = useState<DraftRow[]>([])
  const [importing, setImporting] = useState(false)
  const [modeKind, setModeKind] = useState<'opening' | 'purchase' | 'supplier_credit'>('opening')
  const [account, setAccount] = useState<'cash' | 'bank'>('cash')
  const [supplierName, setSupplierName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (file: File) => {
    const text = await file.text()
    const raws = rowsFromMatrix(parseCSV(text))
    setRows(raws.map(normalizeRow))
    if (raws.length === 0) showToast('No rows found in that file', 'error')
  }

  const buildMode = (): CashMode | null => {
    if (modeKind === 'opening') return { kind: 'opening' }
    if (modeKind === 'purchase') return { kind: 'purchase', account }
    if (!supplierName.trim()) {
      showToast('Supplier name required for supplier credit', 'error')
      return null
    }
    return { kind: 'supplier_credit', supplierName: supplierName.trim(), supplierPhone: null }
  }

  const onImport = async () => {
    const mode = buildMode()
    if (!mode) return
    setImporting(true)
    const api: BulkSaveApi = {
      addProduct: addProduct as BulkSaveApi['addProduct'],
      updateProduct: updateProduct as BulkSaveApi['updateProduct'],
      receiveStock,
      addDebt: addDebt as BulkSaveApi['addDebt'],
      findQty: (id) => state.products.find((p) => p.id === id)?.quantity ?? 0,
    }
    try {
      const res = await saveBulkRows(rows, state.products, mode, api)
      showToast(`Added ${res.added}, restocked ${res.restocked}${res.failed ? `, ${res.failed} failed` : ''}`, res.failed ? 'error' : 'success')
      if (res.failed === 0) {
        setRows([])
        onClose()
      } else {
        // Keep only the failed rows for retry.
        const failedNames = new Set(res.failures.map((f) => f.name))
        setRows((rs) => rs.filter((r) => failedNames.has(r.name)))
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl h-[90vh] flex flex-col">
        <SheetHeader><SheetTitle>Bulk add stock</SheetTitle></SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadTemplate} className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm">
              Download template
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()} className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm">
              Upload filled CSV
            </button>
          </div>

          {rows.length > 0 && (
            <>
              <div className="bg-warm-gray/40 rounded-sm p-3 space-y-2">
                <p className="text-micro text-muted-text">This stock is…</p>
                <div className="flex flex-wrap gap-2">
                  {([['opening', 'Already mine (opening)'], ['purchase', 'A purchase'], ['supplier_credit', 'Supplier credit']] as const).map(([k, lbl]) => (
                    <button key={k} onClick={() => setModeKind(k)}
                      className={`text-xs px-3 py-1.5 rounded-sm border-2 border-ink ${modeKind === k ? 'bg-ink text-white' : 'bg-white'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
                {modeKind === 'purchase' && (
                  <div className="flex gap-2">
                    {(['cash', 'bank'] as const).map((a) => (
                      <button key={a} onClick={() => setAccount(a)}
                        className={`text-xs px-3 py-1.5 rounded-sm border-2 border-ink ${account === a ? 'bg-ink text-white' : 'bg-white'}`}>
                        {a === 'cash' ? 'Paid cash' : 'Paid bank'}
                      </button>
                    ))}
                  </div>
                )}
                {modeKind === 'supplier_credit' && (
                  <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Supplier name"
                    className="w-full harsh-border rounded-sm px-3 py-2 text-sm" />
                )}
              </div>

              <BulkReviewTable rows={rows} products={state.products} onChange={setRows} onImport={onImport} importing={importing} />
            </>
          )}

          {rows.length === 0 && (
            <p className="text-sm text-muted-text text-center py-8">
              Download the template, fill it in a spreadsheet, then upload it here to review and import.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Add the entry button to Inventory**

In `src/pages/Inventory.tsx`: add `import BulkAddSheet from '@/components/inventory/BulkAddSheet'`, a `const [showBulk, setShowBulk] = useState(false)` near the other `useState`s, a button near the existing "add product" control:

```tsx
<button onClick={() => setShowBulk(true)} className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm">
  Bulk add
</button>
```

and render the sheet near the end of the returned JSX (sibling of the other sheets/modals):

```tsx
<BulkAddSheet open={showBulk} onClose={() => setShowBulk(false)} />
```

Read `Inventory.tsx` first and place these consistently with the existing add-product button and modal rendering.

- [ ] **Step 3: Typecheck, full suite, build**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, sign in, open Inventory → Bulk add:
1. Download template → a CSV downloads with the headers + Indomie example.
2. Fill 3–4 rows (one matching an existing product), upload → review table shows them with New/Restock/Fix pills; a row with blank cost shows red and disables Import.
3. Fix it; choose "Already mine (opening)"; Import → toast "Added X, restocked Y"; products appear/quantities rise; **cash-in-hand unchanged** (opening stock posts no cash).
4. Repeat with "A purchase / Paid cash" → cash-in-hand drops by the total cost.
5. Repeat with "Supplier credit" + a name → a single "you owe" debt appears for that supplier.

- [ ] **Step 5: Commit**

```bash
git add src/components/inventory/BulkAddSheet.tsx src/pages/Inventory.tsx
git commit -m "feat(bulk): add bulk-add sheet (CSV template) and Inventory entry"
```

---

## Phase 2 — Photo (Claude vision)

### Task 8: Vision edge function

**Files:**
- Create: `supabase/functions/serwaa-stock-vision/index.ts`
- Modify: `supabase/config.toml` (register with `verify_jwt = false`)

**Interfaces:**
- Consumes: `corsHeaders`, `json` from `../_shared/cors.ts`; env `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Produces: endpoint `/functions/v1/serwaa-stock-vision`.
  - Request: `{ userJwt: string; imageBase64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }`
  - Response: `{ rows: Array<{ name?: string; quantity?: number; unit?: string; cost_price?: number; selling_price?: number }> }`

- [ ] **Step 1: Create the function**

```ts
// supabase/functions/serwaa-stock-vision/index.ts
// Reads a photo of a stock list with Claude vision and returns structured rows.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const MODEL = 'claude-haiku-4-5-20251001'

const PROMPT =
  'This image is a shop stock list (typed or handwritten, often a table). ' +
  'Extract every product row. Respond with JSON ONLY: an array of objects with keys ' +
  'name (string), quantity (number), unit (string), cost_price (number), selling_price (number). ' +
  'Omit a key if its value is not present. Amounts are plain numbers (no currency symbols). No prose.'

interface Body {
  userJwt?: string
  imageBase64?: string
  mediaType?: string
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  return JSON.parse(body.slice(start, end + 1))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    let body: Body
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }
    if (!body.userJwt) return json({ error: 'Unauthorized' }, 401)
    if (!body.imageBase64 || !body.mediaType) return json({ error: 'Missing image' }, 400)

    const userClient = createClient(SUPABASE_URL, ANON_KEY)
    const { data: userData, error: userErr } = await userClient.auth.getUser(body.userJwt)
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: body.mediaType, data: body.imageBase64 } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return json({ error: 'Vision upstream error', detail: detail.slice(0, 300) }, 502)
    }

    const data = await res.json()
    const text = (data.content ?? []).filter((b: Record<string, unknown>) => b.type === 'text').map((b: Record<string, unknown>) => String(b.text)).join('')
    let rows: unknown = []
    try {
      rows = extractJson(text)
    } catch {
      return json({ error: 'Could not read the photo. Please retake it or use the template.' }, 422)
    }
    return json({ rows: Array.isArray(rows) ? rows : [] })
  } catch (e) {
    return json({ error: 'Vision error', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})
```

- [ ] **Step 2: Register in `supabase/config.toml`**

Append:

```toml
# Client-invoked: reads a stock-list photo with Claude vision. The function
# validates the user token in the body, so the gateway JWT check is disabled.
[functions.serwaa-stock-vision]
verify_jwt = false
```

- [ ] **Step 3: Commit (deploy is a manual owner step)**

```bash
git add supabase/functions/serwaa-stock-vision/index.ts supabase/config.toml
git commit -m "feat(bulk): add Claude-vision stock-photo edge function"
```

> Deploy (owner, needs Supabase login): `supabase functions deploy serwaa-stock-vision --project-ref <ref>`. `ANTHROPIC_API_KEY` is already set.

---

### Task 9: Vision client (compress + call)

**Files:**
- Create: `src/lib/bulkImport/vision.ts`
- Test: `src/lib/bulkImport/vision.test.ts`

**Interfaces:**
- Consumes: `RawRow` (Task 4); `supabase`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` from `@/lib/supabase`.
- Produces:
  - `export function normalizeVisionRows(rows: unknown): RawRow[]` — coerce arbitrary model JSON to `RawRow[]` (string name/unit, numeric amounts, drop non-objects).
  - `export async function extractRowsFromImage(file: File, deps?: { getToken; doFetch; toBase64 }): Promise<RawRow[]>` — compresses via canvas (max dim 1600, JPEG q0.7), posts to the edge function (anon-key Bearer + `userJwt` in body), returns `normalizeVisionRows(json.rows)`.

Only `normalizeVisionRows` is unit-tested (canvas/network need a browser).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bulkImport/vision.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeVisionRows } from './vision'

describe('normalizeVisionRows', () => {
  it('coerces model output to RawRow fields and drops junk', () => {
    const input = [
      { name: 'Milo', quantity: '10', cost_price: '4', selling_price: 8, unit: 'tin' },
      { name: 42 },
      'nonsense',
      null,
    ]
    expect(normalizeVisionRows(input)).toEqual([
      { name: 'Milo', quantity: 10, cost_price: 4, selling_price: 8, unit: 'tin' },
    ])
  })
  it('returns [] for non-arrays', () => {
    expect(normalizeVisionRows({})).toEqual([])
    expect(normalizeVisionRows(null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bulkImport/vision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/bulkImport/vision.ts
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import type { RawRow } from './rows'

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''))
    if (!Number.isNaN(n) && v.trim() !== '') return n
  }
  return undefined
}
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

export function normalizeVisionRows(rows: unknown): RawRow[] {
  if (!Array.isArray(rows)) return []
  const out: RawRow[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const row: RawRow = {}
    const name = str(o.name)
    if (name) row.name = name
    const unit = str(o.unit)
    if (unit) row.unit = unit
    const q = num(o.quantity); if (q !== undefined) row.quantity = q
    const c = num(o.cost_price); if (c !== undefined) row.cost_price = c
    const s = num(o.selling_price); if (s !== undefined) row.selling_price = s
    if (Object.keys(row).length > 0 && row.name) out.push(row)
  }
  return out
}

interface Deps {
  getToken: () => Promise<string | null>
  doFetch: typeof fetch
  toBase64: (file: File) => Promise<{ base64: string; mediaType: string }>
}

async function compressToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file)
  const max = 1600
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' }
}

const defaultDeps: Deps = {
  getToken: async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  },
  doFetch: (...a) => fetch(...a),
  toBase64: compressToBase64,
}

export async function extractRowsFromImage(file: File, deps: Deps = defaultDeps): Promise<RawRow[]> {
  const token = await deps.getToken()
  if (!token) throw new Error('You are not signed in.')
  const { base64, mediaType } = await deps.toBase64(file)
  const res = await deps.doFetch(`${SUPABASE_URL}/functions/v1/serwaa-stock-vision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userJwt: token, imageBase64: base64, mediaType }),
  })
  const data = await res.json().catch(() => ({}) as Record<string, unknown>)
  if (!(res as Response).ok) throw new Error((data as { error?: string }).error || 'Could not read the photo.')
  return normalizeVisionRows((data as { rows?: unknown }).rows)
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/lib/bulkImport/vision.test.ts && npx tsc -b`
Expected: PASS (2 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bulkImport/vision.ts src/lib/bulkImport/vision.test.ts
git commit -m "feat(bulk): add stock-photo vision client"
```

---

### Task 10: Photo tab in the bulk-add sheet

**Files:**
- Modify: `src/components/inventory/BulkAddSheet.tsx`

**Interfaces:**
- Consumes: `extractRowsFromImage` (Task 9).
- Adds a tab switcher (Template / Photo). Photo tab: a file input with `accept="image/*"` and `capture="environment"` (opens the camera on phones). On select: show a "Reading photo…" state, call `extractRowsFromImage`, map results through `normalizeRow`, set `rows` (feeding the same review table). Errors show a toast.

- [ ] **Step 1: Add the photo path**

At the top of `BulkAddSheet`, add tab state and a reading state:

```tsx
const [tab, setTab] = useState<'template' | 'photo'>('template')
const [reading, setReading] = useState(false)
const photoRef = useRef<HTMLInputElement>(null)
```

Add the import:

```tsx
import { extractRowsFromImage } from '@/lib/bulkImport/vision'
```

Add the handler:

```tsx
const onPhoto = async (file: File) => {
  setReading(true)
  try {
    const raws = await extractRowsFromImage(file)
    setRows(raws.map(normalizeRow))
    if (raws.length === 0) showToast('No products found in the photo', 'error')
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Could not read the photo', 'error')
  } finally {
    setReading(false)
  }
}
```

Render a tab switcher above the intake controls, and gate the two intakes by `tab`:

```tsx
<div className="flex bg-warm-gray rounded-sm p-1 mb-1">
  {(['template', 'photo'] as const).map((tk) => (
    <button key={tk} onClick={() => setTab(tk)}
      className={`flex-1 py-2 text-xs uppercase tracking-wide rounded-sm ${tab === tk ? 'bg-ink text-white' : 'text-ink'}`}>
      {tk === 'template' ? 'Template' : 'Photo'}
    </button>
  ))}
</div>
```

Wrap the existing template buttons in `{tab === 'template' && ( … )}`, and add the photo block:

```tsx
{tab === 'photo' && (
  <div className="flex flex-col items-start gap-2">
    <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f); e.target.value = '' }} />
    <button onClick={() => photoRef.current?.click()} disabled={reading}
      className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm disabled:opacity-50">
      {reading ? 'Reading photo…' : 'Take / upload photo'}
    </button>
    <p className="text-[11px] text-muted-text">Photograph a clear stock list (typed or handwritten). Review the result before importing.</p>
  </div>
)}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc -b && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 3: Manual verification (needs the deployed vision function)**

Deploy `serwaa-stock-vision`, then on a phone: Inventory → Bulk add → Photo → snap a stock list → rows appear in the review table → fix → Import (opening) → products land, cash unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/inventory/BulkAddSheet.tsx
git commit -m "feat(bulk): add photo tab (Claude vision) to bulk-add sheet"
```

---

## Self-Review

- **Spec coverage:** template download+parse (Tasks 2,3,7), photo/vision (Tasks 8,9,10), shared review table (Task 6), new-vs-restock matching (Task 4), opening-vs-purchase + no-cash opening (Tasks 1,5,7), supplier-credit aggregate debt (Task 5), review-before-save gate (Task 6), security/JWT (Task 8), image compression (Task 9). ✓
- **Placeholder scan:** every code step is complete; no TBD/TODO. ✓
- **Type consistency:** `DraftRow`, `RawRow`, `rowStatus`, `normalizeRow`, `rowsFromMatrix`, `CashMode`, `BulkSaveApi`, `saveBulkRows`, `shouldPostStockCash`, `parseCSV`, `toCSVRow`, `TEMPLATE_HEADERS`, `UNITS`, `CATEGORIES`, `extractRowsFromImage`, `normalizeVisionRows` are defined once and reused with matching shapes. ✓

## Deferred / out of scope

- Bulk edit/delete of existing products; barcode/QR bulk assignment; multi-image stitching; in-app spreadsheet editor. Batch DB insert (vs sequential) is a later optimization.
