# SerwaaBroni Agent — Phase 1 (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a voice+text agent "SerwaaBroni" that records stock/restock and cash/credit sales (with a mandatory confirm card) and answers real-time business questions, in English, backed by a Claude Haiku Supabase Edge Function.

**Architecture:** A floating mic/chat sheet captures user input (browser Web Speech for English voice, or typed text). Input + a compact business snapshot go to a Supabase Edge Function that calls Claude Haiku with an allow-listed tool schema. Claude returns either a spoken text answer (read tools, resolved client-side from `state`) or a proposed write action, which the client renders as a confirm card and, on approval, executes through the existing store functions (`addSaleBatch`, `addDebt`, `addProduct`, `updateProduct`). The agent never writes to the DB directly.

**Tech Stack:** React 18 + TypeScript + Vite, Vitest (node env), Supabase (Deno Edge Functions + Postgres), Anthropic Messages API (Claude Haiku), Web Speech API.

## Global Constraints

- Currency is Ghana Cedis; format money via existing `formatCurrency` from `@/lib/data` (never hand-roll).
- All DB writes go through existing store functions in `src/lib/store.tsx`. No new direct Supabase writes from the agent.
- Every money-moving action (sale, credit sale, new product, add stock) requires an explicit user confirm tap before it is written.
- Edge functions authenticate the caller by validating `userJwt` via GoTrue, exactly like `supabase/functions/admin-impersonate` and `send-notification` (send anon key as `Authorization: Bearer`, user token in body).
- Secrets `ANTHROPIC_API_KEY` live only in Supabase (`supabase secrets set`), never in the SPA bundle.
- LLM model is `claude-haiku-4-5-20251001` on every turn. Keep per-turn context to the last 4 messages + one snapshot.
- Tests: Vitest, node environment, files named `*.test.ts` under `src/`. Import style: `import { describe, it, expect } from 'vitest'`. Path alias `@` → `src`.
- Product name matching is fuzzy and case-insensitive; on ambiguity the agent must ask, never guess.

---

### Task 1: Agent shared types

**Files:**
- Create: `src/lib/agent/types.ts`

**Interfaces:**
- Consumes: `Product`, `Debt`, `Sale` from `@/lib/supabase` (existing).
- Produces:
  - `type AgentToolName` (union of the 9 tool names)
  - `interface ToolCall { name: AgentToolName; input: Record<string, unknown> }`
  - `interface AgentMessage { role: 'user' | 'assistant'; content: string }`
  - `interface AgentResponse { say: string; toolCalls: ToolCall[] }`
  - `interface BusinessSnapshot { ... }` (see Task 2)
  - `type ConfirmKind = 'sale' | 'credit_sale' | 'new_product' | 'add_stock'`
  - `interface ConfirmLine { label: string; value: string }`
  - `interface SaleItemResolved { productId: string; productName: string; unitPrice: number; unitCost: number; qty: number }`
  - `interface ConfirmPreview { kind: ConfirmKind; title: string; lines: ConfirmLine[]; warnings: string[]; sale?: { items: SaleItemResolved[]; payment: 'cash' | 'bank' }; credit?: { items: SaleItemResolved[]; customerName: string; dueDate: string | null }; newProduct?: { name: string; costPrice: number; sellPrice: number; qty: number; category: string; payment: 'cash' | 'bank' | 'supplier_credit' }; addStock?: { productId: string; productName: string; qty: number; unitCost: number } }`
  - `interface ReadResult { text: string }`

- [ ] **Step 1: Create the types file**

```ts
// src/lib/agent/types.ts
import type { Product, Debt, Sale } from '@/lib/supabase'

export type AgentToolName =
  | 'new_product'
  | 'add_stock'
  | 'add_sale'
  | 'add_credit_sale'
  | 'get_summary'
  | 'get_low_stock'
  | 'get_debts'
  | 'get_top_products'
  | 'get_alerts'

export interface ToolCall {
  name: AgentToolName
  input: Record<string, unknown>
}

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentResponse {
  say: string
  toolCalls: ToolCall[]
}

export interface SnapshotProduct {
  id: string
  name: string
  qty: number
  unit: string
  price: number
}

export interface BusinessSnapshot {
  currency: 'GHS'
  todaySales: number
  todayProfit: number
  cashInHand: number
  cashInBank: number
  products: SnapshotProduct[]
  lowStock: { name: string; qty: number }[]
  owedTotal: number
  owingTotal: number
}

export type ConfirmKind = 'sale' | 'credit_sale' | 'new_product' | 'add_stock'

export interface ConfirmLine {
  label: string
  value: string
}

export interface SaleItemResolved {
  productId: string
  productName: string
  unitPrice: number
  unitCost: number
  qty: number
}

export interface ConfirmPreview {
  kind: ConfirmKind
  title: string
  lines: ConfirmLine[]
  warnings: string[]
  sale?: { items: SaleItemResolved[]; payment: 'cash' | 'bank' }
  credit?: { items: SaleItemResolved[]; customerName: string; dueDate: string | null }
  newProduct?: {
    name: string
    costPrice: number
    sellPrice: number
    qty: number
    category: string
    payment: 'cash' | 'bank' | 'supplier_credit'
  }
  addStock?: { productId: string; productName: string; qty: number; unitCost: number }
}

export interface ReadResult {
  text: string
}

// Re-export for convenience in agent modules.
export type { Product, Debt, Sale }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/types.ts
git commit -m "feat(agent): add SerwaaBroni agent shared types"
```

---

### Task 2: Business snapshot builder

**Files:**
- Create: `src/lib/agent/snapshot.ts`
- Test: `src/lib/agent/snapshot.test.ts`

**Interfaces:**
- Consumes: `BusinessSnapshot`, `SnapshotProduct` from Task 1; `AppState` shape (subset) from `@/lib/store`.
- Produces: `export function buildSnapshot(input: SnapshotInput): BusinessSnapshot` where `SnapshotInput` is the minimal fields it needs (so tests don't need the full store).
  - `interface SnapshotInput { products: Product[]; debts: Debt[]; todaySales: number; todayProfit: number; cashInHand: number; cashInBank: number }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agent/snapshot.test.ts
import { describe, it, expect } from 'vitest'
import { buildSnapshot } from './snapshot'
import type { Product, Debt } from '@/lib/supabase'

const p = (over: Partial<Product>): Product => ({
  id: 'p1', user_id: 'u', name: 'Indomie', cost_price: 2, selling_price: 3,
  quantity: 10, unit: 'sachet', units_per_pack: 1, category: 'food',
  low_stock_threshold: 5, created_at: '2026-07-01T00:00:00Z', ...over,
})
const d = (over: Partial<Debt>): Debt => ({
  id: 'd1', user_id: 'u', person_name: 'Ama', phone: null, amount: 100,
  amount_paid: 0, payments: [], description: null, type: 'owed', due_date: null,
  is_paid: false, paid_at: null, created_at: '2026-07-01T00:00:00Z', ...over,
})

describe('buildSnapshot', () => {
  it('summarises products, low stock, and debts', () => {
    const snap = buildSnapshot({
      products: [
        p({ id: 'a', name: 'Indomie', quantity: 10, selling_price: 3 }),
        p({ id: 'b', name: 'Milo', quantity: 2, low_stock_threshold: 5, selling_price: 8 }),
      ],
      debts: [
        d({ type: 'owed', amount: 100, is_paid: false }),
        d({ type: 'owing', amount: 40, is_paid: false }),
        d({ type: 'owed', amount: 999, is_paid: true }),
      ],
      todaySales: 500, todayProfit: 120, cashInHand: 300, cashInBank: 700,
    })
    expect(snap.currency).toBe('GHS')
    expect(snap.products).toHaveLength(2)
    expect(snap.products[0]).toEqual({ id: 'a', name: 'Indomie', qty: 10, unit: 'sachet', price: 3 })
    expect(snap.lowStock).toEqual([{ name: 'Milo', qty: 2 }])
    expect(snap.owedTotal).toBe(100)   // excludes paid
    expect(snap.owingTotal).toBe(40)
    expect(snap.todaySales).toBe(500)
  })

  it('caps the product list to 80 items to bound tokens', () => {
    const many: Product[] = Array.from({ length: 200 }, (_, i) => p({ id: `p${i}`, name: `Item ${i}` }))
    const snap = buildSnapshot({ products: many, debts: [], todaySales: 0, todayProfit: 0, cashInHand: 0, cashInBank: 0 })
    expect(snap.products.length).toBe(80)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agent/snapshot.test.ts`
Expected: FAIL — `buildSnapshot` not defined.

- [ ] **Step 3: Implement**

```ts
// src/lib/agent/snapshot.ts
import type { Product, Debt } from '@/lib/supabase'
import type { BusinessSnapshot, SnapshotProduct } from './types'

export interface SnapshotInput {
  products: Product[]
  debts: Debt[]
  todaySales: number
  todayProfit: number
  cashInHand: number
  cashInBank: number
}

const MAX_PRODUCTS = 80

export function buildSnapshot(input: SnapshotInput): BusinessSnapshot {
  const products: SnapshotProduct[] = input.products.slice(0, MAX_PRODUCTS).map((p) => ({
    id: p.id,
    name: p.name,
    qty: p.quantity,
    unit: p.unit,
    price: p.selling_price,
  }))

  const lowStock = input.products
    .filter((p) => p.quantity <= (p.low_stock_threshold || 5))
    .map((p) => ({ name: p.name, qty: p.quantity }))

  const owedTotal = input.debts
    .filter((x) => x.type === 'owed' && !x.is_paid)
    .reduce((s, x) => s + x.amount, 0)
  const owingTotal = input.debts
    .filter((x) => x.type === 'owing' && !x.is_paid)
    .reduce((s, x) => s + x.amount, 0)

  return {
    currency: 'GHS',
    todaySales: input.todaySales,
    todayProfit: input.todayProfit,
    cashInHand: input.cashInHand,
    cashInBank: input.cashInBank,
    products,
    lowStock,
    owedTotal,
    owingTotal,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agent/snapshot.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/snapshot.ts src/lib/agent/snapshot.test.ts
git commit -m "feat(agent): add business snapshot builder"
```

---

### Task 3: Fuzzy product matcher

**Files:**
- Create: `src/lib/agent/match.ts`
- Test: `src/lib/agent/match.test.ts`

**Interfaces:**
- Consumes: `Product` from `@/lib/supabase`.
- Produces: `export interface MatchResult { product: Product | null; candidates: Product[]; ambiguous: boolean }` and `export function matchProduct(query: string, products: Product[]): MatchResult`.
  - Rules: exact case-insensitive name → unique match. Else substring/startsWith scoring. If exactly one candidate scores highest → match. If ≥2 candidates tie at the top score → `ambiguous: true`, `product: null`, `candidates` = the tied set. If none → `product: null`, `candidates: []`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agent/match.test.ts
import { describe, it, expect } from 'vitest'
import { matchProduct } from './match'
import type { Product } from '@/lib/supabase'

const mk = (name: string, id = name): Product => ({
  id, user_id: 'u', name, cost_price: 1, selling_price: 2, quantity: 5,
  unit: 'pc', units_per_pack: 1, category: 'x', low_stock_threshold: 5,
  created_at: '2026-07-01T00:00:00Z',
})

const products = [mk('Indomie'), mk('Milo'), mk('Mackerel 7 Gh', 'm7'), mk('Mackerel 15 Gh', 'm15')]

describe('matchProduct', () => {
  it('matches exact name case-insensitively', () => {
    const r = matchProduct('indomie', products)
    expect(r.product?.name).toBe('Indomie')
    expect(r.ambiguous).toBe(false)
  })

  it('matches unique substring', () => {
    const r = matchProduct('milo', products)
    expect(r.product?.name).toBe('Milo')
  })

  it('flags ambiguous when multiple tie', () => {
    const r = matchProduct('mackerel', products)
    expect(r.product).toBeNull()
    expect(r.ambiguous).toBe(true)
    expect(r.candidates.map((c) => c.name).sort()).toEqual(['Mackerel 15 Gh', 'Mackerel 7 Gh'])
  })

  it('returns no match for unknown', () => {
    const r = matchProduct('zzz', products)
    expect(r.product).toBeNull()
    expect(r.ambiguous).toBe(false)
    expect(r.candidates).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agent/match.test.ts`
Expected: FAIL — `matchProduct` not defined.

- [ ] **Step 3: Implement**

```ts
// src/lib/agent/match.ts
import type { Product } from '@/lib/supabase'

export interface MatchResult {
  product: Product | null
  candidates: Product[]
  ambiguous: boolean
}

function score(query: string, name: string): number {
  const q = query.trim().toLowerCase()
  const n = name.trim().toLowerCase()
  if (!q) return 0
  if (n === q) return 100
  if (n.startsWith(q)) return 80
  if (n.includes(q)) return 60
  // token overlap: any query word contained in the name
  const qWords = q.split(/\s+/)
  if (qWords.some((w) => w.length >= 3 && n.includes(w))) return 40
  return 0
}

export function matchProduct(query: string, products: Product[]): MatchResult {
  const scored = products
    .map((p) => ({ p, s: score(query, p.name) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)

  if (scored.length === 0) return { product: null, candidates: [], ambiguous: false }

  const top = scored[0].s
  const tied = scored.filter((x) => x.s === top)
  if (tied.length === 1) return { product: tied[0].p, candidates: [tied[0].p], ambiguous: false }
  return { product: null, candidates: tied.map((x) => x.p), ambiguous: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agent/match.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/match.ts src/lib/agent/match.test.ts
git commit -m "feat(agent): add fuzzy product matcher"
```

---

### Task 4: Read-tool resolver

**Files:**
- Create: `src/lib/agent/readTools.ts`
- Test: `src/lib/agent/readTools.test.ts`

**Interfaces:**
- Consumes: `ToolCall`, `ReadResult` from Task 1; `generateAlerts` from `@/lib/alerts`; `formatCurrency` from `@/lib/data`; `Product`, `Debt`, `Sale`, `Expense` from `@/lib/supabase`.
- Produces: `export interface ReadContext { products: Product[]; sales: Sale[]; debts: Debt[]; expenses: Expense[]; snapshot: BusinessSnapshot }` and `export function runReadTool(call: ToolCall, ctx: ReadContext): ReadResult | null` — returns `null` if the tool is not a read tool.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agent/readTools.test.ts
import { describe, it, expect } from 'vitest'
import { runReadTool } from './readTools'
import { buildSnapshot } from './snapshot'
import type { Product, Debt } from '@/lib/supabase'

const p = (over: Partial<Product>): Product => ({
  id: 'p', user_id: 'u', name: 'Milo', cost_price: 4, selling_price: 8, quantity: 2,
  unit: 'tin', units_per_pack: 1, category: 'food', low_stock_threshold: 5,
  created_at: '2026-07-01T00:00:00Z', ...over,
})
const d = (over: Partial<Debt>): Debt => ({
  id: 'd', user_id: 'u', person_name: 'Ama', phone: null, amount: 50, amount_paid: 0,
  payments: [], description: null, type: 'owed', due_date: null, is_paid: false,
  paid_at: null, created_at: '2026-07-01T00:00:00Z', ...over,
})

function ctx(products: Product[], debts: Debt[]) {
  const snapshot = buildSnapshot({ products, debts, todaySales: 500, todayProfit: 120, cashInHand: 300, cashInBank: 700 })
  return { products, sales: [], debts, expenses: [], snapshot }
}

describe('runReadTool', () => {
  it('summarises the day', () => {
    const r = runReadTool({ name: 'get_summary', input: { period: 'daily' } }, ctx([p({})], []))
    expect(r?.text).toContain('500')
    expect(r?.text.toLowerCase()).toContain('profit')
  })

  it('lists low stock', () => {
    const r = runReadTool({ name: 'get_low_stock', input: {} }, ctx([p({ name: 'Milo', quantity: 2 })], []))
    expect(r?.text).toContain('Milo')
  })

  it('reports who owes', () => {
    const r = runReadTool({ name: 'get_debts', input: { direction: 'owed' } }, ctx([], [d({ person_name: 'Ama', amount: 50 })]))
    expect(r?.text).toContain('Ama')
  })

  it('returns null for a write tool', () => {
    expect(runReadTool({ name: 'add_sale', input: {} }, ctx([], []))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agent/readTools.test.ts`
Expected: FAIL — `runReadTool` not defined.

- [ ] **Step 3: Implement**

```ts
// src/lib/agent/readTools.ts
import type { Product, Debt, Sale, Expense } from '@/lib/supabase'
import { formatCurrency } from '@/lib/data'
import { generateAlerts } from '@/lib/alerts'
import type { ToolCall, ReadResult, BusinessSnapshot } from './types'

export interface ReadContext {
  products: Product[]
  sales: Sale[]
  debts: Debt[]
  expenses: Expense[]
  snapshot: BusinessSnapshot
}

export function runReadTool(call: ToolCall, ctx: ReadContext): ReadResult | null {
  const s = ctx.snapshot
  switch (call.name) {
    case 'get_summary': {
      return {
        text: `Today's sales are ${formatCurrency(s.todaySales)} with profit ${formatCurrency(
          s.todayProfit,
        )}. Cash in hand ${formatCurrency(s.cashInHand)}, bank ${formatCurrency(s.cashInBank)}.`,
      }
    }
    case 'get_low_stock': {
      if (s.lowStock.length === 0) return { text: 'All your stock levels are healthy right now.' }
      const list = s.lowStock.map((x) => `${x.name} (${x.qty} left)`).join(', ')
      return { text: `These items are low: ${list}. Please restock soon.` }
    }
    case 'get_debts': {
      const dir = (call.input.direction as string) === 'owing' ? 'owing' : 'owed'
      const list = ctx.debts.filter((x) => x.type === dir && !x.is_paid)
      if (list.length === 0) {
        return { text: dir === 'owed' ? 'Nobody owes you right now.' : "You don't owe anyone right now." }
      }
      const byPerson = new Map<string, number>()
      list.forEach((x) => byPerson.set(x.person_name, (byPerson.get(x.person_name) || 0) + x.amount))
      const lines = Array.from(byPerson, ([name, amt]) => `${name} ${formatCurrency(amt)}`).join(', ')
      const total = dir === 'owed' ? s.owedTotal : s.owingTotal
      return {
        text:
          dir === 'owed'
            ? `People owe you ${formatCurrency(total)} in total: ${lines}.`
            : `You owe ${formatCurrency(total)} in total: ${lines}.`,
      }
    }
    case 'get_top_products': {
      const top = [...ctx.snapshot.products].slice(0, 5).map((p) => p.name).join(', ')
      return { text: top ? `Your products include: ${top}.` : 'You have no products yet.' }
    }
    case 'get_alerts': {
      const alerts = generateAlerts(ctx.products, ctx.sales, ctx.debts, ctx.expenses)
      if (alerts.length === 0) return { text: 'No alerts. Everything looks good.' }
      return { text: alerts.slice(0, 4).map((a) => `${a.title}: ${a.message}`).join(' ') }
    }
    default:
      return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agent/readTools.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/readTools.ts src/lib/agent/readTools.test.ts
git commit -m "feat(agent): add read-tool resolver"
```

---

### Task 5: Write-tool preview builder

**Files:**
- Create: `src/lib/agent/writeTools.ts`
- Test: `src/lib/agent/writeTools.test.ts`

**Interfaces:**
- Consumes: `ToolCall`, `ConfirmPreview`, `SaleItemResolved`, `Product` from Task 1; `matchProduct` from Task 3; `formatCurrency` from `@/lib/data`.
- Produces: `export interface PreviewContext { products: Product[] }` and `export function buildPreview(call: ToolCall, ctx: PreviewContext): ConfirmPreview | { error: string }`.
  - `add_sale` / `add_credit_sale` input shape: `{ items: { product: string; qty: number }[]; payment?: 'cash'|'bank'; customer_name?: string; due_date?: string }`.
  - `new_product` input: `{ name; cost_price; sell_price; qty; category?; payment?: 'cash'|'bank'|'supplier_credit' }`.
  - `add_stock` input: `{ product: string; qty: number; cost_price?: number }`.
  - On any ambiguous/failed product match, return `{ error }` describing which item is unclear (so the agent can re-ask).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agent/writeTools.test.ts
import { describe, it, expect } from 'vitest'
import { buildPreview } from './writeTools'
import type { Product } from '@/lib/supabase'

const mk = (name: string, over: Partial<Product> = {}): Product => ({
  id: name, user_id: 'u', name, cost_price: 2, selling_price: 3, quantity: 20,
  unit: 'pc', units_per_pack: 1, category: 'food', low_stock_threshold: 5,
  created_at: '2026-07-01T00:00:00Z', ...over,
})

const ctx = { products: [mk('Indomie'), mk('Milo', { cost_price: 4, selling_price: 8 }), mk('Mackerel 7 Gh'), mk('Mackerel 15 Gh')] }

describe('buildPreview', () => {
  it('builds a cash sale preview with resolved prices and profit', () => {
    const r = buildPreview({ name: 'add_sale', input: { items: [{ product: 'indomie', qty: 5 }], payment: 'cash' } }, ctx)
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('sale')
    expect(r.sale?.items[0]).toMatchObject({ productName: 'Indomie', qty: 5, unitPrice: 3, unitCost: 2 })
    expect(r.sale?.payment).toBe('cash')
    // total line present
    expect(r.lines.some((l) => l.value.includes('15'))).toBe(true) // 5 * 3 = 15
  })

  it('errors on ambiguous product', () => {
    const r = buildPreview({ name: 'add_sale', input: { items: [{ product: 'mackerel', qty: 1 }], payment: 'cash' } }, ctx)
    expect('error' in r).toBe(true)
  })

  it('builds a credit sale preview', () => {
    const r = buildPreview(
      { name: 'add_credit_sale', input: { items: [{ product: 'milo', qty: 2 }], customer_name: 'Ama' } },
      ctx,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('credit_sale')
    expect(r.credit?.customerName).toBe('Ama')
    expect(r.credit?.items[0].qty).toBe(2)
  })

  it('builds a new_product preview', () => {
    const r = buildPreview(
      { name: 'new_product', input: { name: 'Rice 5kg', cost_price: 40, sell_price: 55, qty: 10 } },
      ctx,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('new_product')
    expect(r.newProduct).toMatchObject({ name: 'Rice 5kg', costPrice: 40, sellPrice: 55, qty: 10, payment: 'cash' })
  })

  it('builds an add_stock preview against an existing product', () => {
    const r = buildPreview({ name: 'add_stock', input: { product: 'indomie', qty: 24 } }, ctx)
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('add_stock')
    expect(r.addStock).toMatchObject({ productName: 'Indomie', qty: 24, unitCost: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agent/writeTools.test.ts`
Expected: FAIL — `buildPreview` not defined.

- [ ] **Step 3: Implement**

```ts
// src/lib/agent/writeTools.ts
import type { Product } from '@/lib/supabase'
import { formatCurrency } from '@/lib/data'
import { matchProduct } from './match'
import type { ToolCall, ConfirmPreview, SaleItemResolved } from './types'

export interface PreviewContext {
  products: Product[]
}

interface RawItem {
  product: string
  qty: number
}

function resolveItems(
  raw: RawItem[],
  products: Product[],
): { items: SaleItemResolved[] } | { error: string } {
  const items: SaleItemResolved[] = []
  for (const r of raw) {
    const qty = Number(r.qty)
    if (!qty || qty <= 0) return { error: `How many ${r.product} did you mean?` }
    const m = matchProduct(String(r.product ?? ''), products)
    if (m.ambiguous) {
      return { error: `Did you mean ${m.candidates.map((c) => c.name).join(' or ')}?` }
    }
    if (!m.product) return { error: `I couldn't find "${r.product}" in your stock. Please say the name again.` }
    items.push({
      productId: m.product.id,
      productName: m.product.name,
      unitPrice: m.product.selling_price,
      unitCost: m.product.cost_price,
      qty,
    })
  }
  if (items.length === 0) return { error: 'Which item did you sell?' }
  return { items }
}

function saleLines(items: SaleItemResolved[]): { lines: { label: string; value: string }[]; total: number } {
  const lines = items.map((i) => ({
    label: `${i.productName} ×${i.qty}`,
    value: formatCurrency(i.unitPrice * i.qty),
  }))
  const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0)
  lines.push({ label: 'Total', value: formatCurrency(total) })
  return { lines, total }
}

export function buildPreview(call: ToolCall, ctx: PreviewContext): ConfirmPreview | { error: string } {
  const input = call.input as Record<string, unknown>

  if (call.name === 'add_sale' || call.name === 'add_credit_sale') {
    const raw = (input.items as RawItem[]) ?? []
    const resolved = resolveItems(raw, ctx.products)
    if ('error' in resolved) return resolved
    const { lines } = saleLines(resolved.items)

    if (call.name === 'add_sale') {
      const payment = input.payment === 'bank' ? 'bank' : 'cash'
      return {
        kind: 'sale',
        title: 'Confirm sale',
        lines: [...lines, { label: 'Payment', value: payment === 'bank' ? 'Bank/MoMo' : 'Cash' }],
        warnings: [],
        sale: { items: resolved.items, payment },
      }
    }

    const customerName = String(input.customer_name ?? '').trim()
    if (!customerName) return { error: 'Who is buying on credit? Please say the customer name.' }
    return {
      kind: 'credit_sale',
      title: 'Confirm credit sale',
      lines: [...lines, { label: 'Customer', value: customerName }],
      warnings: ['Recorded as money owed to you.'],
      credit: {
        items: resolved.items,
        customerName,
        dueDate: input.due_date ? String(input.due_date) : null,
      },
    }
  }

  if (call.name === 'new_product') {
    const name = String(input.name ?? '').trim()
    const costPrice = Number(input.cost_price)
    const sellPrice = Number(input.sell_price)
    const qty = Number(input.qty)
    if (!name) return { error: 'What is the product name?' }
    if (!costPrice || costPrice <= 0) return { error: `What did you buy ${name} for (cost price)?` }
    if (!sellPrice || sellPrice <= 0) return { error: `What price will you sell ${name}?` }
    if (!qty || qty < 0) return { error: `How many ${name} did you buy?` }
    const payment =
      input.payment === 'bank' ? 'bank' : input.payment === 'supplier_credit' ? 'supplier_credit' : 'cash'
    const category = String(input.category ?? 'default')
    return {
      kind: 'new_product',
      title: 'Confirm new product',
      lines: [
        { label: 'Name', value: name },
        { label: 'Cost price', value: formatCurrency(costPrice) },
        { label: 'Selling price', value: formatCurrency(sellPrice) },
        { label: 'Quantity', value: String(qty) },
        { label: 'Paid with', value: payment === 'supplier_credit' ? 'Supplier credit' : payment === 'bank' ? 'Bank/MoMo' : 'Cash' },
      ],
      warnings: [],
      newProduct: { name, costPrice, sellPrice, qty, category, payment },
    }
  }

  if (call.name === 'add_stock') {
    const m = matchProduct(String(input.product ?? ''), ctx.products)
    if (m.ambiguous) return { error: `Did you mean ${m.candidates.map((c) => c.name).join(' or ')}?` }
    if (!m.product) return { error: `I couldn't find "${input.product}" in your stock.` }
    const qty = Number(input.qty)
    if (!qty || qty <= 0) return { error: `How many ${m.product.name} did you add?` }
    const unitCost = input.cost_price ? Number(input.cost_price) : m.product.cost_price
    return {
      kind: 'add_stock',
      title: 'Confirm restock',
      lines: [
        { label: 'Product', value: m.product.name },
        { label: 'Add quantity', value: String(qty) },
        { label: 'Unit cost', value: formatCurrency(unitCost) },
        { label: 'New total', value: String(m.product.quantity + qty) },
      ],
      warnings: [],
      addStock: { productId: m.product.id, productName: m.product.name, qty, unitCost },
    }
  }

  return { error: 'Unknown action.' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agent/writeTools.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/writeTools.ts src/lib/agent/writeTools.test.ts
git commit -m "feat(agent): add write-tool preview builder"
```

---

### Task 6: Preview executor (writes through the store)

**Files:**
- Create: `src/lib/agent/execute.ts`
- Test: `src/lib/agent/execute.test.ts`

**Interfaces:**
- Consumes: `ConfirmPreview` from Task 1; `uid` from `@/lib/data`; store function signatures from `src/lib/store.tsx`.
- Produces:
  - `export interface StoreExecApi { addSaleBatch: (sales: any[], items: { productId: string; qty: number }[]) => Promise<void>; addDebt: (debt: any) => Promise<void>; addProduct: (product: any, injectionId?: string | null, opts?: { account?: 'cash' | 'bank'; unpaid?: boolean }) => Promise<void>; updateProduct: (id: string, updates: any) => Promise<void>; findProductQty: (id: string) => number }`
  - `export async function executePreview(preview: ConfirmPreview, api: StoreExecApi): Promise<void>`
  - Sale/credit build mirrors `AddSaleSheet` (one `sale_group_id`, per-line `total`/`profit`, `payment_method`). Credit also creates an `owed` debt linked by `sale_group_id`. `new_product` calls `addProduct` with `opts.account`/`unpaid` from payment. `add_stock` calls `updateProduct(id, { quantity: current + qty })`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agent/execute.test.ts
import { describe, it, expect, vi } from 'vitest'
import { executePreview } from './execute'
import type { ConfirmPreview } from './types'

function fakeApi() {
  return {
    addSaleBatch: vi.fn().mockResolvedValue(undefined),
    addDebt: vi.fn().mockResolvedValue(undefined),
    addProduct: vi.fn().mockResolvedValue(undefined),
    updateProduct: vi.fn().mockResolvedValue(undefined),
    findProductQty: vi.fn().mockReturnValue(20),
  }
}

describe('executePreview', () => {
  it('writes a cash sale via addSaleBatch with matching items', async () => {
    const api = fakeApi()
    const preview: ConfirmPreview = {
      kind: 'sale', title: '', lines: [], warnings: [],
      sale: { payment: 'cash', items: [{ productId: 'p1', productName: 'Indomie', unitPrice: 3, unitCost: 2, qty: 5 }] },
    }
    await executePreview(preview, api)
    expect(api.addSaleBatch).toHaveBeenCalledTimes(1)
    const [sales, items] = api.addSaleBatch.mock.calls[0]
    expect(items).toEqual([{ productId: 'p1', qty: 5 }])
    expect(sales[0]).toMatchObject({ product_id: 'p1', quantity: 5, total: 15, profit: 5, payment_method: 'cash' })
    expect(sales[0].sale_group_id).toBeTruthy()
    expect(api.addDebt).not.toHaveBeenCalled()
  })

  it('writes a credit sale plus a linked debt', async () => {
    const api = fakeApi()
    const preview: ConfirmPreview = {
      kind: 'credit_sale', title: '', lines: [], warnings: [],
      credit: { customerName: 'Ama', dueDate: null, items: [{ productId: 'p2', productName: 'Milo', unitPrice: 8, unitCost: 4, qty: 2 }] },
    }
    await executePreview(preview, api)
    expect(api.addSaleBatch).toHaveBeenCalledTimes(1)
    const [sales] = api.addSaleBatch.mock.calls[0]
    expect(sales[0].payment_method).toBe('credit')
    expect(api.addDebt).toHaveBeenCalledTimes(1)
    const debt = api.addDebt.mock.calls[0][0]
    expect(debt).toMatchObject({ person_name: 'Ama', amount: 16, type: 'owed' })
    expect(debt.sale_group_id).toBe(sales[0].sale_group_id)
  })

  it('creates a new product with the chosen payment account', async () => {
    const api = fakeApi()
    const preview: ConfirmPreview = {
      kind: 'new_product', title: '', lines: [], warnings: [],
      newProduct: { name: 'Rice', costPrice: 40, sellPrice: 55, qty: 10, category: 'food', payment: 'supplier_credit' },
    }
    await executePreview(preview, api)
    expect(api.addProduct).toHaveBeenCalledTimes(1)
    const [product, injectionId, opts] = api.addProduct.mock.calls[0]
    expect(product).toMatchObject({ name: 'Rice', cost_price: 40, selling_price: 55, quantity: 10 })
    expect(injectionId).toBeNull()
    expect(opts).toEqual({ account: 'cash', unpaid: true })
  })

  it('adds stock to an existing product', async () => {
    const api = fakeApi()
    const preview: ConfirmPreview = {
      kind: 'add_stock', title: '', lines: [], warnings: [],
      addStock: { productId: 'p1', productName: 'Indomie', qty: 24, unitCost: 2 },
    }
    await executePreview(preview, api)
    expect(api.updateProduct).toHaveBeenCalledWith('p1', { quantity: 44 }) // 20 + 24
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agent/execute.test.ts`
Expected: FAIL — `executePreview` not defined.

- [ ] **Step 3: Implement**

```ts
// src/lib/agent/execute.ts
import { uid } from '@/lib/data'
import type { ConfirmPreview, SaleItemResolved } from './types'

export interface StoreExecApi {
  addSaleBatch: (
    sales: Record<string, unknown>[],
    items: { productId: string; qty: number }[],
  ) => Promise<void>
  addDebt: (debt: Record<string, unknown>) => Promise<void>
  addProduct: (
    product: Record<string, unknown>,
    injectionId?: string | null,
    opts?: { account?: 'cash' | 'bank'; unpaid?: boolean },
  ) => Promise<void>
  updateProduct: (id: string, updates: Record<string, unknown>) => Promise<void>
  findProductQty: (id: string) => number
  // Posts the cash actually received for a sale to the ledger (source of truth for
  // cash-in-hand / bank). Mirrors AddSaleSheet's saleMovement + postMovement.
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

function buildSaleRows(
  items: SaleItemResolved[],
  paymentMethod: 'cash' | 'bank' | 'credit',
  groupId: string,
  createdAt: string,
) {
  const sales = items.map((i) => ({
    id: uid(),
    product_id: i.productId,
    product_name: i.productName,
    quantity: i.qty,
    unit_price: i.unitPrice,
    total: i.unitPrice * i.qty,
    profit: (i.unitPrice - i.unitCost) * i.qty,
    customer_name: null,
    customer_phone: null,
    payment_method: paymentMethod,
    sale_group_id: groupId,
    sale_unit: null,
    sale_unit_qty: null,
    created_at: createdAt,
  }))
  const rowItems = items.map((i) => ({ productId: i.productId, qty: i.qty }))
  return { sales, rowItems }
}

export async function executePreview(preview: ConfirmPreview, api: StoreExecApi): Promise<void> {
  const createdAt = new Date().toISOString()
  const groupId = uid()

  if (preview.kind === 'sale' && preview.sale) {
    const method = preview.sale.payment === 'bank' ? 'bank' : 'cash'
    const { sales, rowItems } = buildSaleRows(preview.sale.items, method, groupId, createdAt)
    await api.addSaleBatch(sales, rowItems)
    return
  }

  if (preview.kind === 'credit_sale' && preview.credit) {
    const { sales, rowItems } = buildSaleRows(preview.credit.items, 'credit', groupId, createdAt)
    // Credit sales carry the customer name on each row.
    sales.forEach((s) => { s.customer_name = preview.credit!.customerName })
    await api.addSaleBatch(sales, rowItems)
    const total = preview.credit.items.reduce((s, i) => s + i.unitPrice * i.qty, 0)
    const itemCount = preview.credit.items.reduce((s, i) => s + i.qty, 0)
    await api.addDebt({
      id: uid(),
      person_name: preview.credit.customerName,
      phone: null,
      amount: total,
      amount_paid: 0,
      payments: [],
      description: `${itemCount} ${itemCount === 1 ? 'item' : 'items'} on credit`,
      type: 'owed',
      due_date: preview.credit.dueDate,
      injection_id: null,
      sale_group_id: groupId,
      is_paid: false,
      paid_at: null,
      created_at: createdAt,
    })
    return
  }

  if (preview.kind === 'new_product' && preview.newProduct) {
    const np = preview.newProduct
    const product = {
      id: uid(),
      name: np.name,
      cost_price: np.costPrice,
      selling_price: np.sellPrice,
      quantity: np.qty,
      unit: 'piece',
      units_per_pack: 1,
      category: np.category,
      low_stock_threshold: 5,
      created_at: createdAt,
    }
    const account = np.payment === 'bank' ? 'bank' : 'cash'
    const unpaid = np.payment === 'supplier_credit'
    await api.addProduct(product, null, { account, unpaid })
    return
  }

  if (preview.kind === 'add_stock' && preview.addStock) {
    const current = api.findProductQty(preview.addStock.productId)
    await api.updateProduct(preview.addStock.productId, { quantity: current + preview.addStock.qty })
    return
  }
}
```

> **Note:** `add_stock` uses `updateProduct` for a simple quantity bump in Phase 1. FIFO stock-batch creation for restocks (via `receiveStock`) is deferred to Phase 2 so costing stays exact; this is recorded in the plan's Deferred section.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agent/execute.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/execute.ts src/lib/agent/execute.test.ts
git commit -m "feat(agent): add preview executor writing through the store"
```

---

### Task 7: Agent Edge Function (Claude Haiku proxy)

**Files:**
- Create: `supabase/functions/serwaa-agent/index.ts`
- Create: `supabase/functions/serwaa-agent/tools.ts`

**Interfaces:**
- Consumes: `corsHeaders`, `json` from `../_shared/cors.ts`; env `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Produces: an HTTP endpoint at `/functions/v1/serwaa-agent`.
  - Request body: `{ userJwt: string; messages: { role: 'user'|'assistant'; content: string }[]; snapshot: BusinessSnapshot }`
  - Response body: `{ say: string; toolCalls: { name: string; input: Record<string, unknown> }[] }`

- [ ] **Step 1: Create the tool schema**

```ts
// supabase/functions/serwaa-agent/tools.ts
// Anthropic tool definitions the model may call. Kept minimal and allow-listed.
export const TOOLS = [
  {
    name: 'add_sale',
    description: 'Record a cash or bank sale of one or more products the shop already stocks.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { product: { type: 'string' }, qty: { type: 'number' } },
            required: ['product', 'qty'],
          },
        },
        payment: { type: 'string', enum: ['cash', 'bank'] },
      },
      required: ['items'],
    },
  },
  {
    name: 'add_credit_sale',
    description: 'Record a sale taken on credit (pay later). Requires the customer name.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { product: { type: 'string' }, qty: { type: 'number' } },
            required: ['product', 'qty'],
          },
        },
        customer_name: { type: 'string' },
        due_date: { type: 'string', description: 'ISO date, optional' },
      },
      required: ['items', 'customer_name'],
    },
  },
  {
    name: 'new_product',
    description: 'Add a brand new product to the shop stock.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        cost_price: { type: 'number' },
        sell_price: { type: 'number' },
        qty: { type: 'number' },
        category: { type: 'string' },
        payment: { type: 'string', enum: ['cash', 'bank', 'supplier_credit'] },
      },
      required: ['name', 'cost_price', 'sell_price', 'qty'],
    },
  },
  {
    name: 'add_stock',
    description: 'Add more quantity to a product that already exists in the shop.',
    input_schema: {
      type: 'object',
      properties: {
        product: { type: 'string' },
        qty: { type: 'number' },
        cost_price: { type: 'number' },
      },
      required: ['product', 'qty'],
    },
  },
  { name: 'get_summary', description: "Get today's or a period's sales, profit, and cash.", input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] } } } },
  { name: 'get_low_stock', description: 'List products that are low or out of stock.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_debts', description: 'List who owes the shop or who the shop owes.', input_schema: { type: 'object', properties: { direction: { type: 'string', enum: ['owed', 'owing'] } } } },
  { name: 'get_top_products', description: 'List the shop products.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_alerts', description: 'Get current business alerts (low stock, overdue debts).', input_schema: { type: 'object', properties: {} } },
] as const
```

- [ ] **Step 2: Create the edge function**

```ts
// supabase/functions/serwaa-agent/index.ts
// SerwaaBroni agent: validates the caller, calls Claude Haiku with an allow-listed
// tool schema and a compact business snapshot, and returns the model's spoken reply
// plus any tool calls for the client to preview/execute. No DB writes happen here.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { TOOLS } from './tools.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const MODEL = 'claude-haiku-4-5-20251001'

interface Body {
  userJwt?: string
  messages?: { role: 'user' | 'assistant'; content: string }[]
  snapshot?: unknown
}

function systemPrompt(snapshot: unknown): string {
  return [
    'You are SerwaaBroni, a warm, concise assistant for a Ghanaian market trader.',
    'You help record stock, record sales (cash or credit), and answer questions about the business.',
    'Amounts are in Ghana Cedis (GHS). Keep replies short and friendly, one or two sentences.',
    'To record a sale, restock, or add a product, CALL THE MATCHING TOOL — do not ask the user to open a form.',
    'The app will show the user a confirmation card before saving, so you do not need to ask "are you sure".',
    'If a product name is unclear or missing a number, ask one short question to clarify.',
    'For questions about sales, stock, debts, or alerts, call the matching get_* tool.',
    'Never invent products or numbers. Only use products from the snapshot below.',
    `Business snapshot (JSON): ${JSON.stringify(snapshot ?? {})}`,
  ].join(' ')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!body.userJwt) return json({ error: 'Unauthorized' }, 401)
  if (!Array.isArray(body.messages) || body.messages.length === 0) return json({ error: 'No messages' }, 400)

  const userClient = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error: userErr } = await userClient.auth.getUser(body.userJwt)
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)

  // Keep context small: last 4 turns only.
  const recent = body.messages.slice(-4)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: systemPrompt(body.snapshot),
      tools: TOOLS,
      messages: recent.map((m) => ({ role: m.role, content: m.content })),
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return json({ error: 'Agent upstream error', detail: detail.slice(0, 300) }, 502)
  }

  const data = await res.json()
  const blocks: Array<Record<string, unknown>> = data.content ?? []
  const say = blocks.filter((b) => b.type === 'text').map((b) => String(b.text)).join(' ').trim()
  const toolCalls = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ name: String(b.name), input: (b.input as Record<string, unknown>) ?? {} }))

  return json({ say, toolCalls })
})
```

- [ ] **Step 3: Verify it deploys (manual)**

Run:
```bash
supabase functions deploy serwaa-agent --project-ref qumttowvyujqaubyshjq
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref qumttowvyujqaubyshjq
```
Expected: deploy succeeds; secret set confirmed. (Requires the owner's Anthropic key and Supabase CLI login.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/serwaa-agent/index.ts supabase/functions/serwaa-agent/tools.ts
git commit -m "feat(agent): add serwaa-agent Claude Haiku edge function"
```

---

### Task 8: Client transport for the agent

**Files:**
- Create: `src/lib/agent/client.ts`
- Test: `src/lib/agent/client.test.ts`

**Interfaces:**
- Consumes: `AgentMessage`, `AgentResponse`, `BusinessSnapshot` from Task 1; `supabase`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` from `@/lib/supabase`.
- Produces: `export async function callAgent(messages: AgentMessage[], snapshot: BusinessSnapshot): Promise<AgentResponse>` — mirrors the `admin-impersonate` fetch pattern (anon key as Bearer, `userJwt` in body). Throws `Error` on non-OK.
  - For testability, the fetch + session are injected via an optional second-tier `Deps` object with defaults: `export async function callAgent(messages, snapshot, deps?: { getToken: () => Promise<string | null>; doFetch: typeof fetch })`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agent/client.test.ts
import { describe, it, expect, vi } from 'vitest'
import { callAgent } from './client'
import type { BusinessSnapshot } from './types'

const snap: BusinessSnapshot = {
  currency: 'GHS', todaySales: 0, todayProfit: 0, cashInHand: 0, cashInBank: 0,
  products: [], lowStock: [], owedTotal: 0, owingTotal: 0,
}

describe('callAgent', () => {
  it('posts messages + snapshot and returns the parsed response', async () => {
    const doFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ say: 'Hello', toolCalls: [{ name: 'get_summary', input: {} }] }),
    }) as unknown as typeof fetch
    const getToken = vi.fn().mockResolvedValue('jwt-123')

    const r = await callAgent([{ role: 'user', content: 'hi' }], snap, { getToken, doFetch })

    expect(r.say).toBe('Hello')
    expect(r.toolCalls[0].name).toBe('get_summary')
    const [, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent.userJwt).toBe('jwt-123')
    expect(sent.messages).toHaveLength(1)
    expect(sent.snapshot.currency).toBe('GHS')
  })

  it('throws when not signed in', async () => {
    const doFetch = vi.fn() as unknown as typeof fetch
    const getToken = vi.fn().mockResolvedValue(null)
    await expect(callAgent([{ role: 'user', content: 'hi' }], snap, { getToken, doFetch })).rejects.toThrow()
  })

  it('throws on a non-OK response', async () => {
    const doFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'boom' }) }) as unknown as typeof fetch
    const getToken = vi.fn().mockResolvedValue('jwt')
    await expect(callAgent([{ role: 'user', content: 'hi' }], snap, { getToken, doFetch })).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agent/client.test.ts`
Expected: FAIL — `callAgent` not defined.

- [ ] **Step 3: Implement**

```ts
// src/lib/agent/client.ts
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import type { AgentMessage, AgentResponse, BusinessSnapshot } from './types'

interface Deps {
  getToken: () => Promise<string | null>
  doFetch: typeof fetch
}

const defaultDeps: Deps = {
  getToken: async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  },
  doFetch: (...args) => fetch(...args),
}

export async function callAgent(
  messages: AgentMessage[],
  snapshot: BusinessSnapshot,
  deps: Deps = defaultDeps,
): Promise<AgentResponse> {
  const token = await deps.getToken()
  if (!token) throw new Error('You are not signed in.')

  const res = await deps.doFetch(`${SUPABASE_URL}/functions/v1/serwaa-agent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userJwt: token, messages, snapshot }),
  })

  const data = await res.json().catch(() => ({}) as Record<string, unknown>)
  if (!(res as Response).ok) {
    throw new Error((data as { error?: string }).error || 'The agent could not respond. Please try again.')
  }
  return {
    say: String((data as AgentResponse).say ?? ''),
    toolCalls: Array.isArray((data as AgentResponse).toolCalls) ? (data as AgentResponse).toolCalls : [],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agent/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/client.ts src/lib/agent/client.test.ts
git commit -m "feat(agent): add client transport for serwaa-agent"
```

---

### Task 9: Browser speech (STT + TTS)

**Files:**
- Create: `src/lib/agent/speech.ts`

**Interfaces:**
- Consumes: Web Speech API (`window.SpeechRecognition` / `webkitSpeechRecognition`, `window.speechSynthesis`), types from `src/types/speech.d.ts`.
- Produces:
  - `export function speechSupported(): boolean`
  - `export function listenOnce(opts?: { lang?: string }): Promise<string>` — resolves with the final transcript, rejects on error/no-speech.
  - `export function speak(text: string, opts?: { lang?: string }): void`

- [ ] **Step 1: Implement (thin wrapper; verified manually in Task 11)**

```ts
// src/lib/agent/speech.ts
// Phase 1: English via the browser Web Speech API. Twi (Khaya) arrives in Phase 2.
function getRecognition(): SpeechRecognition | null {
  const Ctor =
    (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

export function speechSupported(): boolean {
  return getRecognition() !== null
}

export function listenOnce(opts?: { lang?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const rec = getRecognition()
    if (!rec) return reject(new Error('Voice input is not supported on this device.'))
    rec.lang = opts?.lang ?? 'en-GH'
    rec.interimResults = false
    rec.maxAlternatives = 1
    let finished = false
    rec.onresult = (e: SpeechRecognitionEvent) => {
      finished = true
      const transcript = e.results[0]?.[0]?.transcript ?? ''
      resolve(transcript.trim())
    }
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      finished = true
      reject(new Error(e.error || 'Could not hear you. Please try again.'))
    }
    rec.onend = () => {
      if (!finished) reject(new Error('I did not catch that. Please try again.'))
    }
    rec.start()
  })
}

export function speak(text: string, opts?: { lang?: string }): void {
  if (!('speechSynthesis' in window) || !text) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = opts?.lang ?? 'en-GH'
  u.rate = 1
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors. (If `SpeechSynthesisUtterance` is flagged, confirm `dom` lib is in `tsconfig.app.json` `lib`; it is via Vite defaults.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/speech.ts
git commit -m "feat(agent): add browser speech STT/TTS wrapper"
```

---

### Task 10: `useAgent` turn-loop hook

**Files:**
- Create: `src/hooks/useAgent.ts`
- Test: `src/hooks/useAgent.test.ts`

**Interfaces:**
- Consumes: `useStore` from `@/lib/store`; `buildSnapshot`, `callAgent`, `runReadTool`, `buildPreview`, `executePreview`, speech helpers.
- Produces a hook returning:
  - `messages: { role: 'user'|'assistant'; content: string }[]`
  - `pending: ConfirmPreview | null`
  - `busy: boolean`
  - `sendText(text: string): Promise<void>`
  - `confirm(): Promise<void>` — executes `pending`, clears it, appends a done message
  - `cancel(): void` — clears `pending`
- The pure turn logic is extracted into `export async function runTurn(...)` so it can be unit-tested without React. `useAgent` is a thin wrapper over `runTurn` + `useState`.

**Note on testing:** unit-test the pure `runTurn` (below). The React wrapper is exercised manually in Task 12.

- [ ] **Step 1: Write the failing test for `runTurn`**

```ts
// src/hooks/useAgent.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runTurn } from './useAgent'
import type { BusinessSnapshot } from '@/lib/agent/types'
import type { Product } from '@/lib/supabase'

const snap: BusinessSnapshot = {
  currency: 'GHS', todaySales: 500, todayProfit: 120, cashInHand: 300, cashInBank: 700,
  products: [], lowStock: [], owedTotal: 0, owingTotal: 0,
}
const products: Product[] = [{
  id: 'p1', user_id: 'u', name: 'Indomie', cost_price: 2, selling_price: 3, quantity: 20,
  unit: 'pc', units_per_pack: 1, category: 'food', low_stock_threshold: 5, created_at: '2026-07-01T00:00:00Z',
}]

const readCtx = { products, sales: [], debts: [], expenses: [], snapshot: snap }

describe('runTurn', () => {
  it('answers a read query with spoken text and no pending preview', async () => {
    const callAgent = vi.fn().mockResolvedValue({ say: '', toolCalls: [{ name: 'get_summary', input: { period: 'daily' } }] })
    const out = await runTurn('how are sales today', {
      history: [], snapshot: snap, readCtx, previewCtx: { products }, callAgent,
    })
    expect(out.reply).toContain('500')
    expect(out.pending).toBeNull()
  })

  it('returns a pending confirm preview for a sale', async () => {
    const callAgent = vi.fn().mockResolvedValue({
      say: 'Okay', toolCalls: [{ name: 'add_sale', input: { items: [{ product: 'indomie', qty: 5 }], payment: 'cash' } }],
    })
    const out = await runTurn('sell 5 indomie cash', {
      history: [], snapshot: snap, readCtx, previewCtx: { products }, callAgent,
    })
    expect(out.pending?.kind).toBe('sale')
    expect(out.reply.toLowerCase()).toContain('confirm')
  })

  it('surfaces a clarify question when the write tool errors', async () => {
    const callAgent = vi.fn().mockResolvedValue({
      say: '', toolCalls: [{ name: 'add_sale', input: { items: [{ product: 'zzz', qty: 5 }] } }],
    })
    const out = await runTurn('sell 5 zzz', {
      history: [], snapshot: snap, readCtx, previewCtx: { products }, callAgent,
    })
    expect(out.pending).toBeNull()
    expect(out.reply).toContain("couldn't find")
  })

  it('falls back to the model text when there are no tool calls', async () => {
    const callAgent = vi.fn().mockResolvedValue({ say: 'Hello Auntie!', toolCalls: [] })
    const out = await runTurn('hi', { history: [], snapshot: snap, readCtx, previewCtx: { products }, callAgent })
    expect(out.reply).toBe('Hello Auntie!')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useAgent.test.ts`
Expected: FAIL — `runTurn` not defined.

- [ ] **Step 3: Implement**

```ts
// src/hooks/useAgent.ts
import { useCallback, useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { buildSnapshot } from '@/lib/agent/snapshot'
import { callAgent as defaultCallAgent } from '@/lib/agent/client'
import { runReadTool, type ReadContext } from '@/lib/agent/readTools'
import { buildPreview, type PreviewContext } from '@/lib/agent/writeTools'
import { executePreview, type StoreExecApi } from '@/lib/agent/execute'
import { postMovement, type NewMovement } from '@/services/cashApi'
import { listenOnce, speak, speechSupported } from '@/lib/agent/speech'
import type { AgentMessage, BusinessSnapshot, ConfirmPreview, AgentResponse } from '@/lib/agent/types'

interface TurnDeps {
  history: AgentMessage[]
  snapshot: BusinessSnapshot
  readCtx: ReadContext
  previewCtx: PreviewContext
  callAgent: (messages: AgentMessage[], snapshot: BusinessSnapshot) => Promise<AgentResponse>
}

export interface TurnOutcome {
  reply: string
  pending: ConfirmPreview | null
}

export async function runTurn(userText: string, deps: TurnDeps): Promise<TurnOutcome> {
  const messages: AgentMessage[] = [...deps.history, { role: 'user', content: userText }]
  const res = await deps.callAgent(messages, deps.snapshot)

  const call = res.toolCalls[0]
  if (!call) {
    return { reply: res.say || "I'm here. Tell me a sale, a restock, or ask about your business.", pending: null }
  }

  // Read tool → answer immediately.
  const read = runReadTool(call, deps.readCtx)
  if (read) return { reply: read.text, pending: null }

  // Write tool → build a confirm preview or a clarify question.
  const preview = buildPreview(call, deps.previewCtx)
  if ('error' in preview) return { reply: preview.error, pending: null }
  const spoken = res.say ? `${res.say} Please confirm.` : `Please confirm this ${preview.kind.replace('_', ' ')}.`
  return { reply: spoken, pending: preview }
}

export function useAgent() {
  const store = useStore()
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [pending, setPending] = useState<ConfirmPreview | null>(null)
  const [busy, setBusy] = useState(false)

  const snapshot = useMemo(
    () =>
      buildSnapshot({
        products: store.state.products,
        debts: store.state.debts,
        todaySales: store.state.todaySales ?? 0,
        todayProfit: store.state.todayProfit ?? 0,
        cashInHand: store.state.balance ?? 0,
        cashInBank: store.state.bankBalance ?? 0,
      }),
    [store.state.products, store.state.debts, store.state.todaySales, store.state.todayProfit, store.state.balance, store.state.bankBalance],
  )

  const execApi: StoreExecApi = useMemo(
    () => ({
      addSaleBatch: store.addSaleBatch as StoreExecApi['addSaleBatch'],
      addDebt: store.addDebt as StoreExecApi['addDebt'],
      addProduct: store.addProduct as StoreExecApi['addProduct'],
      updateProduct: store.updateProduct as StoreExecApi['updateProduct'],
      findProductQty: (id: string) => store.state.products.find((p) => p.id === id)?.quantity ?? 0,
      // Cast at the boundary: the executor types category as a plain string to
      // stay decoupled from cashApi; here it is always a valid CashCategory ('sale').
      postMovement: (mv) => postMovement(mv as NewMovement),
    }),
    [store],
  )

  const sendText = useCallback(
    async (text: string) => {
      const clean = text.trim()
      if (!clean || busy) return
      setBusy(true)
      setMessages((m) => [...m, { role: 'user', content: clean }])
      try {
        const readCtx: ReadContext = {
          products: store.state.products,
          sales: store.state.sales,
          debts: store.state.debts,
          expenses: store.state.expenses,
          snapshot,
        }
        const out = await runTurn(clean, {
          history: messages,
          snapshot,
          readCtx,
          previewCtx: { products: store.state.products },
          callAgent: defaultCallAgent,
        })
        setMessages((m) => [...m, { role: 'assistant', content: out.reply }])
        setPending(out.pending)
        speak(out.reply)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Something went wrong.'
        setMessages((m) => [...m, { role: 'assistant', content: msg }])
        speak(msg)
      } finally {
        setBusy(false)
      }
    },
    [busy, messages, snapshot, store.state],
  )

  const listen = useCallback(async () => {
    if (!speechSupported()) {
      setMessages((m) => [...m, { role: 'assistant', content: 'Voice is not available on this device. Please type.' }])
      return
    }
    try {
      const heard = await listenOnce({ lang: 'en-GH' })
      if (heard) await sendText(heard)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not hear you.'
      setMessages((m) => [...m, { role: 'assistant', content: msg }])
    }
  }, [sendText])

  const confirm = useCallback(async () => {
    if (!pending) return
    setBusy(true)
    try {
      await executePreview(pending, execApi)
      const done = 'Done. I have saved it.'
      setMessages((m) => [...m, { role: 'assistant', content: done }])
      speak(done)
    } catch {
      const msg = 'I could not save it. Please try again.'
      setMessages((m) => [...m, { role: 'assistant', content: msg }])
    } finally {
      setPending(null)
      setBusy(false)
    }
  }, [pending, execApi])

  const cancel = useCallback(() => {
    setPending(null)
    setMessages((m) => [...m, { role: 'assistant', content: 'Okay, cancelled.' }])
  }, [])

  return { messages, pending, busy, sendText, listen, confirm, cancel }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useAgent.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify the full suite still passes**

Run: `npx vitest run`
Expected: all tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAgent.ts src/hooks/useAgent.test.ts
git commit -m "feat(agent): add useAgent turn-loop hook"
```

---

### Task 11: Confirm card component

**Files:**
- Create: `src/components/agent/ConfirmCard.tsx`

**Interfaces:**
- Consumes: `ConfirmPreview` from Task 1.
- Produces: `export default function ConfirmCard({ preview, busy, onConfirm, onCancel }: { preview: ConfirmPreview; busy: boolean; onConfirm: () => void; onCancel: () => void })`.

- [ ] **Step 1: Implement**

```tsx
// src/components/agent/ConfirmCard.tsx
import type { ConfirmPreview } from '@/lib/agent/types'

export default function ConfirmCard({
  preview, busy, onConfirm, onCancel,
}: {
  preview: ConfirmPreview
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="bg-light harsh-border rounded-sm p-4 space-y-3">
      <p className="font-display text-sm uppercase tracking-wide text-ink">{preview.title}</p>

      <div className="space-y-1.5">
        {preview.lines.map((l, i) => (
          <div key={i} className="flex justify-between items-center text-sm">
            <span className="text-ink/80">{l.label}</span>
            <span className="font-medium">{l.value}</span>
          </div>
        ))}
      </div>

      {preview.warnings.length > 0 && (
        <div className="space-y-1">
          {preview.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-muted-text italic">{w}</p>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={busy}
          className="btn-tactile flex-1 py-3 rounded-sm border-2 border-ink bg-white text-sm uppercase tracking-wide disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="btn-tactile flex-1 py-3 rounded-sm bg-accent-green text-white text-sm uppercase tracking-wide disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Confirm ✓'}
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
git add src/components/agent/ConfirmCard.tsx
git commit -m "feat(agent): add confirm card component"
```

---

### Task 12: Agent sheet UI + entry point

**Files:**
- Create: `src/components/agent/AgentSheet.tsx`
- Modify: `src/pages/Home.tsx` (add the floating mic FAB that opens the sheet)

**Interfaces:**
- Consumes: `useAgent` (Task 10), `ConfirmCard` (Task 11), existing `Sheet` UI from `@/components/ui/sheet`, `Mic` icon from `lucide-react`.
- Produces: `export default function AgentSheet({ open, onClose }: { open: boolean; onClose: () => void })`.

- [ ] **Step 1: Implement the sheet**

```tsx
// src/components/agent/AgentSheet.tsx
import { useState } from 'react'
import { Mic, Send } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useAgent } from '@/hooks/useAgent'
import ConfirmCard from './ConfirmCard'

export default function AgentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { messages, pending, busy, sendText, listen, confirm, cancel } = useAgent()
  const [text, setText] = useState('')

  const submit = async () => {
    const t = text
    setText('')
    await sendText(t)
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl h-[85vh] flex flex-col">
        <SheetHeader>
          <SheetTitle>SerwaaBroni</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-3">
          {messages.length === 0 && (
            <p className="text-sm text-muted-text text-center py-8">
              Tap the mic and speak, or type. Try: “Sold 5 Indomie for cash”, “Add 24 Milo to stock”, or “How are sales today?”
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <span
                className={`inline-block px-3 py-2 rounded-sm text-sm max-w-[85%] ${
                  m.role === 'user' ? 'bg-ink text-white' : 'bg-warm-gray text-ink'
                }`}
              >
                {m.content}
              </span>
            </div>
          ))}
          {pending && (
            <ConfirmCard preview={pending} busy={busy} onConfirm={confirm} onCancel={cancel} />
          )}
        </div>

        <div className="flex items-center gap-2 pt-2 pb-[env(safe-area-inset-bottom)]">
          <button
            onClick={listen}
            disabled={busy}
            aria-label="Speak"
            className="btn-tactile w-12 h-12 shrink-0 rounded-full bg-accent-green text-white flex items-center justify-center disabled:opacity-50"
          >
            <Mic size={20} />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Type a message…"
            className="flex-1 harsh-border rounded-sm px-3 py-2 text-sm"
          />
          <button
            onClick={submit}
            disabled={busy || !text.trim()}
            aria-label="Send"
            className="btn-tactile w-12 h-12 shrink-0 rounded-full bg-ink text-white flex items-center justify-center disabled:opacity-50"
          >
            <Send size={18} />
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Add the FAB to Home**

In `src/pages/Home.tsx`: add `import { useState } from 'react'` (if not present), `import { Mic } from 'lucide-react'`, and `import AgentSheet from '@/components/agent/AgentSheet'`. Inside the component add state and render a floating button + the sheet. Insert near the end of the top-level returned JSX (as a sibling, before the closing wrapper):

```tsx
{/* SerwaaBroni agent */}
<button
  onClick={() => setAgentOpen(true)}
  aria-label="Open SerwaaBroni"
  className="fixed right-4 bottom-24 z-40 w-14 h-14 rounded-full bg-accent-green text-white shadow-lg flex items-center justify-center btn-tactile"
>
  <Mic size={24} />
</button>
<AgentSheet open={agentOpen} onClose={() => setAgentOpen(false)} />
```

And add near the top of the component body:

```tsx
const [agentOpen, setAgentOpen] = useState(false)
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc -b && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual end-to-end verification**

Prereq: `serwaa-agent` deployed and `ANTHROPIC_API_KEY` set (Task 7).
Run: `npm run dev`, sign in, open the mic FAB on Home. Verify each:
1. Type "How are sales today?" → spoken + text summary with today's figures.
2. Type "Sell 5 Indomie for cash" (use a product you stock) → a **Confirm sale** card with correct total; tap Confirm → toast "Sale recorded", stock drops by 5, sale appears in Sales History.
3. Type "Ama took 2 Milo on credit" → **Confirm credit sale** card; Confirm → debt appears under "They owe you" for Ama.
4. Type "Add a new product Rice, cost 40, sell 55, 10 pieces" → **Confirm new product**; Confirm → product appears in Inventory.
5. Type "Add 24 to Indomie stock" → **Confirm restock**; Confirm → Indomie quantity increases by 24.
6. Tap the mic, speak one of the above in English → transcript appears and flows through the same path.

- [ ] **Step 5: Commit**

```bash
git add src/components/agent/AgentSheet.tsx src/pages/Home.tsx
git commit -m "feat(agent): add SerwaaBroni sheet UI and Home entry point"
```

---

### Task 13: Docs — setup & deploy notes

**Files:**
- Modify: `DEPLOY.md` (append a "SerwaaBroni agent" section)
- Modify: `.env.example` (note: no client env needed; keys are Supabase secrets)

**Interfaces:** none (documentation).

- [ ] **Step 1: Append deploy notes to `DEPLOY.md`**

Add this section at the end:

```markdown
## SerwaaBroni agent (Phase 1)

The agent brain runs in the `serwaa-agent` edge function and calls Claude Haiku.

1. Set the Anthropic key as a Supabase secret (never in the SPA):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <ref>
   ```
2. Deploy the function:
   ```bash
   supabase functions deploy serwaa-agent --project-ref <ref>
   ```
3. No client env vars are required — the app authenticates with the user's
   Supabase session, exactly like `admin-impersonate`.

Cost: model is `claude-haiku-4-5-20251001`, context capped to the last 4 turns
plus a compact snapshot (~1–2K tokens/turn).
```

- [ ] **Step 2: Note in `.env.example`**

Append:
```
# SerwaaBroni agent: no client env needed.
# Set ANTHROPIC_API_KEY as a Supabase secret (see DEPLOY.md).
```

- [ ] **Step 3: Commit**

```bash
git add DEPLOY.md .env.example
git commit -m "docs(agent): add SerwaaBroni setup and deploy notes"
```

---

## Deferred to Phase 2 / 3 (out of scope here)

- Twi ASR + TTS via GhanaNLP Khaya (+ a `serwaa-speech` edge function holding `KHAYA_API_KEY`); slot-by-slot re-ask by voice.
- FIFO stock-batch creation on restock (`receiveStock`) instead of a plain quantity bump.
- Multi-unit (pack/piece) sales in voice; `sale_unit`/`sale_unit_qty` handling.
- Editing/deleting existing records by voice.
- Proactive spoken alerts and a daily voice briefing.
- Per-tenant monthly usage cap table + billing/paid-tier gating.

## Self-Review

- **Spec coverage:** stock/restock (Tasks 5,6,7,10,12), cash+credit sales (Tasks 5,6,7,10,12), real-time info+alerts (Tasks 4,7,10), confirm-before-write (Tasks 6,11,12), Claude-via-edge-function (Task 7), keep-cheap Haiku+snapshot (Tasks 2,7), security/JWT (Tasks 7,8). Voice-first English (Task 9,10,12). Twi/Khaya explicitly deferred to Phase 2 per spec phasing. ✓
- **Placeholder scan:** no TBD/TODO; every code step has complete code. ✓
- **Type consistency:** `ConfirmPreview`, `SaleItemResolved`, `AgentToolName`, `BusinessSnapshot`, `runTurn`, `buildPreview`, `runReadTool`, `executePreview`, `callAgent`, `StoreExecApi` names match across tasks. ✓
