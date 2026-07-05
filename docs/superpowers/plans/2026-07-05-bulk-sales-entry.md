# Bulk Sales Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user record many past sales at once — from a filled CSV template or a photo of a handwritten sales log — reviewing each row (product match, date, payment, pack) before saving through the existing sale path.

**Architecture:** Two intake tabs (Template, Photo) feed one editable review table. CSV is parsed by the existing `@/lib/bulkImport/csv` parser; the photo is read by a new Claude-vision (Sonnet) edge function. Each row is fuzzy-matched to an existing product and dated (defaults to today). On confirm, `saveBulkSales` builds Sale rows, calls `addSaleBatch` once (FIFO + stock), posts cash-ledger movements for cash/momo/bank sales on each sale's date, and creates `owed` debts for credit sales.

**Tech Stack:** React 18 + TypeScript + Vite, Vitest (node env), Supabase (Deno Edge Functions), Anthropic Claude vision (Sonnet).

## Global Constraints

- Currency is Ghana Cedis; format money via `formatCurrency` from `@/lib/data`.
- All DB writes go through existing store functions (`addSaleBatch`, `addDebt`) and `postMovement` from `@/services/cashApi`. No new direct Supabase writes from bulk-sales client code.
- Every sale row must match an existing product before it can be saved (fuzzy match; user can pick from a dropdown). Import is blocked while any row is unmatched or invalid.
- Each sale's `created_at` is its own row date (blank = today). Cash/momo/bank sales post to the ledger on that date; credit sales create an `owed` debt linked by `sale_group_id`.
- Reuse `parseCSV`/`toCSVRow` from `@/lib/bulkImport/csv`, `download` from `@/lib/export`, `matchProduct` from `@/lib/agent/match`, and `saleMovement` from `@/lib/cashPosting`. Do not duplicate them.
- Edge functions authenticate the caller by validating `userJwt` via GoTrue (anon key as `Authorization: Bearer`, user token in body), like `serwaa-stock-vision`. Secret `ANTHROPIC_API_KEY` lives only in Supabase.
- Vision model is `claude-sonnet-5`; image compressed to 1568px / JPEG 0.9 client-side.
- Tests: Vitest, node environment, `*.test.ts` under `src/`, `import { describe, it, expect } from 'vitest'`, path alias `@` → `src`.
- Payment values are exactly `'cash' | 'momo' | 'bank' | 'credit'` (matches the `Sale.payment_method` type).

---

## Phase 1 — CSV template import

### Task 1: Sale row model, matching, pack conversion, validation

**Files:**
- Create: `src/lib/bulkSales/rows.ts`
- Test: `src/lib/bulkSales/rows.test.ts`

**Interfaces:**
- Consumes: `Product` from `@/lib/supabase`; `matchProduct` from `@/lib/agent/match`; `uid` from `@/lib/data`.
- Produces:
  - `export const PAYMENTS = ['cash', 'momo', 'bank', 'credit'] as const` and `export type Payment = typeof PAYMENTS[number]`
  - `export interface SaleRawRow { product?: string; quantity?: number; unit?: string; unit_price?: number; payment?: string; customer?: string; date?: string }`
  - `export interface SaleDraftRow { id: string; product: string; productId: string | null; quantity: number; unit: string; unitPrice: number | null; payment: Payment; customer: string; date: string }`
  - `export function rowsFromMatrix(matrix: string[][]): SaleRawRow[]`
  - `export function normalizeSaleRow(raw: SaleRawRow): SaleDraftRow`
  - `export function matchSaleRow(row: SaleDraftRow, products: Product[]): SaleDraftRow`
  - `export function isPackedSale(row: SaleDraftRow, product: Product): boolean`
  - `export function toBaseSale(row: SaleDraftRow, product: Product): { quantity: number; unitPrice: number; saleUnit: string | null; saleUnitQty: number | null }`
  - `export function saleRowStatus(row: SaleDraftRow, products: Product[]): { status: 'ready' | 'unmatched' | 'invalid'; errors: string[]; warnings: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bulkSales/rows.test.ts
import { describe, it, expect } from 'vitest'
import { rowsFromMatrix, normalizeSaleRow, matchSaleRow, toBaseSale, saleRowStatus } from './rows'
import type { Product } from '@/lib/supabase'

const prod = (over: Partial<Product>): Product => ({
  id: 'p', user_id: 'u', name: 'Indomie', cost_price: 2, selling_price: 3, quantity: 50,
  unit: 'sachet', pack_unit: 'box', units_per_pack: 40, category: 'Noodles',
  low_stock_threshold: 5, created_at: '2026-07-01T00:00:00Z', ...over,
})

describe('rowsFromMatrix', () => {
  it('maps sales headers to RawRow fields', () => {
    const matrix = [
      ['Product', 'Quantity', 'Payment', 'Date'],
      ['Milo', '3', 'credit', '2026-07-03'],
    ]
    expect(rowsFromMatrix(matrix)).toEqual([
      { product: 'Milo', quantity: 3, payment: 'credit', date: '2026-07-03' },
    ])
  })
})

describe('normalizeSaleRow', () => {
  it('defaults payment to cash and date to today when blank', () => {
    const r = normalizeSaleRow({ product: 'Milo', quantity: 3 })
    expect(r.payment).toBe('cash')
    expect(r.unitPrice).toBeNull()
    expect(new Date(r.date).toString()).not.toBe('Invalid Date')
    expect(r.id).toBeTruthy()
  })
  it('keeps a valid date and known payment', () => {
    const r = normalizeSaleRow({ product: 'Milo', quantity: 3, payment: 'MoMo', date: '2026-07-03', unit_price: 5 })
    expect(r.payment).toBe('momo')
    expect(r.date.startsWith('2026-07-03')).toBe(true)
    expect(r.unitPrice).toBe(5)
  })
})

describe('matchSaleRow', () => {
  it('resolves productId by fuzzy name', () => {
    const products = [prod({ id: 'indomie', name: 'Indomie' })]
    const r = matchSaleRow(normalizeSaleRow({ product: 'indomie', quantity: 2 }), products)
    expect(r.productId).toBe('indomie')
  })
  it('leaves productId null when no match', () => {
    const r = matchSaleRow(normalizeSaleRow({ product: 'ZZZ', quantity: 2 }), [prod({})])
    expect(r.productId).toBeNull()
  })
})

describe('toBaseSale', () => {
  it('converts a pack sale (unit = product pack unit) to base', () => {
    const p = prod({ id: 'indomie', name: 'Indomie', pack_unit: 'box', units_per_pack: 40, selling_price: 3 })
    const row = matchSaleRow(normalizeSaleRow({ product: 'Indomie', quantity: 2, unit: 'box', unit_price: 120 }), [p])
    expect(toBaseSale(row, p)).toEqual({ quantity: 80, unitPrice: 3, saleUnit: 'box', saleUnitQty: 2 })
  })
  it('base sale uses product price when unit price blank', () => {
    const p = prod({ id: 'indomie', name: 'Indomie', pack_unit: null, units_per_pack: 1, selling_price: 3 })
    const row = matchSaleRow(normalizeSaleRow({ product: 'Indomie', quantity: 5 }), [p])
    expect(toBaseSale(row, p)).toEqual({ quantity: 5, unitPrice: 3, saleUnit: null, saleUnitQty: null })
  })
})

describe('saleRowStatus', () => {
  const products = [prod({ id: 'indomie', name: 'Indomie', quantity: 4, pack_unit: null, units_per_pack: 1 })]
  it('flags unmatched', () => {
    const r = matchSaleRow(normalizeSaleRow({ product: 'ZZZ', quantity: 2 }), products)
    expect(saleRowStatus(r, products).status).toBe('unmatched')
  })
  it('flags invalid when credit has no customer', () => {
    const r = matchSaleRow(normalizeSaleRow({ product: 'Indomie', quantity: 2, payment: 'credit' }), products)
    const s = saleRowStatus(r, products)
    expect(s.status).toBe('invalid')
    expect(s.errors).toContain('customer')
  })
  it('warns when quantity exceeds current stock but stays ready', () => {
    const r = matchSaleRow(normalizeSaleRow({ product: 'Indomie', quantity: 10 }), products)
    const s = saleRowStatus(r, products)
    expect(s.status).toBe('ready')
    expect(s.warnings).toContain('stock')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bulkSales/rows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/bulkSales/rows.ts
import type { Product } from '@/lib/supabase'
import { matchProduct } from '@/lib/agent/match'
import { uid } from '@/lib/data'

export const PAYMENTS = ['cash', 'momo', 'bank', 'credit'] as const
export type Payment = (typeof PAYMENTS)[number]

export interface SaleRawRow {
  product?: string
  quantity?: number
  unit?: string
  unit_price?: number
  payment?: string
  customer?: string
  date?: string
}

export interface SaleDraftRow {
  id: string
  product: string
  productId: string | null
  quantity: number
  unit: string
  unitPrice: number | null
  payment: Payment
  customer: string
  date: string
}

const HEADER_KEY: Record<string, keyof SaleRawRow> = {
  'product': 'product',
  'quantity': 'quantity',
  'unit': 'unit',
  'unit price': 'unit_price',
  'payment': 'payment',
  'customer': 'customer',
  'date': 'date',
}
const NUMERIC: Set<keyof SaleRawRow> = new Set(['quantity', 'unit_price'])

export function rowsFromMatrix(matrix: string[][]): SaleRawRow[] {
  if (matrix.length < 2) return []
  const headers = matrix[0].map((h) => HEADER_KEY[h.trim().toLowerCase()])
  const out: SaleRawRow[] = []
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]
    const row: SaleRawRow = {}
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

function normPayment(v: string | undefined): Payment {
  const p = (v ?? '').trim().toLowerCase()
  return (PAYMENTS as readonly string[]).includes(p) ? (p as Payment) : 'cash'
}

function normDate(v: string | undefined): string {
  if (v) {
    const d = new Date(v.trim())
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

export function normalizeSaleRow(raw: SaleRawRow): SaleDraftRow {
  return {
    id: uid(),
    product: (raw.product ?? '').trim(),
    productId: null,
    quantity: Number(raw.quantity ?? 0),
    unit: (raw.unit ?? 'piece').trim() || 'piece',
    unitPrice: typeof raw.unit_price === 'number' ? raw.unit_price : null,
    payment: normPayment(raw.payment),
    customer: (raw.customer ?? '').trim(),
    date: normDate(raw.date),
  }
}

export function matchSaleRow(row: SaleDraftRow, products: Product[]): SaleDraftRow {
  const m = matchProduct(row.product, products)
  return { ...row, productId: m.product ? m.product.id : null }
}

export function isPackedSale(row: SaleDraftRow, product: Product): boolean {
  return (
    product.units_per_pack >= 2 &&
    !!product.pack_unit &&
    row.unit.trim().toLowerCase() === product.pack_unit.trim().toLowerCase()
  )
}

export function toBaseSale(
  row: SaleDraftRow,
  product: Product,
): { quantity: number; unitPrice: number; saleUnit: string | null; saleUnitQty: number | null } {
  const packed = isPackedSale(row, product)
  const f = packed ? product.units_per_pack : 1
  const round2 = (n: number) => Math.round(n * 100) / 100
  const enteredPrice = row.unitPrice ?? (packed ? product.selling_price * f : product.selling_price)
  return {
    quantity: row.quantity * f,
    unitPrice: round2(enteredPrice / f),
    saleUnit: packed ? product.pack_unit : null,
    saleUnitQty: packed ? row.quantity : null,
  }
}

export function saleRowStatus(
  row: SaleDraftRow,
  products: Product[],
): { status: 'ready' | 'unmatched' | 'invalid'; errors: string[]; warnings: string[] } {
  const product = row.productId ? products.find((p) => p.id === row.productId) : undefined
  if (!product) return { status: 'unmatched', errors: ['product'], warnings: [] }

  const errors: string[] = []
  if (!(row.quantity > 0)) errors.push('quantity')
  if (row.unitPrice !== null && !(row.unitPrice > 0)) errors.push('price')
  if (row.payment === 'credit' && !row.customer.trim()) errors.push('customer')
  if (errors.length > 0) return { status: 'invalid', errors, warnings: [] }

  const warnings: string[] = []
  if (toBaseSale(row, product).quantity > product.quantity) warnings.push('stock')
  return { status: 'ready', errors: [], warnings }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bulkSales/rows.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bulkSales/rows.ts src/lib/bulkSales/rows.test.ts
git commit -m "feat(bulk-sales): add sale row model, matching, pack conversion, validation"
```

---

### Task 2: Sales CSV template

**Files:**
- Create: `src/lib/bulkSales/template.ts`
- Test: `src/lib/bulkSales/template.test.ts`

**Interfaces:**
- Consumes: `toCSVRow` from `@/lib/bulkImport/csv`; `download` from `@/lib/export`.
- Produces: `export const SALES_TEMPLATE_HEADERS: string[]`, `export function buildSalesTemplateCSV(): string`, `export function downloadSalesTemplate(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bulkSales/template.test.ts
import { describe, it, expect } from 'vitest'
import { SALES_TEMPLATE_HEADERS, buildSalesTemplateCSV } from './template'

describe('buildSalesTemplateCSV', () => {
  it('has the documented headers in order', () => {
    expect(SALES_TEMPLATE_HEADERS).toEqual(['Product', 'Quantity', 'Unit', 'Unit Price', 'Payment', 'Customer', 'Date'])
  })
  it('emits a header row plus a cash example and a credit example', () => {
    const lines = buildSalesTemplateCSV().split('\n')
    expect(lines[0]).toBe('Product,Quantity,Unit,Unit Price,Payment,Customer,Date')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('cash')
    expect(lines[2]).toContain('credit')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bulkSales/template.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/bulkSales/template.ts
import { download } from '@/lib/export'
import { toCSVRow } from '@/lib/bulkImport/csv'

export const SALES_TEMPLATE_HEADERS = ['Product', 'Quantity', 'Unit', 'Unit Price', 'Payment', 'Customer', 'Date']

// Unit Price / Customer / Date may be left blank. Payment is cash | momo | bank | credit.
const EXAMPLE_ROWS = [
  ['Milo', 2, 'tin', '', 'cash', '', '2026-07-03'],
  ['Indomie', 5, 'sachet', '', 'credit', 'Ama', '2026-07-03'],
]

export function buildSalesTemplateCSV(): string {
  return [toCSVRow(SALES_TEMPLATE_HEADERS), ...EXAMPLE_ROWS.map(toCSVRow)].join('\n')
}

export function downloadSalesTemplate(): void {
  download('serwaabroni-sales-template.csv', '﻿' + buildSalesTemplateCSV())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bulkSales/template.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bulkSales/template.ts src/lib/bulkSales/template.test.ts
git commit -m "feat(bulk-sales): add downloadable sales CSV template"
```

---

### Task 3: Bulk-sales save orchestrator

**Files:**
- Create: `src/lib/bulkSales/save.ts`
- Test: `src/lib/bulkSales/save.test.ts`

**Interfaces:**
- Consumes: `SaleDraftRow`, `saleRowStatus`, `toBaseSale` (Task 1); `uid` from `@/lib/data`; `saleMovement` from `@/lib/cashPosting`; `Product` from `@/lib/supabase`.
- Produces:
  - `export interface BulkSalesApi { addSaleBatch: (sales: Record<string, unknown>[], items: { productId: string; qty: number }[]) => Promise<void>; addDebt: (debt: Record<string, unknown>) => Promise<void>; postMovement: (mv: { account: 'cash' | 'bank'; direction: 'in' | 'out'; amount: number; category: string; ref_table: string; ref_id: string; note: string | null; created_at: string }) => Promise<void> }`
  - `export interface BulkSalesResult { recorded: number; debts: number; failed: number; failures: { product: string; error: string }[] }`
  - `export async function saveBulkSales(rows: SaleDraftRow[], products: Product[], api: BulkSalesApi, onProgress?: (done: number, total: number) => void): Promise<BulkSalesResult>`

Behavior: skip rows whose `saleRowStatus` is `unmatched` or `invalid`. Build a Sale + item per valid row (own `sale_group_id`, `created_at = row.date`, base quantity/price via `toBaseSale`, `profit = (unitPrice − product.cost_price) × qty`). Call `addSaleBatch(sales, items)` once. Then per row: `saleMovement(payment, total, 0)` → if non-null `postMovement({ account, direction: 'in', amount, category: 'sale', ref_table: 'sales', ref_id: groupId, note: customer || null, created_at: row.date })`; and for credit rows `addDebt(...)`. Movement/debt errors are captured per row (do not abort). Count `recorded` (sales written), `debts` (credit debts), `failed`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bulkSales/save.test.ts
import { describe, it, expect, vi } from 'vitest'
import { saveBulkSales } from './save'
import { normalizeSaleRow, matchSaleRow } from './rows'
import type { Product } from '@/lib/supabase'

const products: Product[] = [{
  id: 'indomie', user_id: 'u', name: 'Indomie', cost_price: 2, selling_price: 3, quantity: 100,
  unit: 'sachet', pack_unit: null, units_per_pack: 1, category: 'Noodles',
  low_stock_threshold: 5, created_at: '2026-07-01T00:00:00Z',
}]

function fakeApi() {
  return {
    addSaleBatch: vi.fn().mockResolvedValue(undefined),
    addDebt: vi.fn().mockResolvedValue(undefined),
    postMovement: vi.fn().mockResolvedValue(undefined),
  }
}
const mk = (over: Parameters<typeof normalizeSaleRow>[0]) => matchSaleRow(normalizeSaleRow(over), products)

describe('saveBulkSales', () => {
  it('records a cash sale, posts a ledger movement, no debt', async () => {
    const api = fakeApi()
    const row = mk({ product: 'Indomie', quantity: 5, payment: 'cash', date: '2026-07-03' })
    const res = await saveBulkSales([row], products, api)
    expect(res).toMatchObject({ recorded: 1, debts: 0, failed: 0 })
    const [sales, items] = api.addSaleBatch.mock.calls[0]
    expect(sales[0]).toMatchObject({ product_id: 'indomie', quantity: 5, unit_price: 3, total: 15, profit: 5, payment_method: 'cash' })
    expect(sales[0].created_at.startsWith('2026-07-03')).toBe(true)
    expect(items).toEqual([{ productId: 'indomie', qty: 5 }])
    expect(api.postMovement.mock.calls[0][0]).toMatchObject({ account: 'cash', direction: 'in', amount: 15, category: 'sale', ref_id: sales[0].sale_group_id, created_at: sales[0].created_at })
    expect(api.addDebt).not.toHaveBeenCalled()
  })

  it('records a credit sale and creates a linked owed debt, no movement', async () => {
    const api = fakeApi()
    const row = mk({ product: 'Indomie', quantity: 4, payment: 'credit', customer: 'Ama', date: '2026-07-03' })
    const res = await saveBulkSales([row], products, api)
    expect(res).toMatchObject({ recorded: 1, debts: 1 })
    const [sales] = api.addSaleBatch.mock.calls[0]
    expect(sales[0].payment_method).toBe('credit')
    expect(api.postMovement).not.toHaveBeenCalled()
    const debt = api.addDebt.mock.calls[0][0]
    expect(debt).toMatchObject({ person_name: 'Ama', amount: 12, type: 'owed', sale_group_id: sales[0].sale_group_id })
  })

  it('momo posts to the bank account', async () => {
    const api = fakeApi()
    const row = mk({ product: 'Indomie', quantity: 2, payment: 'momo' })
    await saveBulkSales([row], products, api)
    expect(api.postMovement.mock.calls[0][0]).toMatchObject({ account: 'bank', amount: 6 })
  })

  it('skips unmatched/invalid rows', async () => {
    const api = fakeApi()
    const bad = mk({ product: 'ZZZ', quantity: 2 }) // unmatched
    const res = await saveBulkSales([bad], products, api)
    expect(res.recorded).toBe(0)
    expect(api.addSaleBatch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bulkSales/save.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/bulkSales/save.ts
import type { Product } from '@/lib/supabase'
import { uid } from '@/lib/data'
import { saleMovement } from '@/lib/cashPosting'
import { saleRowStatus, toBaseSale, type SaleDraftRow } from './rows'

export interface BulkSalesApi {
  addSaleBatch: (
    sales: Record<string, unknown>[],
    items: { productId: string; qty: number }[],
  ) => Promise<void>
  addDebt: (debt: Record<string, unknown>) => Promise<void>
  postMovement: (mv: {
    account: 'cash' | 'bank'
    direction: 'in' | 'out'
    amount: number
    category: string
    ref_table: string
    ref_id: string
    note: string | null
    created_at: string
  }) => Promise<void>
}

export interface BulkSalesResult {
  recorded: number
  debts: number
  failed: number
  failures: { product: string; error: string }[]
}

interface Built {
  row: SaleDraftRow
  product: Product
  groupId: string
  total: number
  sale: Record<string, unknown>
  item: { productId: string; qty: number }
}

export async function saveBulkSales(
  rows: SaleDraftRow[],
  products: Product[],
  api: BulkSalesApi,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkSalesResult> {
  const result: BulkSalesResult = { recorded: 0, debts: 0, failed: 0, failures: [] }
  const built: Built[] = []

  for (const row of rows) {
    const status = saleRowStatus(row, products)
    if (status.status !== 'ready') {
      result.failed++
      result.failures.push({ product: row.product || 'row', error: status.status })
      continue
    }
    const product = products.find((p) => p.id === row.productId)!
    const base = toBaseSale(row, product)
    const groupId = uid()
    const total = Math.round(base.unitPrice * base.quantity * 100) / 100
    built.push({
      row,
      product,
      groupId,
      total,
      sale: {
        id: uid(),
        product_id: product.id,
        product_name: product.name,
        quantity: base.quantity,
        unit_price: base.unitPrice,
        total,
        profit: Math.round((base.unitPrice - product.cost_price) * base.quantity * 100) / 100,
        customer_name: row.payment === 'credit' ? row.customer : null,
        customer_phone: null,
        payment_method: row.payment,
        sale_group_id: groupId,
        sale_unit: base.saleUnit,
        sale_unit_qty: base.saleUnitQty,
        created_at: row.date,
      },
      item: { productId: product.id, qty: base.quantity },
    })
  }

  if (built.length === 0) return result

  try {
    await api.addSaleBatch(built.map((b) => b.sale), built.map((b) => b.item))
    result.recorded = built.length
  } catch (e) {
    result.failed += built.length
    built.forEach((b) => result.failures.push({ product: b.product.name, error: e instanceof Error ? e.message : String(e) }))
    return result
  }

  // Ledger movements + credit debts, dated to each sale.
  for (let i = 0; i < built.length; i++) {
    const b = built[i]
    const mv = saleMovement(b.row.payment, b.total, 0)
    try {
      if (mv) {
        await api.postMovement({
          account: mv.account, direction: 'in', amount: mv.amount, category: 'sale',
          ref_table: 'sales', ref_id: b.groupId, note: b.row.customer || null, created_at: b.row.date,
        })
      }
      if (b.row.payment === 'credit') {
        const itemCount = b.item.qty
        await api.addDebt({
          id: uid(),
          person_name: b.row.customer,
          phone: null,
          amount: b.total,
          amount_paid: 0,
          payments: [],
          description: `${itemCount} ${itemCount === 1 ? 'item' : 'items'} on credit`,
          type: 'owed',
          due_date: null,
          injection_id: null,
          sale_group_id: b.groupId,
          is_paid: false,
          paid_at: null,
          created_at: b.row.date,
        })
        result.debts++
      }
    } catch {
      /* ledger/debt is best-effort; the sale itself is already recorded */
    }
    onProgress?.(i + 1, built.length)
  }

  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bulkSales/save.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bulkSales/save.ts src/lib/bulkSales/save.test.ts
git commit -m "feat(bulk-sales): add bulk-sales save orchestrator"
```

---

### Task 4: Sales review table component

**Files:**
- Create: `src/components/sales/BulkSalesReviewTable.tsx`

**Interfaces:**
- Consumes: `SaleDraftRow`, `saleRowStatus`, `PAYMENTS` (Task 1); `formatCurrency` from `@/lib/data`; `Product` from `@/lib/supabase`; `Trash2` from `lucide-react`.
- Produces: `export default function BulkSalesReviewTable({ rows, products, onChange, onImport, importing }: { rows: SaleDraftRow[]; products: Product[]; onChange: (rows: SaleDraftRow[]) => void; onImport: () => void; importing: boolean })`.
- Behavior: per-row editable fields — a **Product `<select>`** (options: `products` by name, value = product id) that sets `productId`; numeric Qty; Unit text; numeric Unit Price (placeholder shows the product's price); a Payment `<select>` (PAYMENTS); a Customer input (shown when payment is credit); a Date `<input type="date">` bound to the ISO date; a Status pill (Ready / Match? / Fix) and a small stock warning; a delete button. Footer: counts and an Import button disabled while any row is `unmatched`/`invalid`, the list is empty, or `importing`.

- [ ] **Step 1: Implement**

```tsx
// src/components/sales/BulkSalesReviewTable.tsx
import { Trash2 } from 'lucide-react'
import type { Product } from '@/lib/supabase'
import { formatCurrency } from '@/lib/data'
import { saleRowStatus, PAYMENTS, type SaleDraftRow } from '@/lib/bulkSales/rows'

const toDateInput = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export default function BulkSalesReviewTable({
  rows, products, onChange, onImport, importing,
}: {
  rows: SaleDraftRow[]
  products: Product[]
  onChange: (rows: SaleDraftRow[]) => void
  onImport: () => void
  importing: boolean
}) {
  const set = (id: string, patch: Partial<SaleDraftRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id))

  const statuses = rows.map((r) => saleRowStatus(r, products))
  const blocked = statuses.some((s) => s.status !== 'ready')
  const readyCount = statuses.filter((s) => s.status === 'ready').length

  const pill = (s: 'ready' | 'unmatched' | 'invalid') =>
    s === 'ready' ? 'bg-accent-green text-white' : s === 'unmatched' ? 'bg-warm-gray text-ink' : 'bg-accent-red text-white'
  const label = (s: 'ready' | 'unmatched' | 'invalid') => (s === 'ready' ? 'Ready' : s === 'unmatched' ? 'Match?' : 'Fix')

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <div className="min-w-[840px] space-y-2">
          {rows.map((r, i) => {
            const s = statuses[i]
            const product = r.productId ? products.find((p) => p.id === r.productId) : undefined
            return (
              <div key={r.id} className="space-y-0.5">
                <div className="flex items-center gap-2 text-xs">
                  <select
                    value={r.productId ?? ''} onChange={(e) => set(r.id, { productId: e.target.value || null })}
                    className={`flex-1 min-w-0 harsh-border rounded-sm px-1 py-1.5 border ${r.productId ? 'border-ink/20' : 'border-accent-red'}`}
                  >
                    <option value="">— pick product{r.product ? ` (“${r.product}”)` : ''} —</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="number" inputMode="decimal" value={r.quantity || ''}
                    onChange={(e) => set(r.id, { quantity: Number(e.target.value) })} placeholder="Qty"
                    className={`w-14 harsh-border rounded-sm px-2 py-1.5 border ${s.errors.includes('quantity') ? 'border-accent-red' : 'border-ink/20'}`} />
                  <input value={r.unit} onChange={(e) => set(r.id, { unit: e.target.value })} placeholder="Unit"
                    className="w-16 harsh-border rounded-sm px-2 py-1.5 border border-ink/20" />
                  <input type="number" inputMode="decimal" value={r.unitPrice ?? ''}
                    onChange={(e) => set(r.id, { unitPrice: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder={product ? String(product.selling_price) : 'Price'}
                    className={`w-20 harsh-border rounded-sm px-2 py-1.5 border ${s.errors.includes('price') ? 'border-accent-red' : 'border-ink/20'}`} />
                  <select value={r.payment} onChange={(e) => set(r.id, { payment: e.target.value as SaleDraftRow['payment'] })}
                    className="w-20 harsh-border rounded-sm px-1 py-1.5 border border-ink/20">
                    {PAYMENTS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {r.payment === 'credit' && (
                    <input value={r.customer} onChange={(e) => set(r.id, { customer: e.target.value })} placeholder="Customer"
                      className={`w-24 harsh-border rounded-sm px-2 py-1.5 border ${s.errors.includes('customer') ? 'border-accent-red' : 'border-ink/20'}`} />
                  )}
                  <input type="date" value={toDateInput(r.date)}
                    onChange={(e) => set(r.id, { date: e.target.value ? new Date(e.target.value).toISOString() : r.date })}
                    className="w-32 harsh-border rounded-sm px-2 py-1.5 border border-ink/20" />
                  <span className={`shrink-0 px-2 py-1 rounded-sm text-[10px] uppercase ${pill(s.status)}`}>{label(s.status)}</span>
                  <button onClick={() => remove(r.id)} aria-label="Remove row" className="shrink-0 text-muted-text hover:text-accent-red">
                    <Trash2 size={14} />
                  </button>
                </div>
                {s.warnings.includes('stock') && (
                  <p className="text-[10px] text-accent-red pl-1">More than current stock — allowed, but stock will floor at 0.</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-ink/10 pt-3">
        <span className="text-xs text-muted-text">{readyCount} ready of {rows.length}</span>
        <button onClick={onImport} disabled={importing || rows.length === 0 || blocked}
          className="btn-tactile bg-ink text-white text-sm uppercase tracking-wide px-5 py-2.5 rounded-sm disabled:opacity-50">
          {importing ? 'Recording…' : `Record ${rows.length}`}
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
git add src/components/sales/BulkSalesReviewTable.tsx
git commit -m "feat(bulk-sales): add editable sales review table with product picker"
```

---

### Task 5: Bulk-sales sheet (Template tab) + Sales History entry

**Files:**
- Create: `src/components/sales/BulkSalesSheet.tsx`
- Modify: `src/pages/SalesHistory.tsx` (header "Bulk add" button + render the sheet)

**Interfaces:**
- Consumes: `useStore` from `@/lib/store`; `postMovement` from `@/services/cashApi`; `parseCSV` from `@/lib/bulkImport/csv`; `downloadSalesTemplate` (Task 2); `rowsFromMatrix`, `normalizeSaleRow`, `matchSaleRow`, type `SaleDraftRow` (Task 1); `saveBulkSales`, type `BulkSalesApi` (Task 3); `BulkSalesReviewTable` (Task 4); `Sheet` UI from `@/components/ui/sheet`.
- Produces: `export default function BulkSalesSheet({ open, onClose }: { open: boolean; onClose: () => void })`.

- [ ] **Step 1: Implement the sheet**

```tsx
// src/components/sales/BulkSalesSheet.tsx
import { useRef, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useStore } from '@/lib/store'
import { postMovement } from '@/services/cashApi'
import { parseCSV } from '@/lib/bulkImport/csv'
import { downloadSalesTemplate } from '@/lib/bulkSales/template'
import { rowsFromMatrix, normalizeSaleRow, matchSaleRow, type SaleDraftRow } from '@/lib/bulkSales/rows'
import { saveBulkSales, type BulkSalesApi } from '@/lib/bulkSales/save'
import BulkSalesReviewTable from './BulkSalesReviewTable'

export default function BulkSalesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, addSaleBatch, addDebt, showToast } = useStore()
  const [rows, setRows] = useState<SaleDraftRow[]>([])
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadRaws = (raws: ReturnType<typeof rowsFromMatrix>) => {
    setRows(raws.map((r) => matchSaleRow(normalizeSaleRow(r), state.products)))
    if (raws.length === 0) showToast('No rows found', 'error')
  }

  const onFile = async (file: File) => {
    const text = await file.text()
    loadRaws(rowsFromMatrix(parseCSV(text)))
  }

  const onImport = async () => {
    setImporting(true)
    const api: BulkSalesApi = {
      addSaleBatch: addSaleBatch as BulkSalesApi['addSaleBatch'],
      addDebt: addDebt as BulkSalesApi['addDebt'],
      postMovement,
    }
    try {
      const res = await saveBulkSales(rows, state.products, api)
      showToast(`Recorded ${res.recorded}${res.debts ? `, ${res.debts} on credit` : ''}${res.failed ? `, ${res.failed} skipped` : ''}`, res.failed ? 'error' : 'success')
      if (res.failed === 0) {
        setRows([])
        onClose()
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl h-[90vh] flex flex-col">
        <SheetHeader><SheetTitle>Bulk add sales</SheetTitle></SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadSalesTemplate} className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm">
              Download template
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()} className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm">
              Upload filled CSV
            </button>
          </div>

          {rows.length > 0 ? (
            <BulkSalesReviewTable rows={rows} products={state.products} onChange={setRows} onImport={onImport} importing={importing} />
          ) : (
            <p className="text-sm text-muted-text text-center py-8">
              Download the template, fill it from your sales book, then upload it here. Each row is matched to a
              product; set the payment and the date the sale happened. Blank date = today.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Add the entry button to Sales History**

In `src/pages/SalesHistory.tsx`: add `import BulkSalesSheet from '@/components/sales/BulkSalesSheet'`, a `const [showBulk, setShowBulk] = useState(false)` near the other `useState`s, and in the header (the `flex items-center justify-between` bar with the title and the close button) insert a "Bulk add" button before the close button, wrapping the two buttons in a `flex items-center gap-2` if needed:

```tsx
<div className="flex items-center gap-2">
  <button onClick={() => setShowBulk(true)} className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 h-10 rounded-sm">
    Bulk add
  </button>
  <button onClick={onClose} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
    <X size={20} strokeWidth={2.5} className="text-ink" />
  </button>
</div>
```

and render the sheet before the component's closing `</div>`:

```tsx
<BulkSalesSheet open={showBulk} onClose={() => setShowBulk(false)} />
```

Read `SalesHistory.tsx` first and integrate without breaking the existing header/close markup.

- [ ] **Step 3: Typecheck, full suite, build**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, sign in, open a sale-heavy day, open Sales History → Bulk add:
1. Download template → CSV downloads with a cash and a credit example.
2. Fill 3–4 rows (products you stock, one credit with a customer, past dates) → upload → review shows Ready/Match?/Fix; an unmatched product shows a red picker; credit without a customer shows Fix.
3. Fix rows; Record → toast "Recorded X, Y on credit"; sales appear in history dated to the entered dates; cash-in-hand rises by cash totals; a "they owe you" debt exists for the credit customer; stock dropped.

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/BulkSalesSheet.tsx src/pages/SalesHistory.tsx
git commit -m "feat(bulk-sales): add bulk-sales sheet (CSV) and Sales History entry"
```

---

## Phase 2 — Photo (Claude vision)

### Task 6: Sales-vision edge function

**Files:**
- Create: `supabase/functions/serwaa-sales-vision/index.ts`
- Modify: `supabase/config.toml` (register with `verify_jwt = false`)

**Interfaces:**
- Consumes: `corsHeaders`, `json` from `../_shared/cors.ts`; env `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Produces: endpoint `/functions/v1/serwaa-sales-vision`.
  - Request: `{ userJwt: string; imageBase64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }`
  - Response: `{ rows: Array<{ product?: string; quantity?: number; unit?: string; unit_price?: number; payment?: string; customer?: string; date?: string }> }`

- [ ] **Step 1: Create the function**

```ts
// supabase/functions/serwaa-sales-vision/index.ts
// Reads a photo of a handwritten sales log with Claude vision and returns rows.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const MODEL = 'claude-sonnet-5'

const PROMPT =
  'You are reading a photo of a shop\'s SALES log. It may be TYPED or HANDWRITTEN, ' +
  'often a table where each line is one sale. Transcribe it carefully, reading the ' +
  'handwriting as best you can. Output one row per sale line. Respond with JSON ONLY — ' +
  'no explanation, no markdown fences: an array of objects with keys ' +
  'product (string), quantity (number), unit (string), unit_price (number), ' +
  'payment (string: cash, momo, bank, or credit), customer (string), date (string, e.g. 2026-07-03). ' +
  'Include a row even if some fields are missing — omit only the keys you cannot read. ' +
  'Amounts are plain numbers with no currency symbols. If the image has no sales list, return [].'

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
        max_tokens: 3000,
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
# Client-invoked: reads a sales-log photo with Claude vision. The function
# validates the user token in the body, so the gateway JWT check is disabled.
[functions.serwaa-sales-vision]
verify_jwt = false
```

- [ ] **Step 3: Commit (deploy is a manual owner step)**

```bash
git add supabase/functions/serwaa-sales-vision/index.ts supabase/config.toml
git commit -m "feat(bulk-sales): add Claude-vision sales-photo edge function"
```

> Deploy (owner): `supabase functions deploy serwaa-sales-vision --project-ref <ref>`. `ANTHROPIC_API_KEY` is already set.

---

### Task 7: Sales-vision client

**Files:**
- Create: `src/lib/bulkSales/vision.ts`
- Test: `src/lib/bulkSales/vision.test.ts`

**Interfaces:**
- Consumes: `SaleRawRow` (Task 1); `supabase`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` from `@/lib/supabase`.
- Produces:
  - `export function normalizeSalesVisionRows(rows: unknown): SaleRawRow[]`
  - `export async function extractSalesFromImage(file: File, deps?): Promise<SaleRawRow[]>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/bulkSales/vision.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeSalesVisionRows } from './vision'

describe('normalizeSalesVisionRows', () => {
  it('coerces model output to SaleRawRow fields and drops junk', () => {
    const input = [
      { product: 'Milo', quantity: '2', unit_price: '3', payment: 'Cash', customer: 'Ama', date: '2026-07-03', unit: 'tin' },
      { quantity: 5 }, // no product → dropped
      'nonsense',
      null,
    ]
    expect(normalizeSalesVisionRows(input)).toEqual([
      { product: 'Milo', quantity: 2, unit_price: 3, payment: 'Cash', customer: 'Ama', date: '2026-07-03', unit: 'tin' },
    ])
  })
  it('returns [] for non-arrays', () => {
    expect(normalizeSalesVisionRows({})).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bulkSales/vision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/bulkSales/vision.ts
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import type { SaleRawRow } from './rows'

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

export function normalizeSalesVisionRows(rows: unknown): SaleRawRow[] {
  if (!Array.isArray(rows)) return []
  const out: SaleRawRow[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const row: SaleRawRow = {}
    const product = str(o.product)
    if (product) row.product = product
    const unit = str(o.unit); if (unit) row.unit = unit
    const payment = str(o.payment); if (payment) row.payment = payment
    const customer = str(o.customer); if (customer) row.customer = customer
    const date = str(o.date); if (date) row.date = date
    const q = num(o.quantity); if (q !== undefined) row.quantity = q
    const up = num(o.unit_price); if (up !== undefined) row.unit_price = up
    if (row.product) out.push(row)
  }
  return out
}

interface Deps {
  getToken: () => Promise<string | null>
  doFetch: typeof fetch
  toBase64: (file: File) => Promise<{ base64: string; mediaType: string }>
}

async function compressToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That image format could not be read. Try a JPG/PNG photo.')
  }
  const max = 1568
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
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

export async function extractSalesFromImage(file: File, deps: Deps = defaultDeps): Promise<SaleRawRow[]> {
  const token = await deps.getToken()
  if (!token) throw new Error('You are not signed in.')
  const { base64, mediaType } = await deps.toBase64(file)
  const res = await deps.doFetch(`${SUPABASE_URL}/functions/v1/serwaa-sales-vision`, {
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
  return normalizeSalesVisionRows((data as { rows?: unknown }).rows)
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/lib/bulkSales/vision.test.ts && npx tsc -b`
Expected: PASS (2 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bulkSales/vision.ts src/lib/bulkSales/vision.test.ts
git commit -m "feat(bulk-sales): add sales-photo vision client"
```

---

### Task 8: Photo tab in the bulk-sales sheet

**Files:**
- Modify: `src/components/sales/BulkSalesSheet.tsx`

**Interfaces:**
- Consumes: `extractSalesFromImage` (Task 7).
- Adds a Template / Photo tab switcher. Photo tab: a file input with `accept="image/*"` and `capture="environment"`; on select, show a "Reading photo…" state, call `extractSalesFromImage`, feed results through the same `loadRaws` (normalize + match), and show the review table. Errors toast.

- [ ] **Step 1: Add the photo path**

Add the import:

```tsx
import { extractSalesFromImage } from '@/lib/bulkSales/vision'
```

Add state (near the existing `useState`s):

```tsx
const [tab, setTab] = useState<'template' | 'photo'>('template')
const [reading, setReading] = useState(false)
const photoRef = useRef<HTMLInputElement>(null)
```

Add the handler:

```tsx
const onPhoto = async (file: File) => {
  setReading(true)
  try {
    loadRaws(await extractSalesFromImage(file))
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Could not read the photo', 'error')
  } finally {
    setReading(false)
  }
}
```

Render a tab switcher above the intake controls:

```tsx
<div className="flex bg-warm-gray rounded-sm p-1">
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
    <p className="text-[11px] text-muted-text">Photograph a clear sales list (typed or handwritten). Review before recording.</p>
  </div>
)}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc -b && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 3: Manual verification (needs the deployed sales-vision function)**

Deploy `serwaa-sales-vision`, then on a phone: Sales History → Bulk add → Photo → snap a handwritten sales list → rows appear → match products, set payments/dates → Record.

- [ ] **Step 4: Commit**

```bash
git add src/components/sales/BulkSalesSheet.tsx
git commit -m "feat(bulk-sales): add photo tab (Claude vision) to bulk-sales sheet"
```

---

## Self-Review

- **Spec coverage:** template download+parse (Tasks 2,5), photo/vision (Tasks 6,7,8), review table with product picker (Task 4), per-row product match + date + payment + pack (Tasks 1,4), credit→debt + ledger posting dated per sale (Task 3), stock-underflow warning (Tasks 1,4), save via addSaleBatch (Task 3), Sales History entry (Task 5), security/JWT (Task 6), image compression (Task 7). ✓
- **Placeholder scan:** every code step is complete; no TBD/TODO. ✓
- **Type consistency:** `SaleRawRow`, `SaleDraftRow`, `Payment`, `PAYMENTS`, `rowsFromMatrix`, `normalizeSaleRow`, `matchSaleRow`, `isPackedSale`, `toBaseSale`, `saleRowStatus`, `BulkSalesApi`, `BulkSalesResult`, `saveBulkSales`, `SALES_TEMPLATE_HEADERS`, `buildSalesTemplateCSV`, `downloadSalesTemplate`, `extractSalesFromImage`, `normalizeSalesVisionRows` are defined once and reused with matching shapes. ✓

## Deferred / out of scope

- Bulk edit/delete of existing sales; partial-payment credit (deposit); quick-create product from the sales flow; multi-image stitching. Batch DB insert optimization deferred.
